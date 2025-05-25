/**
 * General helper functions for ID generation, image processing, schema adjustment,
 * and thinking mode parsing. Provides utilities used across the application.
 */
import { Buffer } from "node:buffer";
import { HttpError } from './error.mjs';
import { THINKING_MODES, REASONING_EFFORT_MAP } from '../constants/index.mjs';

/**
 * Generates a random alphanumeric ID for API responses.
 * Creates 29-character identifiers compatible with OpenAI response format.
 *
 * @returns {string} Random 29-character alphanumeric string
 */
export const generateId = () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomChar = () => characters[Math.floor(Math.random() * characters.length)];
  return Array.from({ length: 29 }, randomChar).join("");
};

/**
 * Parses and processes images from URLs or data URLs for Gemini API consumption.
 * Handles both remote HTTP(S) URLs and inline data URLs with base64 encoding.
 *
 * @param {string} url - Image URL (http/https) or data URL (data:image/...)
 * @returns {Promise<Object>} Gemini-compatible inline data object
 * @throws {Error} When image cannot be fetched from remote URL
 * @throws {HttpError} When data URL format is invalid
 */
export const parseImg = async (url) => {
  let mimeType, data;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    // Fetch remote image and convert to base64
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} (${url})`);
      }
      mimeType = response.headers.get("content-type");
      data = Buffer.from(await response.arrayBuffer()).toString("base64");
    } catch (err) {
      throw new Error("Error fetching image: " + err.toString());
    }
  } else {
    // Parse data URL format
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match) {
      throw new HttpError("Invalid image data: " + url, 400);
    }
    ({ mimeType, data } = match.groups);
  }

  return {
    inlineData: {
      mimeType,
      data,
    },
  };
};

/**
 * Recursively adjusts JSON schema properties for Gemini API compatibility.
 * Removes unsupported properties that cause validation errors.
 *
 * @param {Object|Array} schemaPart - Schema object or array to process
 */
export const adjustProps = (schemaPart) => {
  if (typeof schemaPart !== "object" || schemaPart === null) {
    return;
  }

  if (Array.isArray(schemaPart)) {
    schemaPart.forEach(adjustProps);
  } else {
    // Remove additionalProperties:false which Gemini doesn't support
    if (schemaPart.type === "object" && schemaPart.properties && schemaPart.additionalProperties === false) {
      delete schemaPart.additionalProperties;
    }
    Object.values(schemaPart).forEach(adjustProps);
  }
};

/**
 * Adjusts OpenAI JSON schemas for Gemini API compatibility.
 * Removes strict mode and other unsupported schema properties.
 *
 * @param {Object} schema - OpenAI tool schema object
 * @param {string} schema.type - Schema type ("function")
 * @param {Object} schema.function - Function definition with schema
 * @returns {Object} Modified schema object (mutated in place)
 */
export const adjustSchema = (schema) => {
  const obj = schema[schema.type];
  delete obj.strict;
  return adjustProps(schema);
};

/**
 * Parses model names to extract thinking mode configuration and budget levels.
 * Supports special model name suffixes that control reasoning behavior.
 *
 * @param {string} modelName - Model name potentially with thinking mode suffix
 * @returns {Object} Parsed model configuration
 * @returns {string} returns.baseModel - Base model name without suffixes
 * @returns {string} returns.mode - Thinking mode (standard, thinking, refined)
 * @returns {string|null} returns.budget - Budget level string or null
 */
export const parseModelName = (modelName) => {
  if (!modelName || typeof modelName !== "string") {
    return {
      baseModel: modelName,
      mode: THINKING_MODES.STANDARD,
      budget: null,
    };
  }

  // Parse thinking mode: model-thinking-{budget}
  const thinkingMatch = modelName.match(/^(.+)-thinking-([^-]+)$/);
  if (thinkingMatch) {
    const [, baseModel, budgetStr] = thinkingMatch;
    return {
      baseModel,
      mode: THINKING_MODES.THINKING,
      budget: budgetStr,
    };
  }

  // Parse refined mode: model-refined-{budget}
  const refinedMatch = modelName.match(/^(.+)-refined-([^-]+)$/);
  if (refinedMatch) {
    const [, baseModel, budgetStr] = refinedMatch;
    return {
      baseModel,
      mode: THINKING_MODES.REFINED,
      budget: budgetStr,
    };
  }

  // Standard mode without special suffixes
  return {
    baseModel: modelName,
    mode: THINKING_MODES.STANDARD,
    budget: null,
  };
};

/**
 * Converts budget level strings to token budget numbers for thinking configuration.
 * Maps human-readable effort levels to specific token allocations.
 *
 * @param {string} budgetLevel - Budget level ("none", "low", "medium", "high")
 * @returns {number} Token budget for reasoning (0 for none, up to 24576 for high)
 */
export const getBudgetFromLevel = (budgetLevel) => {
  if (!budgetLevel || typeof budgetLevel !== "string") {
    return REASONING_EFFORT_MAP.none;
  }

  const normalizedLevel = budgetLevel.toLowerCase();
  return REASONING_EFFORT_MAP[normalizedLevel] ?? REASONING_EFFORT_MAP.none;
};

/**
 * Removes thinking tags from response content for refined mode processing.
 * Identifies and removes the largest thinking block to clean up final output.
 *
 * @param {string} content - Response content potentially containing thinking tags
 * @returns {string} Content with largest thinking block removed
 */
export const removeThinkingTags = (content) => {
  if (!content || typeof content !== "string") {
    return content;
  }
  // Remove only the first occurrence of <thinking>...</thinking>
  return content.replace(/<thinking>[\s\S]*?<\/thinking>/, '');
};
