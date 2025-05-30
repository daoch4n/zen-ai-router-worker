# TTS Frontend and Orchestrator Integration Documentation

This document provides comprehensive documentation of the integration between the `tts-frontend/index.html` application, the `orchestrator` Cloudflare Worker, and its internal source code (`orchestrator/src`). It details the current state of communication, identifies critical API contract mismatches, and highlights timeout synchronization issues, based on the `analysis_report_B36F90.md`.

## 1. Integration Overview

The Text-to-Speech (TTS) system employs a multi-component architecture to process and deliver synthesized speech:

*   **TTS Frontend (`tts-frontend/index.html`):** This is the client-side application responsible for user interaction. It allows users to input text, initiate TTS jobs, play received audio, visualize progress (including word highlighting), and download the generated WAV files.

*   **Orchestrator Worker (`orchestrator/src/index.mjs`):** Functioning as a central coordinator, this Cloudflare Worker receives TTS requests from the frontend. It manages the lifecycle of TTS jobs, splits the input text into manageable chunks, and persists job metadata and audio chunks using Cloudflare Durable Objects (`TTS_JOBS`). The Orchestrator also delegates the actual speech synthesis to various backend TTS services and handles routing for non-TTS requests.

*   **Backend TTS Services (e.g., `src/handlers/tts.mjs`):** As described in the `architectural_review_plan.md`, these components are responsible for interfacing directly with external TTS APIs, such as the Google Generative AI TTS API, and returning the synthesized audio data.

The primary workflow for a TTS request is as follows:

1.  A user inputs text in the `tts-frontend/index.html` interface and clicks the "Speak" button.
2.  The Frontend sends a `POST` request to the `/api/tts-initiate` endpoint on the Orchestrator.
3.  Upon receiving the request, the Orchestrator generates a unique `jobId`, splits the `fullText` into chunks based on the specified `splittingPreference`, and stores job metadata (including `jobId`, `totalChunks`, `mimeType`, `status`, `chunkLengths`, `sentenceMapping`, and `orchestratorTimeoutMs`) in a `TTS_JOBS` Durable Object. It then initiates asynchronous processing of these text chunks using `ctx.waitUntil`.
4.  The Frontend periodically sends `GET` requests to the `/api/tts-chunk` endpoint on the Orchestrator, requesting specific audio chunks using the `jobId` and `chunkIndex`.
5.  The Orchestrator retrieves the requested chunk from the `TTS_JOBS` Durable Object. If the chunk is not yet ready, it returns a `202` (Accepted) status, signaling the frontend to poll again. Once the chunk is ready, it returns the base64-encoded audio content, `mimeType`, `index`, `status`, and `sentenceMapping`.
6.  As audio chunks are received, the frontend decodes and plays them, updates visual progress bars, and highlights the corresponding text.
7.  In the background, the Orchestrator calls backend TTS services via `/api/rawtts` for each text chunk. If the backend processes asynchronously, the Orchestrator may poll `/api/tts-result` for the results.
8.  Once all chunks are processed (either successfully or with failures), the Orchestrator updates the overall job status in the `TTS_JOBS` Durable Object.

## 2. Detailed Component Analysis

### 2.1. TTS Frontend (`tts-frontend/index.html`)

*   **Role:** User interface, initiation of TTS requests, audio playback, progress visualization, text highlighting, and WAV file download.
*   **Key Interactions:**
    *   Sends `POST /api/tts-initiate` to the Orchestrator to begin a TTS job. The request body includes `fullText`, `voiceId`, `model`, and `splittingPreference`.
    *   Sends `GET /api/tts-chunk?jobId=<jobId>&chunkIndex=<chunkIndex>` to the Orchestrator to retrieve generated audio chunks.
    *   Receives `jobId`, `totalChunks`, `chunkLengths`, `sentenceMapping`, and `orchestratorTimeoutMs` in the response from `/api/tts-initiate`.
    *   Receives `audioContentBase64`, `mimeType`, `index`, `status`, and `sentenceMapping` in the response from `/api/tts-chunk`.
*   **Timeout Mechanisms:**
    *   No explicit `fetch` timeouts were originally set for `tts-initiate` or `tts-chunk` requests, relying on browser defaults.
    *   `MAX_POLLING_TIME_MS` is configured to 90 seconds for the total polling duration of a single chunk.
    *   The `initialFetchTimeout` for `/api/tts-initiate` is now dynamically set based on `orchestratorTimeoutMs` (if available) or a 20-second fallback.
*   **Identified Issues:**
    *   **Hardcoded URL:** `ORCHESTRATOR_WORKER_URL` is hardcoded to `'http://localhost:8787'` (line 1044), which is not suitable for production deployments and lacks deployment flexibility.
    *   **Naming Inconsistency:** Expected `audioBase64` vs. received `audioContentBase64` (lines 544, 810) indicates a minor naming inconsistency.
    *   **Sentence Mapping Reliance:** Frontend relies on the Orchestrator to provide `sentenceMapping` data per chunk for word highlighting.

### 2.2. Orchestrator Worker (`orchestrator/src/index.mjs`)

*   **Role:** Request routing, text splitting, TTS job orchestration, Durable Object interaction, and managing calls to backend TTS services.
*   **Key Interactions:**
    *   Exposes `/api/tts-initiate` (POST) and `/api/tts-chunk` (GET) endpoints for frontend communication.
    *   Generates a `jobId` for new TTS requests using `crypto.randomUUID()`.
    *   Interacts with the `TTS_JOBS` Durable Object (bound as `env.TTS_JOBS`) to:
        *   Store job metadata (`/store-metadata`).
        *   Store individual audio chunks (`/store-chunk`).
        *   Mark chunks as failed (`/mark-chunk-failed`).
        *   Update overall job status (`/update-status`).
        *   Retrieve job metadata (`/retrieve`).
        *   Retrieve specific audio chunks (`/retrieve-chunk`).
    *   Calls backend TTS services (`_callBackendTtsService`) for each text chunk, targeting `/api/rawtts` on a selected backend worker.
    *   Polls backend TTS services for results if they respond with `202` (`_pollForTtsResult`) by calling `/api/tts-result`.
    *   Implements text splitting logic (e.g., `sentence`, `characterCount`, `none`) using `splitIntoSentences` and `getTextCharacterCount` from `utils/textProcessing.mjs`.
*   **Timeout Mechanisms:**
    *   `_callBackendTtsService` dynamically calculates a timeout for backend TTS service calls: `Math.min(5000 + (characterCount * 35), 70000) + 5000`, capped at 75000ms.
    *   `_pollForTtsResult` uses the same calculated `timeoutMs` for backend polling.
    *   Utilizes `AbortController` and `signal` for `fetch` call timeouts.
    *   Includes a retry mechanism (maximum 3 retries with exponential backoff) for transient errors when calling backend services.
    *   Crucially, `ctx.waitUntil()` is used to keep the worker active during asynchronous chunk processing.
*   **Identified Issues:**
    *   **API Contract Mismatches:** Significant mismatches with backend services (detailed in Section 3).
    *   **Hardcoded Polling Delay:** Reliance on hardcoded `POLLING_BASE_DELAY_MS = 1000` (1 second) for polling the backend.

### 2.3. Backend Src Worker (`src/handlers/tts.mjs` - *Information from `architectural_review_plan.md`*)

*   **Role:** Directly interfaces with external TTS APIs (e.g., Google Generative AI TTS API).
*   **Key Interactions:**
    *   Exposes `/api/rawtts` for direct TTS generation.
    *   Exposes `/api/tts-result` for polling asynchronous TTS job results.
    *   Calls the Google Generative AI TTS API.
*   **Timeout Mechanisms:**
    *   Expected to implement a dynamic `fetch` timeout for Google TTS API calls: `5000 (base) + (character_count * 35)`, capped at 70000ms.
*   **Identified Issues:**
    *   **CPU Time for Post-Processing:** Processing Google API responses (JSON parsing, audio decoding, WAV header generation) consumes CPU time, which is a significant constraint, especially on Cloudflare's free tier (10ms CPU limit). This can lead to worker termination for large chunks.
    *   **API Contract Mismatch (voiceId/voiceName):** Expects `voiceName` as a query parameter, while the Orchestrator sends `voiceId` in the request body.
    *   **API Contract Mismatch (Audio Data Format):** Returns raw `audio/wav` binary data directly, while the Orchestrator expects base64-encoded audio within a JSON object.

## 3. API Contract Compatibility Analysis

The `architectural_review_plan.md` accurately highlights critical API contract mismatches:

### 3.1. `sentenceMapping` (Frontend <-> Orchestrator)

*   **Issue:** The frontend (`tts-frontend/index.html`) expects `sentenceMapping` in the `/api/tts-chunk` response for word highlighting, but the orchestrator (`orchestrator/src/index.mjs`) was not explicitly including it.
*   **Resolution (Observed):** The `orchestrator/src/index.mjs` now correctly stores `sentenceMapping` in the Durable Object metadata during `/api/tts-initiate` and retrieves/filters it for the relevant chunk when responding to `/api/tts-chunk` requests (lines 331-334, 444, 617, 699), aligning with frontend expectations.

### 3.2. `voiceId` vs `voiceName` Parameter Location (Orchestrator -> Backend `/api/rawtts`)

*   **Issue:** The Orchestrator sends `voiceId` in the request body (`_callBackendTtsService` - line 208), but the backend (`src/handlers/tts.mjs`) is described as expecting `voiceName` as a query parameter.
*   **Impact:** This direct incompatibility prevents the backend from correctly receiving the voice selection.
*   **Recommendation:** Modify the backend (`src/handlers/tts.mjs`) to expect `voiceId` (or `voiceName`) in the *request body* to standardize the API.

### 3.3. Audio Data Format (Orchestrator <-> Backend `/api/rawtts` and `/api/tts-result`)

*   **Issue:** The Orchestrator expects base64-encoded audio within a JSON object, but the backend (`src/handlers/tts.mjs`) is described as returning raw `audio/wav` binary data.
*   **Impact:** This is a critical functional mismatch. The Orchestrator's `response.json()` call (e.g., in `_callBackendTtsService` at line 250 and `_pollForTtsResult` at line 142) will fail when attempting to parse binary data as JSON.
*   **Recommendation:** Modify the backend (`src/handlers/tts.mjs`) to base64 encode the audio data and return it within a JSON object, along with the `mimeType`, for both `/api/rawtts` and `/api/tts-result` responses.

## 4. Timeout Synchronization Analysis

The `architectural_review_plan.md` provides an accurate assessment of timeout issues:

### 4.1. Identified Discrepancies and Potential Issues

*   **Frontend Client Disconnects (Wall-Clock):** The previous 30-second `MAX_POLLING_TIME_MS` in the frontend was insufficient, given the potential 52-second latency for Google API calls. This has been addressed by increasing it to 90 seconds.
*   **Backend CPU Time for Post-Processing:** This remains a critical concern. `fetch` waits do not consume CPU, but subsequent processing of large audio responses (JSON parsing, decoding) *does* consume CPU time, which is strictly limited in Cloudflare Workers (10ms free tier limit). Exceeding these limits will cause worker termination.
*   **Lack of End-to-End Explicit Timeouts:** The initial absence of explicit `fetch` timeouts in some areas could lead to indefinite hangs.
*   **`event.waitUntil()` Usage:** Proper and consistent use is vital for long-running tasks. The Orchestrator's use of `ctx.waitUntil` for chunk processing addresses this for its asynchronous operations.
*   **Redundant Frontend Variables:** `SENTENCE_FETCH_TIMEOUT_MS` and `FIRST_SENTENCE_TIMEOUT_MS` were unused and have been removed from relevant sections.

### 4.2. Recommendations for Synchronizing Timeouts (Alignment with `architectural_review_plan.md`)

Recommendations from `architectural_review_plan.md` largely align with current implementations:

*   **Backend Src Worker (`src/handlers/tts.mjs`):**
    *   **Dynamic `fetch` timeout for Google TTS API:** Recommended `5000 + (character_count * 35)` ms, capped at 70000 ms. (This is a recommendation for the backend, not directly observed in the Orchestrator code that calls the backend).
    *   **CPU Time Optimization:** This is a critical area. If `MAX_TEXT_LENGTH_CHARACTER_COUNT` in the Orchestrator is too high, it could lead to CPU overruns in the backend. Further analysis or profiling of the backend is needed.
*   **Orchestrator Worker (`orchestrator/src/index.mjs`):**
    *   **Dynamic timeouts for backend calls:** Implemented in `_callBackendTtsService` with `timeoutMs = Math.min(backendCalculatedTimeout + 5000, 75000)`. This aligns with the plan.
    *   **Polling timeout:** `_pollForTtsResult` uses the same `timeoutMs`, aligning with the plan.
*   **Frontend (`tts-frontend/index.html`):**
    *   **`/api/tts-initiate` timeout:** The frontend now uses `initialFetchTimeout` which is `orchestratorTimeoutMs ? Math.min(orchestratorTimeoutMs + 20000, 80000) : 20000` (line 601), providing a dynamic timeout based on the orchestrator's reported timeout, or a 20s fallback. This is a significant improvement.
    *   **`/api/tts-chunk` polling duration:** `MAX_POLLING_TIME_MS` is set to 90 seconds (line 539), directly addressing the `architectural_review_plan.md` recommendation.
    *   **Cleanup:** Unused `SENTENCE_FETCH_TIMEOUT_MS` and `FIRST_SENTENCE_TIMEOUT_MS` variables are no longer present in the `initiateTtsRequest` function, aligning with cleanup recommendations.

## 5. Potential Optimizations and Recommendations

Based on the analysis, the following optimizations and recommendations are crucial:

### 5.1. Address API Contract Mismatches (Critical)

*   **Backend (`src/handlers/tts.mjs`) Modification:**
    *   Change `/api/rawtts` and `/api/tts-result` to return base64-encoded audio within a JSON object, along with the `mimeType`. This is paramount for the Orchestrator to correctly process audio data.
    *   Modify `/api/rawtts` to accept `voiceId` (or `voiceName`) in the request body, consistent with the Orchestrator's current sending method.

### 5.2. Frontend URL Configuration

*   **Externalize `ORCHESTRATOR_WORKER_URL`:** The hardcoded `http://localhost:8787` in `tts-frontend/index.html` (line 1044) should be replaced with an environment-specific variable or a configurable endpoint to improve deployment flexibility.

### 5.3. Performance Optimizations

*   **Backend CPU Time Analysis (Critical):** Investigate and profile the post-processing phase in `src/handlers/tts.mjs` (JSON parsing, audio decoding, WAV header generation) for potential CPU overruns, especially for larger chunks on Cloudflare's free tier. If CPU limits are hit, consider:
    *   **Reducing `MAX_TEXT_LENGTH_CHARACTER_COUNT`:** Adjust `MAX_TEXT_LENGTH_CHARACTER_COUNT` in `orchestrator/src/index.mjs` (line 525) to ensure generated chunks can be processed by the backend within CPU limits. This might increase the number of chunks but ensures stability.
    *   **Streaming Processing:** Explore if the Google TTS API can provide streaming audio or if the backend can stream decoded audio back to the Orchestrator to reduce memory footprint and CPU spikes for large single responses.
    *   **Cloudflare Queues/Durable Objects for Background Processing:** For very large audio requests, offloading the Google API call and subsequent processing to a Cloudflare Queue consumer or a dedicated Durable Object instance that streams results back could prevent worker timeouts and CPU overruns on the main request path.

### 5.4. Error Handling and Observability

*   **Enhanced Logging:** Consider adding more detailed logs at critical points (e.g., successful chunk storage, specific timeout triggers, detailed error payloads) to aid debugging and performance monitoring.
*   **Frontend Error Messages:** Ensure frontend error messages are user-friendly and actionable, providing clear guidance when issues occur (e.g., "API Key Invalid," "Service Temporarily Unavailable").
*   **Circuit Breakers (Orchestrator):** Implementing circuit breakers in the Orchestrator for calls to backend services would provide a more robust way to handle repeated backend failures or slow responses, preventing cascading failures.

## Conclusion

The integration between the TTS frontend and orchestrator demonstrates a well-structured approach, leveraging Cloudflare Workers and Durable Objects for job management and asynchronous processing. The `architectural_review_plan.md` provided an excellent baseline for identifying key issues, and the current code has already addressed some of the timeout synchronization recommendations.

However, the identified API contract mismatches between the orchestrator and backend services are critical and must be resolved for the system to function correctly end-to-end. Furthermore, continuous monitoring and optimization of backend CPU usage for post-processing large audio chunks are essential for scalability and cost-effectiveness. Addressing these points will significantly enhance the robustness, reliability, and performance of the entire TTS system.