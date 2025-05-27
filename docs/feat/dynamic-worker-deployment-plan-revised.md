# Revised Plan: Dynamic `src` Worker Deployment with Stateless Random Routing (Optimized Previews)

**Overall Goal:** To dynamically deploy `src` workers based on the total number of available API keys (one `src` worker per 8 keys) for production, and enable the `orchestrator` worker to route incoming requests to these `src` workers using a stateless random selection mechanism. For PR deploy previews, a single `src` worker will be deployed with all API keys, without an `orchestrator`. Each `src` worker will be responsible for its assigned subset of API keys (production) or all API keys (preview), which it will automatically discover from its environment without any code modifications.

**Assumptions:**

*   API keys are named `KEY1`, `KEY2`, ..., `KEYN` and are stored as GitHub Secrets.
*   The existing `.github/workflows/cf-deploy.yml` can successfully read all `KEY` secrets.
*   The `src` worker (`src/worker.mjs` and its imported utilities) is already capable of dynamically discovering API keys named `KEYN` from its environment variables.

**High-Level Architecture:**

The system will consist of:
1.  A CI/CD pipeline (`.github/workflows/cf-deploy.yml`) that dynamically calculates the number of `src` workers needed, deploys each `src` worker with a unique name and its assigned 8 API keys (using the `KEYN` naming convention), and then generates and deploys the `orchestrator` worker with service bindings to all deployed `src` workers for **production deployments**.
2.  For **PR deploy previews**, the CI/CD pipeline will deploy a *single* `src` worker with *all* available API keys, and *no* `orchestrator` worker.
3.  An `orchestrator` worker (production only) that uses a stateless random selection algorithm to route incoming requests to one of the available `src` workers via service bindings.
4.  Multiple `src` workers (production) or a single `src` worker (preview), handling requests for their specific set of API keys, dynamically discovered from their environment.

```mermaid
graph TD
    subgraph Production Deployment
        A[GitHub Actions Workflow] --> B{Calculate num_src_workers};
        B --> C[Loop: Deploy src-worker-0 to src-worker-N];
        C -- Pass 8 API Keys (KEY1..KEY8) --> D[src-worker-0];
        C -- Pass 8 API Keys (KEY1..KEY8) --> E[src-worker-1];
        C -- Pass 8 API Keys (KEY1..KEY8) --> F[src-worker-N];
        C --> G{Generate orchestrator/wrangler.toml};
        G --> H[Deploy orchestrator Worker];
        H -- Service Bindings --> D;
        H -- Service Bindings --> E;
        H -- Service Bindings --> F;
        I[Client Request] --> J(orchestrator Worker);
        J -- Randomly Select --> L(Selected src-worker-X);
        L -- Process Request --> M[External Gemini API];
        M -- Response --> L;
        L -- Response --> J;
        J -- Response --> I;
    end

    subgraph PR Preview Deployment
        P[GitHub Actions Workflow (PR)] --> Q{Collect All API Keys};
        Q -- Pass All API Keys (KEY1..KEYN) --> R[Single src-worker-preview];
        S[Client Request] --> R;
        R -- Process Request --> M;
    end
```

---

### Detailed Plan

**I. `.github/workflows/cf-deploy.yml` Modifications**

The goal here is to automate the deployment of multiple `src` workers and configure the `orchestrator` to bind to them for production, and simplify preview deployments.

1.  **A. Prepare and Group API Keys (Common Step):**
    *   **Action:** Modify the `Prepare Worker Environment Variables` step in both the `deploy` and `deploy_preview` jobs to collect all available `KEY` secrets into a single, structured output.
    *   **Implementation Detail:** Collect all `KEY_VALUE`s into a delimited string and set it as a GitHub Actions output.
    *   **Example (Conceptual):**
        ```yaml
        - name: Collect All API Keys
          id: api_keys_collection
          run: |
            ALL_KEYS=""
            for i in $(seq 1 100); do
              KEY_NAME="KEY${i}"
              KEY_VALUE=$(eval echo "\${{ secrets.${KEY_NAME} }}")
              if [ -n "$KEY_VALUE" ]; then
                ALL_KEYS="${ALL_KEYS}${KEY_VALUE},"
              fi
            done
            echo "all_api_keys=${ALL_KEYS%,}" >> $GITHUB_OUTPUT # Remove trailing comma
            echo "all_api_keys_count=${#API_KEYS[@]}" >> $GITHUB_OUTPUT # Output count for later use
        ```

2.  **B. Dynamic `src` Worker Deployment Loop (Production `deploy` job):**
    *   **Action:** Introduce a new step (or modify an existing one) in the `deploy` job to loop through the collected API keys, group them into sets of 8, and deploy a `src` worker for each set.
    *   **Implementation Detail:**
        *   Retrieve `steps.api_keys_collection.outputs.all_api_keys` and `all_api_keys_count`.
        *   Split the string into an array of individual keys.
        *   Calculate `num_src_workers = ceil(total_keys / 8)`.
        *   Use a `for` loop to iterate.
        *   Inside the loop:
            *   Define `worker_name = "zen-ai-router-worker-${i}"`.
            *   Extract the 8 API keys (or fewer for the last worker) for the current `i`th worker.
            *   When passing `vars` to the `src` worker, name them `KEY1`, `KEY2`, ..., `KEY8` (or `KEYN` as appropriate for the subset).
            *   Use `cloudflare/wrangler-action@v3` to deploy the `src` worker. Pass the extracted 8 keys as `vars` in the `with` block.
            *   The `src` worker's `wrangler.toml` should remain generic.
    *   **Example (Conceptual `deploy` job step):**
        ```yaml
        - name: Deploy Dynamic src Workers (Production)
          run: |
            IFS=',' read -r -a API_KEYS <<< "${{ steps.api_keys_collection.outputs.all_api_keys }}"
            TOTAL_KEYS=${{ steps.api_keys_collection.outputs.all_api_keys_count }}
            KEYS_PER_WORKER=8
            NUM_WORKERS=$(( (TOTAL_KEYS + KEYS_PER_WORKER - 1) / KEYS_PER_WORKER ))

            for i in $(seq 0 $((NUM_WORKERS - 1))); do
              WORKER_NAME="zen-ai-router-worker-${i}"
              START_INDEX=$((i * KEYS_PER_WORKER))
              END_INDEX=$((START_INDEX + KEYS_PER_WORKER - 1))
              
              WORKER_VARS=""
              CURRENT_WORKER_KEY_INDEX=1 # Start from 1 for KEY1, KEY2, etc.
              for j in $(seq ${START_INDEX} ${END_INDEX}); do
                if [ -n "${API_KEYS[j]}" ]; then
                  WORKER_VARS="${WORKER_VARS} --var KEY${CURRENT_WORKER_KEY_INDEX}:${API_KEYS[j]}"
                  CURRENT_WORKER_KEY_INDEX=$((CURRENT_WORKER_KEY_INDEX + 1))
                fi
              done

              echo "Deploying ${WORKER_NAME} with keys from index ${START_INDEX} to ${END_INDEX}"
              flatpak-spawn --host wrangler deploy --name "${WORKER_NAME}" \
                --compatibility-date "2024-05-01" \
                --main "src/worker.mjs" \
                ${WORKER_VARS}
            done
          env:
            CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
            CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        ```

3.  **C. Dynamic `orchestrator` `wrangler.toml` Generation (Production `deploy` job):**
    *   **Action:** Create a new step *after* the `src` workers are deployed but *before* `deploy-orchestrator` job. This step will generate the `orchestrator/wrangler.toml` file with all necessary service bindings, *excluding* Durable Object configurations.
    *   **Implementation Detail:**
        *   Use the `NUM_WORKERS` calculated in the previous step.
        *   Generate the `wrangler.toml` content, including the `name`, `main`, `compatibility_date`, and then loop to add `[[services]]` blocks for each `src` worker.
    *   **Example (Conceptual):**
        ```yaml
        - name: Generate Orchestrator Wrangler Config (Production)
          run: |
            TOTAL_KEYS=${{ steps.api_keys_collection.outputs.all_api_keys_count }}
            KEYS_PER_WORKER=8
            NUM_WORKERS=$(( (TOTAL_KEYS + KEYS_PER_WORKER - 1) / KEYS_PER_WORKER ))

            CONFIG_CONTENT="name = \"router-orchestrator\"\n"
            CONFIG_CONTENT+="main = \"src/index.mjs\"\n"
            CONFIG_CONTENT+="compatibility_date = \"2024-05-01\"\n\n"

            for i in $(seq 0 $((NUM_WORKERS - 1))); do
              CONFIG_CONTENT+="[[services]]\n"
              CONFIG_CONTENT+="binding = \"BACKEND_SERVICE_${i}\"\n"
              CONFIG_CONTENT+="service = \"zen-ai-router-worker-${i}\"\n\n"
            done

            echo -e "$CONFIG_CONTENT" > orchestrator/wrangler.toml
        ```
    *   **Note:** The `deploy-orchestrator` job will then use this newly generated `orchestrator/wrangler.toml`.

4.  **D. Deploy Single `src` Worker for PR Preview (`deploy_preview` job):**
    *   **Action:** Modify the `deploy_preview` job to deploy a *single* `src` worker for the preview environment, injecting *all* collected API keys into its environment. The `orchestrator` will *not* be deployed for previews.
    *   **Implementation Detail:**
        *   Retrieve `steps.api_keys_collection.outputs.all_api_keys` (assuming `api_keys_collection` is run in `deploy_preview` as well).
        *   Define a single `worker_name` for the preview (e.g., `zen-ai-router-worker-preview-${{ github.event.pull_request.number }}`).
        *   Pass *all* API keys as `KEY1`, `KEY2`, ..., `KEYN` environment variables to this single worker.
        *   Use `cloudflare/wrangler-action@v3` to deploy.
    *   **Example (Conceptual `deploy_preview` job step):**
        ```yaml
        - name: Deploy Single src Worker for PR Preview
          if: github.event_name == 'pull_request' # Ensure this runs only for PRs
          run: |
            IFS=',' read -r -a API_KEYS <<< "${{ steps.api_keys_collection.outputs.all_api_keys }}"
            
            WORKER_NAME="zen-ai-router-worker-preview-${{ github.event.pull_request.number }}"
            
            WORKER_VARS=""
            CURRENT_KEY_INDEX=1
            for j in "${!API_KEYS[@]}"; do # Iterate over array indices
              if [ -n "${API_KEYS[j]}" ]; then
                WORKER_VARS="${WORKER_VARS} --var KEY${CURRENT_KEY_INDEX}:${API_KEYS[j]}"
                CURRENT_KEY_INDEX=$((CURRENT_KEY_INDEX + 1))
              fi
            done

            echo "Deploying preview worker ${WORKER_NAME} with all collected keys"
            flatpak-spawn --host wrangler deploy --name "${WORKER_NAME}" \
              --compatibility-date "2024-05-01" \
              --main "src/worker.mjs" \
              ${WORKER_VARS}
          env:
            CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
            CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        ```

5.  **E. Cleanup for Preview Environments (`cleanup_preview` job):**
    *   **Action:** Update the `cleanup_preview` job to delete the single dynamically deployed `src` worker for the preview. It will no longer need to delete an `orchestrator` for previews.
    *   **Implementation Detail:** This will require using `wrangler delete --name <preview-worker-name> --force`.
    *   **Example (Conceptual `cleanup_preview` job step):**
        ```yaml
        - name: Delete Preview src Worker
          run: |
            WORKER_NAME="zen-ai-router-worker-preview-${{ github.event.pull_request.number }}"
            echo "Deleting preview worker ${WORKER_NAME}"
            flatpak-spawn --host wrangler delete --name "${WORKER_NAME}" --force
          env:
            CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
            CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
        ```

**II. `orchestrator` Codebase Modifications**

The `orchestrator` needs to be updated to implement the stateless random routing logic for worker selection. These changes apply only to the production `orchestrator` deployment.

1.  **A. Remove Durable Object Setup:**
    *   Delete the file `orchestrator/src/routerCounter.mjs`.
    *   Remove any imports or references to `RouterCounter` from `orchestrator/src/index.mjs`.

2.  **B. Dynamic Service Binding Discovery:**
    *   **Action:** In `orchestrator/src/index.mjs`, dynamically discover all `BACKEND_SERVICE_N` bindings from the `env` object.
    *   **Implementation Detail:**
        ```javascript
        // Inside orchestrator/src/index.mjs fetch function
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
          return new Response("No backend workers configured.", { status: 500 });
        }
        ```

3.  **C. Stateless Random Routing Logic:**
    *   **Action:** Implement the stateless random routing logic.
    *   **Implementation Detail:**
        ```javascript
        // Inside orchestrator/src/index.mjs fetch function, after backendServices discovery
        const targetWorkerIndex = Math.floor(Math.random() * numSrcWorkers);
        const targetService = backendServices[targetWorkerIndex];

        if (!targetService) {
          return new Response("Failed to select target worker for routing.", { status: 500 });
        }

        // Forward the original request to the selected src worker
        return targetService.fetch(request);
        ```
    *   **Note:** This approach provides *random load distribution*. Each request will be routed to a randomly selected `src` worker.

**III. `src` Worker Modifications**

*   **No code modifications are required for `src/worker.mjs` or its utility files.** The existing `getRandomApiKey` function in [`src/utils/auth.mjs`](src/utils/auth.mjs:33) is already capable of discovering API keys named `KEYN` from the environment.

**IV. Key Considerations for Architect**

1.  **API Key Security:** Reiterate that API keys must be securely stored as GitHub Secrets and never hardcoded or exposed in logs.
2.  **Error Handling and Retries:** Implement robust error handling in the `orchestrator`. If a `targetService.fetch(request)` fails, consider logging the error and potentially returning a graceful error to the client. Retries would introduce state, so they are not included in this stateless plan.
3.  **Observability:** Set up logging and monitoring for both the `orchestrator` and individual `src` workers. Track routing decisions and `src` worker performance.
4.  **Deployment Complexity:** Acknowledge that this dynamic deployment adds significant complexity to the CI/CD pipeline. Thorough testing of the deployment workflow is crucial.
5.  **Cost Implications:** Each `src` worker deployment is a separate Cloudflare Worker, incurring its own costs. Ensure this aligns with budget expectations. The simplified preview deployment will help manage costs for non-production environments.
6.  **Routing Behavior:** The stateless random routing approach provides simple load distribution. It does not guarantee even distribution over short periods, nor does it ensure that the same client always hits the same backend worker. If session affinity or more even distribution is required, a different strategy (like consistent hashing or a stateful counter) would be necessary.
7.  **Upstream Compatibility:** By leveraging the existing API key discovery mechanism in `src/utils/auth.mjs`, the `src` worker's core logic remains untouched, ensuring maximum compatibility with upstream updates.
8.  **Preview Environment Simplification:** The PR preview environment is significantly simplified by deploying only a single `src` worker with all keys, removing the `orchestrator` dependency for non-production testing.