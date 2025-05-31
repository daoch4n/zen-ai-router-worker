/**
 * Handler for OpenAI-compatible models listing endpoint.
 * Retrieves available models from configured APIs (Google, OpenAI) and formats them for OpenAI compatibility.
 */
import { makeHeaders } from '../utils/auth.mjs';
import { fixCors } from '../utils/cors.mjs';
import { processGoogleApiError } from '../utils/error.mjs'; // TODO: May need a generic error processor
import { BASE_URL, API_VERSION } from '../constants/index.mjs';

/**
 * Retrieves and transforms available models from configured services (Google, potentially OpenAI)
 * to OpenAI format. Provides a unified model listing.
 *
 * @param {string} apiKey - Client's API key. Assumed to be for the primary service (Google)
 *                          or a generic key if multiple services are queried without specific keys.
 * @param {Object} env - Cloudflare Worker environment variables.
 * @returns {Promise<Response>} HTTP response with OpenAI-compatible model list
 */
export async function handleModels(apiKey, env) {
  let allModels = [];
  let errors = [];

  // 1. Fetch Google Models (using the provided apiKey, assumed to be a Google key here)
  try {
    const googleResponse = await fetch(`${BASE_URL}/${API_VERSION}/models`, { // BASE_URL is Google's
      headers: makeHeaders(apiKey), // apiKey is client's Google key
    });

    if (googleResponse.ok) {
      const { models: googleModels } = await googleResponse.json();
      const formattedGoogleModels = googleModels.map(({ name }) => ({
        id: name.replace("models/", ""),
        object: "model",
        created: 0, // Standard OpenAI fields
        owned_by: "google", // Custom field to denote origin
      }));
      allModels = allModels.concat(formattedGoogleModels);
    } else {
      const errorText = await googleResponse.text();
      console.error(`Error fetching Google models: ${googleResponse.status} ${errorText}`);
      errors.push({ service: "google", status: googleResponse.status, message: errorText });
      // Don't throw yet, try other providers. If this was the only provider, error will be handled later.
    }
  } catch (error) {
    console.error(`Exception fetching Google models: ${error.message}`);
    errors.push({ service: "google", status: 500, message: error.message });
  }

  // 2. Fetch OpenAI Models (if configured and apiKey might be applicable or a separate OpenAI key is available)
  // For this refactor, we assume `apiKey` is the one to try for OpenAI if OPENAI_API_BASE_URL is set.
  const OPENAI_BASE_URL = env.OPENAI_API_BASE_URL;
  if (OPENAI_BASE_URL) {
    try {
      const openAiResponse = await fetch(`${OPENAI_BASE_URL}/models`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`, // Using the same client apiKey for OpenAI
          "Content-Type": "application/json"
        },
      });

      if (openAiResponse.ok) {
        const { data: openAiModels } = await openAiResponse.json(); // OpenAI's /models returns { object: "list", data: [...] }
        // OpenAI models usually have `owned_by` already.
        allModels = allModels.concat(openAiModels.map(model => ({ ...model, owned_by: model.owned_by || "openai" })));
      } else {
        const errorText = await openAiResponse.text();
        console.error(`Error fetching OpenAI models: ${openAiResponse.status} ${errorText}`);
        errors.push({ service: "openai", status: openAiResponse.status, message: errorText });
      }
    } catch (error) {
      console.error(`Exception fetching OpenAI models: ${error.message}`);
      errors.push({ service: "openai", status: 500, message: error.message });
    }
  }

  // 3. Combine results and handle errors
  if (allModels.length === 0 && errors.length > 0) {
    // If no models were fetched and there were errors, throw the first one or a summary.
    // For simplicity, using the first error. processGoogleApiError might not be suitable for all.
    const firstError = errors[0];
    throw new Error(`Failed to fetch models from any provider. First error (${firstError.service}): ${firstError.status} ${firstError.message}`);
  }

  // Remove duplicate models by 'id' if any provider lists the same model ID.
  const uniqueModels = Array.from(new Map(allModels.map(model => [model.id, model])).values());

  const responseBody = JSON.stringify({
    object: "list",
    data: uniqueModels,
  }, null, "  ");

  // Determine overall status - prefer 200 if any models loaded, otherwise reflect error from primary if only one source failed.
  // This simplistic approach returns 200 if any models are found.
  const overallStatus = allModels.length > 0 ? 200 : (errors[0]?.status || 500);


  return new Response(responseBody, fixCors({ headers: {}, status: overallStatus }));
}
