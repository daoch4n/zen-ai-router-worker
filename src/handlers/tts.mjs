/**
 * Handler for Text-to-Speech (TTS) endpoint.
 * Processes TTS requests and integrates with Google's Generative AI TTS API.
 */
import { fixCors } from '../utils/cors.mjs';
import { errorHandler, HttpError } from '../utils/error.mjs';

/**
 * Constructs the request body for Google Generative AI TTS API.
 * Supports both single-speaker and multi-speaker configurations.
 *
 * @param {Object} params - Parameters for TTS request
 * @param {string} params.text - Text to synthesize
 * @param {string} params.voiceName - Primary voice name
 * @param {string|null} params.secondVoiceName - Secondary voice name (optional)
 * @returns {Object} Google API request body structure
 */
function constructGoogleTTSRequestBody({ text, voiceName, secondVoiceName }) {
  // Base request structure with contents array
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: text
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {}
    }
  };

  // Configure voice settings based on whether multi-speaker is requested
  if (secondVoiceName) {
    // Multi-speaker configuration
    requestBody.generationConfig.speechConfig.multiSpeakerVoiceConfig = {
      speakerVoiceConfigs: [
        {
          speaker: "Speaker 1",
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName
            }
          }
        },
        {
          speaker: "Speaker 2",
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: secondVoiceName
            }
          }
        }
      ]
    };
  } else {
    // Single-speaker configuration
    requestBody.generationConfig.speechConfig.voiceConfig = {
      prebuiltVoiceConfig: {
        voiceName: voiceName
      }
    };
  }

  return requestBody;
}

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

    // Construct Google Generative AI TTS request body
    const googleApiRequestBody = constructGoogleTTSRequestBody({
      text: text.trim(),
      voiceName: voiceName.trim(),
      secondVoiceName: secondVoiceName ? secondVoiceName.trim() : null
    });

    // TODO: Implement Google Generative AI API call
    // TODO: Implement audio processing and WAV file generation

    // For now, return success with constructed request body for testing
    return new Response(JSON.stringify({
      message: 'TTS request body constructed successfully',
      parameters: {
        voiceName: voiceName.trim(),
        secondVoiceName: secondVoiceName ? secondVoiceName.trim() : null,
        text: text.trim(),
        model: model.trim()
      },
      googleApiRequestBody
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
