/**
 * Response transformation functions
 */
import { generateId, removeThinkingTags } from '../utils/helpers.mjs';
import { REASONS_MAP, CONTENT_SEPARATOR, THINKING_MODES } from '../constants/index.mjs';

/**
 * Transforms usage data
 * @param {Object} data - The usage data
 * @returns {Object} - Transformed usage data
 */
export const transformUsage = (data) => ({
  completion_tokens: data.candidatesTokenCount,
  prompt_tokens: data.promptTokenCount,
  total_tokens: data.totalTokenCount
});

/**
 * Transforms candidates to OpenAI format
 * @param {string} key - The key to use in the transformed object
 * @param {Object} cand - The candidate object
 * @param {string} thinkingMode - The thinking mode (standard, thinking, refined)
 * @returns {Object} - Transformed candidate
 */
export const transformCandidates = (key, cand, thinkingMode = THINKING_MODES.STANDARD) => {
  const message = { role: "assistant", content: [] };
  for (const part of cand.content?.parts ?? []) {
    if (part.functionCall) {
      const fc = part.functionCall;
      message.tool_calls = message.tool_calls ?? [];
      message.tool_calls.push({
        id: fc.id ?? "call_" + generateId(),
        type: "function",
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        }
      });
    } else {
      message.content.push(part.text);
    }
  }

  let content = message.content.join(CONTENT_SEPARATOR) || null;

  // Remove thinking tags for refined mode
  if (thinkingMode === THINKING_MODES.REFINED && content) {
    content = removeThinkingTags(content);
  }

  message.content = content;

  return {
    index: cand.index || 0, // 0-index is absent in new -002 models response
    [key]: message,
    logprobs: null,
    finish_reason: message.tool_calls ? "tool_calls" : REASONS_MAP[cand.finishReason] || cand.finishReason,
  };
};

/**
 * Transforms candidates to message format
 * @param {Object} cand - The candidate object
 * @param {string} thinkingMode - The thinking mode
 * @returns {Object} - Transformed candidate with message
 */
export const transformCandidatesMessage = (cand, thinkingMode = THINKING_MODES.STANDARD) =>
  transformCandidates("message", cand, thinkingMode);

/**
 * Transforms candidates to delta format
 * @param {Object} cand - The candidate object
 * @param {string} thinkingMode - The thinking mode
 * @returns {Object} - Transformed candidate with delta
 */
export const transformCandidatesDelta = (cand, thinkingMode = THINKING_MODES.STANDARD) =>
  transformCandidates("delta", cand, thinkingMode);

/**
 * Checks for prompt blocks and adds appropriate choices
 * @param {Array} choices - The choices array
 * @param {Object} promptFeedback - The prompt feedback object
 * @param {string} key - The key to use in the transformed object
 * @returns {boolean} - Whether a block was detected
 */
export const checkPromptBlock = (choices, promptFeedback, key) => {
  if (choices.length) { return; }
  if (promptFeedback?.blockReason) {
    console.log("Prompt block reason:", promptFeedback.blockReason);
    if (promptFeedback.blockReason === "SAFETY") {
      promptFeedback.safetyRatings
        .filter(r => r.blocked)
        .forEach(r => console.log(r));
    }
    choices.push({
      index: 0,
      [key]: null,
      finish_reason: "content_filter",
    });
  }
  return true;
};

/**
 * Processes completions response
 * @param {Object} data - The response data
 * @param {string} model - The model name
 * @param {string} id - The response ID
 * @param {string} thinkingMode - The thinking mode
 * @returns {string} - JSON string of the processed response
 */
export const processCompletionsResponse = (data, model, id, thinkingMode = THINKING_MODES.STANDARD) => {
  const obj = {
    id,
    choices: data.candidates.map(cand => transformCandidatesMessage(cand, thinkingMode)),
    created: Math.floor(Date.now()/1000),
    model: data.modelVersion ?? model,
    object: "chat.completion",
    usage: data.usageMetadata && transformUsage(data.usageMetadata),
  };
  if (obj.choices.length === 0 ) {
    checkPromptBlock(obj.choices, data.promptFeedback, "message");
  }
  return JSON.stringify(obj);
};
