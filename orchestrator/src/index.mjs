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

const MIN_TEXT_LENGTH_TOKEN_COUNT = 1;
const MAX_TEXT_LENGTH_TOKEN_COUNT = 1500;

let sentences;
console.log(`Orchestrator: Starting text splitting with option: ${splitting}`);
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
            console.log(`Orchestrator: Sentence too long (${sentenceLength} chars), sent as single batch.`);
        } else if (currentBatchLength + sentenceLength > MAX_TEXT_LENGTH_TOKEN_COUNT) {
            // If adding the current sentence exceeds the limit, push the current batch
            batchedSentences.push(currentBatch.trim());
            currentBatch = sentence;
            currentBatchLength = sentenceLength;
            console.log(`Orchestrator: Batch full, starting new batch for sentence.`);
        } else {
            // Otherwise, add to the current batch
            currentBatch += (currentBatch.length > 0 ? ' ' : '') + sentence;
            currentBatchLength += sentenceLength;
            console.log(`Orchestrator: Added sentence to current batch. Current batch length: ${currentBatchLength}`);
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



const MAX_CONCURRENT_SENTENCE_FETCHES = 5;
const MAX_RETRIES = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
let activeFetches = 0;
let fetchQueue = [];
const sentenceFetchPromises = sentences.map((sentence, index) => {
    const originalIndex = index + jobCurrentSentenceIndex;
    return new Promise((resolve, reject) => {
        fetchQueue.push({ sentence, index: originalIndex, resolve, reject });
        console.log(`Orchestrator: Added sentence ${originalIndex} to fetch queue. Queue size: ${fetchQueue.length}`);
    });
});

const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
const encoder = new TextEncoder();

const sendSseMessage = (data, event = 'message') => {
    let message = `event: ${event}\n`;
    message += `id: ${data.index}\n`;
    message += `data: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(message));
    console.log(`Orchestrator: SSE message sent for index ${data.index}, event: ${event}`);
};


const outstandingPromises = new Set();

const processQueue = async () => {
    console.log(`Orchestrator: Processing queue. Active fetches: ${activeFetches}, Queue size: ${fetchQueue.length}`);
    while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT_SENTENCE_FETCHES) {
        const { sentence, index, resolve, reject } = fetchQueue.shift();
        activeFetches++;
        console.log(`Orchestrator: Starting fetch for sentence ${index}. Active fetches: ${activeFetches}`);

        const currentPromise = (async () => {
            const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
            const stub = env.ROUTER_COUNTER.get(id);
            const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
            const currentCounter = parseInt(await currentCounterResponse.text());

            const targetWorkerIndex = currentCounter % numSrcWorkers;
            const targetService = backendServices[targetWorkerIndex];
            console.log(`Orchestrator: Sentence ${index} - Selected targetWorkerIndex: ${targetWorkerIndex}, targetService: ${targetService}`);

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
                                backendTtsUrl.pathname = '/api/rawtts'; // Corrected path for backend worker
                                // Pass voiceId as voiceName in URL query parameters
                                backendTtsUrl.searchParams.set('voiceName', voiceId);
                                // Clear other search parameters if needed, or explicitly set only required ones
                                // backendTtsUrl.search = `voiceName=${encodeURIComponent(voiceId)}`;

                                console.log(`Orchestrator: Sentence ${index} - Backend TTS URL: ${backendTtsUrl.toString()}`);
                                console.log(`Orchestrator: Sentence ${index} - API Key being sent to backend: ${apiKey ? 'Present' : 'Missing'}`);
                                 const headersToSend = {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${apiKey}`
                                 };
                                 console.log(`Orchestrator: Sentence ${index} - Headers sent to backend: ${JSON.stringify(headersToSend)}`);
                                 const response = await targetService.fetch(new Request(backendTtsUrl.toString(), {
                                    method: 'POST',
                                    headers: headersToSend,
                                    body: JSON.stringify({
                                        text: sentence.trim(),
                                        model: DEFAULT_TTS_MODEL // Pass the default model name
                                    }),
                                }));
                        
                        console.log(`Orchestrator: Sentence ${index} - Response status from backend: ${response.status}`);

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
                            console.log(`Orchestrator: Sentence ${index} - Successfully received audio data from backend.`);
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
            console.log(`Orchestrator: Fetch for sentence ${index} completed. Active fetches: ${activeFetches}`);
            outstandingPromises.delete(currentPromise);
            processQueue();
        });

        currentPromise.then(resolve, reject);
    }
};

processQueue();

Promise.allSettled(sentenceFetchPromises).then(() => {
    console.log("Orchestrator: All sentence fetch promises settled. Sending end event to SSE.");
    writer.write(encoder.encode('event: end\ndata: \n\n'));
    writer.close();
});

const responseOptions = fixCors({
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        status: 200
    });
    return new Response(readable, responseOptions);
}
