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

  const { text, voiceId, apiKey } = await request.json();

  if (!text || !voiceId || !apiKey) {
    return new Response('Missing required parameters: text, voiceId, or apiKey', { status: 400 });
  }

  const optimizedText = optimizeTextForJson(text);
  const sentences = splitIntoSentences(optimizedText);
  console.log(`Orchestrator: Text optimized and split into ${sentences.length} sentences.`);

  const MAX_CONCURRENT_SENTENCE_FETCHES = 5; // Define a reasonable concurrency limit
  const MAX_RETRIES = 3;
  const RETRY_INITIAL_DELAY_MS = 1000; // 1 second
  let activeFetches = 0;
  let fetchQueue = [];
  const sentenceFetchPromises = sentences.map((sentence, index) => {
    return new Promise((resolve, reject) => {
      fetchQueue.push({ sentence, index, resolve, reject });
    });
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendSseMessage = (data, event = 'message') => {
    let message = `event: ${event}\n`;
    message += `id: ${data.index}\n`; // Add id field
    message += `data: ${JSON.stringify(data)}\n\n`;
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

        if (!targetService) {
          const errMsg = "Failed to select target worker.";
          console.error(`Orchestrator: ${errMsg} for sentence ${index}.`);
          sendSseMessage({ index, message: `Synthesis failed for sentence ${index}: ${errMsg}`, audioContentBase64: null }, 'error');
          return { index, error: errMsg, audioContentBase64: null };
        }

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

              // Retry on server errors (5xx) or specific transient errors (e.g., 429 for rate limiting)
              if (response.status >= 500 || response.status === 429) {
                console.warn(`Orchestrator: Backend error for sentence ${index}, attempt ${attempts + 1}/${MAX_RETRIES + 1}. Retrying... Error: ${rawErrorMessage}`);
                attempts++;
                if (attempts <= MAX_RETRIES) {
                  await new Promise(res => setTimeout(res, delay));
                  delay *= 2; // Exponential backoff
                  continue; // Go to next attempt
                }
              }
              // If not retried or max retries reached, signal error and return
              const finalErrMsg = `Backend Error: ${rawErrorMessage}`;
              console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}`);
              sendSseMessage({ index, message: `Synthesis failed for sentence ${index}: ${finalErrMsg}`, audioContentBase64: null }, 'error');
              return { index, error: finalErrMsg, audioContentBase64: null };
            } else {
              const data = await response.json();
              const audioChunk = data.audioContentBase64;
              sendSseMessage({ audioChunk, index, mimeType: "audio/opus" });
              return { index, audioContentBase64: audioChunk, error: null };
            }
          } catch (e) {
            // Catch network errors, timeouts, etc.
            console.warn(`Orchestrator: Fetch error for sentence ${index}, attempt ${attempts + 1}/${MAX_RETRIES + 1}. Retrying... Error: ${e.message}`);
            attempts++;
            if (attempts <= MAX_RETRIES) {
              await new Promise(res => setTimeout(res, delay));
              delay *= 2; // Exponential backoff
              continue; // Go to next attempt
            }
            // If not retried or max retries reached, signal error and return
            const finalErrMsg = `Fetch Exception: ${e.message}`;
            console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}:`, e);
            sendSseMessage({ index, message: `Synthesis failed for sentence ${index}: ${finalErrMsg}`, audioContentBase64: null }, 'error');
            return { index, error: finalErrMsg, audioContentBase64: null };
          }
        }
        // This line should ideally not be reached if MAX_RETRIES logic is correct
        // but as a failsafe, ensure an error is sent if all retries somehow fail without explicit return.
        const finalErrMsg = `All retry attempts failed.`;
        console.error(`Orchestrator: ${finalErrMsg} for sentence ${index}.`);
        sendSseMessage({ index, message: `Synthesis failed for sentence ${index}: ${finalErrMsg}`, audioContentBase64: null }, 'error');
        return { index, error: finalErrMsg, audioContentBase64: null };
      })();
      outstandingPromises.add(currentPromise);
      currentPromise.then(resolve, reject); // Resolve/reject the original promise
      // Initial call to processQueue needs to be outside the loop that populates sentenceFetchPromises
      // It is handled by the initial processQueue call after setting up sentenceFetchPromises
    }
  };

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
