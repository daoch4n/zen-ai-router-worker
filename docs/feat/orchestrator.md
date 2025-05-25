# Project Summary: Cloudflare AI Router/Orchestrator

## Introduction

This project implements a Cloudflare Router/Orchestrator worker designed to dynamically load balance incoming AI model inference requests across multiple backend workers. It leverages Cloudflare Service Bindings for seamless inter-worker communication and RPC for efficient data exchange. The primary goal is to provide a robust, scalable, and highly available system for routing AI workloads.

## Architecture

The project comprises two main types of Cloudflare Workers:

*   **`router-orchestrator` Worker**: This acts as the central entry point. It's responsible for discovering available backend workers, applying load balancing logic (e.g., Round-Robin), and forwarding requests to the appropriate backend. It also handles advanced error handling and retries.
*   **`backend-worker-template` Workers**: These are individual workers that host the actual AI model inference logic. They receive requests from the orchestrator, process them, and return responses. Multiple instances of this worker type can be deployed to handle increased load.

Communication between the `router-orchestrator` and `backend-worker-template` workers is facilitated by:

*   **Cloudflare Service Bindings**: These allow workers to invoke other workers directly, providing a secure and efficient communication channel without exposing backend workers to the public internet.
*   **RPC (Remote Procedure Call)**: Used over service bindings for structured inter-worker communication, enabling the orchestrator to call specific functions on backend workers.

## Key Features

*   **Dynamic Backend Worker Discovery and Configuration**: The orchestrator can dynamically discover and configure backend workers, allowing for flexible scaling and management without manual updates to the orchestrator's code.
*   **Round-Robin Load Balancing**: Requests are distributed among available backend workers using a Round-Robin strategy to ensure even load distribution.
*   **Advanced Error Handling with Retries and Failover**: The orchestrator is equipped with sophisticated error handling mechanisms, including automatic retries to alternative backend workers and failover strategies to maintain service availability in case of backend failures.
*   **Automated Deployment via GitHub Actions**: The entire deployment process is automated using GitHub Actions. This includes:
    *   Dynamic deployment of `backend-worker-template` instances.
    *   Automatic generation and updating of service bindings for the `router-orchestrator` worker, ensuring it always knows about the latest backend workers.

## Project Structure

The project follows a monorepo structure, organizing related components:

*   `orchestrator-worker/`: Contains the source code and configuration for the `router-orchestrator` worker.
*   `backend-worker-template/`: Contains the source code and configuration for the `backend-worker-template` worker, designed to be easily replicated.
*   `src/interfaces.ts`: Defines shared TypeScript interfaces and types used across both worker types, ensuring consistent data structures.
*   `.github/workflows/`: Houses the GitHub Actions workflow definitions, primarily `cf-deploy.yml`, which manages the automated deployment.

## Local Development

For detailed instructions on setting up and running the project locally, please refer to the `docs/local-development-setup.md` file. This document covers prerequisites, environment configuration, and steps to run both the orchestrator and backend workers for local testing.

## Deployment

The deployment of the Cloudflare Workers is managed through a GitHub Actions workflow defined in `.github/workflows/cf-deploy.yml`. This workflow automates the following key steps:

1.  **Backend Worker Deployment**: Multiple instances of the `backend-worker-template` are deployed as separate Cloudflare Workers.
2.  **Service Binding Generation**: The workflow dynamically generates and updates the necessary Cloudflare Service Bindings in the `router-orchestrator` worker's configuration, linking it to the newly deployed backend workers.
3.  **Orchestrator Deployment**: The `router-orchestrator` worker is then deployed with its updated bindings.

This automated process ensures that the orchestrator is always correctly configured to communicate with its dynamic backends.

## Future Work/Next Steps

A key area for future development is the implementation of comprehensive end-to-end testing (Task 17). This will involve creating robust test suites to validate the entire system, from request ingress through load balancing and backend processing, to ensure the reliability and performance of the router/orchestrator.