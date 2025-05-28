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

  const sentenceFetchPromises = [];
  const MAX_CONCURRENT_SENTENCE_FETCHES = 5; // Define a reasonable concurrency limit
  let activeFetches = 0;
  let fetchQueue = [];

  const processQueue = async () => {
    while (fetchQueue.length > 0 && activeFetches < MAX_CONCURRENT_SENTENCE_FETCHES) {
      const { sentence, index, resolve, reject } = fetchQueue.shift();
      activeFetches++;

      const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
      const stub = env.ROUTER_COUNTER.get(id);
      const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
      const currentCounter = parseInt(await currentCounterResponse.text());

      const targetWorkerIndex = currentCounter % numSrcWorkers;
      const targetService = backendServices[targetWorkerIndex];

      if (!targetService) {
        console.error(`Orchestrator: Failed to select target worker for sentence ${index}.`);
        activeFetches--;
        resolve({ index, error: "Failed to select target worker.", audioContentBase64: null });
        processQueue();
        continue;
      }

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
          let errorMessage = `HTTP error Status ${response.status}`;
          try {
            errorData = await response.json();
            errorMessage = errorData.error?.message || errorData.message || errorMessage;
          } catch (e) {
            errorMessage = await response.text() || errorMessage;
          }
          console.error(`Orchestrator: Backend error for sentence ${index}: ${errorMessage}`);
          resolve({ index, error: `Backend Error: ${errorMessage}`, audioContentBase64: null });
        } else {
          const data = await response.json();
          resolve({ index, audioContentBase64: data.audioContentBase64, error: null });
        }
      } catch (e) {
        console.error(`Orchestrator: Fetch error for sentence ${index}:`, e);
        resolve({ index, error: `Fetch Exception: ${e.message}`, audioContentBase64: null });
      } finally {
        activeFetches--;
        processQueue();
      }
    }
  };

  sentences.forEach((sentence, index) => {
    sentenceFetchPromises.push(new Promise((resolve, reject) => {
      fetchQueue.push({ sentence, index, resolve, reject });
    }));
  });

  // Start processing the queue
  for (let i = 0; i < MAX_CONCURRENT_SENTENCE_FETCHES; i++) {
    processQueue();
  }

  const results = await Promise.allSettled(sentenceFetchPromises);

  const combinedAudioBlobs = new Map();
  const errors = [];

  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value.audioContentBase64 !== null) {
      combinedAudioBlobs.set(result.value.index, result.value.audioContentBase64);
    } else if (result.status === 'fulfilled' && result.value.error) {
      errors.push(`Sentence ${result.value.index}: ${result.value.error}`);
    } else if (result.status === 'rejected') {
      errors.push(`Sentence processing failed: ${result.reason}`);
    }
  });

  const orderedAudioContent = Array.from({ length: sentences.length }, (_, i) => combinedAudioBlobs.get(i) || '')
    .filter(Boolean)
    .join('');

  if (orderedAudioContent.length === 0) {
    const errorMessage = errors.length > 0 ? errors.join('; ') : "No audio could be generated for the provided text.";
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Return the combined audio blob. SSE streaming will be implemented in a later task.
  return new Response(JSON.stringify({
    message: `Successfully processed and combined audio for ${combinedAudioBlobs.size} of ${sentences.length} sentences.`,
    audioContentBase64: orderedAudioContent,
    totalSentences: sentences.length,
    processedSentences: combinedAudioBlobs.size,
    errors: errors.length > 0 ? errors : undefined,
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  });
}
