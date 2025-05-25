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
  // Initialize state for tool calls across chunks
  this.toolCallAccumulatedArgs = this.toolCallAccumulatedArgs || new Map();
  this.toolCallIndices = this.toolCallIndices || new Map();
  if (!data || (!data.candidates && !data.promptFeedback)) {
    console.error("Invalid or empty completion chunk object from Gemini:", data);
    controller.enqueue(sseline({
      id: this.id,
      object: "chat.completion.chunk",
      model: this.model,
      choices: [{
        index: 0,
        delta: { content: `An internal error occurred.` },
        finish_reason: "stop",
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

  // Extract incoming content and tool_calls from the current delta
  const incomingContent = cand.delta?.content;
  const incomingToolCalls = cand.delta?.tool_calls || [];

  // Clear the original tool_calls from delta, as we'll reconstruct them correctly
  cand.delta.tool_calls = undefined; // This modifies the 'cand' object

  const openAiToolCallDeltas = [];
  incomingToolCalls.forEach((incomingToolCall) => {
    const toolCallId = incomingToolCall.id;
    const functionName = incomingToolCall.function.name;
    const currentArgsChunk = incomingToolCall.function.arguments;

    let toolCallIndex;
    if (!this.toolCallIndices.has(toolCallId)) {
      // This is a new tool call, assign a new index and include full metadata
      // The index should be sequential based on the order of unique tool calls encountered
      toolCallIndex = this.toolCallIndices.size;
      this.toolCallIndices.set(toolCallId, toolCallIndex);

      openAiToolCallDeltas.push({
        index: toolCallIndex,
        id: toolCallId,
        type: "function",
        function: {
          name: functionName,
          arguments: currentArgsChunk,
        },
      });
    } else {
      // This is a subsequent chunk for an existing tool call, only append arguments
      toolCallIndex = this.toolCallIndices.get(toolCallId);
      openAiToolCallDeltas.push({
        index: toolCallIndex,
        function: {
          arguments: currentArgsChunk,
        },
      });
    }

    // Accumulate arguments (useful for state tracking/debugging, not directly for output delta)
    let accumulatedArgs = this.toolCallAccumulatedArgs.get(toolCallId) || '';
    accumulatedArgs += currentArgsChunk;
    this.toolCallAccumulatedArgs.set(toolCallId, accumulatedArgs);
  });

  // Prepare the delta for the current chunk
  // Note: 'role' is only added if it's the very first chunk in the 'if (!this.last[cand.index])' block
  // and then deleted from currentDelta to prevent duplication.
  const currentDelta = {};
  if (incomingContent !== "" && incomingContent !== undefined) {
    currentDelta.content = incomingContent;
  }
  if (openAiToolCallDeltas.length > 0) {
    currentDelta.tool_calls = openAiToolCallDeltas;
  }

  // Send initial chunk with role for new candidates if not already sent
  if (!this.last[cand.index]) {
    controller.enqueue(sseline({
      ...obj,
      choices: [{
        ...cand,
        delta: {
          role: "assistant",
          ...currentDelta, // Include the content and tool_calls that are part of this very first delta
        },
        tool_calls: undefined, // Clear tool_calls from top level of choice, as it's in delta
        finish_reason: null, // Clear finish_reason for initial chunk
      }],
    }));
    // After sending the initial chunk, clear currentDelta to avoid sending content/tool_calls again
    currentDelta.content = undefined;
    currentDelta.tool_calls = undefined;
  }

  // Enqueue the current chunk if it still contains new content or tool calls
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
  // Iterate over all stored last chunks for each candidate
  for (const lastObj of Object.values(this.last || {})) {
    if (!lastObj || !lastObj.choices || lastObj.choices.length === 0) {
      continue;
    }

    const choice = lastObj.choices[0]; // Assuming single choice per object in this.last

    // If the last known state of a candidate did not have a finish_reason,
    // it means the stream ended abruptly for this candidate.
    // We need to send a final chunk for it.
    if (!choice.finish_reason) {
      const finalChunk = {
        id: lastObj.id,
        choices: [{
          index: choice.index,
          delta: {}, // Empty delta for the final chunk
          finish_reason: "stop", // Default to "stop" reason
        }],
        model: lastObj.model,
        object: "chat.completion.chunk",
      };
      controller.enqueue(sseline(finalChunk));
    }
  }
  controller.enqueue("data: [DONE]" + STREAM_DELIMITER);
}
