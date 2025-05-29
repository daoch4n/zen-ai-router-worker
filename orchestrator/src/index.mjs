import { RouterCounter } from './routerCounter.mjs';
import { fixCors } from '../src/utils/cors.mjs';
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

  if (!text || !voiceId || !apiKey) {
    return new Response('Missing required parameters: text, voiceId, or apiKey', { status: 400 });
  }

let jobId = url.searchParams.get('jobId');

if (!jobId) {
    jobId = crypto.randomUUID();
    console.log(`Orchestrator: New TTS Job ID generated: ${jobId}`);
} else {
    console.log(`Orchestrator: Resuming TTS Job ID: ${jobId}`);
}

const ttsStateId = env.TTS_STATE_DO.idFromName(jobId);
const ttsStateStub = env.TTS_STATE_DO.get(ttsStateId);

let jobCurrentSentenceIndex = 0;
let jobAudioChunks = [];
let jobAlreadyInitialised = false;

try {
    const stateResponse = await ttsStateStub.fetch(new Request("https://dummy-url/get-state"));
    if (stateResponse.ok) {
        const state = await stateResponse.json();
        if (state && state.initialised) {
            jobCurrentSentenceIndex = state.currentSentenceIndex;
            jobAudioChunks = state.audioChunks;
            jobAlreadyInitialised = state.initialised;
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

const MIN_TEXT_LENGTH_TOKEN_COUNT = 1;
const MAX_TEXT_LENGTH_TOKEN_COUNT = 1500;

let sentences;
if (splitting === 'tokenCount') {
    const initialSentences = splitIntoSentences(text);
    const batchedSentences = [];
    let currentBatch = '';
    let currentBatchLength = 0;

    for (const sentence of initialSentences) {
        const sentenceLength = getTextCharacterCount(sentence);

        if (sentenceLength > MAX_TEXT_LENGTH_TOKEN_COUNT) {
            // If a single sentence is too long, send it as its own batch
            if (currentBatch.length > 0) {
                batchedSentences.push(currentBatch.trim());
                currentBatch = '';
                currentBatchLength = 0;
            }
            batchedSentences.push(sentence.trim());
        } else if (currentBatchLength + sentenceLength > MAX_TEXT_LENGTH_TOKEN_COUNT) {
            // If adding the current sentence exceeds the limit, push the current batch
            batchedSentences.push(currentBatch.trim());
            currentBatch = sentence;
            currentBatchLength = sentenceLength;
        } else {
            // Otherwise, add to the current batch
            currentBatch += (currentBatch.length > 0 ? ' ' : '') + sentence;
            currentBatchLength += sentenceLength;
        }
    }

    // Add any remaining batch
    if (currentBatch.length > 0) {
        batchedSentences.push(currentBatch.trim());
    }

    sentences = batchedSentences.filter(s => s.length > 0);
    console.log(`Orchestrator: Using 'Sentence by Token Count' splitting. Text split into ${sentences.length} batches with max length ${MAX_TEXT_LENGTH_TOKEN_COUNT}.`);
} else if (splitting === 'none') {
    sentences = [text];
    console.log("Orchestrator: Using 'No Splitting' option. Text will be sent as a single block.");
} else {
    sentences = splitIntoSentences(text);
    console.log(`Orchestrator: Using 'Sentence by Sentence' splitting. Text split into ${sentences.length} sentences.`);
}

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

const MAX_CONCURRENT_SENTENCE_FETCHES = 5;
const MAX_RETRIES = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
let activeFetches = 0;
let fetchQueue = [];
const sentenceFetchPromises = sentences.map((sentence, index) => {
    const originalIndex = index + jobCurrentSentenceIndex;
    return new Promise((resolve, reject) => {
        fetchQueue.push({ sentence, index: originalIndex, resolve, reject });
    });
});

const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
const encoder = new TextEncoder();

const sendSseMessage = (data, event = 'message') => {
    let message = `event: ${event}\n`;
    message += `id: ${data.index}\n`;
    message += `data: ${JSON.stringify({ ...data, jobId })}\n\n`;
    writer.write(encoder.encode(message));
};


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
                        const backendTtsUrl = new URL(request.url);
                                backendTtsUrl.pathname = '/rawtts';
                                // Pass voiceId as voiceName in URL query parameters
                                backendTtsUrl.searchParams.set('voiceName', voiceId);
                                // Clear other search parameters if needed, or explicitly set only required ones
                                // backendTtsUrl.search = `voiceName=${encodeURIComponent(voiceId)}`;


                                const response = await targetService.fetch(new Request(backendTtsUrl.toString(), {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${apiKey}`
                                    },
                                    body: JSON.stringify({
                                        text: sentence.trim(),
                                        model: DEFAULT_TTS_MODEL // Pass the default model name
                                    }),
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
                                    delay *= 2;
                                    continue;
                                }
                            }
                            finalErrMsg = `Backend Error: ${rawErrorMessage}`;
                            console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}`);
                            result.error = finalErrMsg;
                        } else {
                            const data = await response.json();
                            result.audioContentBase64 = data.audioContentBase64;
                            result.error = null;
                        }
                        break;
                    } catch (e) {
                        finalErrMsg = `Fetch Exception: ${e.message}`;
                        console.warn(`Orchestrator: Fetch error for sentence ${index}, attempt ${attempts + 1}/${MAX_RETRIES + 1}. Retrying... Error: ${e.message}`);
                        attempts++;
                        if (attempts <= MAX_RETRIES) {
                            await new Promise(res => setTimeout(res, delay));
                            delay *= 2;
                            continue;
                        }
                        console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}:`, e);
                        result.error = finalErrMsg;
                        break;
                    }
                }
            }

            await ttsStateStub.fetch(new Request("https://dummy-url/update-progress", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sentenceIndex: index,
                    audioChunkBase64: result.audioContentBase64,
                    error: result.error
                })
            }));

            if (result.error) {
                sendSseMessage({ index, message: `Synthesis failed for sentence ${index}: ${result.error}`, audioContentBase64: null }, 'error');
            } else {
                sendSseMessage({ audioChunk: result.audioContentBase64, index, mimeType: "audio/opus" });
            }
            return result;
        })();
        outstandingPromises.add(currentPromise);
        
        currentPromise.finally(() => {
            activeFetches--;
            outstandingPromises.delete(currentPromise);
            processQueue();
        });

        currentPromise.then(resolve, reject);
    }
};

processQueue();

Promise.allSettled(sentenceFetchPromises).then(() => {
    writer.write(encoder.encode('event: end\ndata: \n\n'));
    writer.close();
});

const responseOptions = fixCors({
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        status: 200
    });
    return new Response(readable, responseOptions);
}
