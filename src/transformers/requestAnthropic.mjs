import {
  DEFAULT_ANTHROPIC_VERSION
} from '../constants/index.mjs';

/**
 * Recursively removes unsupported fields from a JSON schema for Gemini.
 * @param {Object} schema - The JSON schema to clean.
 * @returns {Object} The cleaned schema.
 */
function cleanGeminiSchema(schema) {
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
 * Transforms an Anthropic request body into an OpenAI-compatible request body.
 * This function handles role mapping, content block conversion, system prompts,
 * and tool definitions as described in the mapping document.
 * @param {Object} anthropicReq - The incoming Anthropic request body.
 * @returns {Object} The transformed OpenAI-compatible request body.
 */
export function transformAnthropicToOpenAIRequest(anthropicReq, env) {
  const openAIReq = {};

  // 1. Model mapping
  // The mapping document suggests mapping Claude model names to OpenAI model names.
  // Explicit model mapping: Map Anthropic model names to OpenAI/Gemini equivalents.
  // This ensures the downstream system receives recognized model identifiers.
  const modelMap = {
    "claude-3-opus-20240229": env.MODEL_MAP_OPUS,
    "claude-3-sonnet-20240229": env.MODEL_MAP_SONNET,
    "claude-3-haiku-20240307": env.MODEL_MAP_HAIKU,
  };
  openAIReq.model = modelMap[anthropicReq.model] || anthropicReq.model; // Use mapped model or fallback to original

  // 2. Messages and System Prompt
  openAIReq.messages = [];

  // Handle Anthropic system prompt
  if (anthropicReq.system) {
    openAIReq.messages.push({
      role: "system",
      content: anthropicReq.system
    });
  }

  // Map Anthropic messages to OpenAI format
  for (const message of anthropicReq.messages) {
    const openAIMessage = {
      role: message.role
    };

    if (typeof message.content === "string") {
      openAIMessage.content = message.content;
    } else if (Array.isArray(message.content)) {
      // Handle content blocks
      let textContent = [];
      for (const block of message.content) {
        if (block.type === "text") {
          textContent.push(block.text);
        } else if (block.type === "tool_result" && message.role === "user") {
          // Map Anthropic tool_result (user turn) to OpenAI function role
          // The name of the tool needs to be tracked from the assistant's previous tool_use.
          // CRITICAL BUG: Tool name mapping for tool_result messages is complex in a stateless proxy.
          // The `tool_use_id` is an internal identifier. To get the actual tool `name` for OpenAI's `function` role,
          // the proxy would ideally need to track the `tool_use_id` to `tool_name` mapping from the *previous*
          // assistant's `tool_use` message. This requires state management across turns.
          //
          // CURRENT LIMITATION: Without state, we cannot reliably infer the tool name.
          // For now, a placeholder name is used. This will likely cause failures in downstream systems
          // that rely on accurate tool names.
          //
          // A robust solution would involve:
          // 1. Storing the `tool_use_id` to `tool_name` mapping in a cache or database when the assistant
          //    returns a `tool_use` message.
          // 2. Retrieving the `tool_name` using the `tool_use_id` when a `tool_result` message is received.
          //
          // For this stateless proxy, this remains a significant gap.
          openAIReq.messages.push({
            role: "function",
            name: `UNKNOWN_TOOL_NAME_FOR_${block.tool_use_id}`, // Placeholder due to stateless nature
            content: JSON.stringify(block.content) // OpenAI expects stringified JSON
          });
        }
        // Image blocks are not directly supported by standard OpenAI Chat API
        // As per mapping.md, they should be omitted or handled via a separate Vision API.
        // For now, we will omit them.
      }
      if (textContent.length > 0) {
        openAIMessage.content = textContent.join("\n"); // Concatenate multiple text blocks
      } else if (openAIMessage.role !== "function") {
        // If no text content and not a function call, content might be null
        openAIMessage.content = null;
      }
    }

    // Only push if content is not null (unless it's an assistant message with only function_call)
    // and not a tool_result that's already pushed as a function role message
    if (openAIMessage.content !== null || openAIMessage.role === "assistant") {
      openAIReq.messages.push(openAIMessage);
    }
  }

  // 3. Max Tokens
  if (anthropicReq.max_tokens) {
    openAIReq.max_tokens = anthropicReq.max_tokens;
  }

  // 4. Stop Sequences
  if (anthropicReq.stop_sequences) {
    openAIReq.stop = anthropicReq.stop_sequences;
  }

  // 5. Stream
  if (anthropicReq.stream !== undefined) {
    openAIReq.stream = anthropicReq.stream;
    // Anthropic's stream_options is not directly supported by OpenAI
    // Usage will be handled by the proxy at the end of the stream.
  }

  // 6. Temperature
  if (anthropicReq.temperature !== undefined) {
    openAIReq.temperature = anthropicReq.temperature;
  }

  // 7. Top P
  if (anthropicReq.top_p !== undefined) {
    openAIReq.top_p = anthropicReq.top_p;
  }

  // 8. Top K
  if (anthropicReq.top_k !== undefined) {
    openAIReq.top_k = anthropicReq.top_k;
  }

  // 9. Metadata.user_id
  if (anthropicReq.metadata && anthropicReq.metadata.user_id) {
    openAIReq.user = anthropicReq.metadata.user_id;
  }

  // 10. Tools and Tool Choice
  if (anthropicReq.tools && anthropicReq.tools.length > 0) {
    openAIReq.functions = anthropicReq.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: cleanGeminiSchema(tool.input_schema) // Clean schema for Gemini compatibility
    }));

    if (anthropicReq.tool_choice) {
      if (anthropicReq.tool_choice.type === "auto" || anthropicReq.tool_choice.type === "any") {
        openAIReq.function_call = "auto";
      } else if (anthropicReq.tool_choice.type === "tool" && anthropicReq.tool_choice.name) {
        openAIReq.function_call = {
          name: anthropicReq.tool_choice.name
        };
      } else if (anthropicReq.tool_choice.type === "none") {
        openAIReq.function_call = "none";
      }
    } else {
      // If Anthropic tool_choice is omitted, OpenAI defaults to "auto"
      openAIReq.function_call = "auto";
    }
  }

  // 11. Thinking (Ignored by Gemini, ensure it's not passed)
  if (anthropicReq.thinking !== undefined) {
    // Explicitly do not pass the 'thinking' parameter, as it's not supported by Gemini
    // and its presence, even if ignored, might be contributing to the internal error.
    delete anthropicReq.thinking; // Remove from the original request object if needed, though not strictly necessary for openAIReq
  }

  return openAIReq;
}