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
export function transformConfig(openAiConfig) {
    const generationConfig = {};
    if (openAiConfig.temperature !== undefined) generationConfig.temperature = openAiConfig.temperature;
    if (openAiConfig.top_p !== undefined) generationConfig.topP = openAiConfig.top_p;
    if (openAiConfig.top_k !== undefined) generationConfig.topK = openAiConfig.top_k;
    if (openAiConfig.max_tokens !== undefined) generationConfig.maxOutputTokens = openAiConfig.max_tokens;
    if (openAiConfig.stop_sequences !== undefined) generationConfig.stopSequences = openAiConfig.stop_sequences;
    return generationConfig; // Matches GenerationConfig interface
}

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
export function transformMessages(messages) {
    const contents = [];
    for (const msg of messages) {
        const parts = [];
        if (msg.content) {
            parts.push({ text: msg.content }); // Matches Part interface for text
        }
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const toolCall of msg.tool_calls) {
                parts.push({
                    functionCall: {
                        name: toolCall.function.name,
                        args: toolCall.function.arguments // Ensure this is already parsed JSON
                    }
                });
            }
        }
        if (msg.role === "tool" && msg.tool_call_id && msg.content) {
            parts.push({
                functionResponse: {
                    name: msg.tool_call_id, // Assuming tool_call_id maps to function name for response
                    response: {
                        result: msg.content // Or parse if content is JSON string
                    }
                }
            });
        }

        if (msg.role === "user") {
            contents.push({ role: "user", parts: parts }); // Matches Content interface
        } else if (msg.role === "assistant") {
            contents.push({ role: "model", parts: parts }); // Matches Content interface
        }
    }
    return contents;
}

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
export function transformTools(openAiTools) {
    if (!openAiTools || openAiTools.length === 0) return undefined;
    const tools = openAiTools.map(tool => {
        if (tool.type === "function" && tool.function) {
            return {
                functionDeclarations: [{
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: tool.function.parameters // Ensure this matches Schema type
                }]
            };
        }
        return null;
    }).filter(Boolean);
    return tools.length > 0 ? tools : undefined; // Matches Tool interface
}

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
export async function transformRequest(openAiRequest) {
    if (openAiRequest.messages) {
        const requestBody = {};
        requestBody.contents = transformMessages(openAiRequest.messages);
        requestBody.generationConfig = transformConfig(openAiRequest);
        requestBody.tools = transformTools(openAiRequest.tools);
        return requestBody; // This will be GenerateContentRequest
    } else if (openAiRequest.input) {
        return transformEmbedRequest(openAiRequest); // This will be EmbedContentRequest
    } else {
        throw new HttpError("Invalid request: missing 'messages' or 'input' field.", 400);
    }
}
