/**
 * Authentication utilities for handling API keys and request headers.
 * Manages Google API authentication and worker access control.
 */
import { HttpError } from './error.mjs';
import { API_CLIENT } from '../constants/index.mjs';

/**
 * Authenticates the client request against the worker's access pass.
 *
 * @param {Request} request - Incoming HTTP request with Authorization header.
 * @param {Object} env - Cloudflare Worker environment variables.
 * @param {string} env.PASS - Worker access password for authentication.
 * @throws {HttpError} When authentication fails (no token or wrong token).
 */
export function authenticateClientRequest(request, env) {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (!token) {
    throw new HttpError("Bad credentials - no api key", 401);
  }

  if (token !== env.PASS) {
    throw new HttpError("Bad credentials - wrong api key", 401);
  }
  // If authentication is successful, the function completes.
}

/**
 * Extracts and filters Google API keys from environment variables.
 * Looks for keys starting with "KEY" or "GOOGLE_API_KEY".
 *
 * @param {Object} env - Cloudflare Worker environment variables.
 * @returns {string[]} An array of valid, non-empty Google API key strings.
 * @internal
 */
function getGoogleApiKeysFromEnv(env) {
  const apiKeys = Object.keys(env)
    .filter(key => key.startsWith("KEY") || key.startsWith("GOOGLE_API_KEY"))
    .map(key => env[key])
    .filter(value => typeof value === 'string' && value.trim() !== '');
  return apiKeys;
}

/**
 * Selects a Google API key from the environment variables using a round-robin strategy.
 * Uses keys starting with "KEY" (e.g., KEY0, KEY1) or "GOOGLE_API_KEY" (e.g., GOOGLE_API_KEY_1).
 *
 * @param {Object} env - Cloudflare Worker environment variables.
 * @param {number} currentIndex - The current index for round-robin selection (e.g., a counter).
 * @returns {{selectedKey: string, numKeys: number}} An object containing the selected API key and the total number of available keys.
 * @throws {HttpError} If no suitable Google API keys are configured.
 */
export function selectGoogleApiKeyRoundRobin(env, currentIndex) {
  const apiKeys = getGoogleApiKeysFromEnv(env);

  if (apiKeys.length === 0) {
    throw new HttpError("No Google API keys (KEY... or GOOGLE_API_KEY...) configured for round-robin selection.", 500);
  }

  if (typeof currentIndex !== 'number' || currentIndex < 0) {
      // Fallback for invalid currentIndex, though ideally the caller manages this.
      // Using 0 ensures it picks the first key if currentIndex is problematic.
      console.warn(`Invalid currentIndex (${currentIndex}) for round-robin, defaulting to 0.`);
      currentIndex = 0;
  }

  return {
    selectedKey: apiKeys[currentIndex % apiKeys.length],
    numKeys: apiKeys.length
  };
}

/**
 * Selects a random Google API key from the worker's environment variables.
 * Considers only keys named KEY0, KEY1, KEYn, etc.
 *
 * @param {Object} env - Cloudflare Worker environment variables.
 * @param {string} env.KEY0, env.KEY1, etc. - Google API keys.
 * @returns {string} A randomly selected Google API key.
 * @throws {HttpError} If no Google API keys (KEYn) are configured.
 * @deprecated Prefer using `selectGoogleApiKeyRoundRobin` for more controlled key distribution in worker environments.
 */
export function selectRandomGoogleApiKey(env) {
  // This function specifically looks for KEYn patterns, not GOOGLE_API_KEY...
  const apiKeys = Object.entries(env)
    .filter(([key, value]) => /^KEY\d+$/.test(key) && value) // Ensure value is also truthy
    .map(([, value]) => value);

  if (apiKeys.length === 0) {
    throw new HttpError("No Google API keys (pattern KEYn) configured for random selection in worker environment.", 500);
  }

  return apiKeys[Math.floor(Math.random() * apiKeys.length)];
}

/**
 * Creates HTTP headers for Gemini API requests with authentication and client identification.
 * Includes Google API client identifier and optional API key for authenticated requests.
 *
 * @param {string} googleApiKey - Google API key for Gemini access, selected by `selectRandomGoogleApiKey` or `selectGoogleApiKeyRoundRobin`.
 * @param {Object} [more] - Additional headers to include in the request.
 * @returns {Object} Complete headers object for Gemini API requests.
 */
export const makeHeaders = (googleApiKey, more) => ({
  "x-goog-api-client": API_CLIENT,
  ...(googleApiKey && { "x-goog-api-key": googleApiKey }),
  ...more
});

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
 * @deprecated Prefer using authenticateClientRequest and then `selectGoogleApiKeyRoundRobin` or `selectRandomGoogleApiKey` separately.
 */
export function getRandomApiKey(request, env) {
  // Client Authentication part
  authenticateClientRequest(request, env); // Use the new dedicated function

  // Google API Key Selection part (uses the random selection logic specific to KEYn)
  return selectRandomGoogleApiKey(env);
}
