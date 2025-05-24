/**
 * Handler for chat completions endpoint
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { errorHandler } from '../utils/error.mjs';
import { generateId, parseModelName, getBudgetFromLevel } from '../utils/helpers.mjs';
import { transformRequest } from '../transformers/request.mjs';
import { processCompletionsResponse } from '../transformers/response.mjs';
import { parseStream, parseStreamFlush, toOpenAiStream, toOpenAiStreamFlush } from '../transformers/stream.mjs';
import { BASE_URL, API_VERSION, DEFAULT_MODEL, THINKING_MODES } from '../constants/index.mjs';

/**
 * Handles requests to the chat completions endpoint
 * @param {Object} req - The request object
 * @param {string} apiKey - The API key
 * @returns {Promise<Response>} - The response
 */
export async function handleOpenAICompletions(req, apiKey) {
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

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Gemini API Error:", response.status, errorBody);
    return errorHandler(new Error(errorBody), fixCors, response.status);
  }

  // Original body might be a stream, so handle accordingly
  let id = "chatcmpl-" + generateId();
  const shared = {};
  if (req.stream) {
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
        thinkingMode: mode, // Pass thinking mode to stream transformer
        shared,
      }))
      .pipeThrough(new TextEncoderStream());
  } else {
    body = await response.text();
    try {
      body = JSON.parse(body);
      if (!body.candidates) {
        throw new Error("Invalid completion object");
      }
    } catch (err) {
      console.error("Error parsing response:", err);
      // If parsing fails, return the raw body as is (with CORS headers)
      return new Response(body, fixCors(response));
    }
    body = processCompletionsResponse(body, model, id, mode);
  }
  return new Response(body, fixCors(response));
}
