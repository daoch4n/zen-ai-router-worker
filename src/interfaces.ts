// src/interfaces.ts (to be placed in orchestrator-worker/src/ and backend-worker-template/src/)

export interface BackendWorkerInterface {
  // The orchestrator will forward the entire Request object
  handleRequest(request: Request): Promise<Response>;
  // Add other methods if backend workers expose more specific RPC functionality
}