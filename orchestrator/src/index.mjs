import { RouterCounter } from './routerCounter.mjs';
import { fixCors } from './utils/cors.mjs';
import { HttpError } from './utils/error.mjs';
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
      return handleTtsInitiate(request, env, backendServices, numSrcWorkers);
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

      try {
        const response = await targetService.fetch(request);
        console.log(`Orchestrator: Response status from target worker: ${response.status}`);
        return response;
      } catch (error) {
        console.error(`Orchestrator: Error during fetch to target service ${targetService}:`, error);
        return new Response("Service Unavailable: Target worker failed or is unreachable.", { status: 503 });
      }
    }
  },
};

const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts"; // Updated model name

// Constants for polling
const POLLING_MAX_ATTEMPTS = 30; // Max polling attempts
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

    try {
        const { audioContentBase64, mimeType } = await _callBackendTtsService(text, voiceId, model, apiKey, env, backendServices, numSrcWorkers);

        return new Response(JSON.stringify({ audioContentBase64, mimeType }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (e) {
        console.error(`Orchestrator: Error during raw TTS fetch:`, e);
        const status = e instanceof HttpError ? e.status : 500;
        return new Response(`Error processing raw TTS: ${e.message}`, { status: status });
    }
}

/**
 * Polls the backend worker for the TTS result.
 * @param {ServiceWorkerGlobalScope} targetService - The backend worker service.
 * @param {string} jobId - The ID of the TTS job.
 * @param {string} apiKey - The API key for authentication.
 * @returns {Promise<{audioContentBase64: string, mimeType: string}>} The audio content and mime type.
 * @throws {HttpError} If polling fails after max attempts or encounters a non-retryable error.
 */
async function _pollForTtsResult(targetService, jobId, apiKey) {
    const pollingUrl = new URL(`/api/tts-result?jobId=${jobId}`, 'http://placeholder');
    const headersToSend = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    for (let i = 0; i < POLLING_MAX_ATTEMPTS; i++) {
        try {
            console.log(`Orchestrator: Polling for TTS job ${jobId} (attempt ${i + 1}/${POLLING_MAX_ATTEMPTS})...`);
            const response = await targetService.fetch(new Request(pollingUrl.toString(), {
                method: 'GET',
                headers: headersToSend,
            }));

            if (response.status === 200) {
                console.log(`Orchestrator: TTS job ${jobId} completed successfully.`);
                const data = await response.json();
                const mimeType = response.headers.get('Content-Type') || 'audio/L16;rate=24000'; // Default if not provided
                return { audioContentBase64: data.base64Audio, mimeType };
            } else if (response.status === 404) {
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
                // For other errors, we might still retry a few times or immediately fail
                if (i < POLLING_MAX_ATTEMPTS - 1) {
                    await new Promise(resolve => setTimeout(resolve, POLLING_BASE_DELAY_MS));
                } else {
                    throw new HttpError(errorData.message || `Backend error during polling: ${response.status}`, response.status);
                }
            }
        } catch (e) {
            console.error(`Orchestrator: Network error during TTS job ${jobId} polling: ${e.message}`);
            if (i < POLLING_MAX_ATTEMPTS - 1) {
                await new Promise(resolve => setTimeout(resolve, POLLING_BASE_DELAY_MS));
            } else {
                throw new HttpError(`Network error during polling: ${e.message}`, 502);
            }
        }
    }
    throw new HttpError(`TTS job ${jobId} timed out after ${POLLING_MAX_ATTEMPTS} attempts.`, 504);
}

async function _callBackendTtsService(text, voiceId, model, apiKey, env, backendServices, numSrcWorkers) {
    const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
    const stub = env.ROUTER_COUNTER.get(id);
    const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
    const currentCounter = parseInt(await currentCounterResponse.text());

    const targetWorkerIndex = currentCounter % numSrcWorkers;
    const targetService = backendServices[targetWorkerIndex];

    if (!targetService) {
        throw new HttpError("Failed to select target worker.", 500);
    }

    const backendTtsUrl = new URL('/api/rawtts', 'http://placeholder'); // Base URL for backend rawtts endpoint
    
    const headersToSend = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const maxRetries = 3; // Maximum number of retry attempts for initial request failures
    const baseDelayMs = 100; // Base delay for exponential backoff in milliseconds

    for (let i = 0; i <= maxRetries; i++) {
        try {
            const response = await targetService.fetch(new Request(backendTtsUrl.toString(), {
                method: 'POST',
                headers: headersToSend,
                body: JSON.stringify({
                    text: text.trim(),
                    model: model,
                    voiceId: voiceId
                }),
            }));

            if (response.status === 202) {
                console.log(`Orchestrator: Backend worker accepted TTS job. Initiating polling.`);
                const responseData = await response.json();
                const jobId = responseData.jobId || response.headers.get('X-Processing-Job-Id');
                if (!jobId) {
                    throw new HttpError("202 response missing jobId", 500);
                }
                return await _pollForTtsResult(targetService, jobId, apiKey);
            } else if (!response.ok) {
                // Check for retryable status codes (e.g., 429 Too Many Requests, 5xx Server Errors)
                // For this task, we'll consider all non-2xx (except 202) as retryable for simplicity
                if (i < maxRetries) {
                    const delay = Math.pow(2, i) * baseDelayMs;
                    console.warn(`Orchestrator: Backend TTS fetch failed (status: ${response.status}). Retrying in ${delay}ms (attempt ${i + 1}/${maxRetries}).`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Continue to the next retry attempt
                } else {
                    let errorData;
                    try {
                        errorData = await response.json();
                    } catch (e) {
                        errorData = { message: await response.text() };
                    }
                    throw new HttpError(errorData.message || `Backend error: ${response.status}`, response.status);
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

            return { audioContentBase64: data.audioContentBase64, mimeType: mimeType };

        } catch (e) {
            if (i < maxRetries) {
                const delay = Math.pow(2, i) * baseDelayMs;
                console.warn(`Orchestrator: Error during backend TTS fetch: ${e.message}. Retrying in ${delay}ms (attempt ${i + 1}/${maxRetries}).`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Orchestrator: All retry attempts failed for backend TTS fetch. Last error:`, e);
                throw e; // Re-throw the error to be handled by the caller
            }
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
        return new Response('Missing or invalid parameters: jobId or chunkIndex', { status: 400 });
    }

    try {
        const id = env.TTS_JOBS.idFromName(jobId);
        const stub = env.TTS_JOBS.get(id);

        const retrieveResponse = await stub.fetch(new Request(`https://dummy-url/retrieve?jobId=${jobId}`));

        if (!retrieveResponse.ok) {
            console.error(`Orchestrator: Failed to retrieve TTS job ${jobId} from Durable Object: ${await retrieveResponse.text()}`);
            return new Response('Failed to retrieve TTS job.', { status: retrieveResponse.status });
        }

        const job = await retrieveResponse.json();

        if (!job || !Array.isArray(job.audioChunks) || chunkIndex < 0 || chunkIndex >= job.audioChunks.length) {
            return new Response('Chunk not found or invalid chunkIndex', { status: 404 });
        }

        const audioContentBase64 = job.audioChunks[chunkIndex];
        const mimeType = job.mimeType || 'audio/L16;rate=24000'; // Default to audio/L16;rate=24000 if mimeType is not stored

        return new Response(JSON.stringify({ audioContentBase64, mimeType, index: chunkIndex }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (e) {
        console.error(`Orchestrator: Error handling TTS chunk request:`, e);
        const status = e instanceof HttpError ? e.status : 500;
        return new Response(`Error retrieving TTS chunk: ${e.message}`, { status: status });
    }
}

class TTSJob {
    constructor(jobId, totalChunks, audioChunks, mimeType) {
        this.jobId = jobId;
        this.totalChunks = totalChunks;
        this.audioChunks = audioChunks; // Store base64 encoded audio chunks
        this.mimeType = mimeType; // Store the mimeType
        this.createdAt = Date.now();
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
            case '/store':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId, totalChunks, audioChunks, mimeType } = await request.json();
                // Set a Time To Live (TTL) for the stored TTS job data to ensure automatic cleanup.
                // The TTL is set to 2 hours (7,200,000 milliseconds) to allow for job completion
                // but prevent indefinite storage and accumulation of old data.
                const TTL_IN_MILLISECONDS = 7200000; // 2 hours
                await this.storage.put(jobId, new TTSJob(jobId, totalChunks, audioChunks, mimeType), { expirationTtl: TTL_IN_MILLISECONDS });
                console.log(`TTS_DURABLE_OBJECT: Stored job ${jobId} with ${totalChunks} chunks.`);
                return new Response('OK', { status: 200 });

            case '/retrieve':
                if (request.method !== 'GET') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const retrieveJobId = url.searchParams.get('jobId');
                if (!retrieveJobId) {
                    return new Response('Missing jobId parameter', { status: 400 });
                }
                const job = await this.storage.get(retrieveJobId);
                if (job) {
                    console.log(`TTS_DURABLE_OBJECT: Retrieved job ${retrieveJobId} with ${job.totalChunks} chunks.`);
                    return new Response(JSON.stringify(job), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 200
                    });
                } else { // Corrected: Moved 'Job not found' into an else block
                    return new Response('Job not found', { status: 404 });
                }

            case '/delete':
                if (request.method !== 'POST') {
                    return new Response('Method Not Allowed', { status: 405 });
                }
                const { jobId: deleteJobId } = await request.json(); // Corrected: Destructured jobId
                await this.storage.delete(deleteJobId);
                console.log(`TTS_DURABLE_OBJECT: Deleted job ${deleteJobId}.`);
                return new Response('OK', { status: 200 });

            default:
                return new Response('Not Found', { status: 404 });
        }
    }
}

async function handleTtsInitiate(request, env, backendServices, numSrcWorkers) {
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

// splittingPreference: 'characterCount' uses character count as a proxy for token count
    const { text: fullText, voiceId, model, splittingPreference } = await request.json();

    if (!fullText || !voiceId || !model || !splittingPreference) {
        return new Response('Missing required parameters: text, voiceId, model, or splittingPreference', { status: 400 });
    }

    const jobId = crypto.randomUUID();
    console.log(`Orchestrator: New TTS Job ID generated: ${jobId}`);

    const MIN_TEXT_LENGTH_CHARACTER_COUNT = 1;
    const MAX_TEXT_LENGTH_CHARACTER_COUNT = 1500;

    let sentences;
    console.log(`Orchestrator: Starting text splitting with option: ${splittingPreference}`);
    if (splittingPreference === 'characterCount') {
        const initialSentences = splitIntoSentences(fullText);
        const batchedSentences = [];
        let currentBatch = '';
        let currentBatchLength = 0;

        for (const sentence of initialSentences) {
            const sentenceLength = getTextCharacterCount(sentence);

            if (sentenceLength > MAX_TEXT_LENGTH_CHARACTER_COUNT) {
                if (currentBatch.length > 0) {
                    batchedSentences.push(currentBatch.trim());
                    currentBatch = '';
                    currentBatchLength = 0;
                }
                batchedSentences.push(sentence.trim());
                console.log(`Orchestrator: Sentence too long (${sentenceLength} chars), sent as single batch.`);
            } else if (currentBatchLength + sentenceLength > MAX_TEXT_LENGTH_CHARACTER_COUNT) {
                batchedSentences.push(currentBatch.trim());
                currentBatch = sentence;
                currentBatchLength = sentenceLength;
                console.log(`Orchestrator: Batch full, starting new batch for sentence.`);
            } else {
                currentBatch += (currentBatch.length > 0 ? ' ' : '') + sentence;
                currentBatchLength += sentenceLength;
                console.log(`Orchestrator: Added sentence to current batch. Current batch length: ${currentBatchLength}`);
            }
        }

        if (currentBatch.length > 0) {
            batchedSentences.push(currentBatch.trim());
        }

        sentences = batchedSentences.filter(s => s.length > 0);
        console.log(`Orchestrator: Using 'Sentence by Character Count' splitting (character count used as a proxy for token count). Text split into ${sentences.length} batches with max length ${MAX_TEXT_LENGTH_CHARACTER_COUNT}.`);
    } else if (splittingPreference === 'none') {
        sentences = [fullText];
        console.log("Orchestrator: Using 'No Splitting' option. Text will be sent as a single block.");
    } else {
        sentences = splitIntoSentences(fullText);
        console.log(`Orchestrator: Using 'Sentence by Sentence' splitting. Text split into ${sentences.length} sentences.`);
    }

    const audioChunkPromises = sentences.map(async (sentence, index) => {
        try {
            const { audioContentBase64, mimeType } = await _callBackendTtsService(sentence, voiceId, model, apiKey, env, backendServices, numSrcWorkers);
            return { index, audioContentBase64, mimeType };
        } catch (error) {
            console.error(`Orchestrator: Error generating chunk ${index}:`, error);
            return { index, error: error.message };
        }
    });

    const results = await Promise.allSettled(audioChunkPromises);

    const successfulChunks = results.filter(r => r.status === 'fulfilled' && !r.value.error).map(r => r.value);
    const failedChunks = results.filter(r => r.status === 'rejected' || r.value.error);

    if (failedChunks.length > 0) {
        console.error(`Orchestrator: ${failedChunks.length} chunks failed during TTS initiation.`);
        // Decide how to handle partial failures: either return an error or return successful chunks and log failures
        // For now, let's return an error if any chunk fails.
        return new Response(JSON.stringify({ error: 'Failed to generate all audio chunks.', details: failedChunks }), { status: 500 });
    }

    // Store the generated audio chunks in a Durable Object
    const id = env.TTS_JOBS.idFromName(jobId);
    const stub = env.TTS_JOBS.get(id);

    const storeResponse = await stub.fetch(new Request("https://dummy-url/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jobId,
            totalChunks: successfulChunks.length,
            audioChunks: successfulChunks.sort((a, b) => a.index - b.index).map(c => c.audioContentBase64),
mimeType: successfulChunks[0].mimeType // Assuming all chunks have the same mimeType
        })
    }));

    if (!storeResponse.ok) {
        console.error(`Orchestrator: Failed to store TTS job ${jobId} in Durable Object: ${await storeResponse.text()}`);
        return new Response('Failed to store TTS job.', { status: 500 });
    }

    return new Response(JSON.stringify({ jobId, totalChunks: successfulChunks.length }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
    });
}
