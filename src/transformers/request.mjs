/**
 * Request transformation functions that convert OpenAI API format to Gemini API format.
 * Handles message transformation, configuration mapping, and tool definitions.
 */
import { HttpError } from '../utils/error.mjs';
import { parseImg, getBudgetFromLevel, adjustSchema } from '../utils/helpers.mjs';
import { FIELDS_MAP, SAFETY_SETTINGS, REASONING_EFFORT_MAP, THINKING_MODES } from '../constants/index.mjs';

/**
 * Transforms OpenAI-style request configuration parameters to Gemini API format.
 * Maps parameter names and handles special cases like response formatting and thinking configuration.
 * Uses responseJsonSchema for JSON schema response formats.
 *
 * @param {Object} req - OpenAI request object containing configuration parameters
 * @param {number} [req.temperature] - Sampling temperature (0-2)
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
  const generationConfig = {};
  const customConfig = {};

  // Map OpenAI parameter names to Gemini equivalents for generationConfig
  for (const key of Object.keys(req)) {
    const matchedKey = FIELDS_MAP[key];
    if (matchedKey) {
      switch (key) {
        case "max_tokens":
          // Ensure max_output_tokens is a positive integer
          const maxOutputTokens = parseInt(req[key], 10);
          if (!isNaN(maxOutputTokens) && maxOutputTokens > 0) {
            generationConfig[matchedKey] = maxOutputTokens;
          } else {
            console.warn(`Invalid max_tokens value: ${req[key]}. Must be a positive integer.`);
          }
          break;
        case "temperature":
          // Ensure temperature is a valid float between 0.0 and 2.0
          const temperature = parseFloat(req[key]);
          if (!isNaN(temperature) && temperature >= 0.0 && temperature <= 2.0) {
            generationConfig[matchedKey] = temperature;
          } else {
            console.warn(`Invalid temperature value: ${req[key]}. Must be between 0.0 and 2.0.`);
          }
          break;
        case "top_p":
          // Ensure top_p is a valid float between 0.0 and 1.0
          const topP = parseFloat(req[key]);
          if (!isNaN(topP) && topP >= 0.0 && topP <= 1.0) {
            generationConfig[matchedKey] = topP;
          } else {
            console.warn(`Invalid top_p value: ${req[key]}. Must be between 0.0 and 1.0.`);
          }
          break;
        case "top_k":
          // Ensure top_k is a non-negative integer
          const topK = parseInt(req[key], 10);
          if (!isNaN(topK) && topK >= 0) {
            generationConfig[matchedKey] = topK;
          } else {
            console.warn(`Invalid top_k value: ${req[key]}. Must be a non-negative integer.`);
          }
          break;
        case "stop_sequences":
          // Ensure stop_sequences is an array of strings
          if (Array.isArray(req[key]) && req[key].every(item => typeof item === 'string')) {
            generationConfig[matchedKey] = req[key];
          } else {
            console.warn(`Invalid stop_sequences value: ${req[key]}. Must be an array of strings.`);
          }
          break;
        case "reasoning_effort":
          const budget = getBudgetFromLevel(req[key]);
          if (budget > 0) {
            customConfig.thinkingConfig = customConfig.thinkingConfig || {};
            customConfig.thinkingConfig.thinkingBudget = budget;
          }
          break;
        default:
          // For other mapped fields, directly assign to generationConfig
          generationConfig[matchedKey] = req[key];
          break;
      }
    }
  }

  // Apply thinking configuration from model name parsing
  if (thinkingConfig) {
    customConfig.thinkingConfig = customConfig.thinkingConfig || {};
    Object.assign(customConfig.thinkingConfig, thinkingConfig);
  }

  // Handle response format specifications
  if (req.response_format) {
    switch (req.response_format.type) {
      case "json_schema":
        adjustSchema(req.response_format);
        customConfig.responseSchema = req.response_format.json_schema?.schema;
        if (customConfig.responseSchema && "enum" in customConfig.responseSchema) {
          customConfig.responseMimeType = "text/x.enum";
          break;
        }
        // eslint-disable-next-line no-fallthrough
      case "json_object":
        customConfig.responseMimeType = "application/json";
        break;
      case "text":
        customConfig.responseMimeType = "text/plain";
        break;
      default:
        throw new HttpError("Unsupported response_format.type", 400);
    }
  }
  return { generationConfig, ...customConfig };
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

  // If all parts are image_url, add an empty text part to satisfy Gemini's requirement
  if (parts.every(part => part.inlineData && part.inlineData.mimeType.startsWith('image/'))) {
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

  let response;
  try {
    response = JSON.parse(content);
  } catch (err) {
    console.error("Error parsing function response content:", err);
    throw new HttpError("Invalid function response: " + content, 400);
  }

  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    response = { result: response };
  } else if (Object.keys(response).length === 0) {
    response = { result: null };
  }

  if (!tool_call_id) {
    throw new HttpError("tool_call_id not specified", 400);
  }

  const { i, name } = parts.calls[tool_call_id] ?? {};
  if (!name) {
    throw new HttpError("Unknown tool_call_id: " + tool_call_id, 400);
  }
  if (parts[i]) {
    throw new HttpError("Duplicated tool_call_id: " + tool_call_id, 400);
  }

  parts[i] = {
    functionResponse: {
      name,
      response,
    }
  };
};

export const transformFnCalls = ({ tool_calls }) => {
  const calls = {};
  const parts = tool_calls.map(({ function: { arguments: argstr, name }, id, type }, i) => {
    if (type !== "function") {
      throw new HttpError(`Unsupported tool_call type: "${type}"`, 400);
    }

    let args = {};
    if (argstr) {
      try {
        args = JSON.parse(argstr);
      } catch (err) {
        console.error("Error parsing function arguments:", err);
        throw new HttpError("Invalid function arguments: " + argstr, 400);
      }
    }

    calls[id] = { i, name };
    return {
      functionCall: {
        name,
        args,
      }
    };
  });

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

  // Ensure system_instruction is the first message if present
  if (messages[0]?.role === "system") {
    system_instruction = { parts: await transformMsg(messages[0]) };
    messages = messages.slice(1); // Remove system message from the main flow
  }

  for (const item of messages) {
    // Validate message content
    if (typeof item.content === 'undefined' || item.content === null) {
      throw new HttpError(`Message content cannot be null or undefined for role: "${item.role}"`, 400);
    }
    if (Array.isArray(item.content) && item.content.length === 0) {
      throw new HttpError(`Message content array cannot be empty for role: "${item.role}"`, 400);
    }

    switch (item.role) {
      case "tool": {
        // Ensure the last content entry is a function call for proper grouping
        const lastContent = contents[contents.length - 1];
        if (!lastContent || !lastContent.parts || !lastContent.parts.calls) {
          throw new HttpError("Tool message received without a preceding function call context.", 400);
        }
        transformFnResponse(item, lastContent.parts);
        continue;
      }

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

  // Ensure conversation doesn't start with a model message, if system instruction is not present
  if (!system_instruction && contents.length > 0 && contents[0].role === "model") {
    // If the first message is a model message, prepend a dummy user message
    contents.unshift({ role: "user", parts: [{ text: "" }] });
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
  const tools = [];
  let toolConfig = undefined;

  if (req.tools) {
    const functionDeclarations = req.tools
      .filter(tool => tool.type === "function")
      .map(tool => {
        adjustSchema(tool);
        return tool.function;
      });

    if (functionDeclarations.length > 0) {
      tools.push({ functionDeclarations });
    }
  }

  if (req.tool_choice) {
    let mode;
    let allowedFunctionNames;

    if (typeof req.tool_choice === "string") {
      if (req.tool_choice === "none") {
        mode = "NONE";
      } else if (req.tool_choice === "auto") {
        mode = "AUTO";
      }
    } else if (req.tool_choice.type === "function" && req.tool_choice.function?.name) {
      mode = "ANY";
      allowedFunctionNames = [req.tool_choice.function.name];
    }

    if (mode) {
      toolConfig = {
        functionCallingConfig: {
          mode,
          allowedFunctionNames,
        },
      };
    }
  }

  return { tools, toolConfig };
};

/**
 * Transforms OpenAI embedding request to Gemini API format.
 *
 * @param {Object} req - OpenAI embedding request object
 * @returns {Object} Gemini API embedding request object
 * @throws {HttpError} When input is invalid
 */
export const transformEmbedRequest = (req) => {
  if (!req.input || (Array.isArray(req.input) && req.input.length === 0)) {
    throw new HttpError("Input cannot be empty for embedding request.", 400);
  }

  // Gemini's embedContent expects a single string or an array of strings/Parts.
  // OpenAI's input can be a string or an array of strings.
  // For now, we'll assume string or array of strings.
  // If OpenAI's input could be more complex (e.g., objects with text/image),
  // additional transformation would be needed.
  const content = Array.isArray(req.input) ? req.input.map(text => ({ text })) : [{ text: req.input }];

  return {
    content: {
      parts: content,
    },
    model: req.model, // Ensure model is passed for embedding requests
  };
};


/**
 * Main request transformation function that combines all transformations.
 * Converts complete OpenAI request to Gemini API format.
 *
 * @param {Object} req - Complete OpenAI chat completion or embedding request
 * @param {Object} [thinkingConfig] - Optional thinking configuration from model parsing
 * @returns {Promise<Object>} Complete Gemini API request object
 */
export const transformRequest = async (req, thinkingConfig = null) => {
  // Determine if it's a chat completion or embedding request
  if (req.messages) {
    // Chat completion request
    const { generationConfig, ...customConfig } = transformConfig(req, thinkingConfig);
    const { tools, toolConfig } = transformTools(req);

    return {
      ...await transformMessages(req.messages),
      safetySettings: SAFETY_SETTINGS,
      generationConfig,
      tools,
      toolConfig,
      ...customConfig,
    };
  } else if (req.input) {
    // Embedding request
    return transformEmbedRequest(req);
  } else {
    throw new HttpError("Invalid request: missing 'messages' or 'input' field.", 400);
  }
};
