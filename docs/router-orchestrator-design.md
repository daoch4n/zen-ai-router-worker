# Detailed Technical Plan: Router/Orchestrator Cloudflare Worker

This document outlines the detailed technical plan for designing a Cloudflare Worker that acts as a unified endpoint (router/orchestrator) and uses a round-robin strategy to load balance requests across multiple dynamically discovered backend worker deployments.

## 1. Project Structure Recommendation

To maintain clarity, modularity, and independent deployability, a monorepo-like structure is recommended for the orchestrator and backend workers.

```
.
├── .github/
│   └── workflows/
│       └── cf-deploy.yml           # Existing deployment workflow (will be modified)
├── orchestrator-worker/
│   ├── src/
│   │   ├── index.ts                # Orchestrator worker entry point
│   │   └── interfaces.ts           # Shared RPC interfaces
│   └── wrangler.toml               # Orchestrator worker configuration
├── backend-worker-template/
│   ├── src/
│   │   ├── index.ts                # Template for backend worker logic
│   │   └── interfaces.ts           # Shared RPC interfaces (should be identical to orchestrator's)
│   └── wrangler.toml               # Template for backend worker configuration
├── package.json
├── tsconfig.json
└── README.md
```

**Explanation:**
*   `orchestrator-worker/`: Contains the router/orchestrator worker code and configuration.
*   `backend-worker-template/`: This serves as a base for all backend workers. During deployment, this template will be deployed multiple times, each with a unique name derived from the `KEY{num}` secrets.
*   `src/interfaces.ts`: This file will contain the shared TypeScript RPC interfaces, ensuring type safety between the orchestrator and backend workers. It should be a common file or symlinked/copied to both worker directories.

## 2. Dynamic Worker Discovery & Service Binding Configuration

The primary challenge is the dynamic nature of backend workers while Cloudflare's Service Bindings are typically static. The solution involves dynamically generating the service binding arguments during the GitHub Actions deployment of the orchestrator.

**A. Backend Worker Naming:**
The `KEY{num}` secrets, as seen in `cf-deploy.yml`, will directly provide the names for the deployed backend workers (e.g., `KEY1="my-backend-worker-1"`, `KEY2="another-backend-worker"`).

**B. Orchestrator `wrangler.toml` (`orchestrator-worker/wrangler.toml`):**
This file will be minimal and will **not** contain explicit `[[services]]` blocks for each backend worker. These bindings will be injected at deployment time.

```toml
# orchestrator-worker/wrangler.toml
name = "router-orchestrator"
main = "src/index.ts"
compatibility_date = "2024-05-01"

# Service bindings will be dynamically added via GitHub Actions workflow.
# No explicit [[services]] block needed here for backend workers.
```

**C. Dynamic Binding in `cf-deploy.yml` for Orchestrator:**
The existing `cf-deploy.yml` workflow will be modified to first deploy all backend workers, and then, based on the names of those workers, construct the `--service` arguments for the orchestrator worker's deployment.

```yaml
# Partial modification to .github/workflows/cf-deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v4

      - name: Prepare Worker Environment Variables and Deploy Backend Workers
        id: prepare_and_deploy_backends # Add an ID to reference outputs
        run: |
          ORCHESTRATOR_SERVICE_BINDINGS_ARGS=""
          for i in $(seq 1 100); do
            KEY_NAME="KEY${i}"
            KEY_VALUE=$(eval echo "\${{ secrets.${KEY_NAME} }}")
            if [ -z "$KEY_VALUE" ]; then
              break # Stop if a KEY{num} secret is not found
            fi
            echo "Deploying backend worker: $KEY_VALUE"
            # Deploy each backend worker with its dynamic name
            # Assuming 'backend-worker-template' is the base project
            flatpak-spawn --host npx wrangler publish --name "$KEY_VALUE" --compatibility-date 2024-05-01 --main backend-worker-template/src/index.ts
            
            # Construct binding argument for the orchestrator
            # The binding name in the orchestrator will be BACKEND_SERVICE_N (e.g., BACKEND_SERVICE_1)
            # The service name will be the actual deployed worker name (KEY_VALUE)
            ORCHESTRATOR_SERVICE_BINDINGS_ARGS+=" --service BACKEND_SERVICE_${i}=${KEY_VALUE}"
          done
          # Output the generated service binding arguments for the orchestrator
          echo "orchestrator_bindings=${ORCHESTRATOR_SERVICE_BINDINGS_ARGS}" >> $GITHUB_OUTPUT
        env:
          # Ensure CF_API_TOKEN and CF_ACCOUNT_ID are available here
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}

      - name: Deploy Orchestrator Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CF_API_TOKEN }}
          accountId: ${{ secrets.CF_ACCOUNT_ID }}
          # Point to the orchestrator worker's directory
          workingDirectory: orchestrator-worker
          command: |
            publish --name router-orchestrator \
            --main src/index.ts \
            --compatibility-date 2024-05-01 \
            ${{ steps.prepare_and_deploy_backends.outputs.orchestrator_bindings }}
```
This ensures that the orchestrator worker receives the necessary RPC service bindings at deployment time, corresponding to the actual backend workers that have been deployed.

**D. Orchestrator Code (`orchestrator-worker/src/index.ts`):**
The `Env` interface in the orchestrator will explicitly list all possible service bindings. The orchestrator will then dynamically identify which of these bindings are active (i.e., actually provided by the environment).

```typescript
// orchestrator-worker/src/index.ts
import type { BackendWorkerInterface } from "./interfaces";

// Define all possible backend service bindings up to the maximum (100)
// This interface allows TypeScript to recognize the dynamically provided bindings.
interface Env {
  BACKEND_SERVICE_1?: Service<BackendWorkerInterface>;
  BACKEND_SERVICE_2?: Service<BackendWorkerInterface>;
  // ... continue up to BACKEND_SERVICE_100
  // Example: BACKEND_SERVICE_100?: Service<BackendWorkerInterface>;
}

// Global state for active backend services and round-robin index
let activeBackendServices: Service<BackendWorkerInterface>[] = [];
let nextWorkerIndex = 0;

export default {
  // The `scheduled` handler is a good place for one-time initialization
  // that happens at worker startup.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Populate activeBackendServices array once at worker startup
    if (activeBackendServices.length === 0) {
      for (let i = 1; i <= 100; i++) {
        const serviceBindingName = `BACKEND_SERVICE_${i}`;
        // Access the service binding dynamically
        const service = env[serviceBindingName as keyof Env];
        if (service) { // If the binding exists (i.e., KEY{i} was present and deployed)
          activeBackendServices.push(service as Service<BackendWorkerInterface>);
        }
      }
      console.log(`Discovered ${activeBackendServices.length} backend workers.`);
    }
  },

  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Ensure activeBackendServices is populated. If not, try again (e.g., for local dev or first request)
    if (activeBackendServices.length === 0) {
      // This logic duplicates the scheduled handler for robustness, especially in `wrangler dev`
      for (let i = 1; i <= 100; i++) {
        const serviceBindingName = `BACKEND_SERVICE_${i}`;
        const service = env[serviceBindingName as keyof Env];
        if (service) {
          activeBackendServices.push(service as Service<BackendWorkerInterface>);
        }
      }
      if (activeBackendServices.length === 0) {
        return new Response("No backend workers configured or discovered.", { status: 500 });
      }
    }

    // Round-robin selection
    const targetWorker = activeBackendServices[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % activeBackendServices.length;

    try {
      // Forward the original request using RPC
      const response = await targetWorker.handleRequest(request);
      return response;
    } catch (error) {
      console.error(`Error communicating with backend worker ${nextWorkerIndex}:`, error);
      // Fallback to error handling and resilience logic
      return new Response("Internal Server Error during request processing.", { status: 500 });
    }
  }
}
```

## 3. Inter-Worker Communication (RPC Adaptation)

The provided Service Bindings + RPC implementation will be used as the foundation.

**A. Shared RPC Interface (`src/interfaces.ts`):**
This file will define the RPC contract that both the orchestrator and backend workers adhere to. It should be placed in a shared location or duplicated in both worker directories.

```typescript
// src/interfaces.ts (to be placed in orchestrator-worker/src/ and backend-worker-template/src/)

export interface BackendWorkerInterface {
  // The orchestrator will forward the entire Request object
  handleRequest(request: Request): Promise<Response>;
  // Add other methods if backend workers expose more specific RPC functionality
}
```

**B. Backend Worker Implementation (`backend-worker-template/src/index.ts`):**
Each backend worker will implement the `BackendWorkerInterface`.

```typescript
// backend-worker-template/src/index.ts
import { WorkerEntrypoint } from "cloudflare:workers";
import { BackendWorkerInterface } from "./interfaces"; // Path relative to backend-worker-template/src/

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
```

## 4. Round-Robin Load Balancing

The load balancing logic will reside within the orchestrator worker's `fetch` handler.

```mermaid
graph TD
    A[Incoming HTTP Request] --> B{Orchestrator Worker};
    B --> C{Initialize activeBackendServices (once at startup/first request)};
    C --> D{Select next Backend Worker (Round-Robin)};
    D --> E{RPC Call: targetWorker.handleRequest(originalRequest)};
    E --> F[Backend Worker Instance];
    F --> G[Process Request & Generate Response];
    G --> H[Return Response via RPC];
    H --> E;
    E --> I{Orchestrator receives Response};
    I --> J[Return Response to Client];
```

**Implementation Details:**
*   **`activeBackendServices` Array**: This array holds the `Service` bindings to the active backend workers. It's populated dynamically at worker startup.
*   **`nextWorkerIndex` Counter**: A simple counter that cycles through the `activeBackendServices` array to achieve round-robin distribution.
*   **Request Forwarding**: The orchestrator uses the RPC `handleRequest` method to pass the original `Request` object to the selected backend worker. This allows the backend worker to access all aspects of the original request (headers, body, method, URL, etc.).

## 5. Error Handling and Resilience

Robust error handling is crucial for a load balancer.

*   **RPC Call `try...catch`**:
    *   Each RPC call (`await targetWorker.handleRequest(request)`) will be wrapped in a `try...catch` block within the orchestrator's `fetch` handler.
    *   This catches errors related to network issues, RPC failures, or unhandled exceptions from the backend worker.

*   **Retry Mechanism with Failover**:
    *   Upon a failed RPC call, the orchestrator should attempt to retry the request with the *next* available backend worker in the list.
    *   A simple retry loop can be implemented:

    ```typescript
    // Inside orchestrator-worker/src/index.ts fetch handler
    const MAX_ATTEMPTS = activeBackendServices.length; // Max attempts equals number of active workers
    let response: Response | null = null;
    let attempts = 0;

    while (response === null && attempts < MAX_ATTEMPTS) {
        const currentWorkerIndex = (nextWorkerIndex + attempts) % activeBackendServices.length;
        const targetWorker = activeBackendServices[currentWorkerIndex];
        
        try {
            console.log(`Attempting to route to worker index ${currentWorkerIndex}.`);
            response = await targetWorker.handleRequest(request);
        } catch (error) {
            console.error(`Attempt ${attempts + 1} failed for worker at index ${currentWorkerIndex}:`, error);
            attempts++;
            // Optionally: Implement a short delay before retrying
            // await new Promise(resolve => setTimeout(resolve, 50));
        }
    }
    nextWorkerIndex = (nextWorkerIndex + attempts) % activeBackendServices.length; // Update next index for next incoming request

    if (response) {
        return response;
    } else {
        // If all attempts fail
        return new Response("Service Unavailable: All backend workers failed or are unreachable.", { status: 503 });
    }
    ```

*   **Fallback Response:**
    *   If all backend workers are unavailable or all retry attempts fail, the orchestrator will return a descriptive HTTP 503 (Service Unavailable) error to the client.

## 6. Project Structure and Deployment Considerations

The modifications to `cf-deploy.yml` detailed in section 2.C are crucial for the deployment of this dynamic setup.

**A. Backend Worker `wrangler.toml` (`backend-worker-template/wrangler.toml`):**
This file will be minimal as its name and other deployment specifics will be overridden by the GitHub Actions workflow.

```toml
# backend-worker-template/wrangler.toml
main = "src/index.ts"
compatibility_date = "2024-05-01"
# No 'name' field here, as it's set dynamically by the CI/CD.
# No [[services]] bindings needed here as they are the target of RPC calls.
```

**B. GitHub Actions Workflow (`.github/workflows/cf-deploy.yml`):**
The updated workflow will handle:
1.  **Iterative Backend Deployment:** Loop through `KEY{num}` secrets, deploying the `backend-worker-template` for each valid secret, using the secret's value as the worker's name.
2.  **Orchestrator Binding Generation:** Collect the names of the deployed backend workers and format them into `--service` arguments.
3.  **Orchestrator Deployment:** Deploy the `router-orchestrator` worker, passing the dynamically generated `--service` arguments to `wrangler publish`.

**C. Local Development (`wrangler dev`):**
For local development, you will need to manually simulate the deployment environment:
1.  **Start Backend Workers:** In separate terminal instances, run each backend worker with a distinct name:
    `flatpak-spawn --host npx wrangler dev --name my-backend-worker-1 --port 8081`
    `flatpak-spawn --host npx wrangler dev --name my-backend-worker-2 --port 8082`
    (Adjust names and ports as needed for your local setup).
2.  **Start Orchestrator Worker:** In another terminal, start the orchestrator worker, manually providing the service bindings using the `--service` flag:
    `flatpak-spawn --host npx wrangler dev --name router-orchestrator --main orchestrator-worker/src/index.ts --port 8080 --service BACKEND_SERVICE_1=my-backend-worker-1 --service BACKEND_SERVICE_2=my-backend-worker-2`
    (Include all active backend workers you started).