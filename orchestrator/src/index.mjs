import { RouterCounter } from './routerCounter.mjs';
import { fixCors } from './utils/cors.mjs';
import { HttpError, errorHandler } from './utils/error.mjs';
import { handleOPTIONS } from './utils/cors.mjs';
import { splitIntoSentences, getTextCharacterCount } from './utils/textProcessing.mjs';
export { RouterCounter };


export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url = new URL(request.url);
    console.log(`Orchestrator: Incoming request: ${request.method} ${url.pathname}`);
    try {

    const backendServices = Object.keys(env)
      .filter(key => key.startsWith("BACKEND_SERVICE_"))
      .sort((a, b) => {
        const indexA = parseInt(a.split('_')[2]);
        const indexB = parseInt(b.split('_')[2]);
        return indexA - indexB;
      })
      .map(key => env[key]);

    const numSrcWorkers = backendServices.length;

    if (numSrcWorkers === 0) {
      console.log("Orchestrator: No backend workers configured.");
      return new Response("No backend workers configured.", { status: 500 });
    }

    // Handle /api/tts-stream requests


    if (url.pathname === '/api/rawtts') {
      return handleRawTTS(request, env, backendServices, numSrcWorkers);
    } else if (url.pathname === '/api/tts-initiate') {
      return handleTtsInitiate(request, env, backendServices, numSrcWorkers, ctx);
    } else if (url.pathname === '/api/tts-chunk') {
      return handleTtsChunk(request, env);
    } else {
      // Existing routing logic for non-TTS requests
      const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
      const stub = env.ROUTER_COUNTER.get(id);
      const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
      const currentCounter = parseInt(await currentCounterResponse.text());

      const targetWorkerIndex = currentCounter % numSrcWorkers;
      const targetService = backendServices[targetWorkerIndex];
      console.log(`Orchestrator: Selected targetWorkerIndex: ${targetWorkerIndex}, targetService: ${targetService}`);
      console.log(`Orchestrator: Routing to worker index: ${targetWorkerIndex} (counter: ${currentCounter})`);

      if (!targetService) {
        console.log("Orchestrator: Failed to select target worker for routing.");
        return new Response("Failed to select target worker for routing.", { status: 500 });
      }

      const response = await targetService.fetch(request);
      console.log(`Orchestrator: Response status from target worker: ${response.status}`);
      return response;
    } // Closes the 'else' block from line 44
  } catch (e) { // Closes the 'try' block from line 17
    return errorHandler(e, fixCors, request);
  }
}, // Closes the 'fetch' method definition, comma for 'export default' object
};

const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts"; // Updated model name

// Constants for polling
const POLLING_BASE_DELAY_MS = 1000; // 1 second base delay for polling

async function handleRawTTS(request, env, backendServices, numSrcWorkers) {
    if (request.method === 'OPTIONS') {
        return handleOPTIONS();
    }
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!apiKey || apiKey !== env.PASS) {
        throw new HttpError("Authentication required or invalid API key", 401);
    }

    const { text, voiceId, model } = await request.json();

    if (!text || !voiceId || !model) {
        return new Response('Missing required parameters: text, voiceId, or model', { status: 400 });
    }

    // For rawTTS, the characterCount for timeout calculation would be text.length
    const characterCount = getTextCharacterCount(text);
    const { audioContentBase64, mimeType } = await _callBackendTtsService(text, voiceId, model, apiKey, env, backendServices, numSrcWorkers, undefined, characterCount);

    return new Response(JSON.stringify({ audioContentBase64, mimeType }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
    });
}

/**
 * Polls the backend worker for the TTS result.
 * @param {ServiceWorkerGlobalScope} targetService - The backend worker service.
 * @param {string} jobId - The ID of the TTS job.
 * @param {string} apiKey - The API key for authentication.
 * @param {number} timeoutMs - The total timeout for polling.
 * @returns {Promise<{audioContentBase64: string, mimeType: string}>} The audio content and mime type.
 * @throws {HttpError} If polling fails after max attempts or encounters a non-retryable error.
 */
async function _pollForTtsResult(targetService, jobId, apiKey, timeoutMs) {
    const pollingUrl = new URL(`/api/tts-result?jobId=${jobId}`, 'http://placeholder');
    const headersToSend = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        for (let i = 0; ; i++) { // Loop indefinitely, rely on timeout
            console.log(`Orchestrator: Polling for TTS job ${jobId} (attempt ${i + 1})...`);
            const response = await targetService.fetch(new Request(pollingUrl.toString(), {
                method: 'GET',
                headers: headersToSend,
                signal: controller.signal // Apply the AbortController signal
            }));

            if (response.status === 200) {
                console.log(`Orchestrator: TTS job ${jobId} completed successfully.`);
                const data = await response.json();
                const mimeType = 'audio/L16;rate=24000'; // Default if not provided
                return { audioContentBase64: data.base64Audio, mimeType };
            } else if (response.status === 404 || response.status === 202) { // 202 means not yet ready
                console.warn(`Orchestrator: TTS job ${jobId} not yet ready or expired.`);
                await new Promise(resolve => setTimeout(resolve, POLLING_BASE_DELAY_MS));
            } else {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    errorData = { message: await response.text() };
                }
                console.error(`Orchestrator: Error polling for TTS job ${jobId}: ${errorData.message} (status: ${response.status})`);
                throw new HttpError(errorData.message || `Backend error during polling: ${response.status}`, response.status);
            }
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new HttpError(`TTS job ${jobId} polling timed out after ${timeoutMs}ms.`, 504);
        }
        throw new HttpError(`Network error during polling: ${e.message}`, 502);
    } finally {
        clearTimeout(timeoutId); // Ensure timeout is cleared on success or other exits
    }
}

async function _callBackendTtsService(text, voiceId, model, apiKey, env, backendServices, numSrcWorkers, chunkIndex, characterCount) {
    const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
    const stub = env.ROUTER_COUNTER.get(id);
    const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
    const currentCounter = parseInt(await currentCounterResponse.text());

    const targetWorkerIndex = currentCounter % numSrcWorkers;
    const targetService = backendServices[targetWorkerIndex];

    if (!targetService) {
        return { success: false, index: chunkIndex, errorMessage: "Failed to select target worker." };
    }

    const backendTtsUrl = new URL('/api/rawtts', 'http://placeholder');

    const headersToSend = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const maxRetries = 3;
    const baseDelayMs = 100;

    // Calculate dynamic timeout based on characterCount
    // Backend's Dynamic Timeout for the specific chunk: Math.min(5000 + (characterCount * 35), 70000)
    // Orchestrator's timeoutMs: (Backend's Dynamic Timeout) + 5000, capped at 75000ms
    const backendCalculatedTimeout = Math.min(5000 + (characterCount * 35), 70000);
    const timeoutMs = Math.min(backendCalculatedTimeout + 5000, 75000);

    for (let i = 0; i <= maxRetries; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await targetService.fetch(new Request(backendTtsUrl.toString(), {
                method: 'POST',
                headers: headersToSend,
                body: JSON.stringify({
                    text: text.trim(),
                    model: model,
                    voiceId: voiceId
                }),
                signal: controller.signal // Apply the AbortController signal
            }));

            

            if (response.status === 202) {
                console.log(`Orchestrator: Backend worker accepted TTS job. Initiating polling.`);
                const responseData = await response.json();
                const jobId = responseData.jobId || response.headers.get('X-Processing-Job-Id');
                if (!jobId) {
                    return { success: false, index: chunkIndex, errorMessage: "202 response missing jobId" };
                }
                // Pass the calculated timeout to the polling function
                const pollResult = await _pollForTtsResult(targetService, jobId, apiKey, timeoutMs);
                return { success: true, ...pollResult, timeoutMs };
            } else if (response.ok) {
                // Existing handling for successful fetch (2xx responses other than 202)
            } else { // response.status is not 2xx or 202
                const RETRYABLE_STATUSES = [429, 500, 502, 503, 504]; // Define transient, retryable HTTP status codes

                if (RETRYABLE_STATUSES.includes(response.status) && i < maxRetries) {
                    const delay = Math.pow(2, i) * baseDelayMs;
                    console.warn(`Orchestrator: Backend TTS fetch failed (status: ${response.status}). Retrying in ${delay}ms (attempt ${i + 1}/${maxRetries}).`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                } else {
                    // Non-retryable HTTP error or max retries reached for a retryable error
                    let errorData;
                    try {
                        errorData = await response.json();
                    } catch (e) {
                        errorData = { message: await response.text() };
                    }
                    console.error(`Orchestrator: Backend TTS failed with non-retryable status ${response.status} or max retries reached. Error: ${errorData.message}`);
                    return { success: false, index: chunkIndex, errorMessage: errorData.message || `Backend TTS failed with status ${response.status}`, status: response.status, timeoutMs: null };
                }
            }

            console.log(`Orchestrator: Backend TTS fetch successful after ${i + 1} attempt(s).`);
            const data = await response.json();
            let mimeType = response.headers.get('Content-Type');

            if (data.mimeType) {
                mimeType = data.mimeType;
            } else if (!mimeType) {
                mimeType = 'audio/L16;rate=24000';
                console.warn(`Orchestrator: Backend did not provide mimeType for raw TTS, defaulting to ${mimeType}`);
            }

            return { success: true, audioContentBase64: data.audioContentBase64, mimeType: mimeType, timeoutMs };

        } catch (e) {
            

if (e instanceof HttpError) {
                console.error(`Orchestrator: HttpError during backend TTS fetch: ${e.message} (status: ${e.status}).`);
                return { success: false, index: chunkIndex, errorMessage: e.message, status: e.status, timeoutMs: null };
            }
            if (e.name === 'AbortError') {
                return { success: false, index: chunkIndex, errorMessage: `API call timed out after ${timeoutMs}ms`, status: 504, timeoutMs: null };
            }

            if (i < maxRetries) {
                const delay = Math.pow(2, i) * baseDelayMs;
                console.warn(`Orchestrator: Error during backend TTS fetch: ${e.message}. Retrying in ${delay}ms (attempt ${i + 1}/${maxRetries}).`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Orchestrator: All retry attempts failed for backend TTS fetch. Last error:`, e);
                return { success: false, index: chunkIndex, errorMessage: e.message || "Unknown error during backend TTS fetch.", timeoutMs: null };
            }
        } finally {
            clearTimeout(timeoutId); // Ensure timeout is cleared on success or other exits
        }
    }
}
async function handleTtsChunk(request, env) {
    if (request.method === 'OPTIONS') {
        return handleOPTIONS();
    }
    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const chunkIndex = parseInt(searchParams.get('chunkIndex'), 10);

    if (!jobId || isNaN(chunkIndex)) {
        throw new HttpError('Missing or invalid parameters: jobId or chunkIndex', 400);
    }

    const id = env.TTS_JOBS.idFromName(jobId);
    const stub = env.TTS_JOBS.get(id);

    const metadataResponse = await stub.fetch(new Request(`https://dummy-url/retrieve?jobId=${jobId}`));
    if (!metadataResponse.ok) {
        console.error(`Orchestrator: Failed to retrieve TTS job metadata ${jobId} from Durable Object: ${await metadataResponse.text()}`);
        throw new HttpError('Failed to retrieve TTS job metadata.', metadataResponse.status);
    }
    const jobMetadata = await metadataResponse.json();

    if (!jobMetadata || chunkIndex < 0 || chunkIndex >= jobMetadata.totalChunks) {
        throw new HttpError('Chunk not found or invalid chunkIndex', 404);
    }

    // Step 1: Check Metadata for Failed Chunks
    if (jobMetadata.failedChunkIndices && jobMetadata.failedChunkIndices.includes(chunkIndex)) {
        console.log(`Orchestrator: Chunk ${chunkIndex} for job ${jobId} is permanently failed.`);
        throw new HttpError('Chunk permanently failed', 410);
    }

    // Step 2: Attempt Chunk Retrieval
    const chunkResponse = await stub.fetch(new Request(`https://dummy-url/retrieve-chunk?jobId=${jobId}&chunkIndex=${chunkIndex}`));

    // Step 3: Handle DO Response
    if (chunkResponse.status === 200) {
        console.log(`Orchestrator: Successfully retrieved chunk ${chunkIndex} for job ${jobId}.`);
        const audioContentBase64 = await chunkResponse.text();
        const mimeType = jobMetadata.mimeType || 'audio/L16;rate=24000';
        const sentenceMapping = jobMetadata.sentenceMapping || []; // Retrieve sentenceMapping

        // Filter sentenceMapping to only include entries for the current chunk
        const relevantSentenceMapping = sentenceMapping.filter(item => item.chunkIndex === chunkIndex);

        return new Response(JSON.stringify({ audioContentBase64, mimeType, index: chunkIndex, status: jobMetadata.status, sentenceMapping: relevantSentenceMapping }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } else if (chunkResponse.status === 202) {
        console.log(`Orchestrator: Chunk ${chunkIndex} for job ${jobId} not yet available, polling required.`);
        return new Response('Chunk not yet available', { status: 202 });
    } else {
        console.error(`Orchestrator: Failed to retrieve chunk ${chunkIndex} for job ${jobId}: ${await chunkResponse.text()} (status: ${chunkResponse.status})`);
        throw new HttpError('Failed to retrieve TTS chunk.', 500);
    }
}

export class TTS_DURABLE_OBJECT {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.storage = this.state.storage;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;

        switch (path) {
            case '/store-metadata':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId, totalChunks, mimeType, status, chunkLengths, sentenceMapping, orchestratorTimeoutMs } = await request.json();
                const TTL_IN_MILLISECONDS = 7200000;
                await this.storage.put(`${jobId}:metadata`, { totalChunks, mimeType, status, failedChunkIndices: [], chunkLengths, sentenceMapping, orchestratorTimeoutMs }, { expirationTtl: TTL_IN_MILLISECONDS });
                console.log(`TTS_DURABLE_OBJECT: Stored metadata for job ${jobId}. Total chunks: ${totalChunks}.`);
                return new Response('OK', { status: 200 });

            case '/store-chunk':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId: chunkJobId, chunkIndex, audioContentBase64 } = await request.json();
                await this.storage.put(`${chunkJobId}:chunk:${chunkIndex}`, audioContentBase64);
                console.log(`TTS_DURABLE_OBJECT: Stored chunk ${chunkIndex} for job ${chunkJobId}.`);
                return new Response('OK', { status: 200 });

            case '/mark-chunk-failed':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId: failedJobId, chunkIndex: failedChunkIndex } = await request.json();
                const currentMetadataForFail = await this.storage.get(`${failedJobId}:metadata`);
                if (!currentMetadataForFail) {
                    return new Response('Job metadata not found to mark chunk failed', { status: 404 });
                }
                if (!currentMetadataForFail.failedChunkIndices) {
                    currentMetadataForFail.failedChunkIndices = [];
                }
                if (!currentMetadataForFail.failedChunkIndices.includes(failedChunkIndex)) {
                    currentMetadataForFail.failedChunkIndices.push(failedChunkIndex);
                }
                await this.storage.put(`${failedJobId}:metadata`, currentMetadataForFail);
                console.log(`TTS_DURABLE_OBJECT: Marked chunk ${failedChunkIndex} as failed for job ${failedJobId}.`);
                return new Response('OK', { status: 200 });

            case '/update-status':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId: statusJobId, status: newStatus, details } = await request.json();
                const currentMetadata = await this.storage.get(`${statusJobId}:metadata`);
                if (!currentMetadata) {
                    return new Response('Job metadata not found for status update', { status: 404 });
                }
                currentMetadata.status = newStatus;
                if (details) {
                    currentMetadata.details = details;
                }
                await this.storage.put(`${statusJobId}:metadata`, currentMetadata);
                console.log(`TTS_DURABLE_OBJECT: Updated job ${statusJobId} status to ${newStatus}.`);
                return new Response('OK', { status: 200 });

            case '/retrieve':
                if (request.method !== 'GET') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const retrieveJobId = url.searchParams.get('jobId');
                if (!retrieveJobId) {
                    return new Response('Missing jobId parameter', { status: 400 });
                }

                const metadata = await this.storage.get(`${retrieveJobId}:metadata`);
                if (!metadata) {
                    return new Response('Job metadata not found', { status: 404 });
                }
                
                // Remove chunk fetching and return only metadata
                const job = {
                    jobId: retrieveJobId,
                    totalChunks: metadata.totalChunks,
                    mimeType: metadata.mimeType,
                    status: metadata.status,
                    failedChunkIndices: metadata.failedChunkIndices || [],
                    chunkLengths: metadata.chunkLengths || [],
                    sentenceMapping: metadata.sentenceMapping || [],
                    orchestratorTimeoutMs: metadata.orchestratorTimeoutMs || null
                };

                console.log(`TTS_DURABLE_OBJECT: Retrieved job metadata for ${retrieveJobId}. Status: ${job.status}`);
                return new Response(JSON.stringify(job), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 200
                });

            case '/retrieve-chunk':
                if (request.method !== 'GET') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const retrieveChunkJobId = url.searchParams.get('jobId');
                const retrieveChunkIndex = parseInt(url.searchParams.get('chunkIndex'), 10);
                if (!retrieveChunkJobId || isNaN(retrieveChunkIndex)) {
                    return new Response('Missing or invalid parameters: jobId or chunkIndex', { status: 400 });
                }

                const chunkMetadata = await this.storage.get(`${retrieveChunkJobId}:metadata`);
                if (chunkMetadata && chunkMetadata.failedChunkIndices && chunkMetadata.failedChunkIndices.includes(retrieveChunkIndex)) {
                    console.log(`TTS_DURABLE_OBJECT: Chunk ${retrieveChunkIndex} for job ${retrieveChunkJobId} is permanently failed, returning 410.`);
                    return new Response('Chunk permanently failed', { status: 410 });
                }

                const chunkData = await this.storage.get(`${retrieveChunkJobId}:chunk:${retrieveChunkIndex}`);
                if (chunkData) {
                    console.log(`TTS_DURABLE_OBJECT: Retrieved chunk ${retrieveChunkIndex} for job ${retrieveChunkJobId}.`);
                    return new Response(chunkData, { status: 200 });
                } else {
                    console.log(`TTS_DURABLE_OBJECT: Chunk ${retrieveChunkIndex} for job ${retrieveChunkJobId} not found, returning 202.`);
                    return new Response('Chunk not yet available', { status: 202 });
                }

            case '/delete':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId: deleteJobId } = await request.json();
                const keysToDelete = [`${deleteJobId}:metadata`];
                const deleteMetadata = await this.storage.get(`${deleteJobId}:metadata`);
                if (deleteMetadata && deleteMetadata.totalChunks) {
                    for (let i = 0; i < deleteMetadata.totalChunks; i++) {
                        keysToDelete.push(`${deleteJobId}:chunk:${i}`);
                    }
                }
                await this.storage.delete(keysToDelete);
                console.log(`TTS_DURABLE_OBJECT: Deleted job ${deleteJobId} and its chunks.`);
                return new Response('OK', { status: 200 });

            default:
                return new Response('Not Found', { status: 404 });
        }
    }
}

async function handleTtsInitiate(request, env, backendServices, numSrcWorkers, ctx) {
    if (request.method === 'OPTIONS') {
        return handleOPTIONS();
    }
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!apiKey || apiKey !== env.PASS) {
        throw new HttpError("Authentication required or invalid API key", 401);
    }

    const { text: fullText, voiceId, model, splittingPreference } = await request.json();

    if (!fullText || !voiceId || !model || !splittingPreference) {
        return new Response('Missing required parameters: text, voiceId, model, or splittingPreference', { status: 400 });
    }

    const jobId = crypto.randomUUID();
    console.log(`Orchestrator: New TTS Job ID generated: ${jobId}`);

    const MIN_TEXT_LENGTH_CHARACTER_COUNT = 1;
    const MAX_TEXT_LENGTH_CHARACTER_COUNT = 1500; // This is used for splitting, not a hard limit for backend.

    let sentences;
    let chunkLengths = [];
    let sentenceMapping = []; // Array to store { originalSentenceIndex, chunkIndex }
    let originalSentenceCounter = 0; // Tracks the index of the sentence in the fullText

    console.log(`Orchestrator: Starting text splitting with option: ${splittingPreference}`);
    if (splittingPreference === 'characterCount') {
        const initialSentences = splitIntoSentences(fullText);
        const batchedSentences = [];
        let currentBatch = '';
        let currentBatchCharCount = 0;
        let currentChunkIndex = 0; // This will be the index of the chunk being built

        for (let i = 0; i < initialSentences.length; i++) {
            const sentence = initialSentences[i];
            const sentenceCharCount = getTextCharacterCount(sentence);

            // If adding the current sentence would exceed the max character count for the current chunk
            // AND the current batch is not empty (to avoid creating empty chunks)
            if (currentBatchCharCount + sentenceCharCount > MAX_TEXT_LENGTH_CHARACTER_COUNT && currentBatch.length > 0) {
                // Finalize the current batch as a chunk
                batchedSentences.push(currentBatch.trim());
                chunkLengths.push(currentBatchCharCount);
                currentChunkIndex++; // Move to the next chunk for the new batch
                currentBatch = ''; // Reset batch
                currentBatchCharCount = 0;
            }

            // If the sentence itself is too long, it forms its own chunk
            if (sentenceCharCount > MAX_TEXT_LENGTH_CHARACTER_COUNT) {
                batchedSentences.push(sentence.trim());
                chunkLengths.push(sentenceCharCount);
                sentenceMapping.push({ originalSentenceIndex: originalSentenceCounter, chunkIndex: currentChunkIndex });
                currentChunkIndex++; // Move to the next chunk for the subsequent sentences/batches
                currentBatch = ''; // Ensure batch is reset after adding a large sentence as its own chunk
                currentBatchCharCount = 0;
            } else {
                // Add sentence to current batch
                currentBatch += (currentBatch.length > 0 ? ' ' : '') + sentence;
                currentBatchCharCount += sentenceCharCount;
                sentenceMapping.push({ originalSentenceIndex: originalSentenceCounter, chunkIndex: currentChunkIndex });
            }
            originalSentenceCounter++;
        }

        // Push any remaining content in the last batch
        if (currentBatch.length > 0) {
            batchedSentences.push(currentBatch.trim());
            chunkLengths.push(currentBatchCharCount);
            // No need to update sentenceMapping here, as it was already pushed for each sentence.
        }

        sentences = batchedSentences;
        console.log(`Orchestrator: Using 'Sentence by Character Count' splitting. Text split into ${sentences.length} batches with max length ${MAX_TEXT_LENGTH_CHARACTER_COUNT}.`);
    } else if (splittingPreference === 'none') {
        sentences = [fullText];
        chunkLengths = [getTextCharacterCount(fullText)];
        // For 'none' splitting, all original sentences map to chunk 0
        splitIntoSentences(fullText).forEach((_, idx) => {
            sentenceMapping.push({ originalSentenceIndex: idx, chunkIndex: 0 });
        });
        console.log("Orchestrator: Using 'No Splitting' option. Text will be sent as a single block.");
    } else { // Default: 'sentence' splitting
        sentences = splitIntoSentences(fullText);
        chunkLengths = sentences.map(s => getTextCharacterCount(s));
        // For 'sentence' splitting, each original sentence maps to its own chunk
        sentences.forEach((_, idx) => {
            sentenceMapping.push({ originalSentenceIndex: idx, chunkIndex: idx });
        });
        console.log(`Orchestrator: Using 'Sentence by Sentence' splitting. Text split into ${sentences.length} sentences.`);
    }

    const totalChunks = sentences.length;
    const expectedMimeType = 'audio/L16;rate=24000';

    const id = env.TTS_JOBS.idFromName(jobId);
    const stub = env.TTS_JOBS.get(id);

// Calculate overallOrchestratorTimeoutMs based on the max character count of all chunks
    const maxCharacterCount = chunkLengths.length > 0 ? Math.max(...chunkLengths) : 0;
    const backendCalculatedTimeoutForMax = Math.min(5000 + (maxCharacterCount * 35), 70000);
    const overallOrchestratorTimeoutMs = Math.min(backendCalculatedTimeoutForMax + 5000, 75000);
    const storeMetadataResponse = await stub.fetch(new Request("https://dummy-url/store-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jobId,
            totalChunks,
            mimeType: expectedMimeType,
            status: 'processing',
            chunkLengths,
            sentenceMapping, // Include sentenceMapping
            orchestratorTimeoutMs: overallOrchestratorTimeoutMs // Include overall timeout
        })
    }));

    if (!storeMetadataResponse.ok) {
        console.error(`Orchestrator: Failed to store TTS job metadata ${jobId} in Durable Object: ${await storeMetadataResponse.text()}`);
        return new Response('Failed to initiate TTS job: could not store metadata.', { status: 500 });
    }

    ctx.waitUntil(
        (async () => {
            const chunkPromises = sentences.map(async (sentence, index) => {
                const characterCount = chunkLengths[index]; // Get character count for this specific chunk
                const result = await _callBackendTtsService(sentence, voiceId, model, apiKey, env, backendServices, numSrcWorkers, index, characterCount);

                if (result.success) {
                    const storeChunkResponse = await stub.fetch(new Request("https://dummy-url/store-chunk", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            jobId,
                            chunkIndex: index,
                            audioContentBase64: result.audioContentBase64
                        })
                    }));

                    if (!storeChunkResponse.ok) {
                        console.error(`Orchestrator: Failed to store chunk ${index} for job ${jobId}: ${await storeChunkResponse.text()}`);
                        await stub.fetch(new Request("https://dummy-url/mark-chunk-failed", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ jobId, chunkIndex: index })
                        }));
                        return { index, status: 'failed', error: `Failed to store chunk: ${await storeChunkResponse.text()}` };
                    }
                    return { index, status: 'fulfilled', audioContentBase64: result.audioContentBase64, mimeType: result.mimeType, timeoutMs: result.timeoutMs };
                } else {
                    console.error(`Orchestrator: Error generating chunk ${index} for job ${jobId}: ${result.errorMessage}`);
                    await stub.fetch(new Request("https://dummy-url/mark-chunk-failed", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ jobId, chunkIndex: index })
                    }));
                    return { index, status: 'failed', error: result.errorMessage };
                }
            });

            const results = await Promise.all(chunkPromises); // Use Promise.all since _callBackendTtsService now returns structured result


            const successfulChunks = results.filter(r => r.status === 'fulfilled');
            const failedChunks = results.filter(r => r.status === 'failed');

            let overallStatus;
            let statusDetails = null;

            if (successfulChunks.length === totalChunks) {
                overallStatus = 'complete';
                console.log(`Orchestrator: All chunks for job ${jobId} completed successfully.`);
            } else if (successfulChunks.length > 0 && failedChunks.length > 0) {
                overallStatus = 'partial_success';
                statusDetails = `Successfully processed ${successfulChunks.length} chunks, ${failedChunks.length} chunks failed.`;
                console.warn(`Orchestrator: Job ${jobId} completed with partial success. ${statusDetails}`);
            } else {
                overallStatus = 'failed';
                statusDetails = `All ${failedChunks.length} chunks failed.`;
                console.error(`Orchestrator: All chunks for job ${jobId} failed.`);
            }

            await stub.fetch(new Request("https://dummy-url/update-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jobId,
                    status: overallStatus,
                    details: statusDetails
                })
            }));
        })()
    );

    return new Response(JSON.stringify({ jobId, totalChunks, expectedMimeType, chunkLengths, sentenceMapping, orchestratorTimeoutMs: overallOrchestratorTimeoutMs }), { // Include sentenceMapping and overall timeout in response
        headers: { 'Content-Type': 'application/json' },
        status: 200
    });
}
