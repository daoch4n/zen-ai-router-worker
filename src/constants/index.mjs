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

/**
 * Text-to-Speech API limits and validation constants.
 * Based on Google Cloud Text-to-Speech API specifications.
 */
export const TTS_LIMITS = Object.freeze({
  /** Maximum text length in bytes per request (Google API limit) */
  MAX_TEXT_BYTES: 5000,
  /** Minimum text length in characters */
  MIN_TEXT_LENGTH: 1,
  /** Maximum text length in characters (conservative estimate for multi-byte safety) */
  MAX_TEXT_LENGTH: 4000,
});

/**
 * Common Google API error codes and their user-friendly mappings.
 * Provides consistent error messages across different API endpoints.
 */
export const GOOGLE_API_ERROR_MAP = Object.freeze({
  // Authentication and authorization errors
  401: "Invalid or missing API key. Please check your authentication credentials.",
  403: "Access denied. Your API key may not have permission for this operation.",

  // Request validation errors
  400: "Invalid request format or parameters.",

  // Resource and quota errors
  429: "Rate limit exceeded. Please reduce your request frequency and try again.",
  413: "Request too large. Please reduce the size of your input and try again.",

  // Service errors
  500: "Internal server error. Please try again later.",
  502: "Service temporarily unavailable. Please try again later.",
  503: "Service overloaded. Please try again later.",
  504: "Request timeout. Please try again later.",
});

/**
 * Specific error message patterns for Google API responses.
 * Maps common error message patterns to user-friendly responses.
 */
export const GOOGLE_API_ERROR_PATTERNS = Object.freeze({
  // Voice-related errors
  "voice": "The specified voice is not available. Please check the voice name and try again.",
  "Voice": "The specified voice is not available. Please check the voice name and try again.",
  "VOICE": "The specified voice is not available. Please check the voice name and try again.",

  // Model-related errors
  "model": "The specified model is not available or does not support this operation.",
  "Model": "The specified model is not available or does not support this operation.",
  "MODEL": "The specified model is not available or does not support this operation.",

  // Content policy errors
  "content policy": "Content violates usage policies. Please modify your text and try again.",
  "Content policy": "Content violates usage policies. Please modify your text and try again.",
  "CONTENT_POLICY": "Content violates usage policies. Please modify your text and try again.",
  "safety": "Content violates safety guidelines. Please modify your text and try again.",
  "Safety": "Content violates safety guidelines. Please modify your text and try again.",
  "SAFETY": "Content violates safety guidelines. Please modify your text and try again.",

  // Quota and limits
  "quota": "API quota exceeded. Please try again later or contact support.",
  "Quota": "API quota exceeded. Please try again later or contact support.",
  "QUOTA": "API quota exceeded. Please try again later or contact support.",
  "limit": "Request exceeds API limits. Please reduce input size and try again.",
  "Limit": "Request exceeds API limits. Please reduce input size and try again.",
  "LIMIT": "Request exceeds API limits. Please reduce input size and try again.",

  // Network and connectivity
  "network": "Network error occurred. Please check your connection and try again.",
  "Network": "Network error occurred. Please check your connection and try again.",
  "timeout": "Request timed out. Please try again later.",
  "Timeout": "Request timed out. Please try again later.",
  "TIMEOUT": "Request timed out. Please try again later.",
});

/**
 * Voice name validation patterns.
 * Defines acceptable formats for voice names in TTS requests.
 */
export const VOICE_NAME_PATTERNS = Object.freeze({
  /** Standard voice name pattern (e.g., en-US-Standard-A, ja-JP-Wavenet-B) */
  STANDARD: /^[a-z]{2}-[A-Z]{2}-(Standard|Wavenet|Neural2|Studio|Journey)-[A-Z]$/,
  /** Gemini voice pattern (e.g., Puck, Charon, Kore) */
  GEMINI: /^[A-Z][a-z]+$/,
  /** Custom voice pattern for future extensibility */
  CUSTOM: /^custom-[a-zA-Z0-9-_]+$/,
});
