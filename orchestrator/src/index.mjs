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
    if (url.pathname === '/api/tts-stream') {
        if (request.method === 'OPTIONS') {
            return handleOPTIONS();
        }
        if (request.method !== 'GET') {
            return new Response('Method Not Allowed', { status: 405 });
        }
        const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');
        console.log(`Orchestrator: API Key received for /api/tts-stream: ${apiKey ? 'Present' : 'Missing'}`);
        if (!apiKey) {
            throw new HttpError("API key is required", 401);
        }
        if (apiKey !== env.PASS) {
            throw new HttpError("Bad credentials - wrong api key for orchestrator", 401);
        }
        // If authenticated, delegate to handleTtsRequest which handles streaming
        return handleTtsRequest(request, env, backendServices, numSrcWorkers, url);
    }

    if (url.pathname === '/api/rawtts') {
      return handleTtsRequest(request, env, backendServices, numSrcWorkers, url);
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

async function handleTtsRequest(request, env, backendServices, numSrcWorkers, url) {
  if (request.method !== 'GET') {
if (request.method === 'OPTIONS') {
    return handleOPTIONS();
  }
    return new Response('Method Not Allowed', { status: 405 });
  }

  const text = url.searchParams.get('text');
  const voiceId = url.searchParams.get('voiceId');
  const splitting = url.searchParams.get('splitting');
  const apiKey = request.headers.get('Authorization')?.replace('Bearer ', '');

  console.log(`Orchestrator: handleTtsRequest - text: ${text ? 'Present' : 'Missing'}, voiceId: ${voiceId ? 'Present' : 'Missing'}, splitting: ${splitting || 'default'}, apiKey: ${apiKey ? 'Present' : 'Missing'}`);

  if (!text || !voiceId || !apiKey) {
    console.log("Orchestrator: handleTtsRequest - Missing required parameters.");
    return new Response('Missing required parameters: text, voiceId, or apiKey', { status: 400 });
  }

const jobId = crypto.randomUUID();
console.log(`Orchestrator: New TTS Job ID generated: ${jobId}`);

const jobId = crypto.randomUUID();
console.log(`Orchestrator: New TTS Job ID generated: ${jobId}`);

// Durable Object setup
if (!env.TTS_JOB_DO) {
    console.error("Orchestrator: TTS_JOB_DO is not bound.");
    throw new HttpError("TTS service misconfigured (DO not bound)", 500);
}
const doId = env.TTS_JOB_DO.idFromName(jobId);
const doStub = env.TTS_JOB_DO.get(doId);

// R2 Bucket check
if (!env.TTS_AUDIO_BUCKET) {
    console.error("Orchestrator: TTS_AUDIO_BUCKET is not bound.");
    // Optionally inform DO to mark job as failed
    // Consider: await doStub.fetch(`https://do-placeholder/tts-job/${jobId}/update-status`, { method: 'POST', body: JSON.stringify({ status: 'failed', errorMessage: 'TTS_AUDIO_BUCKET not bound' }) });
    throw new HttpError("TTS service misconfigured (R2 bucket not bound)", 500);
}

const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
const encoder = new TextEncoder();
const responseOptions = fixCors({
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        status: 200
    });

// Initialize Job with Durable Object
console.log(`Orchestrator: Initializing job ${jobId} with DO.`);
const initResponse = await doStub.fetch(`https://do-placeholder/tts-job/${jobId}/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        jobId,
        text,
        voiceId,
        model: DEFAULT_TTS_MODEL,
        splittingPreference: splitting
    }),
});

if (!initResponse.ok) {
    const errorData = await initResponse.text();
    console.error(`Orchestrator: Failed to initialize job with DO ${jobId}. Status: ${initResponse.status}. Error: ${errorData}`);
    // No writer.close() or readable stream response if init fails before stream starts properly.
    throw new HttpError(`Failed to initialize TTS job: ${errorData}`, initResponse.status);
}

const initResult = await initResponse.json();
const totalSentences = initResult.totalSentences;
console.log(`Orchestrator: Job ${jobId} initialized by DO. Total sentences: ${totalSentences}`);

if (totalSentences === 0) {
    console.log(`Orchestrator: Job ${jobId} has no sentences. Sending end event immediately.`);
    writer.write(encoder.encode('event: end\ndata: \n\n'));
    writer.close();
    return new Response(readable, responseOptions);
}

const sendSseMessage = (data, event = 'message') => {
    let message = `event: ${event}\n`;
    // SSE 'id' should be unique for each message if possible, or related to the chunk index
    message += `id: ${jobId}-${data.index || Date.now()}\n`;
    message += `data: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(message));
    console.log(`Orchestrator: SSE message sent for job ${jobId}, index ${data.index}, event: ${event}`);
};


const MAX_CONCURRENT_SENTENCE_FETCHES = 5;
const MAX_RETRIES = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
let activeFetches = 0;
let successfullyStreamedSentenceCount = 0;
let jobCompletedSuccessfully = false; // Flag to prevent processing after job end

// Helper for DO URL
const getDoUrl = (action, queryParams = "") => `https://do-placeholder/tts-job/${jobId}/${action}${queryParams}`;

const processSentenceTask = async () => {
    if (jobCompletedSuccessfully || successfullyStreamedSentenceCount >= totalSentences) {
        return; // All sentences processed or job ended
    }

    console.log(`Orchestrator: Job ${jobId} - Attempting to fetch next sentence from DO. Active fetches: ${activeFetches}`);
    let nextSentenceData;
    try {
        const nextSentenceResponse = await doStub.fetch(getDoUrl('next-sentence'));
        if (!nextSentenceResponse.ok) {
            const errorText = await nextSentenceResponse.text();
            console.error(`Orchestrator: Job ${jobId} - Error fetching next sentence from DO. Status: ${nextSentenceResponse.status}, Error: ${errorText}`);
            // This is a critical error with DO, might need to abort the job.
            // For now, log and stop fetching more sentences for this worker.
            // Consider marking job failed in DO if this persists.
            throw new HttpError(`DO error fetching next sentence: ${errorText}`, nextSentenceResponse.status);
        }
        nextSentenceData = await nextSentenceResponse.json();
    } catch (e) {
        console.error(`Orchestrator: Job ${jobId} - Exception fetching next sentence from DO: ${e.message}`);
        activeFetches--;
        dispatchNextTasks(); // Try to keep other tasks going if possible
        return; // Stop this specific task
    }

    const { sentence, index: sentenceIndex, done } = nextSentenceData;

    if (done) {
        console.log(`Orchestrator: Job ${jobId} - DO indicates no more sentences. Active fetches: ${activeFetches}`);
        // If all active fetches complete and done is true from all, then job is finished.
        // This specific task ends. If activeFetches becomes 0 and all tasks reported 'done', the main loop control will handle job completion.
        return;
    }

    console.log(`Orchestrator: Job ${jobId} - Received sentence ${sentenceIndex} from DO.`);

    try {
        // b. Send to Backend Worker
        const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
        const rcStub = env.ROUTER_COUNTER.get(id);
        const currentCounterResponse = await rcStub.fetch("https://dummy-url/increment");
        const currentCounter = parseInt(await currentCounterResponse.text());
        const targetWorkerIndex = currentCounter % numSrcWorkers;
        const targetService = backendServices[targetWorkerIndex];

        let backendResponseData;
        let r2Key, mimeType;

        if (!targetService) {
            throw new Error("Failed to select target worker.");
        }

        let attempts = 0;
        let lastError = null;
        while (attempts <= MAX_RETRIES) {
            try {
                const backendTtsUrl = new URL(request.url); // Base URL from original request
                backendTtsUrl.pathname = '/api/rawtts';
                backendTtsUrl.searchParams.set('voiceName', voiceId); // voiceId from outer scope

                const headersToSend = { 'Content-Type': 'application/json' };
                console.log(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Sending to backend worker: ${targetService} at ${backendTtsUrl.toString()}`);

                const backendResponse = await targetService.fetch(new Request(backendTtsUrl.toString(), {
                    method: 'POST',
                    headers: headersToSend,
                    body: JSON.stringify({
                        text: sentence.trim(),
                        model: DEFAULT_TTS_MODEL,
                        jobId: jobId,
                        sentenceIndex: sentenceIndex
                    }),
                }));

                if (!backendResponse.ok) {
                    let errorData;
                    let rawErrorMessage = `HTTP error Status ${backendResponse.status}`;
                    try {
                        errorData = await backendResponse.json();
                        rawErrorMessage = errorData.error?.message || errorData.message || rawErrorMessage;
                    } catch (e) {
                        rawErrorMessage = await backendResponse.text() || rawErrorMessage;
                    }
                    lastError = new Error(rawErrorMessage);
                    if (backendResponse.status >= 500 || backendResponse.status === 429) {
                        attempts++;
                        if (attempts <= MAX_RETRIES) {
                            console.warn(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Backend error (attempt ${attempts}/${MAX_RETRIES+1}), retrying. Error: ${rawErrorMessage}`);
                            await new Promise(res => setTimeout(res, RETRY_INITIAL_DELAY_MS * (2 ** (attempts-1)) ));
                            continue;
                        }
                    }
                    throw lastError; // Non-retryable or max retries exceeded
                }
                backendResponseData = await backendResponse.json();
                break; // Success
            } catch (e) {
                lastError = e;
                attempts++;
                 if (attempts <= MAX_RETRIES) {
                    console.warn(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Backend fetch exception (attempt ${attempts}/${MAX_RETRIES+1}), retrying. Error: ${e.message}`);
                    await new Promise(res => setTimeout(res, RETRY_INITIAL_DELAY_MS * (2 ** (attempts-1)) ));
                } else {
                    throw e; // Max retries exceeded
                }
            }
        }

        if (!backendResponseData || !backendResponseData.r2Key) {
             throw new Error(`Backend worker did not return r2Key. Last error: ${lastError?.message}`);
        }

        r2Key = backendResponseData.r2Key;
        mimeType = backendResponseData.mimeType;

        if (backendResponseData.jobId !== jobId || backendResponseData.sentenceIndex !== sentenceIndex) {
            console.warn(`Orchestrator: Job ${jobId} - Mismatch in jobId/sentenceIndex from backend. Expected ${jobId}/${sentenceIndex}, got ${backendResponseData.jobId}/${backendResponseData.sentenceIndex}`);
            // Potentially throw error or handle as critical failure
        }
        console.log(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Received r2Key ${r2Key} from backend.`);

        // c. Inform DO of Processed Sentence
        const markProcessedResponse = await doStub.fetch(getDoUrl('sentence-processed'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: sentenceIndex, r2Key, mimeType }),
        });
        if (!markProcessedResponse.ok) {
            const errorText = await markProcessedResponse.text();
            console.error(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Failed to mark as processed in DO. Status: ${markProcessedResponse.status}, Error: ${errorText}`);
            // This is a significant issue, data in R2 might not be tracked by DO.
            // Consider how to handle this - potentially retry, or flag for reconciliation.
            // For now, proceed to stream if R2 fetch is okay, but log error.
        }
        console.log(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Marked as processed in DO.`);

        // d. Fetch Audio from R2
        const r2Object = await env.TTS_AUDIO_BUCKET.get(r2Key);
        if (!r2Object) {
            throw new Error(`R2 object not found for key ${r2Key}`);
        }
        const audioArrayBuffer = await r2Object.arrayBuffer();

        let binary = '';
        const bytes = new Uint8Array(audioArrayBuffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64AudioChunk = btoa(binary);
        console.log(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Fetched audio from R2 and converted to base64.`);

        // e. Send SSE Message to Client
        sendSseMessage({ audioChunk: base64AudioChunk, index: sentenceIndex, mimeType });
        successfullyStreamedSentenceCount++;

    } catch (error) {
        console.error(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Error in processing task: ${error.message}`, error.stack);
        try {
            await doStub.fetch(getDoUrl('update-status'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'error', errorMessage: `Failed to process sentence ${sentenceIndex}: ${error.message}`, sentenceIndexToFail: sentenceIndex })
            });
        } catch (doError) {
            console.error(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - CRITICAL: Failed to update DO status after task error: ${doError.message}`);
        }
        sendSseMessage({ index: sentenceIndex, error: { message: `Failed to process sentence ${sentenceIndex}: ${error.message}` } }, 'error');
    } finally {
        activeFetches--;
        console.log(`Orchestrator: Job ${jobId}, Sentence ${sentenceIndex} - Task finished. Active fetches: ${activeFetches}. Streamed count: ${successfullyStreamedSentenceCount}/${totalSentences}`);
        // Check for job completion after each task.
        if (successfullyStreamedSentenceCount >= totalSentences && !jobCompletedSuccessfully) {
            jobCompletedSuccessfully = true;
            console.log(`Orchestrator: Job ${jobId} - All ${totalSentences} sentences successfully streamed. Sending end event.`);
            writer.write(encoder.encode('event: end\ndata: \n\n'));
            writer.close();
        } else if (!jobCompletedSuccessfully) {
            dispatchNextTasks(); // Attempt to dispatch more tasks
        }
    }
};

const dispatchNextTasks = () => {
    console.log(`Orchestrator: Job ${jobId} - Dispatching next tasks. Active: ${activeFetches}, Max: ${MAX_CONCURRENT_SENTENCE_FETCHES}, Streamed: ${successfullyStreamedSentenceCount}/${totalSentences}`);
    while (activeFetches < MAX_CONCURRENT_SENTENCE_FETCHES && successfullyStreamedSentenceCount < totalSentences && !jobCompletedSuccessfully) {
        // Check if we expect more sentences. This check is implicitly handled by processSentenceTask's 'done' flag.
        // If 'done' is received consistently and successfullyStreamedSentenceCount < totalSentences, it implies an issue.
        // However, the primary condition is successfullyStreamedSentenceCount.

        // A more robust check here would be to ask DO for job status if many 'done' flags appear before count is met.
        // For now, we rely on successfullyStreamedSentenceCount and totalSentences.

        activeFetches++;
        console.log(`Orchestrator: Job ${jobId} - Incrementing active fetches to ${activeFetches}, starting new task.`);
        processSentenceTask(); // Intentionally not awaited, runs in background
    }

    // If no active fetches are running, and not all sentences were streamed, and job not marked complete,
    // it might mean all available sentences from DO returned 'done' prematurely or tasks failed.
    if (activeFetches === 0 && successfullyStreamedSentenceCount < totalSentences && !jobCompletedSuccessfully) {
        console.warn(`Orchestrator: Job ${jobId} - All tasks finished but not all sentences streamed (${successfullyStreamedSentenceCount}/${totalSentences}). Sending end event.`);
        // This could be due to errors in all tasks or DO prematurely reporting 'done'.
        writer.write(encoder.encode('event: end\ndata: \n\n')); // Ensure stream closes
        writer.close();
        jobCompletedSuccessfully = true; // Mark as ended to prevent further operations
    }
};

// Start the initial dispatch
dispatchNextTasks();

return new Response(readable, responseOptions);
}
