/**
 * General helper functions
 */
import { Buffer } from "node:buffer";
import { HttpError } from './error.mjs';

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
