import {
  generateId
} from '../utils/helpers.mjs';
import {
  DO_MAX_RETRIES,
  DO_RETRY_DELAY_MS
} from '../constants/index.mjs';
import {
  randomUUID
} from 'node:crypto';

/**
 * Stores tool execution state in the ConversationState Durable Object.
 * @param {DurableObjectStub} conversationStateDOBinding - The Durable Object binding.
 * @param {string} openAIRequestId - The ID of the OpenAI request (conversation ID).
 * @param {string} toolUseId - The tool use ID.
 * @param {string} toolName - The name of the tool.
 * @param {boolean} isToolError - True if the tool execution resulted in an error.
 * @param {Object} content - The content/result of the tool execution.
 */
async function storeToolState(conversationStateDOBinding, openAIRequestId, toolUseId, toolName, isToolError, content) {
  if (!conversationStateDOBinding || !openAIRequestId) {
    console.warn("ConversationStateDO binding or OpenAI request ID not available for tool state storage.");
    return;
  }

  const MAX_RETRIES = DO_MAX_RETRIES;
  const RETRY_DELAY_MS = DO_RETRY_DELAY_MS;
  let storageSuccess = false;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      const doId = conversationStateDOBinding.idFromName(openAIRequestId);
      const stub = conversationStateDOBinding.get(doId);
      const storeResponse = await stub.fetch('/store', {
        method: 'POST',
        body: JSON.stringify({
          tool_use_id: toolUseId,
          tool_name: toolName,
          is_error: isToolError,
          content: content
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (storeResponse.ok) {
        console.log(`Successfully stored tool use/result: ${toolUseId} for conversation: ${openAIRequestId}`);
        storageSuccess = true;
        break;
      } else {
        console.error(`Failed to store tool use/result in ConversationStateDO for tool_use_id: ${toolUseId}, Status: ${storeResponse.status}`);
      }
    } catch (e) {
      console.error(`Error during DO storage attempt ${i + 1} for tool_use_id: ${toolUseId}`, e);
    }

    if (i < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  if (!storageSuccess) {
    console.error(`AGGRESSIVE LOGGING: Failed to store tool use/result for tool_use_id: ${toolUseId} after ${MAX_RETRIES + 1} attempts. This might lead to future tool_result processing issues.`);
  }
}

/**
 * Transforms an OpenAI chat completion response into an Anthropic-compatible response body.
 * This function handles role mapping, content block conversion, stop reasons, and usage statistics.
 * @param {Object} openAIRes - The incoming OpenAI response body.
 * @param {string} anthropicModelName - The original Anthropic model name requested by the client.
 * @param {string} openAIRequestId - The ID from the OpenAI request, for traceability.
 * @returns {Object} The transformed Anthropic-compatible response body.
 */
export async function transformOpenAIToAnthropicResponse(openAIRes, anthropicModelName, openAIRequestId, conversationStateDOBinding) {
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

  // Handle top-level errors from the upstream API (e.g., Gemini errors)
  if (openAIRes.error) {
    let errorType = "api_error";
    if (openAIRes.error.code === 429) {
      errorType = "rate_limit_error";
    } else if (openAIRes.error.code === 400) {
      errorType = "invalid_request_error";
    } else if (openAIRes.error.code === 401 || openAIRes.error.code === 403) {
      errorType = "authentication_error";
    } else if (openAIRes.error.code >= 500 && openAIRes.error.code < 600) {
      errorType = "api_error";
    }
    return {
      type: "error",
      error: {
        type: errorType,
        message: `Upstream error: ${openAIRes.error.message || 'Unknown'}` +
                 (openAIRes.error.param ? ` (Param: ${openAIRes.error.param})` : '') +
                 (openAIRes.error.type ? ` (Type: ${openAIRes.error.type})` : '') +
                 (openAIRes.error.details ? ` (Details: ${JSON.stringify(openAIRes.error.details)})` : '')
      }
    };
  }

  if (!openAIRes.choices || openAIRes.choices.length === 0) {
    // Handle cases where no choices are returned, though typically an error would be thrown upstream
    return anthropicRes;
  }

  const choice = openAIRes.choices[0];
  const message = choice.message;

  // 1. Map content
  if (message.tool_calls && message.tool_calls.length > 0) {
    // Handle OpenAI's newer `message.tool_calls` (array of tool calls)
    for (const toolCall of message.tool_calls) { // Use for...of for async operations
      const toolUseId = toolCall.id || `toolu_${randomUUID()}`;
      const toolName = toolCall.function.name;
      let toolInputContent = {}; // Renamed from toolResultContent for clarity
      let isToolError = false;

      try {
        toolInputContent = JSON.parse(toolCall.function.arguments);
        // Check for the custom `is_error` flag from our proxy's tool execution
        if (toolInputContent && typeof toolInputContent === 'object' && toolInputContent.is_error === true) {
          isToolError = true;
        }
      } catch (e) {
        console.error("Failed to parse tool_calls arguments:", e, toolCall.function.arguments);
        // If parsing fails, consider it an error and set a generic message
        toolInputContent = { error: "Malformed tool result content from upstream." };
        isToolError = true;
      }

      // Always push type: "tool_use" as the LLM is requesting a tool execution
      anthropicRes.content.push({
        type: "tool_use",
        id: toolUseId,
        name: toolName,
        // If there was an error, include it in the input for the LLM to process
        input: isToolError ? { error: toolInputContent.error || "An unknown tool execution error occurred." } : toolInputContent
      });

      // Use the helper function to store tool state
      await storeToolState(conversationStateDOBinding, openAIRequestId, toolUseId, toolName, isToolError, toolInputContent);
    }
    anthropicRes.stop_reason = "tool_use"; // Set stop reason for tool calls
  } else if (message.function_call) {
    // Keep legacy support for `message.function_call`
    const toolUseId = `toolu_${randomUUID()}`;
    const toolName = message.function_call.name;
    let toolInputContent = {}; // Renamed from toolResultContent
    let isToolError = false;

    try {
      toolInputContent = JSON.parse(message.function_call.arguments);
      if (toolInputContent && typeof toolInputContent === 'object' && toolInputContent.is_error === true) {
        isToolError = true;
      }
    } catch (e) {
      console.error("Failed to parse function_call arguments:", e, message.function_call.arguments);
      toolInputContent = { error: "Malformed tool result content from upstream (legacy)." };
      isToolError = true;
    }

    // Always push type: "tool_use" as the LLM is requesting a tool execution
    anthropicRes.content.push({
      type: "tool_use",
      id: toolUseId,
      name: toolName,
      // If there was an error, include it in the input for the LLM to process
      input: isToolError ? { error: toolInputContent.error || "An unknown tool execution error occurred (legacy)." } : toolInputContent
    });

    // Use the helper function to store tool state
    await storeToolState(conversationStateDOBinding, openAIRequestId, toolUseId, toolName, isToolError, toolInputContent);
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