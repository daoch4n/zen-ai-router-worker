/**
 * Stream processing functions that handle server-sent events from Gemini API
 * and transform them to OpenAI-compatible streaming format.
 */
import { transformCandidatesDelta, checkPromptBlock, transformUsage } from './response.mjs';
import { RESPONSE_LINE_REGEX, STREAM_DELIMITER } from '../constants/index.mjs';

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
 * Transform stream function that parses incoming Gemini SSE chunks.
 * Buffers partial data and extracts complete JSON objects for processing.
 *
 * @param {string} chunk - Raw text chunk from Gemini stream
 * @param {TransformStreamDefaultController} controller - Stream controller for output
 * @this {Object} Transform stream context with buffer property
 */
export function parseStream(chunk, controller) {
  this.buffer += chunk;
  do {
    const match = this.buffer.match(RESPONSE_LINE_REGEX);
    if (!match) { break; }
    controller.enqueue(match[1]);
    this.buffer = this.buffer.substring(match[0].length);
  } while (true); // eslint-disable-line no-constant-condition
}

/**
 * Flush function that handles any remaining buffered data when stream ends.
 * Logs errors for incomplete data and marks buffer issues for downstream handling.
 *
 * @param {TransformStreamDefaultController} controller - Stream controller for output
 * @this {Object} Transform stream context with buffer and shared properties
 */
export function parseStreamFlush(controller) {
  if (this.buffer) {
    console.error("Invalid data:", this.buffer);
    controller.enqueue(this.buffer);
    this.shared.is_buffers_rest = true;
  }
}

/**
 * Transform stream function that converts Gemini streaming responses to OpenAI format.
 * Handles candidate processing, content filtering, and streaming protocol compliance.
 *
 * @param {string} line - JSON string from parsed Gemini stream
 * @param {TransformStreamDefaultController} controller - Stream controller for output
 * @this {Object} Transform stream context with id, model, thinkingMode, and other properties
 */
export function toOpenAiStream(line, controller) {
  let data;
  try {
    data = JSON.parse(line);
    if (!data.candidates) {
      throw new Error("Invalid completion chunk object");
    }
  } catch (err) {
    console.error("Error parsing response:", err);
    if (!this.shared.is_buffers_rest) { line =+ STREAM_DELIMITER; }
    controller.enqueue(line);
    return;
  }

  // Build OpenAI-compatible streaming chunk
  const obj = {
    id: this.id,
    choices: data.candidates.map(cand => transformCandidatesDelta(cand, this.thinkingMode)),
    model: data.modelVersion ?? this.model,
    object: "chat.completion.chunk",
    usage: data.usageMetadata && this.streamIncludeUsage ? null : undefined,
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
  cand.finish_reason = null;

  // Send initial chunk with role for new candidates
  if (!this.last[cand.index]) {
    controller.enqueue(sseline({
      ...obj,
      choices: [{ ...cand, tool_calls: undefined, delta: { role: "assistant", content: "" } }],
    }));
  }

  // Send content delta if present
  delete cand.delta.role;
  if ("content" in cand.delta) {
    controller.enqueue(sseline(obj));
  }

  // Prepare final chunk with finish reason and usage
  cand.finish_reason = finish_reason;
  if (data.usageMetadata && this.streamIncludeUsage) {
    obj.usage = transformUsage(data.usageMetadata);
  }
  cand.delta = {};
  this.last[cand.index] = obj;
}

/**
 * Flush function that sends final chunks and stream termination signal.
 * Outputs any pending finish reasons and the required [DONE] marker.
 *
 * @param {TransformStreamDefaultController} controller - Stream controller for output
 * @this {Object} Transform stream context with last array property
 */
export function toOpenAiStreamFlush(controller) {
  if (this.last.length > 0) {
    for (const obj of this.last) {
      controller.enqueue(sseline(obj));
    }
    controller.enqueue("data: [DONE]" + STREAM_DELIMITER);
  }
}
