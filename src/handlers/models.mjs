/**
 * Handler for OpenAI-compatible models listing endpoint.
 * Retrieves available models from Gemini API and formats them for OpenAI compatibility.
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { BASE_URL, API_VERSION } from '../constants/index.mjs';

/**
 * Retrieves and transforms available Gemini models to OpenAI format.
 * Provides model listing compatible with OpenAI API clients.
 *
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with OpenAI-compatible model list
 */
export async function handleModels(apiKey) {
  const response = await fetch(`${BASE_URL}/${API_VERSION}/models`, {
    headers: makeHeaders(apiKey),
  });

  let { body } = response;
  if (response.ok) {
    // Transform Gemini model list to OpenAI format
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

  return new Response(body, fixCors(response));
}
