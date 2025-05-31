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
  getRandomApiKey,
  forceSetWorkerLocation,
  fixCors,
  errorHandler,
  HttpError
} from './utils/index.mjs';

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
    const url = new URL(request.url); // Define URL here to use it later
    let selectedApiKey;

    // API key selection logic for TTS routes
    if (url.pathname.endsWith("/tts") || url.pathname.endsWith("/rawtts")) {
      const apiKeys = Object.keys(env)
        .filter(key => key.startsWith("KEY") || key.startsWith("GOOGLE_API_KEY"))
        .map(key => env[key])
        .filter(value => typeof value === 'string' && value.trim() !== ''); // Ensure keys are non-empty strings

      if (apiKeys.length === 0) {
        throw new HttpError("No Google API keys configured", 500);
      }

      selectedApiKey = apiKeys[apiKeyIndex % apiKeys.length];
      apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;
      console.log(`Worker: Selected API Key (Round Robin Index: ${apiKeyIndex}): ${selectedApiKey ? 'Present' : 'Missing'}`);
    } else {
      // Existing API key logic for other routes
      // This part might need adjustment based on whether other routes also stop using Authorization header
      selectedApiKey = getRandomApiKey(request, env);
    }

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

    // const { pathname } = new URL(request.url); // URL is already parsed above
    switch (true) {
      case url.pathname.endsWith("/v1/messages"): // Anthropic Messages API
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed", 405);
        }
        // Assuming selectedApiKey here refers to the one from getRandomApiKey for non-TTS routes
        return handleAnthropicCompletions(await request.json(), selectedApiKey, env)
          .catch(errHandler);

      case url.pathname.endsWith("/chat/completions"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        return handleCompletions(await request.json(), selectedApiKey)
          .catch(errHandler);

      case url.pathname.endsWith("/embeddings"):
      case url.pathname.endsWith("/embed"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        return handleEmbeddings(await request.json(), selectedApiKey)
          .catch(errHandler);

      case url.pathname.endsWith("/models"):
        if (!(request.method === "GET")) {
          throw new Error("Assertion failed: expected GET request");
        }
        return handleModels(selectedApiKey)
          .catch(errHandler);

      case url.pathname.endsWith("/tts"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        // Pass selectedApiKey, env, and url to handleTTS
        return handleTTS(request, selectedApiKey, env, url)
          .catch(errHandler);

      case url.pathname.endsWith("/rawtts"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        // Pass selectedApiKey, env, and url to handleRawTTS
        return handleRawTTS(request, selectedApiKey, env, url)
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
