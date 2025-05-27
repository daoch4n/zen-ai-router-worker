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

    const targetWorkerIndex = Math.floor(Math.random() * numSrcWorkers);
    const targetService = backendServices[targetWorkerIndex];
    console.log(`Orchestrator: Routing to worker index: ${targetWorkerIndex}`);

    if (!targetService) {
      console.log("Orchestrator: Failed to select target worker for routing.");
      return new Response("Failed to select target worker for routing.", { status: 500 });
    }

    try {
      const response = await targetService.fetch(request);
      console.log(`Orchestrator: Response status from target worker: ${response.status}`);
      return response;
    } catch (error) {
      console.error("Orchestrator: Failed to fetch from target service:", error);
      return new Response("Service Unavailable: Target worker failed or is unreachable.", { status: 503 });
    }
  }
}