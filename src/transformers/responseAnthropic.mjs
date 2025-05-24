import {
  generateId
} from '../utils/helpers.mjs';

/**
 * Transforms an OpenAI chat completion response into an Anthropic-compatible response body.
 * This function handles role mapping, content block conversion, stop reasons, and usage statistics.
 * @param {Object} openAIRes - The incoming OpenAI response body.
 * @param {string} anthropicModelName - The original Anthropic model name requested by the client.
 * @param {string} openAIRequestId - The ID from the OpenAI request, for traceability.
 * @returns {Object} The transformed Anthropic-compatible response body.
 */
export function transformOpenAIToAnthropicResponse(openAIRes, anthropicModelName, openAIRequestId) {
  const anthropicRes = {
    id: openAIRequestId || `msg_${generateId()}`, // Use OpenAI ID or generate new Anthropic ID
    type: "message", // Fixed type for successful response
    role: "assistant", // Fixed role for assistant responses
    model: anthropicModelName, // Return the original Anthropic model name
    content: [], // Array of content blocks
    stop_reason: null, // Reason generation stopped
    stop_sequence: null, // Sequence that caused stop, if applicable
    usage: {
      input_tokens: 0,
      output_tokens: 0
    }
  };

  if (!openAIRes.choices || openAIRes.choices.length === 0) {
    // Handle cases where no choices are returned, though typically an error would be thrown upstream
    return anthropicRes;
  }

  const choice = openAIRes.choices[0];
  const message = choice.message;

  // 1. Map content
  if (message.tool_calls && message.tool_calls.length > 0) {
    // Handle OpenAI's newer `message.tool_calls` (array of tool calls)
    message.tool_calls.forEach(toolCall => {
      try {
        anthropicRes.content.push({
          type: "tool_use",
          id: toolCall.id || `toolu_${generateId()}`, // Use tool call ID or generate new
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments) // Parse JSON string into object
        });
      } catch (e) {
        console.error("Failed to parse tool_calls arguments:", e, toolCall.function.arguments);
        anthropicRes.content.push({
          type: "tool_use",
          id: toolCall.id || `toolu_${generateId()}`,
          name: toolCall.function.name,
          input: {} // Fallback to empty object on parsing failure
        });
      }
    });
    anthropicRes.stop_reason = "tool_use"; // Set stop reason for tool calls
  } else if (message.function_call) {
    // Keep legacy support for `message.function_call`
    try {
      anthropicRes.content.push({
        type: "tool_use",
        id: `toolu_${generateId()}`, // Generate a unique ID for this tool call
        name: message.function_call.name,
        input: JSON.parse(message.function_call.arguments) // Parse JSON string into object
      });
    } catch (e) {
      console.error("Failed to parse function_call arguments:", e, message.function_call.arguments);
      anthropicRes.content.push({
        type: "tool_use",
        id: `toolu_${generateId()}`,
        name: message.function_call.name,
        input: {} // Fallback to empty object on parsing failure
      });
    }
  } else if (message.content !== null) {
    // Text Content
    anthropicRes.content.push({
      type: "text",
      text: message.content
    });
  }

  // 2. Map stop reasons
  if (choice.finish_reason) {
    switch (choice.finish_reason) {
      case "stop":
        anthropicRes.stop_reason = "end_turn";
        // If a stop sequence was hit, the proxy needs to detect this from the original request
        // and set anthropicRes.stop_sequence accordingly. OpenAI doesn't return the matched sequence.
        break;
      case "length":
        anthropicRes.stop_reason = "max_tokens";
        break;
      case "content_filter":
        // As per mapping.md, Anthropic has `stop_reason: "content_filter"`
        anthropicRes.stop_reason = "content_filter";
        break;
      default:
        anthropicRes.stop_reason = "end_turn";
    }
  }

  // 3. Map usage statistics
  if (openAIRes.usage) {
    anthropicRes.usage.input_tokens = openAIRes.usage.prompt_tokens || 0;
    anthropicRes.usage.output_tokens = openAIRes.usage.completion_tokens || 0;
  }

  return anthropicRes;
}