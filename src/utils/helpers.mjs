/**
 * General helper functions
 */
import { Buffer } from "node:buffer";
import { HttpError } from './error.mjs';
import { THINKING_MODES, REASONING_EFFORT_MAP } from '../constants/index.mjs';

/**
 * Generates a random ID for API responses
 * @returns {string} - Random ID
 */
export const generateId = () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomChar = () => characters[Math.floor(Math.random() * characters.length)];
  return Array.from({ length: 29 }, randomChar).join("");
};

/**
 * Parses an image from a URL or data URL
 * @param {string} url - The image URL or data URL
 * @returns {Promise<Object>} - Object with image data in the format required by the API
 * @throws {Error} - If the image cannot be fetched or parsed
 */
export const parseImg = async (url) => {
  let mimeType, data;
  if (url.startsWith("http://") || url.startsWith("https://")) {
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
 * Adjusts properties in a schema part
 * @param {Object} schemaPart - The schema part to adjust
 */
export const adjustProps = (schemaPart) => {
  if (typeof schemaPart !== "object" || schemaPart === null) {
    return;
  }
  if (Array.isArray(schemaPart)) {
    schemaPart.forEach(adjustProps);
  } else {
    if (schemaPart.type === "object" && schemaPart.properties && schemaPart.additionalProperties === false) {
      delete schemaPart.additionalProperties;
    }
    Object.values(schemaPart).forEach(adjustProps);
  }
};

/**
 * Adjusts a schema for compatibility
 * @param {Object} schema - The schema to adjust
 * @returns {Object} - The adjusted schema
 */
export const adjustSchema = (schema) => {
  const obj = schema[schema.type];
  delete obj.strict;
  return adjustProps(schema);
};

/**
 * Parses a model name to extract thinking mode and budget information
 * @param {string} modelName - The model name to parse
 * @returns {Object} - Object containing baseModel, mode, and budget
 */
export const parseModelName = (modelName) => {
  if (!modelName || typeof modelName !== "string") {
    return {
      baseModel: modelName,
      mode: THINKING_MODES.STANDARD,
      budget: null,
    };
  }

  // Check for thinking mode suffix: -thinking-{budget}
  const thinkingMatch = modelName.match(/^(.+)-thinking-([^-]+)$/);
  if (thinkingMatch) {
    const [, baseModel, budgetStr] = thinkingMatch;
    return {
      baseModel,
      mode: THINKING_MODES.THINKING,
      budget: budgetStr,
    };
  }

  // Check for refined mode suffix: -refined-{budget}
  const refinedMatch = modelName.match(/^(.+)-refined-([^-]+)$/);
  if (refinedMatch) {
    const [, baseModel, budgetStr] = refinedMatch;
    return {
      baseModel,
      mode: THINKING_MODES.REFINED,
      budget: budgetStr,
    };
  }

  // Standard mode (no suffix)
  return {
    baseModel: modelName,
    mode: THINKING_MODES.STANDARD,
    budget: null,
  };
};

/**
 * Converts a budget level string to a thinking budget number
 * @param {string} budgetLevel - The budget level ("low", "medium", "high", "none")
 * @returns {number} - The thinking budget in tokens
 */
export const getBudgetFromLevel = (budgetLevel) => {
  if (!budgetLevel || typeof budgetLevel !== "string") {
    return REASONING_EFFORT_MAP.none;
  }

  const normalizedLevel = budgetLevel.toLowerCase();
  return REASONING_EFFORT_MAP[normalizedLevel] ?? REASONING_EFFORT_MAP.none;
};

/**
 * Removes thinking tags from response content
 * @param {string} content - The content to process
 * @returns {string} - Content with thinking tags removed
 */
export const removeThinkingTags = (content) => {
  if (!content || typeof content !== "string") {
    return content;
  }

  // Remove thinking blocks with various tag formats
  // This handles both XML-style tags and other potential thinking markers
  return content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
    .replace(/\[thought\][\s\S]*?\[\/thought\]/gi, '')
    .trim();
};
