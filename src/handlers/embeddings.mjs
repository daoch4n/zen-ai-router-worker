/**
 * Handler for OpenAI-compatible embeddings endpoint.
 * Transforms embedding requests to Gemini API format and processes responses.
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { HttpError, processGoogleApiError } from '../utils/error.mjs';
import { BASE_URL, API_VERSION, DEFAULT_EMBEDDINGS_MODEL } from '../constants/index.mjs';

/**
 * Processes text embedding requests by transforming OpenAI format to Gemini API.
 * Handles model validation, input normalization, and response format conversion.
 *
 * @param {Object} req - OpenAI-compatible embedding request
 * @param {string} req.model - Model name for embeddings
 * @param {string|Array<string>} req.input - Text input(s) to embed
 * @param {number} [req.dimensions] - Desired embedding dimensions
 * @param {string} apiKey - Client's API key for the target service.
 * @param {Object} env - Cloudflare Worker environment variables.
 * @returns {Promise<Response>} HTTP response with embedding data
 * @throws {HttpError} When model is not specified or request validation fails
 */
export async function handleEmbeddings(req, apiKey, env) {
  if (typeof req.model !== "string") {
    throw new HttpError("model is not specified", 400);
  }

  const originalModel = req.model;
  let targetModelApiName = originalModel;

  if (!Array.isArray(req.input)) {
    req.input = [req.input];
  }

  let url;
  let headers;
  let requestBody;

  const isGoogleModel = originalModel.startsWith("gemini-") || originalModel.startsWith("models/");
  const isOpenAiModel = originalModel.startsWith("text-embedding-") || originalModel.includes("ada");

  if (isGoogleModel) {
    if (originalModel.startsWith("models/")) {
      targetModelApiName = originalModel;
    } else {
      // Default to a known Google embedding model if a generic or non-embedding Gemini model is passed.
      targetModelApiName = `models/${DEFAULT_EMBEDDINGS_MODEL}`;
    }
    url = `${BASE_URL}/${API_VERSION}/${targetModelApiName}:batchEmbedContents`; // BASE_URL is Google
    headers = makeHeaders(apiKey, { "Content-Type": "application/json" }); // apiKey is client's Google key
    requestBody = JSON.stringify({
      "requests": req.input.map(text => ({
        model: targetModelApiName,
        content: { parts: { text } },
        outputDimensionality: req.dimensions,
      }))
    });
  } else if (isOpenAiModel) {
    const OPENAI_BASE_URL = env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
    url = `${OPENAI_BASE_URL}/embeddings`;
    headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    };
    requestBody = JSON.stringify({
      model: originalModel,
      input: req.input,
      dimensions: req.dimensions
    });
  } else {
    throw new HttpError(`Unsupported model for embeddings: ${originalModel}`, 400);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: requestBody
  });

  let responseBodyJson;
  if (response.ok) {
    responseBodyJson = await response.json();
    let finalResponseBody;
    if (isGoogleModel) {
      finalResponseBody = JSON.stringify({
        object: "list",
        data: responseBodyJson.embeddings.map(({ values }, index) => ({
          object: "embedding",
          index,
          embedding: values,
        })),
        model: originalModel,
      }, null, "  ");
    } else if (isOpenAiModel) {
      // OpenAI response is already in the desired format.
      // Ensure 'model' field is present, as client expects it.
      if (!responseBodyJson.model) responseBodyJson.model = originalModel;
      finalResponseBody = JSON.stringify(responseBodyJson);
    }
    return new Response(finalResponseBody, fixCors(response));
  } else {
    // TODO: processGoogleApiError might need to be made generic or conditional based on the target API
    throw await processGoogleApiError(response);
  }
}
