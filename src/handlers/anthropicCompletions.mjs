import {
  transformAnthropicToOpenAIRequest
} from '../transformers/requestAnthropic.mjs';
import {
  transformOpenAIToAnthropicResponse
} from '../transformers/responseAnthropic.mjs';
import {
  createAnthropicStreamTransformer
} from '../transformers/streamAnthropic.mjs';
import {
  handleCompletions
} from './completions.mjs'; // This is the refactored core logic
import {
  parseStream,
  parseStreamFlush
} from '../transformers/stream.mjs'; // For parsing raw stream data
import {
  generateId
} from '../utils/helpers.mjs'; // For generating IDs
import {
  fixCors
} from '../utils/cors.mjs'; // For applying CORS headers
import {
  errorHandler
} from '../utils/error.mjs'; // For handling errors

/**
 * Handles requests to the Anthropic chat completions endpoint.
 * This function acts as an adapter, transforming Anthropic requests
 * to OpenAI format, calling the core OpenAI completions handler,
 * and then transforming the response back to Anthropic format.
 * @param {Object} req - The incoming Anthropic request object.
 * @param {string} apiKey - The API key.
 * @returns {Promise<Response>} - The Anthropic-compatible response.
 */
export async function handleAnthropicCompletions(req, apiKey, env) {
  const anthropicModelName = req.model; // Store original Anthropic model name

  // 1. Transform Anthropic request to OpenAI format
  const openAIReq = transformAnthropicToOpenAIRequest(req, env);

  // 2. Call the core OpenAI completions handler (which now handles OpenAI to Gemini)
  // This function will return an OpenAI-formatted response (either full JSON or a stream)
  let openAIRes;
  try {
    openAIRes = await handleCompletions(openAIReq, apiKey);
  } catch (error) {
    // Catch errors from handleCompletions and transform to Anthropic error
    return errorHandler(error, fixCors);
  }

  // 3. Transform OpenAI response back to Anthropic format
  if (openAIReq.stream) {
    // For streaming, pipe through the Anthropic stream transformer
    const openAIRequestId = openAIRes.headers.get('openai-request-id') || `chatcmpl-${generateId()}`; // Get ID for traceability
    const anthropicStream = openAIRes.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream({
        transform: parseStream, // This handles parsing raw stream data into JSON chunks
        flush: parseStreamFlush,
      }))
      .pipeThrough(new TransformStream({
        transform: (chunk, controller) => {
          if (!this.anthropicStreamTransformer) {
            this.anthropicStreamTransformer = createAnthropicStreamTransformer(
              anthropicModelName,
              openAIRequestId,
              req.stream_options?.include_usage, // Anthropic-specific stream option
              req // Pass original Anthropic request for input token calculation
            );
          }
          const anthropicSse = this.anthropicStreamTransformer.transform(chunk); // chunk should already be parsed object
          if (anthropicSse) {
            controller.enqueue(anthropicSse);
          }
        },
        flush: (controller) => {
          if (this.anthropicStreamTransformer) {
            const finalSse = this.anthropicStreamTransformer.transform("[DONE]");
            if (finalSse) {
              controller.enqueue(finalSse);
            }
          }
        }
      }))
      .pipeThrough(new TextEncoderStream());

    return new Response(anthropicStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...fixCors(openAIRes).headers // Apply CORS headers
      }
    });

  } else {
    // For non-streaming, transform the full JSON response
    let openAIResBody;
    try {
      openAIResBody = await openAIRes.json();
      console.log('DEBUG: Raw OpenAI/Gemini non-streaming response:', JSON.stringify(openAIResBody, null, 2));
    } catch (error) {
      // Catch JSON parsing errors and transform to Anthropic error
      return errorHandler(error, fixCors);
    }
    const anthropicResBody = transformOpenAIToAnthropicResponse(
      openAIResBody,
      anthropicModelName,
      openAIResBody.id // Use OpenAI's ID for traceability
    );
    return new Response(JSON.stringify(anthropicResBody), {
      headers: {
        'Content-Type': 'application/json',
        ...fixCors(openAIRes).headers // Apply CORS headers
      }
    });
  }
}