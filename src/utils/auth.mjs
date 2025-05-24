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
export const makeHeaders = (apiKey, more) => ({
  "x-goog-api-client": API_CLIENT,
  ...(apiKey && { "x-goog-api-key": apiKey }),
  ...more
});

/**
 * Retrieves a random API key from the environment variables
 * @param {Request} request - The incoming request object
 * @param {Object} env - The environment variables
 * @returns {string} - The API key
 * @throws {HttpError} - If no valid API key is found
 */
export function getRandomApiKey(request, env) {
  let apiKey = request.headers.get("x-api-key") ?? null; // Try Anthropic's x-api-key header first
  if (!apiKey) {
    apiKey = request.headers.get("Authorization")?.split(" ")[1] ?? null; // Then try OpenAI's Authorization header
  }

  if (!apiKey) {
    throw new HttpError("Bad credentials - no api key", 401);
  }

  if (apiKey !== env.PASS) {
    throw new HttpError("Bad credentials - wrong api key", 401);
  }

  const apiKeys = Object.entries(env)
    .filter(([key, value]) => /^KEY\d+$/.test(key) && value)
    .map(([, value]) => value);
  apiKey = apiKeys.length > 0 ? apiKeys[Math.floor(Math.random() * apiKeys.length)] : null;

  if (!apiKey) {
    throw new HttpError("Bad credentials - check api keys in worker", 401);
  }
  return apiKey;
}
