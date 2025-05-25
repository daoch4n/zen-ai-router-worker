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
export function transformConfig(openAiConfig, thinkingConfig) {
    const generationConfig = {};
    if (openAiConfig.temperature !== undefined) generationConfig.temperature = openAiConfig.temperature;
    if (openAiConfig.top_p !== undefined) generationConfig.topP = openAiConfig.top_p;
    if (openAiConfig.top_k !== undefined) generationConfig.topK = openAiConfig.top_k;
    if (openAiConfig.max_tokens !== undefined) generationConfig.maxOutputTokens = openAiConfig.max_tokens;
    if (openAiConfig.frequency_penalty !== undefined) generationConfig.frequencyPenalty = openAiConfig.frequency_penalty;
    if (openAiConfig.presence_penalty !== undefined) generationConfig.presencePenalty = openAiConfig.presence_penalty;
    if (openAiConfig.stop_sequences !== undefined) generationConfig.stopSequences = openAiConfig.stop_sequences;

    // Handle response_format
    if (openAiConfig.response_format) {
        const formatType = openAiConfig.response_format.type;
        if (formatType === "json_object") {
            generationConfig.responseMimeType = "application/json";
            // For json_object, if a schema is provided, use it
            if (openAiConfig.response_format.json_schema && openAiConfig.response_format.json_schema.schema) {
                generationConfig.responseSchema = openAiConfig.response_format.json_schema.schema;
            }
        } else if (formatType === "json_schema") {
            if (openAiConfig.response_format.json_schema && openAiConfig.response_format.json_schema.schema) {
                generationConfig.responseSchema = openAiConfig.response_format.json_schema.schema;
                // If the schema is an enum, set mime type to text/x.enum
                if (generationConfig.responseSchema.enum && Array.isArray(generationConfig.responseSchema.enum)) {
                    generationConfig.responseMimeType = "text/x.enum";
                } else {
                    generationConfig.responseMimeType = "application/json";
                }
            } else {
                throw new HttpError("Invalid response_format: 'json_schema' requires a 'schema' object.", 400);
            }
        }
         else if (formatType === "text") {
            generationConfig.responseMimeType = "text/plain";
        } else {
            throw new HttpError(`Unsupported response_format type: ${formatType}`, 400);
        }
    }

    // Handle thinkingConfig
    // Handle thinkingConfig from explicit parameter
    if (thinkingConfig) {
        generationConfig.thinkingConfig = {
            ...generationConfig.thinkingConfig, // Preserve existing if any
            ...(thinkingConfig.thinkingBudget !== undefined && { thinkingBudget: thinkingConfig.thinkingBudget }),
            ...(thinkingConfig.includeThoughts !== undefined && { includeThoughts: thinkingConfig.includeThoughts })
        };
    }

    // Handle reasoning_effort from openAiConfig
    if (openAiConfig.reasoning_effort && REASONING_EFFORT_MAP[openAiConfig.reasoning_effort]) {
        // Ensure thinkingConfig object exists before setting its property
        if (!generationConfig.thinkingConfig) {
            generationConfig.thinkingConfig = {};
        }
        generationConfig.thinkingConfig.thinkingBudget = REASONING_EFFORT_MAP[openAiConfig.reasoning_effort];
    }

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

  if (content === null || content === undefined) {
    return []; // No content, so no parts from content
  }
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
 * Transforms OpenAI conversation messages to Gemini format.
 * Handles role mapping, system instructions, and function call sequences.
 *
 * @param {Array} messages - Array of OpenAI conversation messages
 * @returns {Promise<Object>} Object with system_instruction and contents for Gemini API
 * @throws {HttpError} When unknown message role is encountered
 */
export async function transformMessages(messages) {
    if (!messages) return undefined; // Handle null/undefined messages input

    let systemInstruction = undefined;
    const contents = [];

    const parseArguments = (argsString) => {
        try {
            return JSON.parse(argsString);
        } catch (e) {
            // If parsing fails, return the original string or handle as appropriate
            console.warn("Failed to parse tool call arguments as JSON:", argsString, e);
            return argsString;
        }
    };

    for (const msg of messages) {
        if (msg.role === "system") {
            if (typeof msg.content === 'string') {
                systemInstruction = { parts: [{ text: msg.content }] };
            } else if (Array.isArray(msg.content)) {
                // Handle system messages with multipart content, join text parts
                systemInstruction = {
                    parts: [{
                        text: msg.content
                            .filter(part => part.type === "text")
                            .map(part => part.text)
                            .join("\n")
                    }]
                };
            }
            continue; // System messages are extracted and not part of contents
        }

        const parts = [];
        // Use the async transformMsg to handle multi-part content (text, image, audio)
        // Ensure that transformMsg is awaited
        // Only call transformMsg for user and assistant roles, or if content is explicitly defined
        if (msg.role !== "tool" && (msg.content || msg.tool_calls)) {
            const transformedParts = await transformMsg(msg);
            parts.push(...transformedParts);
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const toolCall of msg.tool_calls) {
                parts.push({
                    functionCall: {
                        name: toolCall.function.name,
                        args: parseArguments(toolCall.function.arguments)
                    }
                });
            }
        }
        if (msg.role === "tool" && msg.tool_call_id && msg.content) {
            parts.push({
                functionResponse: {
                    name: msg.name, // The actual name of the function that was called
                    response: {
                        result: parseArguments(msg.content) // Parse tool response content if it's JSON string
                    }
                }
            });
        }

        if (msg.role === "user") {
            const hasTextPart = parts.some(part => part.text !== undefined && part.text !== "");
            const hasContentParts = parts.length > 0;
            if (!hasTextPart && hasContentParts) {
                parts.push({ text: "" });
            }
            contents.push({ role: "user", parts: parts }); // Matches Content interface
        } else if (msg.role === "assistant") {
            const hasTextPart = parts.some(part => part.text !== undefined && part.text !== "");
            const hasContentParts = parts.length > 0;
            if (!hasTextPart && hasContentParts) {
                parts.push({ text: "" });
            }
            contents.push({ role: "model", parts: parts }); // Matches Content interface
        } else if (msg.role === "tool") { // Explicitly handle tool role
            // Tool messages are already processed into parts (functionResponse)
            contents.push({ role: "function", parts: parts });
        }
        else {
            throw new HttpError(`Unknown message role: ${msg.role}`, 400);
        }
    }
    return { system_instruction: systemInstruction, contents };
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
export function transformTools(openAiRequest) {
    const geminiTools = {};
    const openAiTools = openAiRequest.tools;

    if (!Array.isArray(openAiTools) || openAiTools.length === 0) {
        geminiTools.tools = undefined;
    } else {
        const functionDeclarations = openAiTools.map(tool => {
            if (tool.type === "function" && tool.function) {
                return {
                    name: tool.function.name,
                    description: tool.function.description,
                    parameters: tool.function.parameters
                };
            }
            return null;
        }).filter(Boolean);

        if (functionDeclarations.length > 0) {
            geminiTools.tools = [{ functionDeclarations }];
        } else {
            geminiTools.tools = undefined;
        }
    }

    // Handle tool_choice
    // Only set tool_config if tool_choice is explicitly supported.
    // Otherwise, geminiTools.tool_config remains undefined,
    // allowing Gemini API to apply its default behavior (AUTO).
    if (typeof openAiRequest.tool_choice === "string") {
        if (openAiRequest.tool_choice === "none") {
            geminiTools.tool_config = { functionCallingConfig: { mode: "NONE" } };
        } else if (openAiRequest.tool_choice === "auto") {
            geminiTools.tool_config = { functionCallingConfig: { mode: "AUTO" } };
        }
        // For any other string value, geminiTools.tool_config remains undefined.
    } else if (typeof openAiRequest.tool_choice === "object" && openAiRequest.tool_choice !== null) {
        if (openAiRequest.tool_choice.type === "function" && openAiRequest.tool_choice.function && openAiRequest.tool_choice.function.name) {
            geminiTools.tool_config = {
                functionCallingConfig: {
                    mode: "ANY",
                    allowedFunctionNames: [openAiRequest.tool_choice.function.name]
                }
            };
        }
        // For any other object structure, geminiTools.tool_config remains undefined.
    }
    // For undefined or null tool_choice, geminiTools.tool_config remains undefined.
    return geminiTools;
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
    outputDimensionality: req.dimensions, // Pass output dimensionality if provided
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
export async function transformRequest(openAiRequest, thinkingConfig) {
    if (openAiRequest.messages) {
        const requestBody = {};
        const { system_instruction, contents } = await transformMessages(openAiRequest.messages);
        if (system_instruction) {
            requestBody.system_instruction = system_instruction; // Use the structured system_instruction
        }
        requestBody.contents = contents;
        requestBody.safetySettings = SAFETY_SETTINGS; // Add safety settings
        requestBody.generationConfig = transformConfig(openAiRequest, thinkingConfig);
        const { tools, tool_config } = transformTools(openAiRequest); // Destructure tools and tool_config
        if (tools) {
            requestBody.tools = tools;
        }
        if (tool_config) {
            requestBody.tool_config = tool_config;
        }
        return requestBody; // This will be GenerateContentRequest
    } else if (openAiRequest.input) {
        return transformEmbedRequest(openAiRequest); // This will be EmbedContentRequest
    } else {
        throw new HttpError("Invalid request: missing 'messages' or 'input' field.", 400);
    }
}
