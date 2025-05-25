/**
 * Stream processing functions that handle server-sent events from Gemini API
 * and transform them to OpenAI-compatible streaming format.
 */
import { transformCandidatesDelta, checkPromptBlock, transformUsage } from './response.mjs';
import { STREAM_DELIMITER } from '../constants/index.mjs';

/**
 * Formats an object as a server-sent event data line.
 * Adds timestamp and proper SSE formatting for OpenAI compatibility.
 *
 * @param {Object} obj - Object to format as SSE data
 * @returns {string} Formatted SSE line with data prefix and delimiter
 */
export const sseline = (obj) => {
  obj.created = Math.floor(Date.now()/1000);
  return "data: " + JSON.stringify(obj) + STREAM_DELIMITER;
};

/**
 * Transform stream function that converts Gemini streaming responses to OpenAI format.
 * Handles candidate processing, content filtering, and streaming protocol compliance.
 *
 * @param {import("@google/generative-ai").StreamGenerateContentResponse} data - StreamGenerateContentResponse object from Gemini stream
 * @param {TransformStreamDefaultController} controller - Stream controller for output
 * @this {Object} Transform stream context with id, model, thinkingMode, and other properties
 */
export function toOpenAiStream(data, controller) {
  if (!data || (!data.candidates && !data.promptFeedback)) {
    console.error("Invalid or empty completion chunk object from Gemini:", data);
    controller.enqueue(sseline({
      id: this.id,
      object: "chat.completion.chunk",
      model: this.model,
      choices: [{
        index: 0,
        delta: { content: `Error: Invalid or empty completion chunk object from Gemini.` },
        finish_reason: "error",
      }],
    }));
    return;
  }

  // Build OpenAI-compatible streaming chunk
  const obj = {
    id: this.id,
    choices: data.candidates.map(cand => transformCandidatesDelta(cand, this.thinkingMode)),
    model: data.modelVersion ?? this.model,
    object: "chat.completion.chunk",
    usage: undefined, // Will be populated in the final chunk if requested
  };

  // Handle content filtering blocks
  if (checkPromptBlock(obj.choices, data.promptFeedback, "delta")) {
    controller.enqueue(sseline(obj));
    return;
  }

  console.assert(data.candidates.length === 1, "Unexpected candidates count: %d", data.candidates.length);
  const cand = obj.choices[0];
  cand.index = cand.index || 0;
  const finish_reason = cand.finish_reason;

  // Send initial chunk with role for new candidates if not already sent
  if (!this.last[cand.index]) {
    controller.enqueue(sseline({
      ...obj,
      choices: [{
        ...cand,
        delta: {
          role: "assistant",
          ...(cand.delta.content !== "" && { content: cand.delta.content }),
          ...(cand.toolCalls && { tool_calls: cand.toolCalls }),
        },
        tool_calls: undefined, // Clear tool_calls from top level of choice
        finish_reason: null, // Clear finish_reason for initial chunk
      }],
    }));
  }

  // Prepare delta for subsequent chunks
  const currentDelta = {};
  if (cand.delta && cand.delta.content !== "") {
    currentDelta.content = cand.delta.content;
  }
  if (cand.toolCalls) {
    currentDelta.tool_calls = cand.toolCalls;
  }
  cand.toolCalls = undefined; // Ensure tool_calls are not duplicated in subsequent chunks

  // Enqueue the current chunk if it contains new content or tool calls
  if (Object.keys(currentDelta).length > 0) {
    controller.enqueue(sseline({
      ...obj,
      choices: [{ ...cand, delta: currentDelta, finish_reason: null }],
    }));
  }

  // If there's a finish reason, send a final chunk for this candidate with the reason
  if (finish_reason) {
    cand.finish_reason = finish_reason;
    cand.delta = {}; // Clear delta for the final chunk
    // Include usage metadata in the final chunk if requested and available
    if (data.usageMetadata && this.streamIncludeUsage) {
      obj.usage = transformUsage(data.usageMetadata);
    }
    controller.enqueue(sseline(obj));
  }

  // Store the last processed object for this candidate index
  this.last[cand.index] = obj;
};

/**
 * Flush function that sends final chunks and stream termination signal.
 * Outputs any pending finish reasons and the required [DONE] marker.
 *
 * @param {TransformStreamDefaultController} controller - Stream controller for output
 * @this {Object} Transform stream context with last array property
 */
export function toOpenAiStreamFlush(controller) {
  // If there are any pending last chunks, ensure they are sent
  controller.enqueue("data: [DONE]" + STREAM_DELIMITER);
}
