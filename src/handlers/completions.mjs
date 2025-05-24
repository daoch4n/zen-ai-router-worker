/**
 * Handler for chat completions endpoint
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { generateId, parseModelName, getBudgetFromLevel } from '../utils/helpers.mjs';
import { transformRequest } from '../transformers/request.mjs';
import { processCompletionsResponse } from '../transformers/response.mjs';
import { parseStream, parseStreamFlush } from '../transformers/stream.mjs';
import { transformOpenAIToAnthropicResponse } from '../transformers/responseAnthropic.mjs';
import { createAnthropicStreamTransformer } from '../transformers/streamAnthropic.mjs';
import { BASE_URL, API_VERSION, DEFAULT_MODEL, THINKING_MODES } from '../constants/index.mjs';

/**
 * Handles requests to the chat completions endpoint
 * @param {Object} req - The request object
 * @param {string} apiKey - The API key
 * @returns {Promise<Response>} - The response
 */
export async function handleCompletions(req, apiKey, anthropicModelName = null) {
  let model = DEFAULT_MODEL;
  let originalModel = req.model;

  // Parse model name to extract thinking mode and budget
  const { baseModel, mode, budget } = parseModelName(req.model);

  switch (true) {
    case typeof req.model !== "string":
      break;
    case req.model.startsWith("models/"):
      model = baseModel.substring(7);
      break;
    case baseModel.startsWith("gemini-"):
    case baseModel.startsWith("gemma-"):
    case baseModel.startsWith("learnlm-"):
      model = baseModel;
  }

  // Prepare thinking configuration based on mode and budget
  let thinkingConfig = null;
  if (mode === THINKING_MODES.THINKING || mode === THINKING_MODES.REFINED) {
    const thinkingBudget = getBudgetFromLevel(budget);
    if (thinkingBudget > 0) {
      thinkingConfig = {
        thinkingBudget,
        includeThoughts: mode === THINKING_MODES.THINKING, // Include thoughts for thinking mode, exclude for refined
      };
    }
  }

  let body = await transformRequest(req, thinkingConfig);
  switch (true) {
    case model.endsWith(":search"):
      model = model.substring(0, model.length - 7);
      // eslint-disable-next-line no-fallthrough
    case originalModel.endsWith("-search-preview"):
      body.tools = body.tools || [];
      body.tools.push({googleSearch: {}});
  }
  const TASK = req.stream ? "streamGenerateContent" : "generateContent";
  let url = `${BASE_URL}/${API_VERSION}/models/${model}:${TASK}`;
  if (req.stream) { url += "?alt=sse"; }
  const response = await fetch(url, {
    method: "POST",
    headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  body = response.body;
  if (response.ok) {
    let id = "chatcmpl-" + generateId(); // OpenAI-style ID
    const shared = {};
    if (req.stream) {
      // For streaming responses, we need to transform OpenAI chunks to Anthropic SSE events
      body = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TransformStream({
          transform: parseStream, // This handles parsing raw stream data into JSON chunks
          flush: parseStreamFlush,
          buffer: "",
          shared,
        }))
        .pipeThrough(new TransformStream({
          transform: (chunk, controller) => {
            // Use the AnthropicStreamTransformer to convert OpenAI chunks to Anthropic SSE
            if (!shared.anthropicStreamTransformer) {
              shared.anthropicStreamTransformer = createAnthropicStreamTransformer(
                anthropicModelName || originalModel, // Use original Anthropic model name if provided, else original OpenAI model
                id, // OpenAI request ID for traceability
                req.stream_options?.include_usage, // Anthropic-specific stream option
                req // Pass original request for input token calculation
              );
            }
            const anthropicSse = shared.anthropicStreamTransformer.transform(JSON.stringify(chunk));
            if (anthropicSse) {
              controller.enqueue(anthropicSse);
            }
          },
          flush: (controller) => {
            if (shared.anthropicStreamTransformer) {
              // Ensure any final events are flushed
              const finalSse = shared.anthropicStreamTransformer.transform("[DONE]");
              if (finalSse) {
                controller.enqueue(finalSse);
              }
            }
          },
          // No need for buffer or shared here, handled by AnthropicStreamTransformer
        }))
        .pipeThrough(new TextEncoderStream());
    } else {
      // For non-streaming responses, parse and transform the full JSON body
      body = await response.text();
      try {
        body = JSON.parse(body);
        if (!body.choices) { // Check for choices in OpenAI response
          throw new Error("Invalid completion object");
        }
      } catch (err) {
        console.error("Error parsing response:", err);
        return new Response(body, fixCors(response)); // output as is
      }
      // Process OpenAI response to an OpenAI-compatible format first (existing logic)
      let openAIResponse = processCompletionsResponse(body, model, id, mode);
      // Then transform the OpenAI-compatible response to Anthropic format
      if (anthropicModelName) {
        body = transformOpenAIToAnthropicResponse(openAIResponse, anthropicModelName, id);
      } else {
        body = openAIResponse; // If not an Anthropic request, return original OpenAI-compatible response
      }
    }
  }
  return new Response(body, fixCors(response));
}
