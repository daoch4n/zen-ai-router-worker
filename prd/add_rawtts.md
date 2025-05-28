# Overview
This document outlines the requirements for a new Text-to-Speech (TTS) endpoint, `/rawtts`, within the existing OpenAI-to-Gemini API proxy service. The current `/tts` endpoint processes audio from Google's Generative AI TTS API and returns it as a standardized WAV file. The new `/rawtts` endpoint will provide a more direct pass-through of Google's TTS output, returning the base64 encoded audio data and the original mime type as provided by Google, without converting it to WAV or decoding the base64 string.

This feature is valuable for users who require raw audio formats (e.g., Opus, raw L16, or other formats Google might provide) and prefer to handle audio decoding and processing on the client-side, or for applications that can directly consume base64 encoded audio with a specific mime type.

# Core Features
The `/rawtts` endpoint will include the following core features:

1.  **New API Endpoint:**
    *   **What it does:** Introduces a new POST endpoint: `/rawtts`.
    *   **Why it's important:** Provides an alternative to the existing `/tts` endpoint for users needing raw, unprocessed audio output from the underlying Google TTS service.
    *   **How it works at a high level:** Accepts POST requests with a JSON body and query parameters, forwards the TTS request to Google's Generative AI API, and returns Google's raw audio output.

2.  **Request Compatibility:**
    *   **What it does:** Accepts the same request parameters as the existing `/tts` endpoint.
        *   JSON Body: `{ "text": "string", "model": "string" }`
        *   Query Parameters: `voiceName` (required), `secondVoiceName` (optional).
    *   **Why it's important:** Ensures consistency and ease of use for developers already familiar with the `/tts` endpoint.
    *   **How it works at a high level:** Parses and validates request parameters using existing utility functions.

3.  **Raw Audio Response:**
    *   **What it does:** Returns the audio data exactly as received from Google's API (typically base64 encoded) in the response body. It will **not** perform base64 decoding on this data.
    *   **Why it's important:** Gives clients access to the original audio format and encoding from Google, offering greater flexibility.
    *   **How it works at a high level:** The `data` field from Google's `inlineData` (containing the base64 audio string) will be used directly as the HTTP response body.

4.  **Original Mime Type:**
    *   **What it does:** Sets the `Content-Type` header of the HTTP response to the mime type string provided by Google for the audio data (e.g., `audio/L16;rate=24000`, `audio/ogg; codecs=opus`).
    *   **Why it's important:** Informs the client about the format of the base64 encoded audio data in the response body.
    *   **How it works at a high level:** The `mimeType` field from Google's `inlineData` will be used for the `Content-Type` header.

5.  **No WAV Conversion:**
    *   **What it does:** Skips the WAV header generation and PCM data conversion steps that are present in the `/tts` endpoint.
    *   **Why it's important:** This is the core differentiator, providing unprocessed audio and avoiding forced conversion to WAV.
    *   **How it works at a high level:** The audio processing steps involving `decodeBase64Audio` and `generateWavHeader` will be omitted for this endpoint.

# User Experience
*   **User Personas:** Developers integrating with the API proxy who need:
    *   Specific audio codecs provided by Google (e.g., Opus, if available) not easily convertible from WAV.
    *   To minimize server-side processing and latency.
    *   To perform custom audio manipulation or decoding on the client-side.
*   **Key User Flows:**
    1.  Developer sends a POST request to `/rawtts` with valid `text`, `model`, `voiceName` (and optionally `secondVoiceName`).
    2.  The service validates the request and calls Google's TTS API.
    3.  The service receives a response from Google containing base64 encoded audio and a mime type.
    4.  The service returns an HTTP response to the developer:
        *   Body: The base64 encoded audio string.
        *   `Content-Type` Header: The mime type string from Google.
    5.  Developer's application receives the response and can then (if necessary) base64 decode the audio data according to the provided `Content-Type`.
*   **UI/UX Considerations:**
    *   API Documentation: Clear documentation for `/rawtts` is crucial. It must specify:
        *   That the response body is a base64 encoded string.
        *   That the `Content-Type` header reflects the format of the *encoded* data.
        *   How clients should interpret this (i.e., they may need to base64 decode the body).
    *   Error Handling: Consistent error responses with the rest of the API (using existing `HttpError` and `errorHandler`).

# Technical Architecture
*   **System Components:**
    *   Cloudflare Worker: Hosts the API proxy logic.
    *   Google Generative AI TTS API: The underlying service providing the text-to-speech functionality.
*   **Data Models:**
    *   **Request (to `/rawtts`):**
        *   Method: `POST`
        *   Query Parameters: `voiceName: string`, `secondVoiceName?: string`
        *   Body (JSON): `{ "text": "string", "model": "string" }`
    *   **Response (from Google TTS API - relevant parts):**
        *   JSON: `{ candidates: [ { content: { parts: [ { inlineData: { data: "BASE64_AUDIO_STRING", mimeType: "GOOGLE_MIME_TYPE" } } ] } } ] }`
    *   **Response (from `/rawtts`):**
        *   Status: `200 OK` (on success)
        *   Headers: `Content-Type: GOOGLE_MIME_TYPE`, CORS headers.
        *   Body: `BASE64_AUDIO_STRING` (as plain text).
*   **APIs and Integrations:**
    *   The worker will integrate with the Google Generative AI TTS API using the same mechanisms as the current `/tts` endpoint (`callGoogleTTSAPI`).
    *   No new external APIs are required.
*   **Infrastructure Requirements:**
    *   No changes to the existing Cloudflare Worker infrastructure.

# Development Roadmap
*   **MVP Requirements:**
    1.  **Handler Implementation (`handleRawTTS` in `src/handlers/tts.mjs`):**
        *   Create a new asynchronous function `handleRawTTS(request, apiKey)`.
        *   Reuse existing request parsing logic from `handleTTS` for query parameters (`voiceName`, `secondVoiceName`) and JSON body (`text`, `model`).
        *   Reuse existing input validation logic (`validateTextLength`, `validateVoiceName`, etc.).
        *   Reuse `constructGoogleTTSRequestBody` to prepare the request for Google's API.
        *   Call the existing `callGoogleTTSAPI` function to interact with Google's TTS service and retrieve `base64Audio` and `mimeType`.
        *   Construct an HTTP `Response` object:
            *   The body of the response must be the `base64Audio` string.
            *   The `Content-Type` header must be set to the `mimeType` received from `callGoogleTTSAPI`.
            *   Apply CORS headers using `fixCors`.
            *   Implement standard error handling using `errorHandler`.
    2.  **Routing (`src/worker.mjs`):**
        *   Import `handleRawTTS` from `./handlers/index.mjs`.
        *   Add a new case to the `switch` statement in the `fetch` function to route POST requests for paths ending with `/rawtts` to the `handleRawTTS` handler.
    3.  **Export (`src/handlers/index.mjs`):**
        *   Ensure `handleRawTTS` is exported from `src/handlers/tts.mjs` so it's available via `src/handlers/index.mjs`. (This should happen automatically if `export * from './tts.mjs';` is used and `handleRawTTS` is an exported function in `tts.mjs`).
    4.  **Testing:**
        *   Develop unit/integration tests to verify:
            *   Correct request parsing and validation.
            *   Successful interaction with the (mocked) Google API.
            *   Response body contains the raw base64 string.
            *   `Content-Type` header matches Google's mime type.
            *   Correct error handling for invalid inputs or API errors.
*   **Future Enhancements (Out of Scope for MVP):**
    *   Provide an option in the request to specify desired output encoding if Google's API supports more granular control beyond `responseModalities` (e.g., explicitly requesting MP3 or Opus if not the default for a voice/model).
    *   More sophisticated `Content-Type` negotiation or providing metadata if clients find the current approach (base64 string with original binary mime-type) confusing. For example, returning a JSON object `{ "audioContent": "base64string", "mimeType": "google_mime_type" }` with `Content-Type: application/json`.

# Logical Dependency Chain
1.  **Foundation (Existing):** The implementation will heavily rely on existing utilities:
    *   `callGoogleTTSAPI`: For making the actual call to Google.
    *   `constructGoogleTTSRequestBody`: For building the request payload.
    *   Input validation functions (`validateTextLength`, `validateVoiceName`).
    *   CORS (`fixCors`) and error handling (`errorHandler`) utilities.
2.  **New Handler Logic (`handleRawTTS`):** This is the primary piece of new code. It orchestrates the use of existing utilities and implements the new response generation logic (raw base64 body, Google's mime type). This needs to be built first after confirming dependencies.
3.  **Routing Update (`worker.mjs`):** Once `handleRawTTS` is implemented and exported, the main worker router needs to be updated to direct requests for `/rawtts` to this new handler.
4.  **Usable Endpoint:** After deploying these changes, the `/rawtts` endpoint will be live and usable. This is the quickest path to a "visible" working feature for API consumers.
5.  **Documentation:** API documentation should be updated concurrently or immediately after deployment to explain the new endpoint's behavior.

Each step is atomic and builds upon the previous one, ensuring a clear path to a functional feature.

# Risks and Mitigations
*   **Technical Challenges:**
    *   *Risk:* Unexpected behavior or formats from Google TTS API for certain voice/model combinations.
    *   *Mitigation:* `callGoogleTTSAPI` already has some error handling and parsing logic. Testing with various inputs can help identify issues. Ensure `callGoogleTTSAPI` robustly extracts `base64Audio` and `mimeType`.
*   **Figuring out the MVP that we can build upon:**
    *   *Risk:* The chosen MVP (base64 string body + Google's mime type as `Content-Type`) might be confusing for clients.
    *   *Mitigation:*
        *   Start with the direct interpretation as requested.
        *   Provide very clear API documentation explaining the response format and how clients should handle it (i.e., expect base64, check `Content-Type` for format, then decode).
        *   Gather user feedback post-release. If confusion is high, a "Future Enhancement" could be to offer a JSON-wrapped response.
*   **Resource Constraints:**
    *   *Risk:* Development time for testing and documentation.
    *   *Mitigation:* Leverage existing test patterns and documentation structure. The core logic change is relatively small due to high reuse of existing components.
*   **Client-Side Handling:**
    *   *Risk:* Clients might incorrectly handle the base64 encoded response or misinterpret the `Content-Type` header.
    *   *Mitigation:* Explicit and clear API documentation with examples of how to consume the `/rawtts` endpoint in common languages/frameworks.
*   **Google API Inconsistencies:**
    *   *Risk:* Google API might not always return base64 encoded data or a consistent `mimeType` string, though this is unlikely for `inlineData`.
    *   *Mitigation:* The `callGoogleTTSAPI` function should have robust checks for the presence and format of `inlineData.data` and `inlineData.mimeType`. Log errors if unexpected structures are encountered.

# Appendix
*   **Research Findings:** N/A (Feature is an extension of existing functionality).
*   **Technical Specifications (Google TTS API):** Refer to official Google Cloud Text-to-Speech and Generative AI API documentation for details on their response formats, especially the structure of `inlineData`.
    *   The current implementation assumes `inlineData.data` is base64 and `inlineData.mimeType` describes the format of the decoded data.
