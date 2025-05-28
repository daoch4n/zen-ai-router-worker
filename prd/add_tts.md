# Overview
This document outlines the requirements for adding a new Text-to-Speech (TTS) endpoint (`/tts`) to the existing Cloudflare Worker. This endpoint will enable users to convert text into high-quality speech audio (WAV format) by proxying requests to Google's Generative AI API. The design prioritizes modularity, minimal CPU usage on the worker (under 10ms for worker-side processing, excluding external API call time), and reuses existing authentication mechanisms.

The primary problem this solves is providing a simple, authenticated API endpoint for TTS generation.

This feature is for developers who need to integrate TTS capabilities into their applications and are already using or wish to use this Cloudflare worker as a unified gateway for AI services.

# Core Features

1.  **Text-to-Speech Conversion:**
    *   **What it does:** Converts input text into spoken audio.
    *   **Why it's important:** Provides core TTS functionality.
    *   **How it works:** The worker receives a text string and model preference in the request body. It then constructs a request to the Google Generative AI TTS API, including voice configuration from query parameters.

2.  **Voice Configuration via Query Parameters:**
    *   **What it does:** Allows users to specify the desired voice(s) for TTS generation using URL query parameters.
    *   **Why it's important:** Offers flexibility in voice selection without complicating the request body.
    *   **How it works:** Query parameters like `voiceName` (and `secondVoiceName` for multi-speaker) will be parsed by the worker and included in the `speechConfig` section of the request to Google's API.

3.  **WAV Audio Output:**
    *   **What it does:** Returns the generated audio in WAV format.
    *   **Why it's important:** WAV is a common, uncompressed audio format suitable for further processing or direct playback. Google's API typically returns raw PCM data, which needs a WAV header.
    *   **How it works:** The worker will receive base64 encoded audio data (likely PCM) from Google. It will decode this data and prepend a dynamically generated WAV header before sending the binary audio data back to the client with `Content-Type: audio/wav`.

4.  **Secure API Access & Key Management:**
    *   **What it does:** Reuses the existing authentication mechanism (Bearer token worker pass, random Google API key selection).
    *   **Why it's important:** Ensures consistent security practices and simplifies API key management for the user.
    *   **How it works:** The `/tts` endpoint will leverage the existing `getRandomApiKey` utility. The client provides the worker access pass, and the worker uses one of its configured Google API keys for the backend request.

5.  **Model Selection:**
    *   **What it does:** Allows the user to specify the Google TTS model to be used.
    *   **Why it's important:** Provides flexibility to use different or newer TTS models as they become available.
    *   **How it works:** The `model` (e.g., "gemini-2.5-flash-preview-tts") will be passed in the JSON request body.

# User Experience

## User Personas
*   **Developer (API Consumer):** An application developer who needs to integrate voice generation into their product. They prefer a simple, consistent API interface and do not want to manage Google API keys directly.

## Key User Flows

**Flow 1: Generate Single-Speaker Audio**
1.  Developer constructs a `POST` request to the `/tts` endpoint.
    *   URL: `https://<worker-url>/tts?voiceName=Zephyr`
    *   Headers:
        *   `Authorization: Bearer <WORKER_ACCESS_PASS>`
        *   `Content-Type: application/json`
    *   Body:
        ```json
        {
          "text": "Hello, world! This is a test of the text to speech system.",
          "model": "gemini-2.5-flash-preview-tts"
        }
        ```
2.  Worker authenticates the request and selects a Google API key.
3.  Worker validates query parameters and request body.
4.  Worker constructs a request to the Google Generative AI API, including the text, model, and single-speaker voice configuration.
5.  Google API processes the request and returns base64 encoded audio data.
6.  Worker decodes the audio data, prepends a WAV header.
7.  Worker sends a response to the developer:
    *   Status: `200 OK`
    *   Headers: `Content-Type: audio/wav`
    *   Body: Binary WAV audio data.

**Flow 2: Generate Multi-Speaker Audio (Future Enhancement, but good to consider)**
1.  Similar to Flow 1, but with additional query parameters:
    *   URL: `https://<worker-url>/tts?voiceName=Zephyr&secondVoiceName=Fenrir`
    *   Body: (Text should be formatted for multi-speaker if Google's API requires specific syntax, e.g., "Speaker 1: Hello. Speaker 2: Hi there.")
        ```json
        {
          "text": "Speaker 1: Hello from Zephyr. Speaker 2: And hello from Fenrir.",
          "model": "gemini-2.5-flash-preview-tts"
        }
        ```
2.  Worker constructs the `multiSpeakerVoiceConfig` for the Google API.
3.  Rest of the flow is similar to Flow 1.

**Flow 3: Error Handling**
1.  Developer sends an invalid request (e.g., missing API key, invalid model, missing text).
2.  Worker responds with an appropriate HTTP error code (e.g., 400, 401, 500) and a JSON error message, reusing the existing `errorHandler`.
    *   Example: `400 Bad Request`, `{"error": "Text field is required."}`

## UI/UX Considerations (API Contract)
*   **Endpoint:** `POST /tts`
*   **Query Parameters:**
    *   `voiceName` (string, required): Primary voice name (e.g., 'Zephyr', 'Puck').
    *   `secondVoiceName` (string, optional): Secondary voice for multi-speaker mode.
    *   *(Future)* `sampleRate` (integer, optional, default: 24000): e.g., 16000, 24000, 44100.
    *   *(Future)* `channels` (integer, optional, default: 1): 1 for mono, 2 for stereo.
    *   *(Future)* `bitsPerSample` (integer, optional, default: 16): e.g., 16, 24.
*   **Request Headers:**
    *   `Authorization: Bearer <WORKER_ACCESS_PASS>` (required)
    *   `Content-Type: application/json` (required)
*   **Request Body (JSON):**
    ```json
    {
      "text": "string" // required, text to synthesize
      "model": "string" // required, Google TTS model name (e.g., "gemini-2.5-flash-preview-tts")
    }
    ```
*   **Success Response:**
    *   Status Code: `200 OK`
    *   Headers: `Content-Type: audio/wav`
    *   Body: Binary WAV data.
*   **Error Response:**
    *   Status Code: `4xx` or `5xx`
    *   Headers: `Content-Type: application/json`
    *   Body: (Utilize existing `errorHandler` format)
        ```json
        {
          "error": "Descriptive error message"
        }
        ```

# Technical Architecture

## System Components
1.  **Cloudflare Worker:** Hosts the `/tts` endpoint, handles authentication, request transformation, and response formatting.
2.  **Google Generative AI API:** External service that performs the actual TTS conversion.

## New Modules/Files
*   `src/handlers/tts.mjs`: Contains `handleTTS` function responsible for processing `/tts` requests.
*   `src/utils/audio.mjs` (or similar): Contains utility functions for audio processing, specifically `generateWavHeader` and potentially `decodeBase64Audio`.

## Data Models

**1. Worker Incoming Request (Parsed from Query & Body):**
```typescript
interface TTSWorkerRequest {
  apiKey: string; // Resolved Google API key
  text: string;
  model: string;
  voiceName: string;
  secondVoiceName?: string;
  // Future: sampleRate, channels, bitsPerSample
}
```

**2. Google API TTS Request Body:**
```json
// Based on generate-audio.ps1
{
  "contents": [
    {
      "parts": [
        {
          "text": "User-provided text"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      // Single Speaker
      "voiceConfig": {
        "prebuiltVoiceConfig": {
          "voiceName": "Zephyr" // from query param
        }
      }
      // OR Multi-Speaker (if secondVoiceName provided)
      // "multiSpeakerVoiceConfig": {
      //   "speakerVoiceConfigs": [
      //     { "speaker": "Speaker 1", "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Zephyr" } } },
      //     { "speaker": "Speaker 2", "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Fenrir" } } }
      //   ]
      // }
    }
  }
}
```

**3. Google API TTS Response (Relevant Part):**
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "audio/L16;rate=24000", // Example, worker needs to parse rate for WAV header
              "data": "BASE64_ENCODED_AUDIO_STRING"
            }
          }
        ]
      }
    }
  ]
  // Potentially usageMetadata
}
```

**4. Worker Outgoing Response:** Binary WAV data.

## APIs and Integrations
*   **Google Generative AI API:**
    *   Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent?key={API_KEY}`
    *   Method: `POST`
    *   The `MODEL_NAME` will be the one specified in the request body (e.g., `gemini-2.5-flash-preview-tts`).

## Infrastructure Requirements
*   Cloudflare Worker environment.
*   Environment variables for Google API keys (`KEY1`, `KEY2`, etc.) and worker access pass (`PASS`) are already assumed to be in place.

## WAV Header Generation
A JavaScript function `generateWavHeader(dataLength, sampleRate, channels, bitsPerSample)` will be created in `src/utils/audio.mjs`. This function will construct a 44-byte WAV header as an `ArrayBuffer` or `Uint8Array`.
*   **Performance:** This must be highly optimized. It involves writing specific byte values to an array. Direct manipulation of `DataView` on an `ArrayBuffer` is likely the most performant way.
*   **Default parameters for MVP:** `sampleRate = 24000`, `channels = 1`, `bitsPerSample = 16`. The `sampleRate` should ideally be parsed from Google's response `mimeType` if available and reliable.

# Development Roadmap

## MVP (Minimum Viable Product) Requirements
1.  **Endpoint Routing:** Add route for `POST /tts` in `src/worker.mjs` to a new `handleTTS` handler.
2.  **Authentication:** Reuse `getRandomApiKey` for Google API key and worker access pass validation.
3.  **Request Parsing:**
    *   Parse `voiceName` from query parameters.
    *   Parse `text` and `model` from JSON request body.
    *   Basic validation for required fields.
4.  **Google API Request Construction (Single Speaker):**
    *   Implement logic in `handleTTS` (or a helper) to build the JSON body for Google's TTS API, supporting single-speaker configuration using `voiceConfig`.
5.  **Google API Call:** Use `fetch` to call the Google Generative AI API.
6.  **Response Handling:**
    *   Extract base64 audio data and `mimeType` from Google's response.
    *   Decode base64 audio data to a byte array (`Uint8Array`).
    *   Parse `sampleRate` from `mimeType` (e.g., "audio/L16;rate=24000" -> 24000). Default to 24000 if parsing fails.
7.  **WAV Header Generation (MVP - Fixed common parameters):**
    *   Implement `generateWavHeader` in `src/utils/audio.mjs`. For MVP, it can use a fixed sample rate (e.g., 24000 Hz, or parsed from Google's response), 1 channel (mono), and 16 bits per sample.
8.  **Combine Header and Data:** Concatenate the WAV header and the decoded PCM audio data.
9.  **Return WAV Response:** Send the combined binary data with `Content-Type: audio/wav` and `200 OK`.
10. **Error Handling:** Integrate with existing `errorHandler` for consistent error responses.
11. **Documentation:** Basic internal notes on how to use the new endpoint.

## Future Enhancements (Post-MVP)
1.  **Multi-Speaker Support:**
    *   Parse `secondVoiceName` query parameter.
    *   Construct `multiSpeakerVoiceConfig` for Google API.
    *   Consider how text input should be structured for speaker differentiation if Google API requires it.
2.  **Configurable WAV Parameters:**
    *   Allow `sampleRate`, `channels`, `bitsPerSample` to be specified via query parameters.
    *   Pass these to `generateWavHeader`.
    *   Validate these parameters.
3.  **Advanced Text Cleaning/Optimization:**
    *   Implement a function similar to `Optimize-TextForJson` from the PowerShell script if needed for robustness, to sanitize input text before sending to Google. (Assess if Google API handles this sufficiently).
4.  **Streaming Audio Output:** If Google's TTS API supports streaming for `generateContent` and it's beneficial (e.g., for very long texts to reduce time-to-first-byte), investigate implementing streaming passthrough. This would likely change the WAV header requirement or necessitate a different output format.
5.  **Input Validation:** More robust validation for text length, model name format, voice name validity (perhaps against a known list, though this could become outdated).
6.  **Caching:** Consider caching identical TTS requests (text, voice, model) for a short period to reduce API calls and improve response times for repeated requests. This needs careful consideration of cache size and invalidation.

# Logical Dependency Chain

1.  **Setup Basic Handler (`handleTTS`):**
    *   Create `src/handlers/tts.mjs`.
    *   Add routing in `src/worker.mjs` to call `handleTTS`.
    *   Integrate existing auth (`getRandomApiKey`) and error handling (`errorHandler`).
2.  **Request Parsing:**
    *   Implement query parameter parsing for `voiceName`.
    *   Implement JSON body parsing for `text` and `model`.
3.  **Google API Request Construction (MVP - Single Speaker):**
    *   Formulate the JSON payload for Google's API.
4.  **WAV Utilities (`src/utils/audio.mjs`):**
    *   Implement `decodeBase64Audio(base64String): Uint8Array`.
    *   Implement `generateWavHeader(dataLength, sampleRate, channels, bitsPerSample): Uint8Array`. Focus on performance (e.g., using `DataView`).
5.  **Core API Interaction and Response Generation:**
    *   Make the `fetch` call to Google API.
    *   Process the response: decode audio, parse sample rate from mimeType.
    *   Prepend WAV header.
    *   Return `audio/wav` response.
    *   **Visibility/Usability:** At this point, the MVP endpoint should be testable with `curl` or Postman.
6.  **Refinement & Testing:** Thoroughly test various inputs, voice names, and error conditions. Profile CPU usage.
7.  **Future Enhancements (Iterative):**
    *   Implement multi-speaker support.
    *   Add configurable WAV parameters.
    *   Etc.

# Risks and Mitigations

1.  **Google Generative AI API Changes/Limitations:**
    *   **Risk:** API structure, available voices, or rate limits might change. TTS models might have specific input length limits.
    *   **Mitigation:** Refer to official Google documentation. Implement robust error handling for API responses. Design for configurability (e.g., model name).
2.  **Performance of WAV Header Generation/Audio Manipulation:**
    *   **Risk:** JavaScript audio manipulation in the worker (base64 decoding, header generation, concatenation) could exceed the <10ms CPU target for large audio files.
    *   **Mitigation:** Use performant methods like `TextDecoder` for base64 (if applicable, or a fast JS base64 library/native functions), `DataView` for header creation, and efficient array concatenation. Profile thoroughly. For MVP, audio length will be a factor; very long texts might be an issue.
3.  **Complexity of Multi-Speaker Mode:**
    *   **Risk:** Google's API might require specific text formatting or complex configuration for multi-speaker TTS, increasing implementation effort.
    *   **Mitigation:** Defer to post-MVP. Thoroughly research Google's multi-speaker TTS API requirements before implementation.
4.  **Error Handling from Google API:**
    *   **Risk:** Google API might return errors not anticipated (e.g., voice not found, model not supporting TTS, content policy violations).
    *   **Mitigation:** Implement generic error mapping from Google API errors to user-friendly messages. Log detailed errors from Google for debugging.
5.  **Managing Voice Name Validity:**
    *   **Risk:** Users might provide invalid voice names.
    *   **Mitigation:** For MVP, pass through to Google and let Google return an error. Future: Optionally maintain a list of known-good voices or provide a separate endpoint to list available voices (if Google API supports this).

# Appendix

*   **Reference Google Voices (from PowerShell script, subject to change by Google):** Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede. The actual list should be confirmed from Google's documentation.
*   **WAV File Format Specification:** (Link to a reliable WAV format spec, e.g., [http://soundfile.sapp.org/doc/WaveFormat/](http://soundfile.sapp.org/doc/WaveFormat/))
*   **Google Generative AI TTS Documentation:** (Link to the relevant Google Cloud AI documentation page for TTS with generative models)
