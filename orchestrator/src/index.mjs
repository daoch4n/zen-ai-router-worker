import { RouterCounter } from './routerCounter.mjs';
export { RouterCounter };

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    console.log(`Orchestrator: Incoming request: ${request.method} ${request.url}`);
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

    const id = env.ROUTER_COUNTER.idFromName("global-router-counter");
    const stub = env.ROUTER_COUNTER.get(id);
    const currentCounterResponse = await stub.fetch("https://dummy-url/increment");
    const currentCounter = parseInt(await currentCounterResponse.text());
    console.log(`Orchestrator: Current counter value: ${currentCounter}`);

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
}