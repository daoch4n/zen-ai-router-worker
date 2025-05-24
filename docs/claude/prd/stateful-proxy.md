Okay, this is an excellent technical analysis. Let's translate this into a detailed and actionable Product Requirements Document (PRD).

---

## Product Requirements Document: Stateful Anthropic API Proxy

**Version:** 1.0
**Date:** October 26, 2023
**Author:** AI Product Manager (based on analysis by Engineering)
**Status:** Proposed

### 1. Introduction

This document outlines the requirements for enhancing our Anthropic API Proxy to support robust, bidirectional tool usage. Currently, the proxy's stateless architecture prevents reliable mapping of Anthropic `tool_result` (identified by `tool_use_id`) back to the original `tool_name` requested by the assistant in a previous turn. This limitation critically impairs multi-turn tool-based conversations and diminishes the proxy's overall utility when mediating between Anthropic's Messages API and downstream models like OpenAI's Chat Completions API or Google's Gemini.

This enhancement will introduce a state management layer using Cloudflare Durable Objects to resolve this issue, enabling complex, multi-step tool interactions.

### 2. Goals

*   **Enable Reliable Bidirectional Tool Usage:** Allow the proxy to correctly process multi-turn conversations involving tool calls and results.
*   **Improve User Experience:** Provide a seamless and reliable experience for developers and end-users relying on tool-based workflows through the proxy.
*   **Enhance Proxy Utility:** Significantly increase the value of the proxy by supporting a critical LLM feature.
*   **Maintain Scalability and Performance:** Ensure the state management solution scales with demand and introduces minimal latency.
*   **Optimize Operational Costs:** Implement lifecycle management for stateful components to control costs effectively.

### 3. Target Users

*   **Primary:** Developers building applications that integrate Anthropic's LLMs via our proxy and require sophisticated tool-use capabilities with downstream models (e.g., OpenAI, Gemini).
*   **Secondary:** End-users of applications built by the primary target users, who will benefit from more capable and reliable AI interactions.

### 4. User Stories

*   **US1 (Developer - Core Functionality):** As a developer using the proxy, I want to engage in multi-turn conversations where an Anthropic model requests a tool, my application executes it, and I send the result back, so that the downstream model (e.g., OpenAI) correctly understands which tool's result it is receiving and can continue the task.
*   **US2 (Developer - Error Handling):** As a developer, when an external tool execution fails, I want the proxy to correctly format this failure as an Anthropic `tool_result` with `is_error: true`, so that the LLM can understand the failure and respond appropriately.
*   **US3 (Developer - Conversation Management):** As a developer, I want to be able to signal the end of a conversation, so that any associated state in the proxy can be cleaned up to manage resources and costs.
*   **US4 (System - State Persistence):** As the proxy, when an assistant message includes a `tool_use` block, I need to securely store the mapping between the `tool_use_id` and `tool_name` associated with the current conversation, so that it can be retrieved later.
*   **US5 (System - State Retrieval):** As the proxy, when a user message includes a `tool_result` block, I need to retrieve the original `tool_name` using the provided `tool_use_id` for the current conversation, so that I can correctly format the message for the downstream model.
*   **US6 (System - State Isolation):** As the proxy, I need to ensure that conversation state is isolated, so that one user's/conversation's tool mappings do not interfere with another's.
*   **US7 (System - Resource Management):** As the proxy, I need to automatically clean up conversation state for inactive or completed conversations, so that resource utilization and costs are optimized.

### 5. Proposed Solution Overview

The proxy will leverage Cloudflare Durable Objects (DOs) to manage conversational state. Each ongoing conversation requiring tool use will be associated with a unique `ConversationStateDO` instance. This DO will store `tool_use_id` to `tool_name` mappings.

*   When the proxy transforms a downstream model's response containing a tool call into an Anthropic `tool_use` block, it will store the `tool_use_id` and `tool_name` in the conversation's DO.
*   When the proxy receives an Anthropic `tool_result` block from the client, it will query the DO using the `tool_use_id` to retrieve the `tool_name` before forwarding the information to the downstream model.

### 6. Detailed Requirements

#### 6.1. Functional Requirements

##### 6.1.1. Conversation State Durable Object (`ConversationStateDO`)
*   **FR1.1:** The system MUST implement a Cloudflare Durable Object class, `ConversationStateDO`.
*   **FR1.2:** `ConversationStateDO` MUST provide an endpoint (e.g., `/store`) to accept and persist a `tool_use_id` and `tool_name` pair.
    *   This operation MUST update an internal mapping (e.g., `toolNameMap`).
    *   This operation MUST persist the updated mapping to the DO's durable storage.
*   **FR1.3:** `ConversationStateDO` MUST provide an endpoint (e.g., `/retrieve`) to accept a `tool_use_id` and return the corresponding `tool_name` from its stored mapping.
*   **FR1.4:** `ConversationStateDO` MUST provide an endpoint (e.g., `/delete_mapping`) to delete a specific `tool_use_id`:`tool_name` mapping from its state and persist this change.
*   **FR1.5:** `ConversationStateDO` MUST implement a full cleanup method (e.g., accessible via `/clear_conversation_state`) that:
    *   Calls `this.state.storage.deleteAll()` to remove all persisted data for the DO instance.
    *   Calls `this.state.storage.deleteAlarm()` to remove any pending alarms for the DO instance.
*   **FR1.6 (Storage Strategy):** The `ConversationStateDO` SHOULD store individual `tool_use_id`:`tool_name` pairs as separate keys in its storage rather than a single serialized map object, to optimize for performance and future row-based billing. (Decision to be finalized based on implementation complexity vs. anticipated benefits).

##### 6.1.2. Worker Integration & `conversationId` Management
*   **FR2.1:** The main Cloudflare Worker MUST be configured to use the `ConversationStateDO`.
*   **FR2.2:** The Worker MUST derive a `conversationId` for each incoming request.
    *   It MUST prioritize a client-provided `X-Conversation-ID` header if present.
    *   If the header is absent, it MUST generate a new, unique `conversationId` (e.g., `conv_` + UUID).
    *   RECOMMENDED: If a user context is available, the `conversationId` string passed to `idFromName()` SHOULD incorporate a user-specific identifier (e.g., `user_id + ":" + session_id`) for enhanced isolation.
*   **FR2.3:** The Worker MUST use `env.CONVERSATION_STATE.idFromName(conversationId)` to get a deterministic DO ID for the conversation.
*   **FR2.4:** The Worker MUST obtain a `DurableObjectStub` for the conversation and pass it to relevant request/response transformation handlers.

##### 6.1.3. State Persistence in Response Transformation (`responseAnthropic.mjs`)
*   **FR3.1:** When transforming a downstream model's response containing tool/function calls into Anthropic `tool_use` blocks:
    *   For each `tool_use` block, the transformer MUST extract/generate the `tool_use_id` and `tool_name`.
    *   The transformer MUST invoke the `/store` endpoint of the `ConversationStateDO` stub to persist this mapping for the current conversation.

##### 6.1.4. State Retrieval in Request Transformation (`requestAnthropic.mjs`)
*   **FR4.1:** When transforming an incoming Anthropic client request containing a `tool_result` block:
    *   The transformer MUST extract the `tool_use_id` from the `tool_result` block.
    *   The transformer MUST invoke the `/retrieve` endpoint of the `ConversationStateDO` stub to get the corresponding `tool_name`.
    *   If `tool_name` is successfully retrieved, it MUST be used to populate the `name` field in the message sent to the downstream model (e.g., OpenAI function message).
    *   If `tool_name` retrieval fails (e.g., ID not found), the system MUST follow the error handling strategy defined in FR5.3. The placeholder `UNKNOWN_TOOL_NAME_FOR_{tool_use_id}` MUST NOT be used in production requests to downstream models.

##### 6.1.5. Error Handling
*   **FR5.1 (External Tool Errors):** If an external tool (called by the system based on LLM instruction) fails, the proxy MUST construct an Anthropic `tool_result` content block with:
    *   The original `tool_use_id`.
    *   `"is_error": true`.
    *   `"content": "<descriptive error message from the tool>"`.
    This formatted error MUST be sent back to the LLM as part of the conversation.
*   **FR5.2 (Malformed Client `tool_result`):** The proxy MUST validate `tool_result` blocks from clients.
    *   If a `tool_result` is malformed (e.g., missing `tool_use_id`, invalid content structure), the proxy MUST return an Anthropic-style `invalid_request_error` (HTTP 400) to the client.
*   **FR5.3 (DO Operation Failures - `tool_name` Retrieval):** If retrieving `tool_name` from `ConversationStateDO` fails:
    *   The proxy MUST implement a retry mechanism (e.g., 1-2 retries with short backoff) for transient DO communication issues.
    *   If retries are exhausted or the `tool_use_id` is definitively not found, the proxy MUST return an Anthropic-style `api_error` (HTTP 500) or a structured error message to the client, indicating inability to process the tool result due to missing context or internal error.
*   **FR5.4 (DO Operation Failures - `tool_name` Storage):** If storing `tool_name` to `ConversationStateDO` fails:
    *   The proxy MUST implement a retry mechanism.
    *   If retries are exhausted, the proxy MUST log the error aggressively. The `tool_use` block might still be sent to the Anthropic client, but a warning should indicate that subsequent `tool_result` processing for this ID will likely fail.
*   **FR5.5 (DO Overload/Unavailable):** If `ConversationStateDO` is overloaded or unavailable:
    *   The proxy MUST implement retries with exponential backoff.
    *   If retries are exhausted, the proxy MUST return an Anthropic-style `overloaded_error` (HTTP 529) or `api_error` (HTTP 500) to the client.

##### 6.1.6. Lifecycle Management for `ConversationStateDO`
*   **FR6.1 (Inactivity Alarm):** `ConversationStateDO` MUST use the Alarms API.
    *   Upon creation or significant activity (e.g., `/store`, `/retrieve`), the DO MUST call `this.state.storage.setAlarm()` to schedule its `alarm()` handler after a configurable period of inactivity (e.g., 30 minutes).
    *   Any new activity MUST delete any pending alarm and set a new one.
*   **FR6.2 (Alarm Handler Action):** The `alarm()` handler in `ConversationStateDO` MUST invoke the full cleanup method (as per FR1.5: `deleteAll()` and `deleteAlarm()`).
*   **FR6.3 (Explicit Cleanup API):** The main Worker MUST expose an API endpoint (e.g., `POST /v1/conversations/{conversationId}/terminate`).
    *   When this endpoint is called, the Worker MUST instruct the corresponding `ConversationStateDO` (identified by `conversationId`) to execute its full cleanup method (FR1.5).
*   **FR6.4 (Individual Mapping Cleanup - Optional Enhancement):** Consider invoking `/delete_mapping` (FR1.4) for a `tool_use_id` after its corresponding `tool_result` has been successfully processed and the `tool_name` retrieved. This is to keep the `toolNameMap` lean during very long conversations. (Evaluate benefit vs. complexity).

#### 6.2. Non-Functional Requirements

*   **NFR1 (Performance):**
    *   DO operations (`/store`, `/retrieve`) MUST have low latency, ideally completing within tens of milliseconds on average, to not significantly impact overall conversational turn latency.
    *   The in-memory `toolNameMap` cache within the DO should be utilized for fast retrievals.
*   **NFR2 (Scalability):** The solution MUST scale horizontally to support a large number of concurrent conversations, leveraging the per-instance nature of DOs.
*   **NFR3 (Reliability):**
    *   The system MUST be resilient to transient DO failures through retries.
    *   Strong consistency of DOs MUST ensure that `tool_name` mappings are immediately available after being stored.
*   **NFR4 (Cost-Effectiveness):**
    *   Lifecycle management (FR6) MUST be implemented to minimize DO duration and storage costs for inactive/completed conversations.
    *   Storage patterns within the DO (FR1.6) SHOULD be optimized for anticipated SQLite row-based billing.
*   **NFR5 (Security):**
    *   `conversationId` generation and handling MUST ensure strong isolation between different conversations. Client-provided `X-Conversation-ID`s should be treated as opaque identifiers.
*   **NFR6 (Maintainability):** The `ConversationStateDO` logic SHOULD be well-encapsulated and clearly separated from the Worker's transformation logic.
*   **NFR7 (Monitoring):** The system MUST allow for monitoring of:
    *   DO request counts, duration, and storage metrics.
    *   Error rates related to DO operations and tool name mapping.
    *   Number of active DOs and cleanup operations.

#### 6.3. Handling Long-Running Tools (Out of Scope for this Phase, Future Consideration)
*   The initial implementation will assume external tool executions are relatively short-lived and can be handled synchronously or within the Worker's time limits.
*   Future enhancements MAY consider asynchronous tool execution using Cloudflare Queues if long-running tools become a common requirement.

### 7. Success Metrics

*   **SM1:** Reduction in errors related to `UNKNOWN_TOOL_NAME` to near zero for conversations utilizing the stateful proxy.
*   **SM2:** Successful completion rate of multi-turn tool-based conversations (as measured through integration tests and/or logs) above 99.9%.
*   **SM3:** Average latency added by DO interactions per conversational turn is less than 50ms (P95).
*   **SM4:** Cloudflare Durable Object costs (duration, requests, storage) remain within projected budget, demonstrating effective lifecycle management.
*   **SM5:** Positive developer feedback regarding the reliability and ease of use of tool-calling features via the proxy.

### 8. Future Considerations / Potential Enhancements

*   **FC1 (RPC for DO Interaction):** Refactor Worker-DO communication from `fetch` calls to RPC for cleaner, type-safe interactions.
*   **FC2 (Asynchronous Tool Handling):** Integrate Cloudflare Queues for robust handling of long-running external tools. The `ConversationStateDO` could orchestrate the status of these async tasks.
*   **FC3 (Advanced Conversational State):** Extend `ConversationStateDO` to manage other conversational states (e.g., summaries, user preferences, intermediate tool chain results).

### 9. Release Criteria (Minimum Viable Product - MVP)

*   All Functional Requirements (FR1-FR5, FR6.1-FR6.3) related to core state storage, retrieval, basic error handling, and essential lifecycle management (inactivity alarms, explicit cleanup) are implemented and tested.
*   Key Non-Functional Requirements (NFR1-NFR5) are met.
*   Success Metrics SM1, SM2, and SM3 can be demonstrably met in a testing environment.
*   Comprehensive logging is in place for DO interactions and error conditions.

---