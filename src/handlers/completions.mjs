/**
 * Handler for OpenAI-compatible chat completions endpoint.
 * Transforms OpenAI requests to Gemini API format and processes responses.
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { processGoogleApiError } from '../utils/error.mjs';
import { generateId, parseModelName, getBudgetFromLevel } from '../utils/helpers.mjs';
import { transformRequest } from '../transformers/request.mjs';
import { processCompletionsResponse } from '../transformers/response.mjs';
import { parseStream, parseStreamFlush, toOpenAiStream, toOpenAiStreamFlush } from '../transformers/stream.mjs';
import { BASE_URL, API_VERSION, DEFAULT_MODEL, THINKING_MODES } from '../constants/index.mjs';

/**
 * Processes chat completion requests by transforming OpenAI format to Gemini API,
 * handling special model configurations like thinking modes and search capabilities.
 *
 * @param {Object} req - OpenAI-compatible chat completion request
 * @param {Array} req.messages - Array of conversation messages
 * @param {string} [req.model] - Model name, may include thinking mode suffixes
 * @param {boolean} [req.stream] - Whether to stream the response
 * @param {Object} [req.stream_options] - Streaming configuration options
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with completion data or stream
 * @throws {Error} When request validation fails or API call errors
 */
export async function handleCompletions(req, apiKey) {
  let model = DEFAULT_MODEL;
  let originalModel = req.model;

  const { baseModel, mode, budget } = parseModelName(req.model);

  // Determine the actual model name to use with Gemini API
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

  // Configure thinking capabilities for reasoning-enhanced models
  let thinkingConfig = null;
  if (mode === THINKING_MODES.THINKING || mode === THINKING_MODES.REFINED) {
    const thinkingBudget = getBudgetFromLevel(budget);
    if (thinkingBudget > 0) {
      thinkingConfig = {
        thinkingBudget,
        includeThoughts: mode === THINKING_MODES.THINKING,
      };
    }
  }

  let body = await transformRequest(req, thinkingConfig);

  // Enable Google Search tool for search-capable models
  switch (true) {
    case model.endsWith(":search"):
      model = model.substring(0, model.length - 7);
      // eslint-disable-next-line no-fallthrough
    case originalModel.endsWith("-search-preview"):
      body.tools = body.tools || [];
      body.tools.push({googleSearch: {}});
  }

  // Construct Gemini API endpoint URL based on streaming preference
  const TASK = req.stream ? "streamGenerateContent" : "generateContent";
  let url = `${BASE_URL}/${API_VERSION}/models/${model}:${TASK}`;
  if (req.stream) {
    url += "?alt=sse";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  body = response.body;
  if (response.ok) {
    let id = "chatcmpl-" + generateId();
    const shared = {};

    if (req.stream) {
      // Process streaming response through transformation pipeline
      body = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TransformStream({
          transform: parseStream,
          flush: parseStreamFlush,
          buffer: "",
          shared,
        }))
        .pipeThrough(new TransformStream({
          transform: toOpenAiStream,
          flush: toOpenAiStreamFlush,
          streamIncludeUsage: req.stream_options?.include_usage,
          model, id, last: [],
          thinkingMode: mode,
          shared,
        }))
        .pipeThrough(new TextEncoderStream());
    } else {
      // Process non-streaming response
      body = await response.text();
      try {
        body = JSON.parse(body);
        if (!body.candidates) {
          throw new Error("Invalid completion object");
        }
      } catch (err) {
        console.error("Error parsing response:", err);
        return new Response(body, fixCors(response));
      }
      body = processCompletionsResponse(body, model, id, mode);
    }
  } else {
    // Handle API errors with enhanced error processing for non-streaming requests
    if (!req.stream) {
      throw await processGoogleApiError(response);
    }
    // For streaming requests, pass through the error response as-is
    // This maintains compatibility with streaming error handling
  }
  return new Response(body, fixCors(response));
}
