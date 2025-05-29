import { RouterCounter } from './routerCounter.mjs';
import { splitIntoSentences, optimizeTextForJson } from './utils/textProcessing.mjs';
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

    if (url.pathname === '/api/tts') {
      return handleTtsRequest(request, env, backendServices, numSrcWorkers);
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

async function handleTtsRequest(request, env, backendServices, numSrcWorkers) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { text, voiceId, apiKey } = await request.json();
    if (!text || !voiceId || !apiKey) {
      return new Response('Missing required parameters: text, voiceId, or apiKey', { status: 400 });
    }
  } catch (error) {
    console.error('Orchestrator: Error parsing request body:', error);
    return new Response('Invalid JSON in request body', { status: 400 });
  }

const url = new URL(request.url);
let jobId = url.searchParams.get('jobId'); // Check for jobId in URL

if (!jobId) {
    // Generate a new jobId if not provided
    jobId = crypto.randomUUID();
    console.log(`Orchestrator: New TTS Job ID generated: ${jobId}`);
} else {
    console.log(`Orchestrator: Resuming TTS Job ID: ${jobId}`);
}

const ttsStateId = env.TTS_STATE_DO.idFromName(jobId);
const ttsStateStub = env.TTS_STATE_DO.get(ttsStateId);

let jobCurrentSentenceIndex = 0; // Use a distinct variable name to avoid conflict
let jobAudioChunks = []; // Use a distinct variable name to avoid conflict
let jobAlreadyInitialised = false;

try {
    const stateResponse = await ttsStateStub.fetch(new Request("https://dummy-url/get-state"));
    if (stateResponse.ok) {
        const state = await stateResponse.json();
        if (state && state.initialised) { // Check state.initialised from the DO
            jobCurrentSentenceIndex = state.currentSentenceIndex;
            jobAudioChunks = state.audioChunks;
            jobAlreadyInitialised = state.initialised; // Set based on DO's state
            console.log(`Orchestrator: Loaded state for job ${jobId}. Resuming from sentence ${jobCurrentSentenceIndex}.`);
        }
    }
} catch (error) {
    console.warn(`Orchestrator: Could not retrieve state for job ${jobId}. Assuming new job or state corrupted. Error: ${error.message}`);
}

if (!jobAlreadyInitialised) {
    try {
        const initResponse = await ttsStateStub.fetch(new Request("https://dummy-url/initialize", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voiceId })
        }));
        if (!initResponse.ok) {
            console.error(`Orchestrator: Failed to initialize Durable Object for job ${jobId}: ${await initResponse.text()}`);
            return new Response("Failed to initialize TTS job state.", { status: 500 });
        }
        console.log(`Orchestrator: Durable Object initialized for job ${jobId}.`);
    } catch (error) {
        console.error(`Orchestrator: Error initializing Durable Object for job ${jobId}: ${error.message}`);
        return new Response("Error initializing TTS job state.", { status: 500 });
    }
}

const optimizedText = optimizeTextForJson(text);
let sentences = splitIntoSentences(optimizedText);
console.log(`Orchestrator: Text optimized and split into ${sentences.length} sentences.`);

// Adjust sentences and audioChunks if resuming
if (jobCurrentSentenceIndex > 0 && jobCurrentSentenceIndex < sentences.length) {
    console.log(`Orchestrator: Resuming from sentence index ${jobCurrentSentenceIndex}`);
    // Prepend already synthesized audio chunks to the stream
    for (let i = 0; i < jobCurrentSentenceIndex; i++) {
        if (jobAudioChunks[i]) {
            sendSseMessage({ audioChunk: jobAudioChunks[i], index: i, mimeType: "audio/opus" });
        }
    }
    sentences = sentences.slice(jobCurrentSentenceIndex);
}

const MAX_CONCURRENT_SENTENCE_FETCHES = 5; // Define a reasonable concurrency limit
const MAX_RETRIES = 3;
const RETRY_INITIAL_DELAY_MS = 1000; // 1 second
let activeFetches = 0;
let fetchQueue = [];
const sentenceFetchPromises = sentences.map((sentence, index) => {
    // Adjust index for original sentence position
    const originalIndex = index + jobCurrentSentenceIndex;
    return new Promise((resolve, reject) => {
        fetchQueue.push({ sentence, index: originalIndex, resolve, reject });
    });
});

const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
const encoder = new TextEncoder();
// Update sendSseMessage to include jobId
const sendSseMessage = (data, event = 'message') => {
    let message = `event: ${event}\n`;
    message += `id: ${data.index}\n`; // Add id field
    message += `data: ${JSON.stringify({ ...data, jobId })}\n\n`; // Include jobId in data
    writer.write(encoder.encode(message));
};

// Update sendSseMessage to include jobId


const outstandingPromises = new Set();

const processQueue = async () => {
    while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT_SENTENCE_FETCHES) {
        const { sentence, index, resolve, reject } = fetchQueue.shift();
        activeFetches++;

        const currentPromise = (async () => {
            const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
            const stub = env.ROUTER_COUNTER.get(id);
            const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
            const currentCounter = parseInt(await currentCounterResponse.text());

            const targetWorkerIndex = currentCounter % numSrcWorkers;
            const targetService = backendServices[targetWorkerIndex];

            let result = { index, audioContentBase64: null, error: null };
            let finalErrMsg = null;

            if (!targetService) {
                finalErrMsg = "Failed to select target worker.";
                console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}.`);
                result.error = finalErrMsg;
            } else {
                let attempts = 0;
                let delay = RETRY_INITIAL_DELAY_MS;

                while (attempts <= MAX_RETRIES) {
                    try {
                        const response = await targetService.fetch(new Request(request.url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${apiKey}`
                            },
                            body: JSON.stringify({ text: sentence.trim(), voiceId }),
                        }));

                        if (!response.ok) {
                            let errorData;
                            let rawErrorMessage = `HTTP error Status ${response.status}`;
                            try {
                                errorData = await response.json();
                                rawErrorMessage = errorData.error?.message || errorData.message || rawErrorMessage;
                            } catch (e) {
                                rawErrorMessage = await response.text() || rawErrorMessage;
                            }

                            if (response.status >= 500 || response.status === 429) {
                                console.warn(`Orchestrator: Backend error for sentence ${index}, attempt ${attempts + 1}/${MAX_RETRIES + 1}. Retrying... Error: ${rawErrorMessage}`);
                                attempts++;
                                if (attempts <= MAX_RETRIES) {
                                    await new Promise(res => setTimeout(res, delay));
                                    delay *= 2; // Exponential backoff
                                    continue; // Go to next attempt
                                }
                            }
                            finalErrMsg = `Backend Error: ${rawErrorMessage}`;
                            console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}`);
                            result.error = finalErrMsg;
                        } else {
                            const data = await response.json();
                            result.audioContentBase64 = data.audioContentBase64;
                            result.error = null; // Clear error on success
                        }
                        break; // Exit retry loop on success or non-retryable error
                    } catch (e) {
                        finalErrMsg = `Fetch Exception: ${e.message}`;
                        console.warn(`Orchestrator: Fetch error for sentence ${index}, attempt ${attempts + 1}/${MAX_RETRIES + 1}. Retrying... Error: ${e.message}`);
                        attempts++;
                        if (attempts <= MAX_RETRIES) {
                            await new Promise(res => setTimeout(res, delay));
                            delay *= 2; // Exponential backoff
                            continue; // Go to next attempt
                        }
                        console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}:`, e);
                        result.error = finalErrMsg;
                        break; // Exit retry loop if max retries reached
                    }
                }
            }

            // Always update Durable Object state with progress or error before sending SSE and returning
            await ttsStateStub.fetch(new Request("https://dummy-url/update-progress", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sentenceIndex: index,
                    audioChunkBase64: result.audioContentBase64,
                    error: result.error // Pass error status
                })
            }));

            if (result.error) {
                sendSseMessage({ index, message: `Synthesis failed for sentence ${index}: ${result.error}`, audioContentBase64: null }, 'error');
            } else {
                sendSseMessage({ audioChunk: result.audioContentBase64, index, mimeType: "audio/opus" });
            }
            return result; // Resolve the promise with the final result
        })();
        outstandingPromises.add(currentPromise);
        outstandingPromises.add(currentPromise);
        currentPromise.finally(() => {
            activeFetches--; // Decrement when promise settles
            outstandingPromises.delete(currentPromise);
            processQueue(); // Attempt to process more from the queue
        });

        currentPromise.then(resolve, reject); // Resolve/reject the original promise
    }
};

// Start processing the queue after initial setup
processQueue();

// Ensure all promises are settled before closing the stream
Promise.allSettled(sentenceFetchPromises).then(() => {
    writer.write(encoder.encode('event: end\ndata: \n\n'));
    writer.close();
});

return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    status: 200
});
}
