# Dynamic Worker Deployment and Operational Procedures

This document outlines the dynamic deployment process for `src` workers, including API key management, the CI/CD workflow, how the `orchestrator` binds to workers, and simplifiedpreview deployments. It also covers key operational considerations such as API key security, error handling, observability, and cost implications.

## 1. Architecture Overview

The system is designed to dynamically scale `src` workers based on the number ofavailable API keys. For production deployments, an `orchestrator` worker routes requests to these `src` workers using a stateless random selection. For pull request (PR) previews, a single `src` worker handles all requests directly.```mermaid
graph TD
    subgraph Production Deployment
        A[GitHub Actions Workflow] --> B{Calculate num_src_workers};
        B --> C[Loop: Deploy src-worker-0 to src-worker-N];
        C -- Pass 8 API Keys (KEY1..KEY8) --> D[src-worker-0];
        C -- Pass 8 API Keys (KEY1..KEY8) --> E[src-worker-1];
        C -- Pass 8 API Keys (KEY1..KEY8) --> F[src-worker-N];
        C --> G{Generate orchestrator/wrangler.toml};
        G--> H[Deploy orchestrator Worker];
        H -- Service Bindings --> D;
        H -- Service Bindings --> E;
        H -- Service Bindings --> F;
        I[Client Request] --> J(orchestrator Worker);
        J -- Randomly Select --> L(Selected src-worker-X);
        L -- Process Request --> M[External Gemini API];
        M -- Response --> L;
        L -- Response --> J;J -- Response --> I;
    end

    subgraph PR Preview Deployment
        P[GitHub Actions Workflow (PR)] --> Q{Collect All API Keys};
        Q -- Pass All API Keys (KEY1..KEYN) --> R[Single src-worker-preview];
        S[Client Request] --> R;
        R -- Process Request --> M;
    end
```

## 2. CI/CD Workflow (`.github/workflows/cf-deploy.yml`)

The `cf-deploy.yml` GitHub Actions workflow automates the deployment of `src` workers and the `orchestrator`.

### 2.1. API Key CollectionAll available API keys (named `KEY1`, `KEY2`, etc., stored as GitHub Secrets) are collected into a single output for use in subsequent deployment steps.

### 2.2. Dynamic `src` Worker Deployment (Production)

For production deployments, the workflow dynamically calculates the number of `src` workers required based on the total API keys (8 keys per worker). Each `src` worker is deployed with a unique name (e.g., `zen-ai-router-worker-0`, `zen-ai-router-worker-1`) and its assigned subset of 8 API keys injected as environment variables (`KEY1` through `KEY8`).

### 2.3. `orchestrator` `wrangler.toml` Generation (Production)

After `src` workers are deployed, the workflow generates the `orchestrator/wrangler.toml` file. This file includes service bindings foreach deployed `src` worker (e.g., `BACKEND_SERVICE_0`, `BACKEND_SERVICE_1`), allowing the `orchestrator` to communicate with them.

### 2.4. Simplified `src` Worker Deployment (PR Preview)

For pull request preview environments, a single `src` worker is deployed. This worker receives *all* available API keys as environment variables (`KEY1` through `KEYN`). The `orchestrator` worker is *not* deployed in preview environments, simplifying the setup for testing.

### 2.5. Environment Cleanup (PR Preview)

The `cleanup_preview` job in the workflow is responsible for deleting thesingle `src` worker deployed for PR previews when the pull request is closed, ensuring resource management.

## 3. Worker Naming and API Key Management

### 3.1. `src` Worker Naming

Production `src` workers are named `zen-ai-router-worker-N`, where `N` is an incremental index. Preview `src` workers are named `zen-ai-router-worker-preview-PR_NUMBER`.### 3.2. API Key Injection

API keys are securely stored as GitHub Secrets. During deployment, they are injected as environment variables into the respective `src` workers. Each production `src` worker receives a subset of 8keys, named `KEY1` to `KEY8` within its environment. The preview `src` worker receives all keys, also named `KEY1` to `KEYN`.

## 4. `orchestrator` Bindingand Routing

### 4.1. Service Bindings

The `orchestrator` worker connects to the `src` workers via Cloudflare Service Bindings. These bindings are dynamically generated in the `orchestrator/wrangler.toml` during the CI/CD process, with each `src` worker exposed as a `BACKEND_SERVICE_N` binding.

### 4.2. Stateless Random Routing

The `orchestrator` implements astateless random routing mechanism. Upon receiving a request, it randomly selects one of the available `BACKEND_SERVICE_N` bindings and forwards the request to the corresponding `src` worker. This ensures load distribution without maintaining session affinity or aglobal counter.

## 5. Operational Considerations

### 5.1. API Key Security

*   **Never hardcode API keys:** All API keys must be stored as GitHub Secrets and accessed via environment variables.
***Least Privilege:** Ensure that workers only have access to the API keys they require.

### 5.2. Error Handling

*   **`orchestrator` Error Handling:** The `orchestrator` should implement robust errorhandling. If a selected `src` worker fails to respond, the `orchestrator` should log the error and return a graceful error to the client. Retries are not part of the stateless random routing strategy.
*   **`src` Worker Error Handling:** `src` workers should handle errors gracefully, providing informative responses and logging details for troubleshooting.

### 5.3. Observability

*   **Logging:** Implement comprehensive logging for both `orchestrator` and `src` workers. Log routing decisions, API key usage, request/response details (excluding sensitive information), and any errors.
*   **Monitoring:** Set up Cloudflare Workers analytics and potentially integrate with external monitoring toolsto track worker performance, latency, error rates, and resource utilization.
*   **Alerting:** Configure alerts for critical errors, high error rates, or performance degradation.

### 5.4. Deployment Complexity

The dynamic deploymentprocess, while powerful, adds significant complexity to the CI/CD pipeline. Thorough testing of the `cf-deploy.yml` workflow is crucial to ensure correct worker provisioning, API key injection, and `orchestrator` binding.### 5.5. Cost Implications

Each deployed `src` worker instance incurs its own Cloudflare Worker costs. The simplified preview deployment (single `src` worker) helps manage costs for non-production environments. Monitor Cloudflare usageto align with budget expectations.

### 5.6. Routing Behavior

The stateless random routing provides a simple and effective way to distribute load. However, it does not guarantee perfectly even distribution over short periods and does not provide session affinity. For use cases requiring strict even distribution or session persistence, a different routing strategy would be necessary.

### 5.7. Upstream Compatibility

The `src` worker's ability to dynamically discover API keys from its environment (`src/utils/auth.mjs`) ensures that its core logic remains compatible with upstream updates, minimizing the need for code changes within the `src` worker itself for deployment variations.

### 5.8. Preview Environment SimplificationThe PR preview environment is intentionally simplified by deploying only a single `src` worker with all keys and omitting the `orchestrator`. This reduces deployment time and resource consumption for non-production testing.