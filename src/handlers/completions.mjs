/**
 * Handler for OpenAI-compatible chat completions endpoint.
 * Transforms OpenAI requests to Gemini API format and processes responses.
 */
import { fixCors } from '../utils/cors.mjs';
import { handleError } from '../utils/error.mjs';
import { generateId, parseModelName, getBudgetFromLevel, adjustSchema } from '../utils/helpers.mjs';
import { processCompletionsResponse } from '../transformers/response.mjs';
import { toOpenAiStream, toOpenAiStreamFlush } from '../transformers/stream.mjs';
import { BASE_URL, API_VERSION, DEFAULT_MODEL, FIELDS_MAP, SAFETY_SETTINGS } from '../constants/index.mjs';

/**
 * Processes chat completion requests by transforming OpenAI format to Gemini API,
 * handling special model configurations like thinking modes and search capabilities.
 *
 * @param {Object} req - OpenAI-compatible chat completion request
 * @param {Array} req.messages - Array of conversation messages
 * @param {string} [req.model] - Model name, may include thinking mode suffixes
 * @param {boolean} [req.stream] - Whether to stream the response
 * @param {Object} [req.stream_options] - Streaming configuration options
 * @returns {Promise<Response>} HTTP response with completion data or stream
 * @throws {Error} When request validation fails or API call errors
 */
export async function handleCompletions(req, genAI) {
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
  let systemInstruction;
  // Check if the first message is a system message and extract it
  if (req.messages && req.messages.length > 0 && req.messages[0].role === "system") {
      const systemMessage = req.messages.shift(); // Remove system message from the array
      // Assuming system message content is always text for now, based on simplified transformMessages
      systemInstruction = { parts: [{ text: systemMessage.content }] };
  }

  let body = await transformRequest(req); // No thinkingConfig passed here, as it's a top-level field

  body.safetySettings = SAFETY_SETTINGS;

  if (systemInstruction) {
      body.systemInstruction = systemInstruction;
  }

  let toolConfig;
  if (req.tool_choice) {
      let mode;
      let allowedFunctionNames;

      if (typeof req.tool_choice === "string") {
          if (req.tool_choice === "none") {
              mode = "NONE";
          } else if (req.tool_choice === "auto") {
              mode = "AUTO";
          }
      } else if (req.tool_choice.type === "function" && req.tool_choice.function?.name) {
          mode = "ANY";
          allowedFunctionNames = [req.tool_choice.function.name];
      }

      if (mode) {
          toolConfig = {
              functionCallingConfig: {
                  mode,
                  allowedFunctionNames,
              },
          };
      }
  }
  if (toolConfig) {
      body.toolConfig = toolConfig;
  }

  // Enable Google Search tool for search-capable models
  switch (true) {
      case model.endsWith(":search"):
          model = model.substring(0, model.length - 7);
      // eslint-disable-next-line no-fallthrough
      case originalModel.endsWith("-search-preview"):
          body.tools = body.tools || [];
          body.tools.push({googleSearch: {}});
  }

  // Configure Gemini model
  const geminiModel = genAI.getGenerativeModel({ model });

  let response;
  try {
    if (req.stream) {
      // Use streamGenerateContent for streaming requests
      response = await geminiModel.generateContentStream(body);
    } else {
      // Use generateContent for non-streaming requests
      response = await geminiModel.generateContent(body);
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return handleError(error);
  }

  // The `response` object from the library is different from a standard `Response` object.
  // We need to extract the `response.stream` or `response.response` for further processing.
  const rawResponse = req.stream ? response.stream : response.response;

  let id = "chatcmpl-" + generateId();
  const shared = {};

  if (req.stream) {
    // Process streaming response through transformation pipeline
    // Convert AsyncGenerator to ReadableStream for pipeThrough
    const readableStream = new ReadableStream({
        async start(controller) {
            for await (const chunk of rawResponse) {
                controller.enqueue(chunk);
            }
            controller.close();
        }
    });

    const openAiStreamTransformer = new TransformStream({
        transform: toOpenAiStream,
        flush: toOpenAiStreamFlush,
        streamIncludeUsage: req.stream_options?.include_usage,
        model, id, last: [],
        thinkingMode: mode,
        shared,
    });

    const stream = readableStream.pipeThrough(openAiStreamTransformer)
      .pipeThrough(new TextEncoderStream());

    // Create a new Response object with the transformed stream
    return new Response(stream, {
      headers: fixCors(new Headers({ 'Content-Type': 'text/event-stream' }))
    });
  } else {
    // Process non-streaming response
    let responseBody = rawResponse;
    if (!responseBody.candidates) {
      throw new Error("Invalid completion object");
    }
    responseBody = processCompletionsResponse(responseBody, model, id, mode);
    return new Response(responseBody, {
      headers: fixCors(new Headers({ 'Content-Type': 'application/json' }))
    });
  }
}
