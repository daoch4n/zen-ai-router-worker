import {
  generateId
} from '../utils/helpers.mjs';

/**
 * Manages the state for streaming transformation from OpenAI to Anthropic.
 * This class accumulates OpenAI deltas and emits Anthropic SSE events.
 */
export class AnthropicStreamTransformer {
  constructor(anthropicModelName, openAIRequestId, streamIncludeUsage, originalRequest) {
    this.anthropicModelName = anthropicModelName;
    this.openAIRequestId = openAIRequestId || `msg_${generateId()}`;
    this.streamIncludeUsage = streamIncludeUsage;
    this.originalRequest = originalRequest; // Store original request to calculate input tokens
    this.accumulatedContent = "";
    this.accumulatedToolArguments = {}; // Stores partial JSON for each tool_use_id
    this.currentToolUseId = null;
    this.contentBlockIndex = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.isFirstChunk = true;
    this.hasTextContent = false;
    this.hasToolUseContent = false;

    // Calculate initial input tokens from the original request
    // This is a simplified calculation; a proper tokenizer (like tiktoken) would be more accurate.
    // For this example, we'll just count characters as a proxy for tokens.
    if (originalRequest && originalRequest.messages) {
      this.inputTokens = JSON.stringify(originalRequest.messages).length / 4; // Rough estimate
      if (originalRequest.system) {
        this.inputTokens += originalRequest.system.length / 4; // Rough estimate
      }
    }
  }

  /**
   * Transforms an OpenAI streaming chunk into Anthropic SSE events.
   * @param {Object} chunk - The OpenAI streaming chunk.
   * @returns {string} Anthropic SSE formatted string.
   */
  transform(chunk) {
    let anthropicSse = "";

    // Skip [DONE] chunk
    if (chunk === "[DONE]") {
      return "";
    }

    const data = JSON.parse(chunk);
    const choice = data.choices[0];
    const delta = choice.delta;

    // First chunk usually contains role
    if (this.isFirstChunk) {
      anthropicSse += this.emitMessageStart();
      this.isFirstChunk = false;
    }

    // Handle content (text or function_call)
    if (delta.content) {
      if (!this.hasTextContent) {
        // First text content block
        anthropicSse += this.emitContentBlockStart("text", this.contentBlockIndex);
        this.hasTextContent = true;
        this.hasToolUseContent = false; // Reset if switching from tool to text
        this.currentToolUseId = null;
      }
      anthropicSse += this.emitContentBlockDelta("text_delta", this.contentBlockIndex, {
        text: delta.content
      });
      this.accumulatedContent += delta.content;
      this.outputTokens += delta.content.length / 4; // Rough token count
    } else if (delta.function_call) {
      if (!this.hasToolUseContent) {
        // First tool use block
        this.contentBlockIndex++; // Increment for new content block
        this.currentToolUseId = `toolu_${generateId()}`;
        anthropicSse += this.emitContentBlockStart("tool_use", this.contentBlockIndex, {
          id: this.currentToolUseId,
          name: delta.function_call.name || "", // Name might come in first chunk
          input: {} // Initialize input as empty object
        });
        this.hasToolUseContent = true;
        this.hasTextContent = false; // Reset if switching from text to tool
        this.accumulatedToolArguments[this.currentToolUseId] = "";
      }

      if (delta.function_call.name && !this.accumulatedToolArguments[this.currentToolUseId]) {
        // If name comes in a separate chunk, update it.
        // This is a simplification; a full solution would re-emit the start event with the name.
        // For now, we assume name is part of the first function_call delta or handled implicitly.
      }

      if (delta.function_call.arguments) {
        this.accumulatedToolArguments[this.currentToolUseId] += delta.function_call.arguments;
        anthropicSse += this.emitContentBlockDelta("input_json_delta", this.contentBlockIndex, {
          partial_json: delta.function_call.arguments
        });
        this.outputTokens += delta.function_call.arguments.length / 4; // Rough token count
      }
    }

    // Handle finish reason (end of stream for this choice)
    if (choice.finish_reason) {
      if (this.hasTextContent) {
        anthropicSse += this.emitContentBlockStop(this.contentBlockIndex);
      }
      if (this.hasToolUseContent) {
        anthropicSse += this.emitContentBlockStop(this.contentBlockIndex);
      }

      anthropicSse += this.emitMessageDelta(choice.finish_reason);
      anthropicSse += this.emitMessageStop();
    }

    return anthropicSse;
  }

  /**
   * Emits the 'message_start' event.
   */
  emitMessageStart() {
    const message = {
      id: this.openAIRequestId,
      type: "message",
      role: "assistant",
      model: this.anthropicModelName,
      content: [], // Empty initially, content blocks follow
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: this.inputTokens,
        output_tokens: 0 // Will be updated in message_delta
      }
    };
    return `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message })}\n\n`;
  }

  /**
   * Emits a 'content_block_start' event.
   */
  emitContentBlockStart(type, index, initialData = {}) {
    const content_block = {
      type,
      ...initialData
    };
    if (type === "text") {
      content_block.text = "";
    } else if (type === "tool_use") {
      // For tool_use, name and input are part of initialData
    }
    return `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index, content_block })}\n\n`;
  }

  /**
   * Emits a 'content_block_delta' event.
   */
  emitContentBlockDelta(deltaType, index, delta) {
    return `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index, delta: { type: deltaType, ...delta } })}\n\n`;
  }

  /**
   * Emits a 'content_block_stop' event.
   */
  emitContentBlockStop(index) {
    return `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index })}\n\n`;
  }

  /**
   * Emits the 'message_delta' event with final stop reason and usage.
   */
  emitMessageDelta(openAIFinishReason) {
    let stop_reason = "end_turn"; // Default
    if (openAIFinishReason === "length") {
      stop_reason = "max_tokens";
    } else if (openAIFinishReason === "function_call") {
      stop_reason = "tool_use";
    } else if (openAIFinishReason === "content_filter") {
      // This is a simplification; might need custom handling or error
      stop_reason = "stop_sequence"; // Treating as an external stop
    }

    const delta = {
      stop_reason,
      stop_sequence: null // OpenAI doesn't provide this directly
    };

    const usage = {
      output_tokens: Math.ceil(this.outputTokens) // Report final output tokens
    };

    return `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta, usage })}\n\n`;
  }

  /**
   * Emits the 'message_stop' event.
   */
  emitMessageStop() {
    return `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
  }
}

// Export a function to create a new transformer instance for each stream
export function createAnthropicStreamTransformer(anthropicModelName, openAIRequestId, streamIncludeUsage, originalRequest) {
  return new AnthropicStreamTransformer(anthropicModelName, openAIRequestId, streamIncludeUsage, originalRequest);
}