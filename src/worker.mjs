import { Buffer } from "node:buffer";

// This worker script handles incoming requests and routes them to appropriate handlers.

export default {
  async fetch(request, env) { // Added env parameter
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }
    const errHandler = (err) => {
      console.error(err);
      return new Response(err.message, { status: err.status ?? 500, headers: fixCors() });
    };
    try {
      const apiKey = getRandomApiKey(request, env);
      await forceSetWorkerLocation(env);
      const { pathname } = new URL(request.url);
      switch (true) {
        case pathname.endsWith("/chat/completions"):
          if (request.method !== "POST") {
            throw new HttpError("The specified HTTP method is not allowed for the requested resource", 400);
          }
          return handleCompletions(env, await request.json(), apiKey)
            .catch(errHandler);
        case pathname.endsWith("/models"):
          if (request.method !== "GET") {
            throw new HttpError("The specified HTTP method is not allowed for the requested resource", 400);
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

const BASE_URL = "https://generativelanguage.googleapis.com";
const API_VERSION = "v1beta";
const API_CLIENT = "genai-js/0.21.0"; // npm view @google/generative-ai version
const DELIMITER = "\n\n";

/**
 * Custom error class for HTTP errors.
 * @class HttpError
 * @extends {Error}
 */
class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

/**
 * Fixes the CORS headers.
 * @param {Headers} headers The headers object to fix.
 * @returns {Headers} The fixed headers object.
 */
const fixCors = (headers) => {
  headers = new Headers(headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
};

/**
 * Handles OPTIONS requests by returning a response with CORS headers.
 * @returns {Response} A response with CORS headers.
 */
const handleOPTIONS = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    }
  });
};

/**
 * Handles requests for available models.
 * @param {string} apiKey The API key for authentication.
 * @returns {Promise<Response>} A Promise that resolves to a response containing the list of models.
 */
async function handleModels(apiKey) {
  const response = await fetch(`${BASE_URL}/${API_VERSION}/models`, {
    headers: {
      "x-goog-api-key": apiKey,
      "x-goog-api-client": API_CLIENT,
    },
  });
  let { body } = response;
  if (response.ok) {
    const { models } = JSON.parse(await response.text());
    body = JSON.stringify({
      object: "list",
      data: models.map(({ name }) => ({
        id: name.replace("models/", ""),
        object: "model",
        created: 0,
        owned_by: "",
      })),
    }, null, "  ");
  }
  return new Response(body, { ...response, headers: fixCors(response.headers) });
}

/**
 * Handles chat completion requests.
 * @param {object} req The request body containing the chat parameters.
 * @param {string} apiKey The API key for authentication.
 * @returns {Promise<Response>} A Promise that resolves to a response containing the chat completion.
 */
async function handleCompletions(env, req, apiKey) {
  let model = env.DEFAULT_MODEL || "gemini-2.0-flash-exp";
  if (typeof req.model === "string") {
    if (req.model.startsWith("models/")) {
      model = req.model.substring(7);
    } else if (req.model.startsWith("gemini-") || req.model.startsWith("learnlm-")) {
      model = req.model;
    }
  }
  if (!model.includes("exp")) {
    model = env.DEFAULT_MODEL || "gemini-2.0-flash-exp";
  }
  const TASK = req.stream ? "streamGenerateContent" : "generateContent";
  let url = `${BASE_URL}/${API_VERSION}/models/${model}:${TASK}`;
  if (req.stream) { url += "?alt=sse"; }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-api-client": API_CLIENT,
    },
    body: JSON.stringify(await transformRequest(req)), // try
  });

  let body = response.body;
  if (response.ok) {
    let id = generateChatcmplId(); //"chatcmpl-8pMMaqXMK68B3nyDBrapTDrhkHBQK";
    if (req.stream) {
      body = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new TransformStream({
          transform: parseStream,
          flush: parseStreamFlush,
          buffer: "",
        }))
        .pipeThrough(new TransformStream({
          transform: toOpenAiStream,
          flush: toOpenAiStreamFlush,
          model, id, last: [],
        }))
        .pipeThrough(new TextEncoderStream());
    } else {
      body = await response.text();
      body = processCompletionsResponse(JSON.parse(body), model, id);
    }
  }
  return new Response(body, { ...response, headers: fixCors(response.headers) });
}

const harmCategory = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
];
const safetySettings = harmCategory.map(category => ({
  category,
  threshold: "BLOCK_NONE",
}));
const fieldsMap = {
  stop: "stopSequences",
  n: "candidateCount", // { "error": { "code": 400, "message": "Only one candidate can be specified", "status": "INVALID_ARGUMENT" } }
  max_tokens: "maxOutputTokens",
  temperature: "temperature",
  top_p: "topP",
  //..."topK"
};

/**
 * Transforms the request body to match the Google Gemini API format.
 * @param {object} req The request body from the client.
 * @returns {Promise<object>} A Promise that resolves to the transformed request body.
 */
const transformConfig = (req) => {
  const cfg = Object.entries(fieldsMap).reduce((acc, [key, mappedKey]) => {
    if (req[key] !== undefined) {
      acc[mappedKey] = req[key];
    }
    return acc;
  }, {});

  if (req.response_format?.type === "json_object") {
    cfg.response_mime_type = "application/json";
  }
  // best for coding
  cfg.temperature = 0.2;
  cfg.topP = 0.1;
  return cfg;
};

/**
 * Parses an image URL to match the Google Gemini API format.
 * @param {string} url The image URL.
 * @returns {Promise<object>} A Promise that resolves to the transformed image object.
 */
const parseImg = async (url) => {
  let mimeType, data;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} (${url})`);
      }
      mimeType = response.headers.get("content-type");
      data = Buffer.from(await response.arrayBuffer()).toString("base64");
    } catch (err) {
      throw new Error("Error fetching image: " + err.toString());
    }
  } else {
    const match = url.match(/^data:(?<mimeType>.*?)(;base64)?,(?<data>.*)$/);
    if (!match) {
      throw new Error("Invalid image data: " + url);
    }
    ({ mimeType, data } = match.groups);
  }
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
};

/**
 * Transforms a single message object.
 * @param {object} msg The message object.
 * @returns {Promise<object>} A Promise that resolves to the transformed message object.
 */
const transformMsg = async ({ role, content }) => {
  const parts = [];
  if (!Array.isArray(content)) {
    // system, user: string
    // assistant: string or null (Required unless tool_calls is specified.)
    parts.push({ text: content });
    return { role, parts };
  }
  // user:
  // An array of content parts with a defined type.
  // Supported options differ based on the model being used to generate the response.
  // Can contain text, image, or audio inputs.
  for (const item of content) {
    switch (item.type) {
      case "text":
        parts.push({ text: item.text });
        break;
      case "image_url":
        parts.push(await parseImg(item.image_url.url));
        break;
      case "input_audio":
        parts.push({
          inlineData: {
            mimeType: "audio/" + item.input_audio.format,
            data: item.input_audio.data,
          }
        });
        break;
      default:
        throw new TypeError(`Unknown "content" item type: "${item.type}"`);
    }
  }
  return { role, parts };
};

/**
 * Transforms the messages array to match the Google Gemini API format.
 * @param {array} messages The messages array.
 * @returns {Promise<object>} A Promise that resolves to the transformed messages object.
 */
const transformMessages = async (messages) => {
  if (!messages) { return; }
  let system_instruction;
  const contents = [];

  for (const item of messages) {
    if (item.role === "system") {
      delete item.role;
      system_instruction = await transformMsg(item);
    } else {
      item.role = item.role === "assistant" ? "model" : "user";
      contents.push(await transformMsg(item));
    }
  }

  if (system_instruction && contents.length === 0) {
    contents.push({ role: "model", parts: { text: " " } });
  }
  return { system_instruction, contents };
};

/**
 * Transforms the request body to match the Google Gemini API format.
 * @param {object} req The request body from the client.
 * @returns {Promise<object>} A Promise that resolves to the transformed request body.
 */
const transformRequest = async (req) => ({
  ...await transformMessages(req.messages),
  safetySettings,
  generationConfig: transformConfig(req),
});

/**
 * Generates a unique ID for a chat completion.
 * @returns {string} The unique ID.
 */
const generateChatcmplId = () => {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomChar = () => characters[Math.floor(Math.random() * characters.length)];
  return "chatcmpl-" + Array.from({ length: 29 }, randomChar).join("");
};

/**
 * Maps finish reasons to OpenAI format.
 * @param {string} key The key for the finish reason.
 * @param {object} cand The candidate object.
 * @returns {object} The transformed candidate object.
 */
const reasonsMap = { //https://ai.google.dev/api/rest/v1/GenerateContentResponse#finishreason
  //"FINISH_REASON_UNSPECIFIED": // Default value. This value is unused.
  "STOP": "stop",
  "MAX_TOKENS": "length",
  "SAFETY": "content_filter",
  "RECITATION": "content_filter",
  //"OTHER": "OTHER",
  // :"function_call",
};

/**
 * Transforms the candidates object to match the OpenAI format.
 * @param {string} key The key for the finish reason.
 * @param {object} cand The candidate object.
 * @returns {object} The transformed candidate object.
 */
const transformCandidates = (key, cand) => ({
  index: cand.index || 0, // 0-index is absent in new -002 models response
  [key]: { role: "assistant", content: cand.content?.parts[0].text },
  logprobs: null,
  finish_reason: reasonsMap[cand.finishReason] || cand.finishReason,
});
const transformCandidatesMessage = transformCandidates.bind(null, "message");
const transformCandidatesDelta = transformCandidates.bind(null, "delta");

/**
 * Transforms the usage metadata to match the OpenAI format.
 * @param {object} data The usage metadata object.
 * @returns {object} The transformed usage object.
 */
const transformUsage = (data) => ({
  completion_tokens: data.candidatesTokenCount,
  prompt_tokens: data.promptTokenCount,
  total_tokens: data.totalTokenCount
});

/**
 * Processes the completions response to match the OpenAI format.
 * @param {object} data The completions response object.
 * @param {string} model The model name.
 * @param {string} id The chat completion ID.
 * @returns {string} The processed completions response.
 */
const processCompletionsResponse = (data, model, id) => {
  return JSON.stringify({
    id,
    choices: data.candidates.map(transformCandidatesMessage),
    created: Math.floor(Date.now() / 1000),
    model,
    //system_fingerprint: "fp_69829325d0",
    object: "chat.completion",
    usage: transformUsage(data.usageMetadata),
  });
};

/**
 * Parses a stream of data chunks.
 * @param {string} chunk The incoming data chunk.
 * @param {TransformStreamDefaultController} controller The controller for the TransformStream.
 */
async function parseStream(chunk, controller) {
  const responseLineRE = /^data: (.*)(?:\n\n|\r\r|\r\n\r\n)/;
  chunk = await chunk;
  if (!chunk) { return; }
  this.buffer += chunk;
  let match;
  while ((match = this.buffer.match(responseLineRE))) {
    try {
      controller.enqueue(match[1]);
      this.buffer = this.buffer.substring(match[0].length);
    } catch (err) {
      console.error("Error parsing stream:", err);
      controller.error(err);
      return;
    }
  }
}

/**
 * Flushes the buffer in the parseStream function.
 * @param {TransformStreamDefaultController} controller The controller for the TransformStream.
 */
async function parseStreamFlush(controller) {
  if (this.buffer) {
    console.error("Invalid data in buffer:", this.buffer);
    controller.enqueue(this.buffer);
  }
}

/**
 * Transforms a single response stream data object.
 * @param {object} data The data object from the stream.
 * @param {string} stop The stop reason.
 * @param {string} first The first chunk flag.
 * @returns {string} The transformed data string.
 */
function transformResponseStream(data, stop, first) {
  const item = transformCandidatesDelta(data.candidates[0]);
  if (stop) { item.delta = {}; } else { item.finish_reason = null; }
  if (first) { item.delta.content = ""; } else { delete item.delta.role; }
  const output = {
    id: this.id,
    choices: [item],
    created: Math.floor(Date.now() / 1000),
    model: this.model,
    //system_fingerprint: "fp_69829325d0",
    object: "chat.completion.chunk",
  };
  if (stop && data.usageMetadata) {
    output.usage = transformUsage(data.usageMetadata);
  }
  return "data: " + JSON.stringify(output) + DELIMITER;
}

/**
 * Transforms the stream data to match the OpenAI format.
 * @param {string} chunk The incoming data chunk.
 * @param {TransformStreamDefaultController} controller The controller for the TransformStream.
 */
async function toOpenAiStream(chunk, controller) {
  const transform = transformResponseStream.bind(this);
  const line = await chunk;
  if (!line) { return; }
  let data;
  try {
    data = JSON.parse(line);
  } catch (err) {
    console.error(line);
    console.error(err);
    const length = this.last.length || 1; // at least 1 error msg
    const candidates = Array.from({ length }, (_, index) => ({
      finishReason: "error",
      content: { parts: [{ text: err }] },
      index,
    }));
    data = { candidates };
  }
  const candidate = data.candidates[0]; // !!untested with candidateCount>1
  candidate.index = candidate.index || 0; // absent in new -002 models response
  if (!this.last[candidate.index]) {
    controller.enqueue(transform(data, false, "first"));
  }
  this.last[candidate.index] = data;
  if (candidate.content) { // prevent empty data (e.g. when MAX_TOKENS)
    controller.enqueue(transform(data));
  }
}

/**
 * Flushes the buffer in the toOpenAiStream function.
 * @param {TransformStreamDefaultController} controller The controller for the TransformStream.
 */
async function toOpenAiStreamFlush(controller) {
  const transform = transformResponseStream.bind(this);
  if (this.last.length > 0) {
    for (const data of this.last) {
      controller.enqueue(transform(data, "stop"));
    }
    controller.enqueue("data: [DONE]" + DELIMITER);
  }
}

/**
 * Retrieves a random API key from the environment variables.
 * @param {Request} request The incoming request object.
 * @param {object} env The environment variables.
 * @returns {string} The API key.
 */
function getRandomApiKey(request, env) {
  let apiKey = request.headers.get("Authorization")?.split(" ")[1] ?? null;
  if (!apiKey) {
    throw new HttpError("Bad credentials - no api key", 401);
  }

  if (apiKey !== env.PASS) {
    throw new HttpError("Bad credentials - wrong api key", 401);
  }

  const apiKeys = [env.KEY1, env.KEY2, env.KEY3, env.KEY4].filter(Boolean);
  apiKey = apiKeys.length > 0 ? apiKeys[Math.floor(Math.random() * apiKeys.length)] : null;

  if (!apiKey) {
    throw new HttpError("Bad credentials - check api keys in worker", 401);
  }
  return apiKey;
}

/**
 * Forces the worker to set the location by connecting to a mocked database.
 * @param {object} env The environment variables.
 */
async function forceSetWorkerLocation(env) {
  if (!env.MOCK_DB) return;

  // Create table if it doesn't exist
  await env.MOCK_DB.prepare(`
      CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
      )
  `).run();

  // Check if table is empty
  const { count } = await env.MOCK_DB.prepare("SELECT COUNT(*) as count FROM comments").first();

  if (count === 0) {
      // Random data generators
      const randomNames = [
          "Emma", "Liam", "Olivia", "Noah", "Ava", "James", "Isabella", "Oliver",
          "Sophia", "William", "Mia", "Lucas", "Charlotte", "Mason", "Amelia"
      ];

      const randomComments = [
          "Absolutely fantastic!", "Could be better", "Really impressed",
          "Great experience", "Nice work", "Needs improvement",
          "Outstanding service", "Very responsive", "Amazing features",
          "Love the interface", "Quick and efficient", "Highly reliable"
      ];

      // Generate random number of entities (between 5 and 10)
      const numEntities = Math.floor(Math.random() * 6) + 5;

      // Generate random entries
      const insertStatements = Array.from({ length: numEntities }, () => {
          const randomName = randomNames[Math.floor(Math.random() * randomNames.length)];
          const randomComment = randomComments[Math.floor(Math.random() * randomComments.length)];

          // Generate random date within last 30 days
          const date = new Date();
          date.setDate(date.getDate() - Math.floor(Math.random() * 30));
          const randomDate = date.toISOString().replace('T', ' ').split('.')[0];

          return env.MOCK_DB.prepare(
              "INSERT INTO comments (author, content, created_at) VALUES (?, ?, ?)"
          ).bind(randomName, randomComment, randomDate);
      });

      // Execute all inserts in a batch
      await env.MOCK_DB.batch(insertStatements);
  }

  // Return sample data
  return await env.MOCK_DB.prepare("SELECT * FROM comments LIMIT 2").all();
}
