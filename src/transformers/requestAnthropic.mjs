import {
  DEFAULT_ANTHROPIC_VERSION
} from '../constants/index.mjs';

/**
 * Recursively removes unsupported fields from a JSON schema for Gemini.
 * @param {Object} schema - The JSON schema to clean.
 * @returns {Object} The cleaned schema.
 */
export function cleanGeminiSchema(schema) { // Added export
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => cleanGeminiSchema(item));
  }

  const cleaned = { ...schema
  };

  // Remove specific keys unsupported by Gemini tool parameters
  delete cleaned.additionalProperties;
  delete cleaned.default;

  // Check for unsupported 'format' in string types
  if (cleaned.type === "string" && cleaned.format) {
    // Gemini might support more, this is a safe subset based on common usage
    const allowedFormats = new Set(["enum", "date-time"]);
    if (!allowedFormats.has(cleaned.format)) {
      // console.warn(`Removing unsupported format '${cleaned.format}' for string type in Gemini schema.`);
      delete cleaned.format;
    }
  }

  // Recursively clean nested schemas (properties, items, etc.)
  for (const key in cleaned) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      cleaned[key] = cleanGeminiSchema(cleaned[key]);
    }
  }

  return cleaned;
}

/**
 * Transforms an Anthropic request body into a Gemini-compatible request body.
 * This function handles role mapping, content block conversion, system prompts,
 * and tool definitions.
 * @param {Object} anthropicReq - The incoming Anthropic request body.
 * @param {Object} env - Environment variables, potentially containing model mappings.
 * @returns {Object} The transformed Gemini-compatible request body.
 */
export function transformAnthropicToGeminiRequest(anthropicReq, env) {
  const geminiReq = {};

  // 1. Model mapping (using env for flexibility, though not strictly part of Gemini direct mapping)
  // It's good practice to allow model aliasing or selection via environment.
  const modelMap = {
    "claude-3-opus-20240229": env.MODEL_MAP_OPUS || "gemini-pro", // Default to gemini-pro or specified
    "claude-3-sonnet-20240229": env.MODEL_MAP_SONNET || "gemini-pro",
    "claude-3-haiku-20240307": env.MODEL_MAP_HAIKU || "gemini-pro",
  };
  // Gemini model names are typically simpler, e.g., "gemini-pro", "gemini-ultra".
  // The actual model name for Gemini will be part of the URL, not the request body usually.
  // However, if a specific version or model is passed, we can retain it.
  // For this transformer, we'll assume the final endpoint construction handles the model.
  // We don't add `geminiReq.model` here as it's part of the URL path in Gemini API.

  // 2. Content (Messages) and System Prompt
  geminiReq.contents = [];

  // Map Anthropic messages to Gemini format
  // Gemini uses a 'parts' array for content.
  for (const message of anthropicReq.messages) {
    const geminiMessage = {
      role: message.role === "assistant" ? "model" : message.role, // Map 'assistant' to 'model'
      parts: []
    };

    if (typeof message.content === "string") {
      geminiMessage.parts.push({
        text: message.content
      });
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text") {
          geminiMessage.parts.push({
            text: block.text
          });
        } else if (message.role === "user" && block.type === "tool_result") {
          // Map Anthropic tool_result (user message) to Gemini functionResponse part
          geminiMessage.parts.push({
            functionResponse: {
              // TODO: The 'name' ideally should be the actual function name called by the model.
              // Using tool_use_id due to statelessness. This might need adjustment if Gemini
              // strictly requires the original function name from the model's functionCall.
              name: block.tool_use_id,
              response: {
                // Per requirements, the response content from Anthropic's tool_result
                // is nested under a "result" key for Gemini's functionResponse.
                result: block.content // block.content is typically a JSON object or string
              }
            }
          });
        } else if (message.role === "assistant" && block.type === "tool_use") {
          // Map Anthropic tool_use (assistant message in history) to Gemini functionCall part
          geminiMessage.parts.push({
            functionCall: {
              name: block.name,
              args: block.input // block.input is typically a JSON object
            }
          });
        }
        // Image blocks ('image' type) would be handled here if converting to Gemini Vision model.
        // For standard Gemini chat, they are typically omitted or require specific handling.
      }
    }
    geminiReq.contents.push(geminiMessage);
  }

  // Handle Anthropic system prompt - Gemini takes this as a separate top-level field
  if (anthropicReq.system) {
    geminiReq.systemInstruction = {
      role: "system", // Gemini expects "system" role for system instructions
      parts: [{
        text: anthropicReq.system
      }]
    };
  }


  // 3. Generation Config (Max Tokens, Stop Sequences, Temperature, Top P, Top K)
  geminiReq.generationConfig = {};

  if (anthropicReq.max_tokens) {
    geminiReq.generationConfig.maxOutputTokens = anthropicReq.max_tokens;
  }
  if (anthropicReq.stop_sequences && anthropicReq.stop_sequences.length > 0) {
    geminiReq.generationConfig.stopSequences = anthropicReq.stop_sequences;
  }
  if (anthropicReq.temperature !== undefined) {
    geminiReq.generationConfig.temperature = anthropicReq.temperature;
  }
  if (anthropicReq.top_p !== undefined) {
    geminiReq.generationConfig.topP = anthropicReq.top_p;
  }
  if (anthropicReq.top_k !== undefined) {
    geminiReq.generationConfig.topK = anthropicReq.top_k;
  }
  // Stream is not part of generationConfig, it's handled by appending ":stream" to the URL.

  // Metadata.user_id is not directly mapped to a standard Gemini field in the request body.
  // It might be passed as a header or handled differently depending on the application.

  // 4. Tools and Tool Configuration
  if (anthropicReq.tools && anthropicReq.tools.length > 0) {
    geminiReq.tools = [{ // Gemini expects an array of Tool objects
      functionDeclarations: anthropicReq.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: cleanGeminiSchema(tool.input_schema)
      }))
    }];

    // Default to AUTO if tool_choice is not specified
    geminiReq.tool_config = {
      function_calling_config: {
        mode: "AUTO"
      }
    };

    if (anthropicReq.tool_choice) {
      const choiceType = anthropicReq.tool_choice.type;
      if (choiceType === "auto") {
        geminiReq.tool_config.function_calling_config.mode = "AUTO";
      } else if (choiceType === "any") {
        geminiReq.tool_config.function_calling_config.mode = "ANY";
      } else if (choiceType === "tool" && anthropicReq.tool_choice.name) {
        geminiReq.tool_config.function_calling_config.mode = "ANY"; // For specific tool, Gemini uses ANY and allowed_function_names
        geminiReq.tool_config.function_calling_config.allowed_function_names = [anthropicReq.tool_choice.name];
      }
      // If type is "none", tools should not be sent, or mode should be NONE.
      // However, Anthropic's "none" usually implies tools *could* have been defined but are not to be used.
      // If Anthropic sends tools but tool_choice.type is "none", this is ambiguous for Gemini.
      // The safest is to set mode to NONE if "none" is explicitly chosen.
      // The problem description implies if tools are present, mode defaults to AUTO if tool_choice is missing.
      // If tool_choice.type is "none", it means no tools should be called.
      else if (choiceType === "none") {
         // If tools are present but choice is "none", set mode to NONE
        geminiReq.tool_config.function_calling_config.mode = "NONE";
      }
    }
  } else {
    // If no tools are provided in Anthropic request, set mode to NONE for Gemini.
    geminiReq.tool_config = {
      function_calling_config: {
        mode: "NONE"
      }
    };
  }

  // Remove empty generationConfig if no sub-fields were set
  if (Object.keys(geminiReq.generationConfig).length === 0) {
    delete geminiReq.generationConfig;
  }

  // Remove empty tool_config if mode is NONE and no tools were defined (it would be set to NONE by default if tools were absent)
  // Or if tools are present but mode became NONE due to tool_choice
  if (geminiReq.tool_config && geminiReq.tool_config.function_calling_config.mode === "NONE" && (!anthropicReq.tools || anthropicReq.tools.length === 0)) {
     // If no tools were ever present, no need to send tool_config with mode NONE
     delete geminiReq.tool_config;
  } else if (geminiReq.tool_config && geminiReq.tool_config.function_calling_config.mode === "NONE" && anthropicReq.tools && anthropicReq.tools.length > 0 && anthropicReq.tool_choice && anthropicReq.tool_choice.type === "none") {
    // If tools were present, but choice is "none", then tool_config with mode NONE is appropriate.
    // So, do nothing here, let it pass.
  }


  // Specific handling for stream parameter: In Gemini, this is often part of the URL,
  // e.g., /v1beta/models/gemini-pro:generateContent vs /v1beta/models/gemini-pro:streamGenerateContent.
  // The core request body doesn't include `stream`. This needs to be handled by the caller
  // when constructing the HTTP request to the Gemini API.
  // We can return it as a hint if needed, or the caller can inspect original anthropicReq.stream.
  // For now, we'll assume the caller handles the endpoint based on anthropicReq.stream.

  return geminiReq;
}