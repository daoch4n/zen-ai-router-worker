/**
 * Cloudflare Worker entry point that acts as a proxy/adapter between
 * OpenAI-compatible API requests and Google's Gemini API.
 *
 * Provides OpenAI API compatibility for chat completions, embeddings,
 * and model listing while translating requests to Gemini API format.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  handleCompletions,
  handleEmbeddings,
  handleModels
} from './handlers/index.mjs';

import {
  getRandomApiKey,
  forceSetWorkerLocation,
  fixCors,
  errorHandler,
  HttpError
} from './utils/index.mjs';

import { handleOPTIONS } from './utils/cors.mjs';

// Initialize the GoogleGenerativeAI client once per worker instance.
// This instance will be reused across all incoming requests to improve efficiency.
let genAI;

/**
 * Main Cloudflare Worker handler that processes incoming HTTP requests
 * and routes them to appropriate handlers based on the endpoint path.
 *
 * Supports the following OpenAI-compatible endpoints:
 * - POST /chat/completions - Chat completion requests
 * - POST /embeddings - Text embedding requests
 * - GET /models - Available model listing
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
    const apiKey = getRandomApiKey(request, env);
    // Initialize genAI only once per worker instance
    if (!genAI) {
      genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
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

    const { pathname } = new URL(request.url);
    switch (true) {
      case pathname.endsWith("/chat/completions"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        return handleCompletions(await request.json(), genAI)
          .catch(errHandler);

      case pathname.endsWith("/embeddings"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        return handleEmbeddings(await request.json(), genAI)
          .catch(errHandler);

      case pathname.endsWith("/models"):
        if (!(request.method === "GET")) {
          throw new Error("Assertion failed: expected GET request");
        }
        return handleModels(genAI)
          .catch(errHandler);

      default:
        throw new HttpError("404 Not Found", 404);
    }
  } catch (err) {
    return errHandler(err);
  }
}

export default { fetch };
