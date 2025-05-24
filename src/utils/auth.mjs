/**
 * Authentication utilities
 */
import { HttpError } from './error.mjs';
import { API_CLIENT } from '../constants/index.mjs';

/**
 * Creates headers with API key and other optional headers
 * @param {string} apiKey - The API key
 * @param {Object} [more] - Additional headers
 * @returns {Object} - Headers object
 */
export const makeHeaders = (apiKey, more) => {
  if (!apiKey) {
    throw new HttpError("API key is missing for makeHeaders", 401);
  }
  return {
    "x-goog-api-client": API_CLIENT,
    "x-goog-api-key": apiKey,
    ...more
  };
};

/**
 * Retrieves a random API key from the environment variables
 * @param {Request} request - The incoming request object
 * @param {Object} env - The environment variables
 * @returns {string} - The API key
 * @throws {HttpError} - If no valid API key is found
 */
export function getRandomApiKey(request, env) {
  let apiKey = request.headers.get("Authorization")?.split(" ")[1] ?? null; // Try OpenAI's Authorization header first
  if (!apiKey) {
    apiKey = request.headers.get("x-api-key") ?? null; // Then try Anthropic's x-api-key header
  }

  if (apiKey) {
    return apiKey;
  }

  const apiKeys = Object.entries(env)
    .filter(([key, value]) => /^KEY\d+$/.test(key) && value)
    .map(([, value]) => value);

  if (apiKeys.length === 0) {
    throw new HttpError("Bad credentials - no API keys found in environment variables", 401);
  }

  return apiKeys[Math.floor(Math.random() * apiKeys.length)];
}
