/**
 * Handler for OpenAI-compatible models listing endpoint.
 * Retrieves available models from Gemini API and formats them for OpenAI compatibility.
 */
import { fixCors } from '../utils/cors.mjs';

/**
 * Retrieves and transforms available Gemini models to OpenAI format.
 * Provides model listing compatible with OpenAI API clients.
 *
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with OpenAI-compatible model list
 */
export async function handleModels(genAI) {
  const result = await genAI.listModels();
  const models = result.models;

  const body = JSON.stringify({
    object: "list",
    data: models.map(({ name }) => ({
      id: name.replace("models/", ""),
      object: "model",
      created: 0,
      owned_by: "",
    })),
  }, null, "  ");

  return new Response(body, fixCors(new Response()));
}
