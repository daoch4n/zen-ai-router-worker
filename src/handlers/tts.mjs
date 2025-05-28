/**
 * Handler for Text-to-Speech (TTS) endpoint.
 * Processes TTS requests and integrates with Google's Generative AI TTS API.
 */
import { fixCors } from '../utils/cors.mjs';
import { errorHandler, HttpError } from '../utils/error.mjs';

/**
 * Processes text-to-speech requests by handling voice configuration,
 * text input validation, and audio generation through Google's API.
 *
 * @param {Request} request - The incoming HTTP request containing TTS parameters
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with audio data or error information
 * @throws {Error} When request validation fails or API call errors
 */
export async function handleTTS(request, apiKey) {
  try {
    // Verify apiKey is provided (should be handled by worker, but defensive check)
    if (!apiKey) {
      throw new HttpError("API key is required", 401);
    }

    // Parse query parameters for voice configuration
    const url = new URL(request.url);
    const voiceName = url.searchParams.get('voiceName');
    const secondVoiceName = url.searchParams.get('secondVoiceName');

    // Parse JSON request body for text and model
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (jsonError) {
      throw new HttpError("Invalid JSON in request body", 400);
    }

    const { text, model } = requestBody;

    // Validate required fields
    if (!voiceName) {
      throw new HttpError("voiceName query parameter is required", 400);
    }

    if (!text) {
      throw new HttpError("text field is required in request body", 400);
    }

    if (!model) {
      throw new HttpError("model field is required in request body", 400);
    }

    // Additional validation for non-empty strings
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new HttpError("text must be a non-empty string", 400);
    }

    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new HttpError("model must be a non-empty string", 400);
    }

    if (typeof voiceName !== 'string' || voiceName.trim().length === 0) {
      throw new HttpError("voiceName must be a non-empty string", 400);
    }

    // Validate secondVoiceName if provided
    if (secondVoiceName !== null && (typeof secondVoiceName !== 'string' || secondVoiceName.trim().length === 0)) {
      throw new HttpError("secondVoiceName must be a non-empty string if provided", 400);
    }

    // TODO: Implement Google Generative AI API integration
    // TODO: Implement audio processing and WAV file generation

    // For now, return success with parsed parameters for testing
    return new Response(JSON.stringify({
      message: 'TTS request parsed successfully',
      parameters: {
        voiceName: voiceName.trim(),
        secondVoiceName: secondVoiceName ? secondVoiceName.trim() : null,
        text: text.trim(),
        model: model.trim()
      }
    }), fixCors({
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    }));
  } catch (err) {
    // Use centralized error handler for consistent error responses
    return errorHandler(err, fixCors);
  }
}
