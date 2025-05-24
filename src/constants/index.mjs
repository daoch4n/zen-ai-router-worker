/**
 * Constants and configuration for the Cloudflare Worker
 */

// API URLs and versions
export const BASE_URL = "https://generativelanguage.googleapis.com";
export const API_VERSION = "v1beta";
export const API_CLIENT = "genai-js/0.24.1"; // npm view @google/generative-ai version
export const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

// Default models
export const DEFAULT_MODEL = "gemini-2.0-flash";
export const DEFAULT_EMBEDDINGS_MODEL = "text-embedding-004";

// Safety settings
export const HARM_CATEGORIES = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];

export const SAFETY_SETTINGS = HARM_CATEGORIES.map(category => ({
  category,
  threshold: "BLOCK_NONE",
}));

// Field mapping for configuration transformation
export const FIELDS_MAP = {
  frequency_penalty: "frequencyPenalty",
  max_completion_tokens: "maxOutputTokens",
  max_tokens: "maxOutputTokens",
  n: "candidateCount", // not for streaming
  presence_penalty: "presencePenalty",
  reasoning_effort: "reasoningEffort", // OpenAI-style thinking parameter
  seed: "seed",
  stop: "stopSequences",
  temperature: "temperature",
  top_k: "topK", // non-standard
  top_p: "topP",
};

// Thinking budget mapping for reasoning effort levels
export const REASONING_EFFORT_MAP = {
  "none": 0,
  "low": 1024,
  "medium": 8192,
  "high": 24576,
};

// Thinking mode constants
export const THINKING_MODES = {
  STANDARD: "standard",
  THINKING: "thinking",
  REFINED: "refined",
};

// Finish reason mapping
export const REASONS_MAP = {
  //"FINISH_REASON_UNSPECIFIED": // Default value. This value is unused.
  "STOP": "stop",
  "MAX_TOKENS": "length",
  "SAFETY": "content_filter",
  "RECITATION": "content_filter",
  //"OTHER": "OTHER",
};

// Stream processing constants
export const STREAM_DELIMITER = "\n\n";
export const RESPONSE_LINE_REGEX = /^data: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
export const CONTENT_SEPARATOR = "\n\n|>";
