/**
 * Response transformation functions that convert Gemini API responses to OpenAI format.
 * Handles usage data, candidate processing, and thinking mode content filtering.
 */
import { generateId, removeThinkingTags } from '../utils/helpers.mjs';
import { REASONS_MAP, CONTENT_SEPARATOR, THINKING_MODES } from '../constants/index.mjs';

/**
 * Transforms Gemini usage metadata to OpenAI-compatible token usage format.
 *
 * @param {Object} data - Gemini usage metadata object
 * @param {number} data.candidatesTokenCount - Tokens used in generated responses
 * @param {number} data.promptTokenCount - Tokens used in input prompt
 * @param {number} data.totalTokenCount - Total tokens consumed
 * @returns {Object} OpenAI-compatible usage object
 */
export const transformUsage = (data) => {
  if (!data) {
    return {
      completion_tokens: 0,
      prompt_tokens: 0,
      total_tokens: 0,
    };
  }
  return {
    completion_tokens: data.candidatesTokenCount || 0,
    prompt_tokens: data.promptTokenCount || 0,
    total_tokens: data.totalTokenCount || 0,
  };
};

/**
 * Transforms Gemini candidate responses to OpenAI choice format.
 * Handles function calls, content processing, and thinking mode filtering.
 *
 * @param {string} key - Property name for the message object ("message" or "delta")
 * @param {Object} cand - Gemini candidate object
 * @param {Object} cand.content - Candidate content with parts array
 * @param {Array} cand.content.parts - Array of content parts (text, function calls)
 * @param {string} cand.finishReason - Reason why generation stopped
 * @param {number} [cand.index] - Candidate index in response
 * @param {string} [thinkingMode] - Thinking mode for content processing
 * @returns {Object} OpenAI-compatible choice object
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
    } else if (typeof part.text === 'string') {
      message.content.push(part.text);
    }
  }

  // Join content parts into a single string, or set to null if empty
  const content = message.content.length > 0 ? message.content.join(CONTENT_SEPARATOR) : null;

  // Apply thinking mode content filtering if content exists
  if (thinkingMode === THINKING_MODES.REFINED && content !== null) {
    message.content = removeThinkingTags(content);
  } else {
    message.content = content;
  }

  return {
    index: cand.index || 0,
    [key]: message,
    logprobs: null,
    finish_reason: message.tool_calls ? "tool_calls" : REASONS_MAP[cand.finishReason] || cand.finishReason,
  };
};

/**
 * Convenience function to transform candidates for non-streaming responses.
 *
 * @param {Object} cand - Gemini candidate object
 * @param {string} [thinkingMode] - Thinking mode for content processing
 * @returns {Object} OpenAI choice object with message property
 */
export const transformCandidatesMessage = (cand, thinkingMode = THINKING_MODES.STANDARD) =>
  transformCandidates("message", cand, thinkingMode);

/**
 * Convenience function to transform candidates for streaming responses.
 *
 * @param {Object} cand - Gemini candidate object
 * @param {string} [thinkingMode] - Thinking mode for content processing
 * @returns {Object} OpenAI choice object with delta property
 */
export const transformCandidatesDelta = (cand, thinkingMode = THINKING_MODES.STANDARD) =>
  transformCandidates("delta", cand, thinkingMode);

/**
 * Checks for content filtering and creates appropriate error choices.
 * Handles cases where Gemini blocks content due to safety policies.
 *
 * @param {Array} choices - Current choices array to modify
 * @param {Object} promptFeedback - Gemini prompt feedback object
 * @param {string} promptFeedback.blockReason - Reason for content blocking
 * @param {Array} [promptFeedback.safetyRatings] - Safety rating details
 * @param {string} key - Property name for the choice object ("message" or "delta")
 * @returns {boolean} True if a block was detected and handled
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
 * Processes complete Gemini response and converts to OpenAI chat completion format.
 * Handles candidate transformation, usage data, and content filtering.
 *
 * @param {Object} data - Complete Gemini API response
 * @param {Array} data.candidates - Array of response candidates
 * @param {Object} [data.usageMetadata] - Token usage information
 * @param {Object} [data.promptFeedback] - Content filtering feedback
 * @param {string} [data.modelVersion] - Actual model version used
 * @param {string} model - Requested model name
 * @param {string} id - Unique response identifier
 * @param {string} [thinkingMode] - Thinking mode for content processing
 * @returns {string} JSON string of OpenAI-compatible completion response
 */
export function processCompletionsResponse(sdkResponse, modelName) {
    // sdkResponse is already a GenerateContentResponse object
    const choices = sdkResponse.candidates.map((candidate, index) => {
        const message = {
            role: "assistant",
            content: candidate.content?.parts.map(part => part.text).join("") || "",
            tool_calls: candidate.content?.parts.filter(part => part.functionCall).map(part => ({
                id: `call_${Date.now()}_${index}`,
                type: "function",
                function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args)
                }
            })) || []
        };

        return {
            index: index,
            message: message,
            finish_reason: candidate.finishReason || "stop"
        };
    });

    const usage = {
        prompt_tokens: sdkResponse.usageMetadata?.promptTokenCount || 0,
        completion_tokens: sdkResponse.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: (sdkResponse.usageMetadata?.promptTokenCount || 0) + (sdkResponse.usageMetadata?.candidatesTokenCount || 0)
    };

    return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: choices,
        usage: usage
    };
}

/**
 * Transforms a single Gemini embedding object to OpenAI embedding format.
 *
 * @param {Object} embeddingData - Gemini embedding object with values array
 * @param {Array<number>} embeddingData.values - Array of embedding values
 * @param {number} index - Index of the embedding in the list
 * @returns {Object} OpenAI-compatible embedding object
 * @throws {Error} When embedding data is invalid
 */
export const transformEmbedding = (embeddingData, index) => {
  if (!embeddingData || !Array.isArray(embeddingData.values)) {
    throw new Error("Invalid embedding object received from Gemini API");
  }

  return {
    object: "embedding",
    index: index,
    embedding: embeddingData.values,
  };
};

/**
 * Processes complete Gemini embedding response and converts to OpenAI embedding format.
 * Handles single and batch embedding responses.
 *
 * @param {Object} data - Complete Gemini API embedding response (can be single or batch)
 * @param {string} model - Requested model name
 * @returns {Object} OpenAI-compatible embedding response object
 */
export function processEmbeddingsResponse(sdkResponse, modelName) {
    // sdkResponse is already an EmbedContentResponse object
    const embeddings = sdkResponse.embeddings.map(embedding => ({
        object: "embedding",
        embedding: embedding.values,
        index: 0
    }));

    const usage = {
        prompt_tokens: sdkResponse.usageMetadata?.promptTokenCount || 0,
        total_tokens: sdkResponse.usageMetadata?.promptTokenCount || 0
    };

    return {
        object: "list",
        data: embeddings,
        model: modelName,
        usage: usage
    };
}
