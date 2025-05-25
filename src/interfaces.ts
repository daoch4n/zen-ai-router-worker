export interface BackendWorkerInterface {
  handleRequest(request: Request): Promise<Response>;
}