/**
 * Cloudflare Worker entry point
 *
 * This worker acts as a proxy/adapter between OpenAI-compatible API requests
 * and Google's Gemini API.
 */
import {
  handleOpenAICompletions
} from './handlers/completions.mjs';
import {
  handleAnthropicCompletions
} from './handlers/anthropicCompletions.mjs';
import {
  handleEmbeddings,
  handleModels,
  handleOPTIONS
} from './handlers/index.mjs';

import {
  getRandomApiKey,
  forceSetWorkerLocation,
  fixCors,
  errorHandler,
  HttpError
} from './utils/index.mjs';

/**
 * Main worker handler
 */
export default {
  async fetch(request, env) {
    // Handle OPTIONS requests for CORS
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }

    // Create error handler with CORS support
    const errHandler = (err) => errorHandler(err, fixCors);

    try {
      // Get API key and validate location
      const apiKey = getRandomApiKey(request, env);
      const colo = request.cf?.colo;
      if (colo && ["DME", "LED", "SVX", "KJA"].includes(colo)) {
        return new Response(`Bad Cloudflare colo: ${colo}. Try again`, {
          status: 429,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // Force set worker location (for geolocation features)
      await forceSetWorkerLocation(env);

      // Route request based on path
      const { pathname } = new URL(request.url);
      switch (pathname) { // Use exact path matching
        case "/v1/messages": // Anthropic Messages API
          if (!(request.method === "POST")) {
            throw new HttpError("Method Not Allowed", 405);
          }
          return handleAnthropicCompletions(await request.json(), apiKey, env)
            .catch(errHandler);

        case "/chat/completions": // OpenAI Chat Completions API
          if (!(request.method === "POST")) {
            throw new HttpError("Method Not Allowed", 405);
          }
          return handleOpenAICompletions(await request.json(), apiKey)
            .catch(errHandler);

        case pathname.endsWith("/embeddings"):
          if (!(request.method === "POST")) {
            throw new Error("Assertion failed: expected POST request");
          }
          return handleEmbeddings(await request.json(), apiKey)
            .catch(errHandler);

        case pathname.endsWith("/models"):
          if (!(request.method === "GET")) {
            throw new Error("Assertion failed: expected GET request");
          }
          return handleModels(apiKey)
            .catch(errHandler);

        default:
          throw new HttpError("404 Not Found", 404);
      }
    } catch (err) {
      return errHandler(err);
    }
  }
};
