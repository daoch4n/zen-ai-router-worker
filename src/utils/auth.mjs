/**
 * Authentication utilities for handling API keys and request headers.
 * Manages Google API authentication and worker access control.
 */
import { HttpError } from './error.mjs';


/**
 * Validates worker access and retrieves a random Google API key from environment.
 * Implements two-tier authentication: worker access validation followed by API key selection.
 *
 * @param {Request} request - Incoming HTTP request with Authorization header
 * @param {Object} env - Cloudflare Worker environment variables
 * @param {string} env.PASS - Worker access password for authentication
 * @param {string} env.KEY1, env.KEY2, etc. - Google API keys for random selection
 * @returns {string} Selected Google API key for Gemini requests
 * @throws {HttpError} When authentication fails or no API keys are configured
 */
export function getRandomApiKey(request, env) {
  // Extract bearer token from Authorization header
  let apiKey = request.headers.get("Authorization")?.split(" ")[1] ?? null;
  if (!apiKey) {
    throw new HttpError("Bad credentials - no api key", 401);
  }

  // Validate worker access using PASS environment variable
  if (apiKey !== env.PASS) {
    throw new HttpError("Bad credentials - wrong api key", 401);
  }

  // Collect all configured Google API keys (KEY1, KEY2, etc.)
  const apiKeys = Object.entries(env)
    .filter(([key, value]) => /^KEY\d+$/.test(key) && value)
    .map(([, value]) => value);

  // Select random API key for load balancing and redundancy
  apiKey = apiKeys.length > 0 ? apiKeys[Math.floor(Math.random() * apiKeys.length)] : null;

  if (!apiKey) {
    throw new HttpError("Bad credentials - check api keys in worker", 401);
  }
  return apiKey;
}
