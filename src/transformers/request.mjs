/**
 * Request transformation functions that convert OpenAI API format to Gemini API format.
 * Handles message transformation, configuration mapping, and tool definitions.
 */
import { HttpError } from '../utils/error.mjs';
import { parseImg, getBudgetFromLevel, adjustSchema } from '../utils/helpers.mjs';
import { reduceSystemMessage } from '../utils/token-reducer.mjs';
import { FIELDS_MAP, SAFETY_SETTINGS, REASONING_EFFORT_MAP, THINKING_MODES } from '../constants/index.mjs';

/**
 * Transforms OpenAI-style request configuration parameters to Gemini API format.
 * Maps parameter names and handles special cases like response formatting and thinking configuration.
 * Uses responseJsonSchema for JSON schema response formats.
 * Sets default values: temperature=0.1, top_p=0.9 when not provided.
 *
 * @param {Object} req - OpenAI request object containing configuration parameters
 * @param {number} [req.temperature] - Sampling temperature (0-2), defaults to 0.1
 * @param {number} [req.top_p] - Top-p sampling parameter (0-1), defaults to 0.9
 * @param {number} [req.max_tokens] - Maximum tokens to generate
 * @param {string} [req.reasoning_effort] - Reasoning effort level for thinking models
 * @param {Object} [req.response_format] - Desired response format specification
 * @param {Object} [thinkingConfig] - Additional thinking configuration from model parsing
 * @param {number} [thinkingConfig.thinkingBudget] - Token budget for reasoning
 * @param {boolean} [thinkingConfig.includeThoughts] - Whether to include reasoning in output
 * @returns {Object} Gemini-compatible generation configuration
 * @throws {HttpError} When unsupported response format is specified
 */
export const transformConfig = (req, thinkingConfig = null) => {
  let cfg = {};

  // Map OpenAI parameter names to Gemini equivalents
  for (let key in req) {
    const matchedKey = FIELDS_MAP[key];
    if (matchedKey) {
      if (key === "reasoning_effort") {
        // Convert reasoning effort level to thinking budget
        const budget = getBudgetFromLevel(req[key]);
        if (budget > 0) {
          cfg.thinkingConfig = cfg.thinkingConfig || {};
          cfg.thinkingConfig.thinkingBudget = budget;
        }
      } else {
        cfg[matchedKey] = req[key];
      }
    }
  }

  // Set temperature if not provided
  if (cfg.temperature === undefined) {
    cfg.temperature = 0.1;
  }
  // Force ovveride topP
  cfg.topP = 0.9;

  // Apply thinking configuration from model name parsing
  if (thinkingConfig) {
    cfg.thinkingConfig = cfg.thinkingConfig || {};
    Object.assign(cfg.thinkingConfig, thinkingConfig);
  }

  // Handle response format specifications
  if (req.response_format) {
    switch (req.response_format.type) {
      case "json_schema":
        // Use responseJsonSchema for JSON schema response formats
        cfg.responseJsonSchema = req.response_format.json_schema?.schema;
        if (cfg.responseJsonSchema && "enum" in cfg.responseJsonSchema) {
          cfg.responseMimeType = "text/x.enum";
          break;
        }
        // eslint-disable-next-line no-fallthrough
      case "json_object":
        cfg.responseMimeType = "application/json";
        break;
      case "text":
        cfg.responseMimeType = "text/plain";
        break;
      default:
        throw new HttpError("Unsupported response_format.type", 400);
    }
  }
  return cfg;
};

/**
 * Transforms OpenAI message content to Gemini-compatible parts format.
 * Handles text, images, and audio content types with appropriate format conversion.
 *
 * @param {Object} message - OpenAI message object
 * @param {string|Array} message.content - Message content (string or array of content parts)
 * @returns {Promise<Array>} Array of Gemini-compatible content parts
 * @throws {HttpError} When unsupported content type is encountered
 */
export const transformMsg = async ({ content }) => {
  const parts = [];

  if (!Array.isArray(content)) {
    // Simple text content for system, user, or assistant messages
    parts.push({ text: content });
    return parts;
  }

  // Multi-part content with text, images, or audio
  for (const item of content) {
    switch (item.type) {
      case "text":
        parts.push({ text: item.text });
        break;
      case "image_url":
        parts.push(await parseImg(item.image_url.url));
        break;
      case "input_audio":
        parts.push({
          inlineData: {
            mimeType: "audio/" + item.input_audio.format,
            data: item.input_audio.data,
          }
        });
        break;
      default:
        throw new HttpError(`Unknown "content" item type: "${item.type}"`, 400);
    }
  }

  // Ensure at least one text part exists for image-only messages
  if (content.every(item => item.type === "image_url")) {
    parts.push({ text: "" });
  }
  return parts;
};

/**
 * Transforms OpenAI function/tool response to Gemini function response format.
 * Validates the response content and maps it to the corresponding function call.
 *
 * @param {Object} item - OpenAI tool message object
 * @param {string} item.content - JSON string containing function response data
 * @param {string} item.tool_call_id - ID linking response to original function call
 * @param {Object} parts - Parts array being built, with calls metadata
 * @param {Object} parts.calls - Map of tool_call_id to call metadata
 * @throws {HttpError} When function call context is missing or response is invalid
 */
export const transformFnResponse = ({ content, tool_call_id }, parts) => {
  if (!parts.calls) {
    throw new HttpError("No function calls found in the previous message", 400);
  }

  // Parse and validate function response content
  let response;
  try {
    response = JSON.parse(content);
  } catch (err) {
    console.error("Error parsing function response content:", err);
    throw new HttpError("Invalid function response: " + content, 400);
  }

  // Wrap primitive responses in result object for consistency
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    response = { result: response };
  }

  if (!tool_call_id) {
    throw new HttpError("tool_call_id not specified", 400);
  }

  // Validate tool call ID exists and hasn't been used
  const { i, name } = parts.calls[tool_call_id] ?? {};
  if (!name) {
    throw new HttpError("Unknown tool_call_id: " + tool_call_id, 400);
  }
  if (parts[i]) {
    throw new HttpError("Duplicated tool_call_id: " + tool_call_id, 400);
  }

  parts[i] = {
    functionResponse: {
      id: tool_call_id.startsWith("call_") ? null : tool_call_id,
      name,
      response,
    }
  };
};

/**
 * Transforms OpenAI tool calls to Gemini function call format.
 * Parses function arguments and creates mapping for response correlation.
 *
 * @param {Object} message - OpenAI assistant message with tool calls
 * @param {Array} message.tool_calls - Array of tool call objects
 * @returns {Array} Array of Gemini function call parts with calls metadata
 * @throws {HttpError} When unsupported tool type or invalid arguments are encountered
 */
export const transformFnCalls = ({ tool_calls }) => {
  const calls = {};
  const parts = tool_calls.map(({ function: { arguments: argstr, name }, id, type }, i) => {
    if (type !== "function") {
      throw new HttpError(`Unsupported tool_call type: "${type}"`, 400);
    }

    // Parse function arguments from JSON string
    let args;
    try {
      args = JSON.parse(argstr);
    } catch (err) {
      console.error("Error parsing function arguments:", err);
      throw new HttpError("Invalid function arguments: " + argstr, 400);
    }

    // Store call metadata for response correlation
    calls[id] = {i, name};
    return {
      functionCall: {
        id: id.startsWith("call_") ? null : id,
        name,
        args,
      }
    };
  });

  // Attach calls metadata to parts array for response processing
  parts.calls = calls;
  return parts;
};

/**
 * Transforms OpenAI conversation messages to Gemini format.
 * Handles role mapping, system instructions, and function call sequences.
 *
 * @param {Array} messages - Array of OpenAI conversation messages
 * @returns {Promise<Object>} Object with system_instruction and contents for Gemini API
 * @throws {HttpError} When unknown message role is encountered
 */
export const transformMessages = async (messages) => {
  if (!messages) { return; }

  const contents = [];
  let system_instruction;

  for (const item of messages) {
    switch (item.role) {
      case "system":
        // Extract system instruction separately from conversation flow
        // Apply token reduction to system message content
        const optimizedItem = { ...item };
        if (typeof item.content === 'string') {
          optimizedItem.content = reduceSystemMessage(item.content);
        } else if (Array.isArray(item.content)) {
          // Handle multi-part content by reducing text parts only
          optimizedItem.content = item.content.map(part => {
            if (part.type === 'text' && typeof part.text === 'string') {
              return { ...part, text: reduceSystemMessage(part.text) };
            }
            return part;
          });
        }
        system_instruction = { parts: await transformMsg(optimizedItem) };
        continue;

      case "tool":
        // Handle function response messages by grouping with previous function calls
        // eslint-disable-next-line no-case-declarations
        let { role, parts } = contents[contents.length - 1] ?? {};
        if (role !== "function") {
          // Create new function response group if needed
          const calls = parts?.calls;
          parts = [];
          parts.calls = calls;
          contents.push({
            role: "function",
            parts
          });
        }
        transformFnResponse(item, parts);
        continue;

      case "assistant":
        // Map assistant role to model for Gemini API
        item.role = "model";
        break;

      case "user":
        // User role maps directly
        break;

      default:
        throw new HttpError(`Unknown message role: "${item.role}"`, 400);
    }

    contents.push({
      role: item.role,
      parts: item.tool_calls ? transformFnCalls(item) : await transformMsg(item)
    });
  }

  // Ensure conversation starts with user message when system instruction exists
  if (system_instruction) {
    if (!contents[0]?.parts.some(part => part.text)) {
      contents.unshift({ role: "user", parts: { text: " " } });
    }
  }

  return { system_instruction, contents };
};

/**
 * Transforms OpenAI tools and tool choice configuration to Gemini format.
 * Handles function declarations and calling mode configuration.
 * Applies schema adjustments to ensure Gemini API compatibility.
 *
 * @param {Object} req - OpenAI request object
 * @param {Array} [req.tools] - Array of tool definitions
 * @param {Object|string} [req.tool_choice] - Tool calling preference
 * @returns {Object} Object with tools and tool_config for Gemini API
 */
export const transformTools = (req) => {
  let tools, tool_config;

  if (req.tools) {
    // Extract function tool schemas and apply Gemini compatibility adjustments
    const funcs = req.tools.filter(tool => tool.type === "function");
    // Apply schema adjustments to remove unsupported properties and ensure compatibility
    funcs.forEach(schema => {
      adjustSchema(schema);
    });
    tools = [{ function_declarations: funcs.map(schema => schema.function) }];
  }

  if (req.tool_choice) {
    // Configure function calling behavior based on tool choice
    const allowed_function_names = req.tool_choice?.type === "function"
      ? [req.tool_choice?.function?.name]
      : undefined;

    if (allowed_function_names || typeof req.tool_choice === "string") {
      tool_config = {
        function_calling_config: {
          mode: allowed_function_names ? "ANY" : req.tool_choice.toUpperCase(),
          allowed_function_names
        }
      };
    }
  }

  return { tools, tool_config };
};

/**
 * Main request transformation function that combines all transformations.
 * Converts complete OpenAI request to Gemini API format.
 *
 * @param {Object} req - Complete OpenAI chat completion request
 * @param {Object} [thinkingConfig] - Optional thinking configuration from model parsing
 * @returns {Promise<Object>} Complete Gemini API request object
 */
export const transformRequest = async (req, thinkingConfig = null) => ({
  ...await transformMessages(req.messages),
  safetySettings: SAFETY_SETTINGS,
  generationConfig: transformConfig(req, thinkingConfig),
  ...transformTools(req),
});
