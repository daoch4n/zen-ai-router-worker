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
  handleOpenAICompletions
} from './completions.mjs'; // This will be the refactored core logic

/**
 * Handles requests to the Anthropic chat completions endpoint.
 * This function acts as an adapter, transforming Anthropic requests
 * to OpenAI format, calling the core OpenAI completions handler,
 * and then transforming the response back to Anthropic format.
 * @param {Object} req - The incoming Anthropic request object.
 * @param {string} apiKey - The API key.
 * @returns {Promise<Response>} - The Anthropic-compatible response.
 */
export async function handleAnthropicCompletions(req, apiKey) {
  const anthropicModelName = req.model; // Store original Anthropic model name

  // 1. Transform Anthropic request to OpenAI format
  const openAIReq = transformAnthropicToOpenAIRequest(req);

  // 2. Call the core OpenAI completions handler (which now handles OpenAI to Gemini)
  // This function will return an OpenAI-formatted response (either full JSON or a stream)
  const openAIRes = await handleOpenAICompletions(openAIReq, apiKey);

  // 3. Transform OpenAI response back to Anthropic format
  if (openAIReq.stream) {
    // For streaming, pipe through the Anthropic stream transformer
    const openAIRequestId = openAIRes.headers.get('openai-request-id') || `chatcmpl-${generateId()}`; // Get ID for traceability
    const anthropicStream = openAIRes.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream({
        transform: parseStream, // This handles parsing raw stream data into JSON chunks
        flush: parseStreamFlush,
        buffer: "",
        shared: {}, // Local shared object for this stream
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
          const anthropicSse = this.anthropicStreamTransformer.transform(JSON.stringify(chunk));
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
    const openAIResBody = await openAIRes.json();
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