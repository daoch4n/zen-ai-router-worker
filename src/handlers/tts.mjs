/**
 * Handler for Text-to-Speech (TTS) endpoint.
 * Processes TTS requests and integrates with Google's Generative AI TTS API.
 */
import { v4 as uuidv4 } from 'uuid';
import { fixCors } from '../utils/cors.mjs';
import {
  errorHandler,
  HttpError,
  processGoogleApiError,
  validateTextLength,
  validateVoiceName
} from '../utils/error.mjs';
import { makeHeaders } from '../utils/auth.mjs';
import { decodeBase64Audio, generateWavHeader } from '../utils/audio.mjs';
import {
  BASE_URL,
  API_VERSION,
  TTS_LIMITS,
  VOICE_NAME_PATTERNS
} from '../constants/index.mjs';




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
 * Parses sample rate from mimeType string.
 * Extracts the numerical sample rate value from formats like:
 * - "audio/L16;rate=24000"
 * - "audio/wav; codecs=pcm; rate=44100"
 *
 * @param {string} mimeType - MIME type string containing rate information
 * @returns {number} Sample rate in Hz, defaults to 24000 if parsing fails
 */
function parseSampleRate(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') {
    return 24000; // Default sample rate
  }

  // Look for rate=XXXXX pattern in the mimeType string
  const rateMatch = mimeType.match(/rate=(\d+)/i);
  if (rateMatch && rateMatch[1]) {
    const rate = parseInt(rateMatch[1], 10);
    return isNaN(rate) ? 24000 : rate;
  }

  return 24000; // Default sample rate if no rate found
}

/**
 * Makes a request to Google's Generative AI API for text-to-speech generation.
 * Handles the complete API interaction including error handling and response parsing.
 *
 * @param {string} model - The Gemini model to use for TTS generation
 * @param {Object} requestBody - The constructed request body for Google API
 * @param {string} apiKey - Google API key for authentication
 * @param {number} characterCount - Number of characters in the text to synthesize for timeout calculation
 * @returns {Promise<Object>} Object containing base64 audio data, mimeType, and sampleRate
 * @throws {HttpError} When API call fails or response is invalid
 */
async function callGoogleTTSAPI(model, requestBody, apiKey, characterCount) {
  // Construct the full Google API endpoint URL
  const url = `${BASE_URL}/${API_VERSION}/models/${model}:generateContent`;

  // Calculate dynamic timeout with a cap of 70 seconds
  const timeoutMs = Math.min(5000 + (characterCount * 35), 70000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Make the fetch request to Google's API
    const response = await fetch(url, {
      method: 'POST',
      headers: makeHeaders(apiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(requestBody),
      signal: controller.signal // Apply the AbortController signal
    });

    clearTimeout(timeoutId); // Clear the timeout if the fetch completes before the timeout

    // Handle non-200 responses using enhanced error processing
    if (!response.ok) {
      throw await processGoogleApiError(response);
    }

    // Parse the successful JSON response
    const responseData = await response.json();

    // Navigate the response structure to extract audio data
    // Expected structure: candidates[0].content.parts[0].inlineData
    if (!responseData.candidates || !Array.isArray(responseData.candidates) || responseData.candidates.length === 0) {
      throw new HttpError('Invalid response structure: no candidates found', 502);
    }

    const candidate = responseData.candidates[0];
    if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
      throw new HttpError('Invalid response structure: no content parts found', 502);
    }

    const part = candidate.content.parts[0];
    if (!part.inlineData || !part.inlineData.data || !part.inlineData.mimeType) {
      throw new HttpError('Invalid response structure: no inline data found', 502);
    }

    const { data: base64Audio } = part.inlineData;
    const hardcodedMimeType = 'audio/L16;rate=24000';
    const hardcodedSampleRate = 24000;

    return {
      base64Audio,
      mimeType: hardcodedMimeType,
      sampleRate: hardcodedSampleRate
    };

  } catch (error) {
    clearTimeout(timeoutId); // Ensure timeout is cleared even if an error occurs

    // Handle AbortError specifically for fetch timeouts
    if (error.name === 'AbortError') {
      throw new HttpError(`API call timed out after ${timeoutMs}ms`, 504); // 504 Gateway Timeout
    }
    // Re-throw HttpErrors as-is
    if (error instanceof HttpError) {
      throw error;
    }

    // Handle network errors and other fetch failures
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new HttpError('Network error: Unable to connect to Google API', 502);
    }

    // Handle other unexpected errors
    throw new HttpError(`Unexpected error during API call: ${error.message}`, 500);
  }
}
/**
 * Processes audio data (base64) and returns an HTTP 200 JSON Response.
 *
 * @param {string} audioContentBase64 - Base64 encoded audio data.
 * @param {string} mimeType - MIME type of the audio.
 * @returns {Response} HTTP Response containing the JSON encoded audio data.
 */
function processAudioDataJSONResponse(audioContentBase64, mimeType) {
  return new Response(JSON.stringify({ audioContentBase64, mimeType }), fixCors({
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  }));
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

    // Enhanced validation using new validation functions

    // Validate text length and format (includes byte-length checking)
    validateTextLength(text, TTS_LIMITS.MAX_TEXT_BYTES, TTS_LIMITS.MIN_TEXT_LENGTH);

    // Validate model format
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new HttpError("model must be a non-empty string", 400);
    }

    // Validate voice name format using pattern matching
    validateVoiceName(voiceName, VOICE_NAME_PATTERNS);

    // Validate secondVoiceName if provided
    if (secondVoiceName !== null) {
      validateVoiceName(secondVoiceName, VOICE_NAME_PATTERNS);
    }

    // Construct Google Generative AI TTS request body
    const googleApiRequestBody = constructGoogleTTSRequestBody({
      text: text.trim(),
      voiceName: voiceName.trim(),
      secondVoiceName: secondVoiceName ? secondVoiceName.trim() : null
    });

    // Call Google Generative AI API to generate audio
    const { base64Audio, mimeType, sampleRate } = await callGoogleTTSAPI(
      model.trim(),
      googleApiRequestBody,
      apiKey,
      text.length // Pass character count for dynamic timeout
    );

    // Decode base64 audio data to binary PCM data
    const pcmAudioData = decodeBase64Audio(base64Audio);

    // Calculate the length of PCM data for WAV header
    const dataLength = pcmAudioData.length;

    // Generate WAV header with parsed sample rate, mono channel, 16 bits per sample
    const wavHeader = generateWavHeader(dataLength, sampleRate, 1, 16);

    // Concatenate WAV header and PCM audio data
    const wavFileData = new Uint8Array(wavHeader.length + pcmAudioData.length);
    wavFileData.set(wavHeader, 0);
    wavFileData.set(pcmAudioData, wavHeader.length);

    // Return the complete WAV file as binary response
    return new Response(wavFileData, fixCors({
      status: 200,
      headers: {
        'Content-Type': 'audio/wav'
      }
    }));
  } catch (err) {
    // Use centralized error handler for consistent error responses
    return errorHandler(err, fixCors);
  }
}

/**
 * Processes raw text-to-speech requests by handling voice configuration,
 * text input validation, and audio generation through Google's API.
 * Returns a 202 Accepted response immediately and starts the TTS job asynchronously.
 * The actual audio data can be retrieved via a separate polling mechanism using the jobId.
 *
 * @param {Request} request - The incoming HTTP request containing TTS parameters
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with jobId or error information
 * @throws {Error} When request validation fails or API call errors
 */
export async function handleRawTTS(request, env, event, apiKey) {
  try {
    // Verify apiKey is provided (should be handled by worker, but defensive check)
    if (!apiKey) {
      throw new HttpError("API key is required", 401);
    }

    // Parse JSON request body for text, model, and voice configuration
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (jsonError) {
      throw new HttpError("Invalid JSON in request body", 400);
    }

    // Extract voiceName and secondVoiceName from the request body
    const { text, model, voiceName, secondVoiceName } = requestBody;

    // Validate required fields
    if (!voiceName) {
      throw new HttpError("voiceName field is required in request body", 400);
    }

    if (!text) {
      throw new HttpError("text field is required in request body", 400);
    }

    if (!model) {
      throw new HttpError("model field is required in request body", 400);
    }

    // Enhanced validation using new validation functions

    // Validate text length and format (includes byte-length checking)
    validateTextLength(text, TTS_LIMITS.MAX_TEXT_BYTES, TTS_LIMITS.MIN_TEXT_LENGTH);

    // Validate model format
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new HttpError("model must be a non-empty string", 400);
    }

    // Validate voice name format using pattern matching
    validateVoiceName(voiceName, VOICE_NAME_PATTERNS);

    // Validate secondVoiceName if provided
    if (secondVoiceName !== null) {
      validateVoiceName(secondVoiceName, VOICE_NAME_PATTERNS);
    }

    // Construct Google Generative AI TTS request body
    const googleApiRequestBody = constructGoogleTTSRequestBody({
      text: text.trim(),
      voiceName: voiceName.trim(),
      secondVoiceName: secondVoiceName ? secondVoiceName.trim() : null
    });

    // Determine if TTS generation should be immediate or asynchronous
    if (text.length <= TTS_LIMITS.IMMEDIATE_TEXT_LENGTH_THRESHOLD) {
      // Immediate TTS generation for shorter texts
      const { base64Audio, mimeType } = await callGoogleTTSAPI(
        model.trim(),
        googleApiRequestBody,
        apiKey,
        text.length // Pass character count for dynamic timeout
      );
      // Return Base64 encoded audio in JSON format
      return processAudioDataJSONResponse(base64Audio, mimeType);
    } else {
      // Asynchronous TTS generation for longer texts
      const jobId = uuidv4();
      const id = env.TTS_JOB_DURABLE_OBJECT.idFromName(jobId);
      const stub = env.TTS_JOB_DURABLE_OBJECT.get(id);

      // Store initial job data in Durable Object
      event.waitUntil(stub.fetch(new Request(`${stub.url}/tts-job/${jobId}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          model: model.trim(),
          voiceId: voiceName.trim(),
          secondVoiceName: secondVoiceName ? secondVoiceName.trim() : null,
          status: 'processing'
        })
      })));

      // Asynchronously call the TTS API and store the result
      event.waitUntil(
        callGoogleTTSAPI(
          model.trim(),
          googleApiRequestBody,
          apiKey,
          text.length // Pass character count for dynamic timeout
        ).then(async (result) => {
          await stub.fetch(new Request(`${stub.url}/tts-job/${jobId}/store-result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result: result.base64Audio })
          }));
        }).catch(async (error) => {
          console.error(`TTS job ${jobId} failed:`, error);
          await stub.fetch(new Request(`${stub.url}/tts-job/${jobId}/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'failed', error: error.message })
          }));
        })
      );

      // The jobId is included in both the JSON body and as an X-Processing-Job-Id header
      // to facilitate the orchestrator's polling mechanism (_pollForTtsResult).
      // Return 202 Accepted with the jobId
      return new Response(JSON.stringify({ jobId, status: 'processing' }), fixCors({
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          'X-Processing-Job-Id': jobId // Custom header for easier access
        }
      }));
    }

  } catch (err) {
    // Use centralized error handler for consistent error responses
    return errorHandler(err, fixCors);
  }
}

/**
 * Handles requests to retrieve the result of an asynchronous TTS job.
 *
 * @param {Request} request - The incoming HTTP request containing the jobId.
 * @param {string} apiKey - Google API key for Gemini access
 * @returns {Promise<Response>} HTTP response with audio data or error information.
 * @throws {Error} When jobId is missing or job is not found/expired.
 */
export async function handleTtsResult(request, env, event, apiKey) {
  try {
    // Verify apiKey is provided (should be handled by worker, but defensive check)
    if (!apiKey) {
      throw new HttpError("API key is required", 401);
    }

    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');

    if (!jobId) {
      throw new HttpError("jobId query parameter is required", 400);
    }

    const id = env.TTS_JOB_DURABLE_OBJECT.idFromName(jobId);
    const stub = env.TTS_JOB_DURABLE_OBJECT.get(id);

    const jobStatusResponse = await stub.fetch(new Request(`${stub.url}/tts-job/${jobId}/status`));
    if (!jobStatusResponse.ok) {
      throw new HttpError(`Failed to retrieve job status for ID ${jobId}`, jobStatusResponse.status);
    }
    const { status } = await jobStatusResponse.json();

    if (status === 'processing') {
      return new Response(JSON.stringify({ jobId, status: 'processing' }), fixCors({
        status: 202,
        headers: {
          'Content-Type': 'application/json',
          'X-Processing-Job-Id': jobId,
          'X-Processing-Status': 'processing'
        }
      }));
    } else if (status === 'completed') {
      const jobResultResponse = await stub.fetch(new Request(`${stub.url}/tts-job/${jobId}/result`));
      if (!jobResultResponse.ok) {
        throw new HttpError(`Failed to retrieve job result for ID ${jobId}`, jobResultResponse.status);
      }
      const { result: audioContentBase64, mimeType } = await jobResultResponse.json();

      return processAudioDataJSONResponse(audioContentBase64, mimeType);
    } else if (status === 'failed') {
      const jobResultResponse = await stub.fetch(new Request(`${stub.url}/tts-job/${jobId}/result`));
      const { error } = await jobResultResponse.json();
      throw new HttpError(`TTS job ${jobId} failed: ${error || 'Unknown error'}`, 500);
    } else {
      throw new HttpError(`Job with ID ${jobId} not found or in an unexpected state: ${status}`, 404);
    }


  } catch (err) {
    return errorHandler(err, fixCors);
  }
}
