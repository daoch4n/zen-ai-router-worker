# Cloudflare R2 Integration Plan for TTS Audio Results

This document outlines the detailed plan to design and implement a solution to store large TTS audio results in Cloudflare R2, mitigating the 128KB per-key storage limit of Durable Objects. This solution also includes an automatic deletion strategy for the R2 audio files.

## Phase 1: Information Gathering and Analysis (Completed)

*   Analyzed `src/durable_objects/TtsJobDurableObject.mjs` to understand current storage mechanisms.
*   Examined `wrangler.toml.example` to understand Cloudflare environment configurations.
*   Researched R2 interaction and lifecycle rules using `context7` tool.

## Phase 2: Detailed Design and Plan

### 1. R2 Bucket Binding in `wrangler.toml`

To enable the Durable Object to interact with Cloudflare R2, an R2 bucket binding needs to be added to the `wrangler.toml` file. This binding will make the R2 bucket accessible via the `env` object within the Durable Object.

**`wrangler.toml` Snippet:**

```toml
[[r2_buckets]]
binding = "TTS_AUDIO_BUCKET" # This name will be used in `env.TTS_AUDIO_BUCKET`
bucket_name = "tts-audio-results" # The actual name of your R2 bucket
# If you have multiple environments (e.g., dev, production), you might need to
# configure this under each environment's `[[r2_buckets]]` section.
```

### 2. Modify `src/durable_objects/TtsJobDurableObject.mjs` - `handleStoreResult`

The `handleStoreResult` function will be modified to store the audio data directly in Cloudflare R2 instead of the Durable Object's internal storage. The Durable Object will only store metadata related to the job.

**Modifications:**

*   **Decode Base64:** Convert the `base64Audio` string received in the request body into a `Uint8Array` or `ArrayBuffer`. This is necessary as R2 expects binary data.
    ```javascript
    const audioBuffer = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
    ```
*   **Upload to R2:** Use the R2 bucket binding (`this.env.TTS_AUDIO_BUCKET`) to upload the binary audio data. The `jobId` will be used as the unique key for the R2 object.
    ```javascript
    await this.env.TTS_AUDIO_BUCKET.put(jobId, audioBuffer, { contentType: mimeType });
    ```
*   **Update DO Storage:** Remove the `base64Audio` and `mimeType` from the `jobData` stored in the Durable Object. The Durable Object will only store essential job metadata.
    ```javascript
    jobData.base64Audio = undefined; // Or delete jobData.base64Audio;
    jobData.mimeType = mimeType; // Keep mimeType in DO for retrieval
    jobData.status = 'completed';
    await this.storage.put(jobId, jobData);
    ```

### 3. Modify `src/durable_objects/TtsJobDurableObject.mjs` - `handleGetResult`

The `handleGetResult` function will be modified to retrieve the audio data from Cloudflare R2 and then encode it back to Base64 before returning it to the client.

**Modifications:**

*   **Retrieve DO Metadata:** Fetch the `jobData` (which now contains only metadata) from `this.storage.get(jobId)`.
*   **Fetch from R2:** Use the R2 bucket binding to retrieve the audio object using the `jobId` as the key.
    ```javascript
    const r2Object = await this.env.TTS_AUDIO_BUCKET.get(jobId);
    if (!r2Object) {
        return new Response('Audio result not found in R2', { status: 404 });
    }
    ```
*   **Convert R2 Object Body to ArrayBuffer:** The `r2Object.body` is a `ReadableStream`. It needs to be read into an `ArrayBuffer`.
    ```javascript
    const arrayBuffer = await r2Object.arrayBuffer();
    ```
*   **Encode to Base64:** Convert the `ArrayBuffer` back into a `base64Audio` string.
    ```javascript
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    ```
*   **Return Result:** Construct and return the response including the fetched `base64Audio` and `mimeType`.
    ```javascript
    return new Response(JSON.stringify({ jobId, status: jobData.status, base64Audio, mimeType: jobData.mimeType }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
    });
    ```

### 4. Automatic Deletion Strategy (R2 Lifecycle Rules)

The primary strategy for automatic deletion of TTS audio files from R2 will be through **R2 Bucket Lifecycle Rules**. This is the most efficient and hands-off method for managing object expiration.

**Configuration:**

*   Lifecycle rules are configured directly in the Cloudflare dashboard for the `tts-audio-results` R2 bucket.
*   A rule will be set to expire objects after a specific number of days (e.g., 1 day for temporary audio files, or a period suitable for your retention policy).
*   **Note:** `wrangler.toml` does not currently support direct configuration of R2 bucket lifecycle rules. This step will need to be performed manually in the Cloudflare dashboard or programmatically via the Cloudflare API.

### 5. Error Handling

Robust error handling will be implemented for all R2 operations within `handleStoreResult` and `handleGetResult` to ensure the system gracefully handles potential failures (e.g., network issues, R2 bucket access problems, object not found).

**Example Error Handling:**

```javascript
// In handleStoreResult
try {
    const audioBuffer = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
    await this.env.TTS_AUDIO_BUCKET.put(jobId, audioBuffer, { contentType: mimeType });
    // ... update DO storage
} catch (error) {
    console.error(`Failed to store audio in R2 for job ${jobId}:`, error);
    return new Response(JSON.stringify({ error: 'Failed to store audio result' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
    });
}

// In handleGetResult
try {
    const r2Object = await this.env.TTS_AUDIO_BUCKET.get(jobId);
    if (!r2Object) {
        return new Response('Audio result not found in R2', { status: 404 });
    }
    const arrayBuffer = await r2Object.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    // ... return response
} catch (error) {
    console.error(`Failed to retrieve audio from R2 for job ${jobId}:`, error);
    return new Response(JSON.stringify({ error: 'Failed to retrieve audio result' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
    });
}
```

## Architecture Diagram

```mermaid
graph TD
    A[Client Request] --> B{Cloudflare Worker};
    B --> C[Durable Object (TtsJobDurableObject)];

    subgraph Durable Object Operations
        C -- Initialize Job (jobId, text, model, voiceId) --> D[DO Storage: Job Metadata];
        C -- Store Result (jobId, mimeType) --> D;
        D -- Job Data (metadata only) --> C;
        C -- Job Status Updates --> D;
    end

    subgraph R2 Operations
        C -- Store Audio (jobId, audioData) --> E[Cloudflare R2: TTS Audio Bucket];
        E -- Fetches Audio Data --> C;
        E -- Automatic Deletion (Lifecycle Rules) --> Z[Expired Audio Deleted];
    end

    C -- Get Result (jobId) --> E;
    B -- Returns Result (base64Audio, mimeType, status) --> A;