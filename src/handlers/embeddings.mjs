/**
 * Handler for OpenAI-compatible embeddings endpoint.
 * Transforms embedding requests to Gemini API format and processes responses.
 */
import { fixCors } from '../utils/cors.mjs';
import { HttpError } from '../utils/error.mjs';
import { processEmbeddingsResponse } from '../transformers/response.mjs';
import { transformRequest } from '../transformers/request.mjs';
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
export async function handleEmbeddings(req, apiKey, genAI) {
  if (typeof req.model !== "string") {
    throw new HttpError("model is not specified", 400);
  }

  // Determine the actual model name for Gemini API
  // Transform the request using the unified transformRequest function
  const body = await transformRequest(req);

  // Configure Gemini model for embeddings using the model from the transformed body
  const geminiEmbeddingsModel = genAI.getGenerativeModel({ model: body.model });

  // Call Gemini embedContent API with the directly compatible body
  const response = await geminiEmbeddingsModel.embedContent(body);

  // The `response` object from the library is different from a standard `Response` object.
  // Process Gemini response to OpenAI format
  const responseBody = JSON.stringify(processEmbeddingsResponse(response, req.model), null, "  ");

  // Create a new Response object with the transformed body
  return new Response(responseBody, {
    headers: fixCors(new Headers({ 'Content-Type': 'application/json' }))
  });
}
