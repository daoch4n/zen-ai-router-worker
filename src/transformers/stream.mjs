/**
 * Stream processing functions
 */
import { transformCandidatesDelta, checkPromptBlock, transformUsage } from './response.mjs';
import { RESPONSE_LINE_REGEX, STREAM_DELIMITER } from '../constants/index.mjs';

/**
 * Formats a server-sent event line
 * @param {Object} obj - The object to format
 * @returns {string} - Formatted SSE line
 */
export const sseline = (obj) => {
  obj.created = Math.floor(Date.now()/1000);
  return "data: " + JSON.stringify(obj) + STREAM_DELIMITER;
};

/**
 * Parses a stream chunk
 * @param {string} chunk - The chunk to parse
 * @param {TransformStreamDefaultController} controller - The stream controller
 * @this {Object} - The transform stream context
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
 * Flushes any remaining buffer in the parse stream
 * @param {TransformStreamDefaultController} controller - The stream controller
 * @this {Object} - The transform stream context
 */
export function parseStreamFlush(controller) {
  if (this.buffer) {
    console.error("Invalid data:", this.buffer);
    controller.enqueue(this.buffer);
    this.shared.is_buffers_rest = true;
  }
}

/**
 * Transforms a stream line to OpenAI format
 * @param {string} line - The line to transform
 * @param {TransformStreamDefaultController} controller - The stream controller
 * @this {Object} - The transform stream context
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
    controller.enqueue(line); // output as is
    return;
  }
  const obj = {
    id: this.id,
    choices: data.candidates.map(cand => transformCandidatesDelta(cand, this.thinkingMode)),
    model: data.modelVersion ?? this.model,
    object: "chat.completion.chunk",
    usage: data.usageMetadata && this.streamIncludeUsage ? null : undefined,
  };
  if (checkPromptBlock(obj.choices, data.promptFeedback, "delta")) {
    controller.enqueue(sseline(obj));
    return;
  }
  console.assert(data.candidates.length === 1, "Unexpected candidates count: %d", data.candidates.length);
  const cand = obj.choices[0];
  cand.index = cand.index || 0; // absent in new -002 models response
  const finish_reason = cand.finish_reason;
  cand.finish_reason = null;
  if (!this.last[cand.index]) { // first
    controller.enqueue(sseline({
      ...obj,
      choices: [{ ...cand, tool_calls: undefined, delta: { role: "assistant", content: "" } }],
    }));
  }
  delete cand.delta.role;
  if ("content" in cand.delta) { // prevent empty data (e.g. when MAX_TOKENS)
    controller.enqueue(sseline(obj));
  }
  cand.finish_reason = finish_reason;
  if (data.usageMetadata && this.streamIncludeUsage) {
    obj.usage = transformUsage(data.usageMetadata);
  }
  cand.delta = {};
  this.last[cand.index] = obj;
}

/**
 * Flushes any remaining data in the OpenAI stream
 * @param {TransformStreamDefaultController} controller - The stream controller
 * @this {Object} - The transform stream context
 */
export function toOpenAiStreamFlush(controller) {
  if (this.last.length > 0) {
    for (const obj of this.last) {
      controller.enqueue(sseline(obj));
    }
    controller.enqueue("data: [DONE]" + STREAM_DELIMITER);
  }
}
