import { WorkerEntrypoint } from "cloudflare:workers";
import { BackendWorkerInterface } from "../../src/interfaces";

export default class BackendWorker extends WorkerEntrypoint
  implements BackendWorkerInterface {

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const workerName = self.name;
    console.log(`Backend Worker ${workerName} received request for path: ${url.pathname}`);
    return new Response(`Hello from Backend Worker: ${workerName} (path: ${url.pathname})`);
  }

  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    return this.handleRequest(request);
  }
}