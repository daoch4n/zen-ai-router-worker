import {
  generateId
} from '../utils/helpers.mjs';

/**
 * Manages the state for streaming transformation from Gemini to Anthropic.
 * This class accumulates Gemini deltas and emits Anthropic SSE events.
 */
export class GeminiToAnthropicStreamTransformer {
  constructor(anthropicModelName, originalRequestId, streamIncludeUsage, originalRequest) {
    this.anthropicModelName = anthropicModelName;
    this.originalRequestId = originalRequestId || `msg_${generateId()}`;
    // Note: Usage is reported based on `usageMetadata` from Gemini's final stream chunk.
    // `streamIncludeUsage` is an Anthropic request concept; this transformer populates Anthropic
    // SSE usage fields if Gemini provides the data in its stream.
    this.streamIncludeUsage = streamIncludeUsage;
    this.originalRequest = originalRequest;

    this.contentBlockIndex = 0; // Overall index for content blocks
    this.inputTokens = 0; // Calculated from original request or passed if known
    this.outputTokens = 0; // Accumulated from deltas

    this.isFirstChunk = true;
    this.activeTextBlock = null; // { index }
    this.activeToolCalls = {}; // Key: tool_use_id, Value: { id, name, index, accumulatedArgsJson, isStarted }
    this.lastActiveToolCallIdForArgs = null; // ID of the tool last designated to receive args
    this.hadToolUseContent = false; // Flag if any tool_use block was ever started

    this.finalFinishReason = null;
    this.finalUsage = null; // To store usage from Gemini's last chunk if available

    // Prioritize direct input_tokens if available in originalRequest.usage
    if (originalRequest && originalRequest.usage && typeof originalRequest.usage.input_tokens === 'number') {
      this.inputTokens = originalRequest.usage.input_tokens;
    } else if (originalRequest && originalRequest.messages) {
      // Fallback to rough input token calculation
      this.inputTokens = JSON.stringify(originalRequest.messages).length / 4;
      if (originalRequest.system) {
        this.inputTokens += originalRequest.system.length / 4;
      }
    } else {
      this.inputTokens = 0; // Default if no info
    }
  }

  /**
   * Transforms a Gemini streaming chunk (parsed JSON object) into Anthropic SSE events.
   * @param {Object} geminiChunk - The parsed Gemini streaming chunk.
   * @returns {string} Anthropic SSE formatted string.
   */
  transform(geminiChunk) {
    let anthropicSse = "";

    // Assuming geminiChunk is already a parsed JSON object from the stream.
    // console.log('DEBUG: Raw Gemini streaming chunk:', JSON.stringify(geminiChunk, null, 2));

    if (this.isFirstChunk) {
      anthropicSse += this.emitMessageStart();
      this.isFirstChunk = false;
    }

    const candidate = geminiChunk.candidates && geminiChunk.candidates[0];
    if (!candidate) {
      // If no candidate, and it's not a [DONE] signal equivalent, it might be an error or ping.
      // For now, if it's an error chunk, it should be handled before this transformer.
      // If it's the end of stream (e.g. final chunk with only usage/finishReason), handle that.
       if (geminiChunk.usageMetadata || (candidate && candidate.finishReason)) {
         // Handled below by finishReason logic
       } else {
        console.warn("Gemini chunk without candidates received:", geminiChunk);
        return ""; // Or handle as an error/ping if Anthropic spec requires it
       }
    }

    // Process parts if they exist
    if (candidate && candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.text !== undefined && part.text !== null) {
          // Stop any active tool call if text starts
          for (const toolId in this.activeToolCalls) {
            if (this.activeToolCalls[toolId].isStarted) { // Check if it was actually started
               anthropicSse += this.emitContentBlockStop(this.activeToolCalls[toolId].index);
               delete this.activeToolCalls[toolId]; // Remove as it's now stopped
            }
          }

          if (!this.activeTextBlock) {
            this.activeTextBlock = {
              index: this.contentBlockIndex
            };
            anthropicSse += this.emitContentBlockStart("text", this.activeTextBlock.index);
            this.contentBlockIndex++;
          }
          anthropicSse += this.emitContentBlockDelta("text_delta", this.activeTextBlock.index, {
            text: part.text
          });
          this.outputTokens += (part.text || "").length / 4;

        } else if (part.functionCall) {
          if (this.activeTextBlock) {
            anthropicSse += this.emitContentBlockStop(this.activeTextBlock.index);
            this.activeTextBlock = null;
          }

          const fc = part.functionCall;
          let toolCallIdForArgs = null; // This will hold the ID for args processing in the current part

          if (fc.name) {
            let currentProcessingToolId = null; // ID of the tool being focused on due to fc.name
            let existingToolIdWithName = null;
            Object.keys(this.activeToolCalls).forEach(id => {
                if (this.activeToolCalls[id].name === fc.name && this.activeToolCalls[id].isStarted) {
                    existingToolIdWithName = id;
                }
            });

            if (existingToolIdWithName) {
                currentProcessingToolId = existingToolIdWithName;
                // This tool is already active. Its args might be appended or it might be a new sequence for it.
                // No need to stop other tools if we are just continuing to stream for an existing tool.
            } else {
                // A truly new, different tool name is starting. Stop all other active tool calls.
                for (const toolId in this.activeToolCalls) {
                    if (this.activeToolCalls[toolId].isStarted) {
                        anthropicSse += this.emitContentBlockStop(this.activeToolCalls[toolId].index);
                    }
                }
                this.activeToolCalls = {}; // Clear all previous tools
                this.lastActiveToolCallIdForArgs = null; // Reset context for future args-only parts

                const newToolId = `toolu_${generateId()}`;
                currentProcessingToolId = newToolId;
                this.activeToolCalls[newToolId] = {
                    id: newToolId,
                    name: fc.name,
                    index: this.contentBlockIndex,
                    accumulatedArgsJson: "",
                    isStarted: true,
                };
                anthropicSse += this.emitContentBlockStart("tool_use", this.contentBlockIndex, {
                    id: currentProcessingToolId, // Use currentProcessingToolId (which is newToolId here)
                    name: fc.name,
                    input: {}
                });
                this.hadToolUseContent = true;
                this.contentBlockIndex++;
            }
            this.lastActiveToolCallIdForArgs = currentProcessingToolId; // For next args-only parts
            toolCallIdForArgs = currentProcessingToolId; // For current part's args

          } else if (fc.args) {
            // This part only contains args, no name. Assign to the tool that last had its name processed.
            toolCallIdForArgs = this.lastActiveToolCallIdForArgs;
          }

          // Process fc.args using the determined toolCallIdForArgs
          if (fc.args && toolCallIdForArgs && this.activeToolCalls[toolCallIdForArgs]) {
            const toolInfo = this.activeToolCalls[toolCallIdForArgs];
             // Ensure the tool is marked as started if it wasn't (e.g. if name and args come in same chunk but different parts)
            if (!toolInfo.isStarted) { // This case should ideally not happen if name always comes first or with first args
                console.warn(`Processing args for tool ${toolInfo.name} which was not marked as started.`);
                toolInfo.isStarted = true;
            }
            const argsFragment = typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args);
            toolInfo.accumulatedArgsJson += argsFragment;
            anthropicSse += this.emitContentBlockDelta("input_json_delta", toolInfo.index, {
              partial_json: argsFragment
            });
            this.outputTokens += argsFragment.length / 4;
          } else if (fc.args && !toolCallIdForArgs) {
             console.warn("Received functionCall args fragment but no active tool call id to assign it to:", fc);
          }
        }
      }
    }

    // Handle finish reason (end of stream for this candidate)
    // Gemini might also send usageMetadata in the last chunk along with finishReason.
    if (candidate && candidate.finishReason) {
      this.finalFinishReason = candidate.finishReason;
      if (geminiChunk.usageMetadata) { // Gemini often sends usage in the *final* chunk.
        this.finalUsage = geminiChunk.usageMetadata;
        this.inputTokens = this.finalUsage.promptTokenCount || this.inputTokens; // Update if available
        this.outputTokens = this.finalUsage.candidatesTokenCount || this.outputTokens; // More accurate
      }

      // Stop any active text block
      if (this.activeTextBlock) {
        anthropicSse += this.emitContentBlockStop(this.activeTextBlock.index);
        this.activeTextBlock = null;
      }
      // Stop any active tool calls
      for (const toolId in this.activeToolCalls) {
         if (this.activeToolCalls[toolId].isStarted) {
            anthropicSse += this.emitContentBlockStop(this.activeToolCalls[toolId].index);
         }
      }
      this.activeToolCalls = {}; // Clear active tools

      anthropicSse += this.emitMessageDelta(this.finalFinishReason, this.finalUsage);
      anthropicSse += this.emitMessageStop();
    }

    return anthropicSse;
  }

  /**
   * Emits the 'message_start' event.
   */
  emitMessageStart() {
    const message = {
      id: this.originalRequestId,
      type: "message",
      role: "assistant",
      model: this.anthropicModelName,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: Math.ceil(this.inputTokens), // Use initial calculation
        output_tokens: 0
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
      content_block.text = ""; // Text content starts empty, filled by deltas
    }
    // For tool_use, id, name, input are part of initialData if available, input starts empty
    return `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index, content_block })}\n\n`;
  }

  /**
   * Emits a 'content_block_delta' event.
   */
  emitContentBlockDelta(deltaType, index, deltaContent) {
     const payload = {
      type: "content_block_delta",
      index,
      delta: { type: deltaType, ...deltaContent }
    };
    return `event: content_block_delta\ndata: ${JSON.stringify(payload)}\n\n`;
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
  emitMessageDelta(geminiFinishReason, geminiUsage) {
    let stop_reason = "end_turn";

    // Determine stop_reason based on finishReason and whether tools were used
    if (geminiFinishReason) {
        switch (geminiFinishReason) {
            case "MAX_TOKENS":
                stop_reason = "max_tokens";
                break;
            case "SAFETY":
            case "RECITATION":
                stop_reason = "content_filter";
                break;
            case "TOOL_CODE_EXECUTED":
                stop_reason = "tool_use";
                this.hadToolUseContent = true; // Ensure flag is set
                break;
            case "STOP":
                stop_reason = this.hadToolUseContent ? "tool_use" : "end_turn";
                break;
            default: // OTHER or unspecified
                stop_reason = this.hadToolUseContent ? "tool_use" : "end_turn";
                break;
        }
    } else if (this.hadToolUseContent) {
        // If stream ends without a finishReason but tools were used
        stop_reason = "tool_use";
    }

    const delta = {
      stop_reason,
      stop_sequence: null // Gemini doesn't provide this directly
    };

    const usage = { // Anthropic expects output_tokens in message_delta
      output_tokens: Math.ceil(this.outputTokens)
    };

    // If final accurate usage is available from Gemini, include it in the message_delta's usage field for Anthropic.
    // Anthropic's spec for message_delta includes usage: { output_tokens: ... }
    // The message_start event includes usage: { input_tokens: ..., output_tokens: 0 }
    // So, we only need to update output_tokens here.
    if (geminiUsage && geminiUsage.candidatesTokenCount !== undefined) {
      usage.output_tokens = Math.ceil(geminiUsage.candidatesTokenCount);
    } else if (geminiUsage && geminiUsage.totalTokenCount !== undefined && geminiUsage.promptTokenCount !== undefined) {
      // If only total and prompt are available, calculate candidate tokens
      usage.output_tokens = Math.ceil(geminiUsage.totalTokenCount - geminiUsage.promptTokenCount);
    }


    return `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta, usage })}\n\n`;
  }

  /**
   * Emits the 'message_stop' event.
   */
  emitMessageStop() {
    this.hadToolUseContent = false; // Reset for next potential message in a multi-message stream (if applicable)
    return `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
  }
}

// Export a function to create a new transformer instance for each stream
export function createGeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, streamIncludeUsage, originalRequest) {
  return new GeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, streamIncludeUsage, originalRequest);
}