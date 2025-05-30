# Architectural Plan: Design Partial Success Model for TTS Initiation

## **Current System Overview**

The system currently uses an orchestrator to manage TTS requests, splitting long texts into chunks and sending them to backend TTS services. A Durable Object (DO) stores the generated audio chunks. The frontend initiates the TTS process and then fetches individual chunks for playback.

**Current Limitations:**
*   If *any* chunk fails during initial generation, the entire TTS initiation fails with a 500 error.
*   The frontend's chunk fetching logic re-throws an error if a chunk fails after retries, stopping the entire playback.

## **Refined Partial Success Model Design: Focus on Polling and Retries with Direct In-Progress Status**

The core principle remains: enable the TTS initiation endpoint to always return successfully, even with initial chunk failures. The key is how these failures are communicated and handled asynchronously through polling and retries, with clearer status signaling from the Durable Object.

```mermaid
graph TD
    A[Frontend: Initiate TTS Request] --> B{Orchestrator: handleTtsInitiate};

    B -- 200 OK (jobId, totalChunks) --> C[Frontend: Start Iterative Chunk Fetching (Loop 0 to totalChunks-1)];

    B -- Async Background (ctx.waitUntil) --> D[Orchestrator: Process Each Chunk (Loop 0 to totalChunks-1)];
    D --> E{_callBackendTtsService};
    E -- Internal Retries (3x) --> E;
    E -- Success: Audio Content --> F[DO: /store-chunk];
    E -- Persistent Failure (after retries) --> G[DO: /mark-chunk-failed];

    F -- DO Store Success --> H[handleTtsInitiate: Chunk Processing Result];
    G -- DO Mark Failed Success --> H;

    H -- All Chunk Promises Settled --> I[handleTtsInitiate: Update Overall Job Status in DO];
    I -- Status: 'complete', 'partial_success', 'failed' --> J[DO: Metadata (jobId, totalChunks, mimeType, status, failedChunkIndices[])];

    C --> K{Frontend: Fetch /api/tts-chunk?jobId=X&chunkIndex=Y};
    K -- Orchestrator: handleTtsChunk --> L{DO: Retrieve Chunk (metadata + chunk data)};

    L -- Chunk Index in failedChunkIndices? --> M{handleTtsChunk: Return 410 Gone};
    M --> N[Frontend: Receive 410 Gone - Skip Chunk, Toast];
    
    L -- Chunk Data Available? --> O{handleTtsChunk: Return 200 OK};
    O --> P[Frontend: Receive 200 OK - Process Audio, Add to Queue];

    L -- Chunk Data Not Found (DO returns no data)? --> Q{DO: Return 202 Accepted};
    Q --> R[Frontend: Receive 202 Accepted - Continue Polling for this chunk];
    R -- Polling loop (client-side MAX_POLLING_TIME_MS) --> K;

    N --> S[Frontend: Increment chunkIndex, Continue to next chunk];
    P --> S;
    R -- Polling Timeout/Error --> T[Frontend: Treat as chunk failure, Skip Chunk, Toast];
    T --> S;

    P -- Playback Continues --> U[User Experience: Partial playback, skipped/marked failed segments];
```

## **Detailed Architectural Changes (Revised for Direct In-Progress Status)**

#### **1. Orchestrator (`orchestrator/src/index.mjs`)**

*   **`TTS_DURABLE_OBJECT` Class (`export class TTS_DURABLE_OBJECT`)**:
    *   **Metadata Structure**:
        *   Confirm the addition of `failedChunkIndices: number[]` to the job metadata stored via `/store-metadata`. This array will track chunks that the orchestrator *could not* successfully generate or store after its internal retries.
    *   **New Endpoint: `/mark-chunk-failed`**:
        *   Add a new endpoint to the `TTS_DURABLE_OBJECT`'s `fetch` method. This endpoint will receive a `jobId` and `chunkIndex`, retrieve the job's metadata, add the `chunkIndex` to the `failedChunkIndices` array, and persist the updated metadata. This is called *after* `_callBackendTtsService` has exhausted its retries for a specific chunk.
    *   **Modified `/retrieve-chunk` Endpoint (within `TTS_DURABLE_OBJECT`)**:
        *   **Priority Check**: When a request comes to `/retrieve-chunk`, the *first* check should be: Is this `chunkIndex` present in the `failedChunkIndices` array of the job's metadata?
            *   **If Yes**: Return a `410 Gone` HTTP status. This explicitly tells `handleTtsChunk` (and thus the frontend) that this chunk will *never* be available.
            *   **If No**: Proceed to try and retrieve the actual chunk data from storage.
        *   If the chunk data is found: Return `200 OK` with the audio content.
        *   **If the chunk data is *not* found (i.e., `this.storage.get()` returns `null` or `undefined`) and it's *not* in `failedChunkIndices`**: Return a `202 Accepted` HTTP status. This explicitly implies the chunk is still being processed or not yet written, signaling to the caller that polling should continue.
*   **`_callBackendTtsService` Function**:
    *   **Enhanced Return Value**: This function will continue its internal retry mechanism (lines 189-253). If, after `maxRetries`, it still fails to get a successful response (200 OK or 202 Accepted followed by successful polling), it should *not* throw an `HttpError` directly. Instead, it should return a standardized failure object, e.g.:
        ```javascript
        return { success: false, index: chunkIndex, errorMessage: error.message || `Backend TTS failed after retries with status ${response.status}` };
        ```
    *   If successful, it returns `{ success: true, audioContentBase64, mimeType }`.
*   **`handleTtsInitiate` Function**:
    *   **Immediate Success Response**: Continues to return `200 OK` with `jobId` and `totalChunks` upfront. This is the "initiation" part of the partial success.
    *   **Asynchronous Chunk Processing (`ctx.waitUntil`)**:
        *   The `chunkPromises.map` (lines 536-559) will now await the new structured return value from `_callBackendTtsService`.
        *   **Failure Handling within `map`**: If `_callBackendTtsService` returns `{ success: false, ... }`:
            1.  Log the error.
            2.  **Crucially**: Call the Durable Object's `/mark-chunk-failed` endpoint to record this chunk's index in the `failedChunkIndices` array.
            3.  Return a structured object to `Promise.allSettled` (e.g., `{ index, status: 'failed', error: '...' }`).
        *   **Post-`Promise.allSettled` Logic**:
            *   Iterate through the `results` from `Promise.allSettled`.
            *   Count `fulfilled` results where `value.status === 'failed'` (i.e., chunks marked failed by `_callBackendTtsService` and recorded in DO) and `rejected` promises (which would indicate a critical orchestrator-level error preventing even the `mark-chunk-failed` call).
            *   Based on these counts, set the overall job status in the Durable Object to `'complete'`, `'partial_success'`, or `'failed'` using the `/update-status` endpoint.
*   **`handleTtsChunk` Function**:
    *   **Primary Logic**: This function receives requests for specific chunks.
    *   **Step 1: Check Metadata for Failed Chunks**:
        1.  Retrieve the job's metadata from the Durable Object (e.g., using a dedicated `/retrieve-metadata` call or by modifying `/retrieve` to just return metadata if only `jobId` is provided).
        2.  Check if `chunkIndex` is present in the `metadata.failedChunkIndices`.
        3.  **If Present**: Return a `new Response('Chunk permanently failed', { status: 410 })`. This is the definitive signal to the frontend.
    *   **Step 2: Attempt Chunk Retrieval**:
        1.  If the chunk is *not* in `failedChunkIndices`, attempt to retrieve the chunk using the DO's `/retrieve-chunk` endpoint.
    *   **Step 3: Handle DO Response**:
        1.  **If DO returns `200 OK`**: The chunk is ready. Return `new Response(JSON.stringify({ audioContentBase64, mimeType, index: chunkIndex }), { headers: { 'Content-Type': 'application/json' }, status: 200 })`.
        2.  **If DO returns `202 Accepted` (from its `/retrieve-chunk` endpoint)**: The chunk is not yet available in the DO's storage. Return `new Response('Chunk not yet available', { status: 202 })`. This tells the frontend to continue polling.
        3.  **If DO returns any other error**: Log and return a `500 Internal Server Error` to the frontend, indicating a problem with the orchestrator or DO.

#### **2. Frontend (`tts-frontend/index.html`)**

*   **`initiateTtsRequest` Function (Chunk Fetching Loop)**:
    *   The `while (chunkIndex < totalChunks)` loop (lines 536-601) is the main driver.
    *   **Polling for `202 Accepted`**:
        *   If the initial `fetch` for a chunk returns `202 Accepted` (now directly from `handleTtsChunk` via DO's 202), the existing polling loop (lines 551-571) will continue. This loop should also handle `410 Gone` and `200 OK` from subsequent polling responses.
    *   **Handling `410 Gone` (Permanent Failure)**:
        *   If `fetch` (either initial or during polling) returns a `410 Gone` status:
            1.  Log `Chunk ${chunkIndex + 1} permanently failed.`
            2.  Display a `showToast` message (e.g., `'Warning: Segment ${chunkIndex + 1} failed and will be skipped.'`, type: 'warning').
            3.  **Crucially**: `continue` to the next `chunkIndex` without re-throwing any error or attempting further retries for this specific chunk. This ensures playback of subsequent chunks.
    *   **Handling `200 OK` (Success)**:
        *   If `fetch` returns `200 OK`, call `await processAudioChunk(...)` as currently.
    *   **Handling Other Errors (e.g., Orchestrator 500)**:
        *   If `fetch` returns any other non-`200 OK`, non-`202 Accepted`, non-`410 Gone` status:
            1.  Log the error.
            2.  Display a `showToast` message (e.g., `'Error: Failed to retrieve chunk ${chunkIndex + 1} due to server error. Skipping.'`, type: 'error').
            3.  `continue` to the next `chunkIndex` without re-throwing. This keeps the overall playback experience flowing despite an unexpected error.
*   **`processAudioChunk` and `playNextChunk` Functions**:
    *   These functions remain largely unchanged. The `audioQueue` will simply not receive buffers for permanently failed chunks, and `playNextChunk` will naturally proceed to the next available chunk.
*   **UI Communication**:
    *   `showToast` will be the primary mechanism for real-time feedback on individual chunk failures or polling timeouts.
    *   The overall progress bar will continue to advance as chunks are either successfully fetched or explicitly skipped due to permanent failure.

#### **3. Overall Impact**

*   **Robustness**: The explicit `410 Gone` status provides a clear signal for permanent chunk failure, improving the reliability of the system.
*   **Clarity of State**: The `failedChunkIndices` array in the Durable Object provides a persistent record of which chunks failed, allowing for potential re-attempts or reporting mechanisms outside the immediate request flow. The direct `202 Accepted` from the DO for in-progress chunks provides clearer state signaling.
*   **Seamless Frontend Experience**: The frontend's ability to `continue` past failed chunks (both permanently failed and polling-timed-out) ensures a smoother user experience, even if some audio segments are missing.
*   **Diagnostic Improvement**: Clearer status codes and explicit failed chunk tracking will greatly assist in debugging and monitoring the TTS pipeline.