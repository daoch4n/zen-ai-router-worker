import {
  transformAnthropicToOpenAIRequest
} from '../transformers/requestAnthropic.mjs';
import {
  transformOpenAIToAnthropicResponse
} from '../transformers/responseAnthropic.mjs';
import {
  createAnthropicStreamTransformer
} from '../transformers/streamAnthropic.mjs';
// Removed: transformAnthropicToOpenAIRequest, transformOpenAIToAnthropicResponse, createAnthropicStreamTransformer
// These were for adapting to handleCompletions (Gemini/OpenAI handler).
// We now need direct Anthropic interaction.
// import { handleCompletions } from './completions.mjs'; // No longer calling this
import { parseStream as parseAnthropicStream, parseStreamFlush as parseAnthropicStreamFlush } from '../transformers/streamAnthropic.mjs'; // Assuming streamAnthropic.mjs has or will have Anthropic specific stream parsing.
import { generateId } from '../utils/helpers.mjs';
import { fixCors } from '../utils/cors.mjs';
import { errorHandler, HttpError } from '../utils/error.mjs'; // HttpError might be needed
import { DEFAULT_ANTHROPIC_VERSION } from '../constants/index.mjs';

/**
 * Handles requests to the Anthropic chat completions endpoint.
 * This function now directly calls the Anthropic API using the client-provided API key.
 * @param {Object} req - The incoming Anthropic request object (already in Anthropic format).
 * @param {string} apiKey - The client's Anthropic API key.
 * @param {Object} env - Cloudflare Worker environment variables.
 * @returns {Promise<Response>} - The Anthropic-compatible response.
 */
export async function handleAnthropicCompletions(req, apiKey, env) {
  const ANTHROPIC_BASE_URL = env.ANTHROPIC_API_BASE_URL || "https://api.anthropic.com/v1";
  const { model, messages, max_tokens, stream, temperature, top_p, top_k, stop_sequences, system } = req;

  // Basic validation
  if (!model || !messages) {
    throw new HttpError("Missing 'model' or 'messages' in Anthropic request", 400);
  }
  if (!apiKey) { // Should have been caught by authenticateClientRequest, but good practice
    throw new HttpError("Anthropic API key is missing", 401);
  }

  const requestBody = {
    model: model,
    messages: messages,
    max_tokens: max_tokens || 1024, // Anthropic requires max_tokens
    stream: !!stream,
    temperature: temperature,
    top_p: top_p,
    top_k: top_k,
    stop_sequences: stop_sequences,
    system: system,
  };

  // Remove undefined fields from requestBody to keep it clean for Anthropic API
  Object.keys(requestBody).forEach(key => requestBody[key] === undefined && delete requestBody[key]);


  const fetchUrl = `${ANTHROPIC_BASE_URL}/messages`;
  const fetchOptions = {
    method: "POST",
    headers: {
      "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  };

  try {
    const anthropicResponse = await fetch(fetchUrl, fetchOptions);

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text();
      console.error(`Anthropic API Error: ${anthropicResponse.status} ${errorBody}`);
      // Transform Anthropic error structure to a somewhat standard error response if needed
      // For now, pass it through but ensure CORS is applied.
      // Use HttpError to structure it for the global errorHandler
      throw new HttpError(`Anthropic API Error: ${anthropicResponse.status} ${errorBody}`, anthropicResponse.status);
    }

    if (stream) {
      // TODO: Anthropic streaming is different from OpenAI's.
      // It uses server-sent events (SSE) with specific event types like 'message_start', 'content_block_delta', 'message_delta', 'message_stop'.
      // The createAnthropicStreamTransformer was for OpenAI -> Anthropic client.
      // Now we need Anthropic backend -> Anthropic client.
      // This means the raw stream from anthropicResponse.body needs to be processed accordingly.
      // For now, let's pass the raw stream and assume client can handle Anthropic's SSE format.
      // A more robust solution would parse and potentially re-format if an intermediate standard was desired.

      // The original `parseStream` and `createAnthropicStreamTransformer` were for adapting
      // an OpenAI stream to an Anthropic client stream.
      // If the client is an Anthropic client, it expects Anthropic's native SSE stream.
      // So, we might just pass the body through after setting correct headers.

      // For simplicity, directly return the stream if client expects native Anthropic SSE
      return new Response(anthropicResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream', // Anthropic uses this
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...fixCors(anthropicResponse).headers, // Apply CORS headers from original response
        }
      });

    } else {
      // Non-streaming: just return the JSON from Anthropic
      const responseJson = await anthropicResponse.json();
      return new Response(JSON.stringify(responseJson), {
        headers: {
          'Content-Type': 'application/json',
          ...fixCors(anthropicResponse).headers,
        }
      });
    }
  } catch (error) {
    // Catch fetch errors or HttpErrors thrown above
    console.error(`Error in handleAnthropicCompletions: ${error.message}`);
    return errorHandler(error, fixCors); // Use the global error handler
  }
}