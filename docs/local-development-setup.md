# Local Development Setup

This document provides instructions on how to set up and run the Cloudflare Workers locally using `wrangler`.

## Prerequisites

*   Node.js (LTS recommended)
*   npm or yarn
*   Cloudflare `wrangler` CLI installed globally (`npm i -g wrangler`)

## 1. Clone the Repository

```bash
git clone <repository-url>
cd zen-ai-router-worker # Or your project root directory
```

## 2. Install Dependencies

Install the root `package.json` dependencies:

```bash
npm install
# or
yarn install
```

## 3. Run Backend Workers Locally

You can run multiple instances of the backend worker locally. Each instance will need to be run in a separate terminal.

### Example: Running Backend Worker 1

Open a new terminal and navigate to the project root:

```bash
cd backend-worker-template
wrangler dev --local --port 8081 --name backend-worker-1
```

This will run `backend-worker-1` on `http://localhost:8081`.

### Example: Running Backend Worker 2

Open another terminal and navigate to the project root:

```bash
cd backend-worker-template
wrangler dev --local --port 8082 --name backend-worker-2
```

This will run `backend-worker-2` on `http://localhost:8082`.

**Note:** You can run as many backend workers as needed, ensuring each uses a unique `--port` and `--name` (e.g., `backend-worker-3` on port 8083, and so on). The name `backend-worker-{number}` is crucial for the orchestrator to bind to them correctly.

## 4. Run Orchestrator Worker Locally

The orchestrator worker needs to be configured to connect to the *locally running* backend workers. This is done by placing service binding configurations in `orchestrator-worker/.dev.vars` and then running `wrangler dev`.

1.  **Create/Update `orchestrator-worker/.dev.vars`:**
    In the `orchestrator-worker/` directory, create a file named `.dev.vars`. This file will define local environment variables for your service bindings. For example, if you are running `backend-worker-1` and `backend-worker-2` locally, your `.dev.vars` file would look like this:

    ```
    # orchestrator-worker/.dev.vars
    BACKEND_SERVICE_1=backend-worker-1
    BACKEND_SERVICE_2=backend-worker-2
    # Add more entries (e.g., BACKEND_SERVICE_3=backend-worker-3) for each backend worker you are running locally.
    ```

    Ensure the values (`backend-worker-1`, `backend-worker-2`, etc.) match the `--name` you used when starting your backend workers.

2.  **Run the Orchestrator Worker:**
    Open a new terminal and navigate to the `orchestrator-worker/` directory:

    ```bash
    cd orchestrator-worker
    wrangler dev --local --port 8080
    ```

    **Explanation:**
    *   `wrangler dev --local --port 8080`: Runs the orchestrator worker locally on port 8080.
    *   `wrangler` automatically reads the `.dev.vars` file in the current directory and creates the necessary local service bindings, allowing the orchestrator to discover and communicate with your locally running backend workers.

This will run the `router-orchestrator` on `http://localhost:8080`. You can then send requests to this endpoint, and the orchestrator will load balance them across your locally running backend workers.

## 5. Testing Locally

Once both orchestrator and backend workers are running:

1.  Send a request to the orchestrator:
    ```bash
    curl http://localhost:8080
    ```
2.  Observe the logs in the terminals where your backend workers are running. You should see requests being distributed in a round-robin fashion.

**Troubleshooting:**
*   Ensure unique ports for each worker.
*   Verify that the `--name` used for backend workers in `wrangler dev` matches the names in the `--service` flags for the orchestrator.
*   Check terminal logs for any errors.