import { Fetcher, Request, Response, ExecutionContext } from "@cloudflare/workers-types";

// Define all possible backend service bindings up to the maximum (100)
// This interface allows TypeScript to recognize the dynamically provided bindings.
interface Env {
  BACKEND_SERVICE: Fetcher;
}

export default {

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      return await env.BACKEND_SERVICE.fetch(request);
    } catch (error) {
      console.error("Failed to fetch from backend service:", error);
      return new Response("Service Unavailable: Backend worker failed or is unreachable.", { status: 503 });
    }
  }
}