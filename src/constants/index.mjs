/**
 * Constants and configuration values for the OpenAI-to-Gemini API proxy.
 * Contains API endpoints, model defaults, safety settings, and transformation mappings.
 */

/** Base URL for Google's Generative Language API */
export const BASE_URL = "https://generativelanguage.googleapis.com";

/** API version used for all Gemini API requests */
export const API_VERSION = "v1beta";

/** Client identifier sent with API requests for tracking and debugging */
export const API_CLIENT = "genai-js/0.24.1";

/** Default Gemini model used when no specific model is requested */
export const DEFAULT_MODEL = "gemini-2.0-flash";

/** Default model used for text embedding requests */
export const DEFAULT_EMBEDDINGS_MODEL = "text-embedding-004";

/**
 * All harm categories supported by Gemini's safety filtering system.
 * These categories are used to configure content filtering behavior.
 */
export const HARM_CATEGORIES = Object.freeze([
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
]);

/**
 * Safety settings that disable all content filtering by setting
 * threshold to BLOCK_NONE for maximum compatibility with OpenAI behavior.
 */
export const SAFETY_SETTINGS = HARM_CATEGORIES.map(category => ({
  category,
  threshold: "BLOCK_NONE",
}));

/**
 * Maps OpenAI API parameter names to their Gemini API equivalents.
 * Enables seamless translation of request configurations between APIs.
 */
export const FIELDS_MAP = {
  frequency_penalty: "frequencyPenalty",
  max_completion_tokens: "maxOutputTokens",
  max_tokens: "maxOutputTokens",
  n: "candidateCount",
  presence_penalty: "presencePenalty",
  reasoning_effort: "reasoningEffort",
  seed: "seed",
  stop: "stopSequences",
  temperature: "temperature",
  top_k: "topK",
  top_p: "topP",
};

/**
 * Token budget allocation for different reasoning effort levels.
 * Higher budgets allow for more complex reasoning but consume more resources.
 */
export const REASONING_EFFORT_MAP = {
  "none": 0,
  "low": 1024,
  "medium": 8192,
  "high": 24576,
};

/**
 * Available thinking modes that control how reasoning content is handled.
 * - STANDARD: Normal completion without special reasoning processing
 * - THINKING: Include reasoning thoughts in the response
 * - REFINED: Process reasoning internally but exclude from final response
 */
export const THINKING_MODES = Object.freeze({
  STANDARD: "standard",
  THINKING: "thinking",
  REFINED: "refined",
});

/**
 * Maps Gemini finish reasons to OpenAI-compatible finish reasons.
 * Ensures consistent response format across different API providers.
 */
export const REASONS_MAP = {
  "STOP": "stop",
  "MAX_TOKENS": "length",
  "SAFETY": "content_filter",
  "RECITATION": "content_filter",
};

/** Delimiter used to separate chunks in server-sent event streams */
export const STREAM_DELIMITER = "\n\n";

/** Regex pattern for parsing server-sent event data lines */
export const RESPONSE_LINE_REGEX = /^data: (.*)(?:\n\n|\r\r|\r\n\r\n)/;

/** Separator used to join multiple content parts in responses */
export const CONTENT_SEPARATOR = "\n\n|>";
