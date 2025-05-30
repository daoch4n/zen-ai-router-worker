# Architectural Design for Segmented Progress Bar

The goal is to implement a segmented progress bar in the TTS frontend, where each segment represents a TTS chunk. Each segment's visual length is proportional to the actual character length of the chunk. The overall progress will be based on the cumulative length of completed chunks, and the *current* processing/playing segment will show dynamic internal progress.

## 1. Orchestrator (`orchestrator/src/index.mjs`) Changes:

*   **Provide Chunk Lengths:**
    *   The `handleTtsInitiate` function will be modified. After splitting the `fullText` into `sentences` (chunks), the character length of each `sentence` will be calculated using the existing `getTextCharacterCount` utility.
    *   These individual chunk lengths will be collected into an array (e.g., `chunkLengths`).
    *   This `chunkLengths` array will be included in the `tts-initiate` API response sent back to the frontend, alongside `jobId` and `totalChunks`.
*   **Durable Object Storage:**
    *   The `TTS_DURABLE_OBJECT`'s `/store-metadata` endpoint will be updated to accept and persist the `chunkLengths` array within the job's metadata.
    *   The `/retrieve` endpoint of `TTS_DURABLE_OBJECT` will also be updated to fetch and return the `chunkLengths` as part of the job metadata to the frontend. This ensures state persistence and consistency.

## 2. Frontend (`tts-frontend/index.html`) Changes:

*   **Receive and Store Length Information:**
    *   The `initiateTtsRequest` function will be updated to receive the `chunkLengths` array from the `tts-initiate` response.
    *   This array will be stored in a JavaScript variable (e.g., `window.ttsJobData.chunkLengths`) for global access throughout the frontend script. The total text length will be calculated by summing these chunk lengths.
*   **Initial Rendering of Segmented Progress Bar:**
    *   The existing HTML structure for `#overallProgressBarContainer` will be modified. It will become a flex container (`display: flex`).
    *   Inside this container, multiple dynamically created `div` elements will represent each chunk segment. Each segment `div` will have a class (e.g., `progress-segment`) and a `data-chunk-index` attribute.
    *   **Each `progress-segment` will contain an inner `div` (e.g., `segment-fill`) that will represent the *internal* progress of that specific chunk.**
    *   CSS will be added to style these segments. Each segment's `width` will be set proportionally to its `chunkLength` relative to the `totalTextLength`.
    *   Initial segments will have a default "pending" color, and their inner `segment-fill` will have `width: 0%`.
*   **Progress Calculation (Revised):**
    *   A new variable, `cumulativeCompletedLength`, will track the sum of lengths of chunks that have been fully processed (fetched and decoded, or permanently failed).
    *   The overall progress bar's visual state will be a combination of:
        *   Segments for fully processed chunks (up to `cumulativeCompletedLength`) displayed in a "completed" or "failed" state.
        *   The *current* active segment showing internal progress.
    *   The `playbackProgressBar` will now be primarily responsible for showing the *internal* progress of the currently playing audio chunk. Its width will update from 0% to 100% for the active segment. The overall visual progress will be achieved by the `playbackProgressBar` overlaying or being associated with the active segment.
*   **Individual Segment and Current Chunk Update (Revised):**
    *   When the frontend starts fetching/processing a specific chunk (e.g., `chunkIndex`), its corresponding `progress-segment` will gain an `active` class.
    *   The existing `playbackProgressBar` will be visually aligned with or positioned over the `active` segment. As the audio for this chunk plays, the `playbackProgressBar`'s width will update from 0% to 100%, reflecting the playback progress *within that specific chunk*.
    *   Once a chunk's audio has finished playing (or if the chunk permanently failed/was skipped), its `progress-segment` will transition from `active` to `completed` or `failed` (e.g., by changing the background color of the `progress-segment` or its `segment-fill`). The `playbackProgressBar` would then reset to 0% and move to be associated with the next active segment.
    *   The `overallProgressBar` element itself will no longer be a single dynamic bar but rather the container for the individual `progress-segment` divs.
*   **Impact on Existing Progress Bars:**
    *   The `#overallProgressBar` div will be replaced by a collection of `progress-segment` divs, each containing a `segment-fill` div. The `overallProgressBarContainer` will manage the layout of these segments.
    *   The `#playbackProgressBar` will now be used to show the *internal* progress of the *currently active* chunk/segment. Its role becomes more focused on real-time playback within a single segment.

## 3. Overall Impact:

*   **Performance:** The impact on performance is expected to be minimal. Calculating chunk lengths is a fast operation. Sending slightly more data in the `tts-initiate` response is negligible. Frontend rendering and updating of multiple small `div`s is efficient.
*   **Complexity:** The primary increase in complexity will be on the frontend, requiring more sophisticated JavaScript to dynamically create, size, and update the individual progress segments, manage their "active" state, and control the inner progress bar (`playbackProgressBar`) to reflect current chunk progress. The orchestrator changes are relatively straightforward additions to existing data structures.

## Mermaid Diagram (High-Level Data Flow with Dynamic Segment Progress):

```mermaid
graph TD
    A[User Initiates TTS Request] --> B(Frontend: initiateTtsRequest);

    B -- POST /api/tts-initiate (text, voice, model, splitting) --> C(Orchestrator: handleTtsInitiate);

    C -- 1. Calculates chunkLengths --> C1[Orchestrator: Text Chunking & Length Calculation];
    C -- 2. Stores metadata + chunkLengths --> D(Durable Object: TTS_DURABLE_OBJECT /store-metadata);

    D -- Persists Data --> E[Durable Object Storage];

    C -- 3. Returns jobId, totalChunks, chunkLengths --> B;

    B -- 4. Renders Initial Segmented Bar (HTML/CSS) --> F[Frontend Display: Segmented Progress Bar Container];
    F -- Each Segment: Initial 'Pending' State --> F1[Segment N (Pending)];

    B -- 5. Loops: Fetches Chunk N --> G(Orchestrator: handleTtsChunk);
    G -- Retrieves audio from DO --> E;
    G -- Returns audio content/status --> B;

    B -- 6. On Chunk N Start Processing/Playback --> F1_active[Segment N: 'Active' State];
    F1_active -- 7. Update Playback ProgressBar (within/over Active Segment) --> I[Frontend Display: Playback Progress Bar (0-100% for Current Segment)];

    B -- 8. Decodes & Queues Audio --> H(Frontend: Audio Playback);

    H -- Chunk N Playback Complete --> F1_completed[Segment N: 'Completed' State];
    F1_completed -- Increment cumulativeCompletedLength --> F;
    B -- If Chunk N Permanently Failed --> F1_failed[Segment N: 'Failed' State];

    H -- All Chunks Played/Processed --> J[TTS Process Complete];

    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#bbf,stroke:#333,stroke-width:2px
    style C fill:#fbb,stroke:#333,stroke-width:2px
    style C1 fill:#f0f,stroke:#333,stroke-width:1px
    style D fill:#dbf,stroke:#333,stroke-width:2px
    style E fill:#eee,stroke:#333,stroke-width:1px
    style F fill:#bfb,stroke:#333,stroke-width:2px
    style F1 fill:#add8e6,stroke:#333,stroke-width:1px
    style F1_active fill:#ffd700,stroke:#333,stroke-width:2px
    style F1_completed fill:#28a745,stroke:#333,stroke-width:2px
    style F1_failed fill:#dc3545,stroke:#333,stroke-width:2px
    style G fill:#fbb,stroke:#333,stroke-width:2px
    style H fill:#bbf,stroke:#333,stroke-width:2px
    style I fill:#ccf,stroke:#333,stroke-width:1px
    style J fill:#f9f,stroke:#333,stroke-width:2px