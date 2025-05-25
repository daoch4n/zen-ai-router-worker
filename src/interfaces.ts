import { Request, Response } from "cloudflare:workers";

export interface BackendWorkerInterface {
  handleRequest(request: Request): Promise<Response>;
}