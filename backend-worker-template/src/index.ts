// backend-worker-template/src/index.ts
import { WorkerEntrypoint } from "cloudflare:workers";
import { BackendWorkerInterface } from "../../src/interfaces"; // Path relative to backend-worker-template/src/

export default class BackendWorker extends WorkerEntrypoint
  implements BackendWorkerInterface {

  async handleRequest(request: Request): Promise<Response> {
    // This is where the backend worker processes the forwarded request.
    // It can inspect the request, perform logic, and return a Response.
    const url = new URL(request.url);
    const workerName = self.name; // Get the deployed worker's name
    console.log(`Backend Worker ${workerName} received request for path: ${url.pathname}`);
    return new Response(`Hello from Backend Worker: ${workerName} (path: ${url.pathname})`);
  }

  // The 'fetch' handler is also required for the worker to be deployable and callable directly
  // via HTTP if needed, though RPC will call handleRequest.
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    // For direct HTTP calls, route to handleRequest
    return this.handleRequest(request);
  }
}