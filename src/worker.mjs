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
  handleTTS
} from './handlers/index.mjs';

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
 *
 * @param {Request} request - The incoming HTTP request
 * @param {Object} env - Cloudflare Worker environment variables
 * @returns {Promise<Response>} HTTP response with CORS headers applied
 */
async function fetch(request, env) {
  console.log(`Incoming request: ${request.method} ${request.url}`);
  if (request.method === "OPTIONS") {
    return handleOPTIONS();
  }

  const errHandler = (err) => errorHandler(err, fixCors);

  try {
    const apiKey = getRandomApiKey(request, env);
    console.log(`Worker: Using API key: ${apiKey ? '********' + apiKey.substring(apiKey.length - 4) : 'N/A'}`);

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
        const completionsResponse = await handleCompletions(await request.json(), apiKey)
          .catch(errHandler);
        console.log(`Completions response status: ${completionsResponse.status}`);
        return completionsResponse;

      case pathname.endsWith("/embeddings"):
        if (!(request.method === "POST")) {
          throw new Error("Assertion failed: expected POST request");
        }
        const embeddingsResponse = await handleEmbeddings(await request.json(), apiKey)
          .catch(errHandler);
        console.log(`Embeddings response status: ${embeddingsResponse.status}`);
        return embeddingsResponse;

      case pathname.endsWith("/models"):
        if (!(request.method === "GET")) {
          throw new HttpError("Method Not Allowed", 405);
        }
        const modelsResponse = await handleModels(apiKey)
          .catch(errHandler);
        console.log(`Models response status: ${modelsResponse.status}`);
        return modelsResponse;

      case pathname.endsWith("/tts"):
        if (!(request.method === "POST")) {
          throw new HttpError("Method Not Allowed", 405);
        }
        const requestBody = await request.json();
        const apiKeyTTS = getRandomApiKey(request, env); // Ensure getRandomApiKey is correctly used
        const ttsResponse = await handleTTS(requestBody, apiKeyTTS);
        const fixedTtsResponse = new Response(ttsResponse.body, fixCors(ttsResponse));
        console.log(`TTS response status: ${fixedTtsResponse.status}`);
        return fixedTtsResponse;

      default:
        throw new HttpError("404 Not Found", 404);
    }
  } catch (err) {
    console.error("Worker: Error during request processing:", err);
    return errHandler(err);
  }
}

export default { fetch };
