/**
 * Handler for OpenAI-compatible embeddings endpoint.
 * Transforms embedding requests to Gemini API format and processes responses.
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { HttpError } from '../utils/error.mjs';
import { BASE_URL, API_VERSION, DEFAULT_EMBEDDINGS_MODEL } from '../constants/index.mjs';

/**
 * Processes text embedding requests by transforming OpenAI format to Gemini API.
 * Handles model validation, input normalization, and response format conversion.
 *
 * @param {Object} req - OpenAI-compatible embedding request
 * @param {string} req.model - Model name for embeddings
 * @param {string|Array<string>} req.input - Text input(s) to embed
 * @param {number} [req.dimensions] - Desired embedding dimensions
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with embedding data
 * @throws {HttpError} When model is not specified or request validation fails
 */
export async function handleEmbeddings(req, apiKey) {
  if (typeof req.model !== "string") {
    throw new HttpError("model is not specified", 400);
  }

  // Determine the actual model name for Gemini API
  let model;
  if (req.model.startsWith("models/")) {
    model = req.model;
  } else {
    // Use default embedding model for non-Gemini model names
    if (!req.model.startsWith("gemini-")) {
      req.model = DEFAULT_EMBEDDINGS_MODEL;
    }
    model = "models/" + req.model;
  }

  // Normalize input to array format for batch processing
  if (!Array.isArray(req.input)) {
    req.input = [req.input];
  }

  // Call Gemini batch embedding API
  const response = await fetch(`${BASE_URL}/${API_VERSION}/${model}:batchEmbedContents`, {
    method: "POST",
    headers: makeHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      "requests": req.input.map(text => ({
        model,
        content: { parts: { text } },
        outputDimensionality: req.dimensions,
      }))
    })
  });

  let { body } = response;
  if (response.ok) {
    // Transform Gemini response to OpenAI format
    const { embeddings } = JSON.parse(await response.text());
    body = JSON.stringify({
      object: "list",
      data: embeddings.map(({ values }, index) => ({
        object: "embedding",
        index,
        embedding: values,
      })),
      model: req.model,
    }, null, "  ");
  }

  return new Response(body, fixCors(response));
}
