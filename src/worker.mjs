/**
 * Cloudflare Worker entry point that acts as a proxy/adapter between
 * OpenAI-compatible API requests and Google's Gemini API.
 *
 * Provides OpenAI API compatibility for chat completions, embeddings,
 * and model listing while translating requests to Gemini API format.
 */
import {
  handleCompletions,
  handleEmbeddings,
  handleModels,
  handleTTS,
  handleRawTTS,
  handleAnthropicCompletions
} from './handlers/index.mjs';

import { TtsJobDurableObject } from './durable_objects/TtsJobDurableObject.mjs';

// Global index for round-robin API key selection
let apiKeyIndex = 0;

import {
  // getRandomApiKey, // Removed
  authenticateClientRequest, // Added
  selectGoogleApiKeyRoundRobin, // Added
  forceSetWorkerLocation,
  fixCors,
  errorHandler,
  HttpError
} from './utils/index.mjs'; // Assuming index.mjs re-exports from auth.mjs

import { handleOPTIONS } from './utils/cors.mjs';

/**
 * Main Cloudflare Worker handler that processes incoming HTTP requests
 * and routes them to appropriate handlers based on the endpoint path.
 *
 * Supports the following OpenAI-compatible endpoints:
 * - POST /chat/completions - Chat completion requests
 * - POST /embeddings - Text embedding requests
 * - GET /models - Available model listing
 * - POST /tts - Text-to-speech requests
 * - POST /rawtts - Raw text-to-speech requests (returns base64 audio)
 *
 * @param {Request} request - The incoming HTTP request
 * @param {Object} env - Cloudflare Worker environment variables
 * @returns {Promise<Response>} HTTP response with CORS headers applied
 */
async function fetch(request, env) {
  if (request.method === "OPTIONS") {
    return handleOPTIONS();
  }

  const errHandler = (err) => errorHandler(err, fixCors);

  try {
    const url = new URL(request.url);

    // Unified Google API Key Selection (Round Robin)
    const { selectedKey: googleApiKeyForBackend, numKeys: numGoogleApiKeys } = selectGoogleApiKeyRoundRobin(env, apiKeyIndex);
    if (numGoogleApiKeys > 0) {
      apiKeyIndex = (apiKeyIndex + 1) % numGoogleApiKeys;
    }
    // console.log(`Worker: Selected Google API Key for backend (Round Robin Index: ${apiKeyIndex}): ${googleApiKeyForBackend ? 'Present' : 'Missing'}`);


    // Block requests from specific Cloudflare data centers that may have
    // connectivity issues with Google's API endpoints
    const colo = request.cf?.colo;
    if (colo && ["DME", "LED", "SVX", "KJA"].includes(colo)) {
      return new Response(`Bad Cloudflare colo: ${colo}. Try again`, {
        status: 429,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Initialize worker location for geolocation-dependent features
    await forceSetWorkerLocation(env);

    switch (true) {
      case url.pathname.endsWith("/v1/messages"): // Anthropic Messages API
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed", 405);
        }
        authenticateClientRequest(request, env);
        return handleAnthropicCompletions(await request.json(), googleApiKeyForBackend, env)
          .catch(errHandler);

      case url.pathname.endsWith("/chat/completions"):
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed for /chat/completions, expected POST", 405);
        }
        authenticateClientRequest(request, env);
        return handleCompletions(await request.json(), googleApiKeyForBackend)
          .catch(errHandler);

      case url.pathname.endsWith("/embeddings"):
      case url.pathname.endsWith("/embed"):
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed for /embeddings, expected POST", 405);
        }
        authenticateClientRequest(request, env);
        return handleEmbeddings(await request.json(), googleApiKeyForBackend)
          .catch(errHandler);

      case url.pathname.endsWith("/models"):
        if (!(request.method === "GET")) {
          throw new HttpError("Method Not Allowed for /models, expected GET", 405);
        }
        authenticateClientRequest(request, env);
        return handleModels(googleApiKeyForBackend)
          .catch(errHandler);

      case url.pathname.endsWith("/tts"):
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed for /tts, expected POST", 405);
        }
        // Client authentication for /tts is handled by the orchestrator/DO if applicable,
        // or by direct API key if GOOGLE_API_KEY is used by the tts handler.
        // Here we pass the globally selected googleApiKeyForBackend.
        return handleTTS(request, googleApiKeyForBackend, env, url)
          .catch(errHandler);

      case url.pathname.endsWith("/rawtts"):
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed for /rawtts, expected POST", 405);
        }
        // Client authentication for /rawtts is expected to be done by the caller (e.g. orchestrator)
        // or by direct API key if GOOGLE_API_KEY is used by the rawtts handler.
        // Here we pass the globally selected googleApiKeyForBackend.
        return handleRawTTS(request, googleApiKeyForBackend, env, url)
          .catch(errHandler);

      default:
        throw new HttpError("404 Not Found", 404);
    }
  } catch (err) {
    return errHandler(err);
  }
}

export { TtsJobDurableObject };
export default { fetch };
