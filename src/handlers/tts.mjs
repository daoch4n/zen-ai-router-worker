/**
 * Handler for Text-to-Speech (TTS) endpoint.
 * Processes TTS requests and integrates with Google's Generative AI TTS API.
 */
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

// A simple in-memory map to store processing jobs
const processingJobs = new Map();

// Simple unique ID generator
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

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
 * @returns {Promise<Object>} Object containing base64 audio data, mimeType, and sampleRate
 * @throws {HttpError} When API call fails or response is invalid
 */
async function callGoogleTTSAPI(model, requestBody, apiKey) {
  // Construct the full Google API endpoint URL
  const url = `${BASE_URL}/${API_VERSION}/models/${model}:generateContent`;

  try {
    // Make the fetch request to Google's API
    const response = await fetch(url, {
      method: 'POST',
      headers: makeHeaders(apiKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(requestBody)
    });

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

    const { data: base64Audio, mimeType } = part.inlineData;
    const sampleRate = parseSampleRate(mimeType);

    return {
      base64Audio,
      mimeType,
      sampleRate
    };

  } catch (error) {
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
 * Processes audio data (base64) into a WAV file and returns an HTTP 200 Response.
 *
 * @param {string} base64Audio - Base64 encoded audio data.
 * @param {string} mimeType - MIME type of the audio.
 * @param {number} sampleRate - Sample rate of the audio.
 * @returns {Response} HTTP Response containing the WAV audio file.
 */
function processAudioData(base64Audio, mimeType, sampleRate) {
  const pcmAudioData = decodeBase64Audio(base64Audio);
  const dataLength = pcmAudioData.length;
  const wavHeader = generateWavHeader(dataLength, sampleRate, 1, 16);
  const wavFileData = new Uint8Array(wavHeader.length + pcmAudioData.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmAudioData, wavHeader.length);

  return new Response(wavFileData, fixCors({
    status: 200,
    headers: {
      'Content-Type': 'audio/wav'
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
      apiKey
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
export async function handleRawTTS(request, apiKey) {
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

    // Determine if TTS generation should be immediate or asynchronous
    if (text.length <= TTS_LIMITS.IMMEDIATE_TEXT_LENGTH_THRESHOLD) {
      // Immediate TTS generation for shorter texts
      const { base64Audio, mimeType, sampleRate } = await callGoogleTTSAPI(
        model.trim(),
        googleApiRequestBody,
        apiKey
      );
      return processAudioData(base64Audio, mimeType, sampleRate);
    } else {
      // Asynchronous TTS generation for longer texts
      const jobId = generateUniqueId();
      const ttsPromise = callGoogleTTSAPI(
        model.trim(),
        googleApiRequestBody,
        apiKey
      );
      processingJobs.set(jobId, { promise: ttsPromise, status: 'processing' });

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
export async function handleTtsResult(request, apiKey) {
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

    const job = processingJobs.get(jobId);

    if (!job) {
      throw new HttpError(`Job with ID ${jobId} not found or already completed/expired`, 404);
    }

    // Check if the job is still processing
    if (job.status === 'processing') {
      // Attempt to resolve the promise to check if it's done without blocking
      const result = await Promise.race([
        job.promise,
        new Promise(resolve => setTimeout(() => resolve('pending'), 50)) // Small delay to avoid blocking
      ]);

      if (result === 'pending') {
        return new Response(JSON.stringify({ jobId, status: 'processing' }), fixCors({
          status: 202,
          headers: {
            'Content-Type': 'application/json',
            'X-Processing-Job-Id': jobId,
            'X-Processing-Status': 'processing'
          }
        }));
      } else {
        // Job has completed, update status and process audio
        job.base64Audio = result.base64Audio;
        job.mimeType = result.mimeType;
        job.sampleRate = result.sampleRate;
        job.status = 'completed';
      }
    }

    // If job is completed or just completed
    if (job.status === 'completed') {
      processingJobs.delete(jobId); // Remove job after successful retrieval

      return processAudioData(job.base64Audio, job.mimeType, job.sampleRate);
    }


  } catch (err) {
    return errorHandler(err, fixCors);
  }
}
