# Plan to Invent a Fix for Gemini `tool_code` Streaming Issue

**Problem Statement:**
The proxy's streaming response transformer (`src/transformers/streamAnthropic.mjs`) fails when Gemini generates `tool_code` markdown blocks within its text content (`delta.content`), leading to `Invalid data: undefined` and `TypeError: Cannot read properties of undefined (reading 'anthropicStreamTransformer')` errors. This prevents reliable streaming of such responses.

**Goal:**
Modify the proxy's streaming logic to gracefully and correctly process Gemini's `tool_code` content, ensuring stable and complete streaming responses.

**High-Level Approach:**
Enhance the `AnthropicStreamTransformer` to specifically detect and handle `tool_code` blocks within incoming `delta.content` chunks, transforming them into an Anthropic-compatible format without errors.

**Detailed Plan:**

1.  **Re-examine `src/transformers/streamAnthropic.mjs`:**
    *   **Objective:** Understand the current parsing logic for `delta.content` and how it interacts with the `AnthropicStreamTransformer`'s internal state.
    *   **Action:** Read the file to refresh context on `transform` method, `accumulated_text`, and how content blocks are managed.

2.  **Identify `tool_code` Pattern:**
    *   **Objective:** Determine a reliable way to detect the `tool_code` markdown block within `delta.content`.
    *   **Action:** Use a regular expression to match the pattern: `` ```tool_code\n...``` ``. This pattern will be applied to incoming `delta.content` strings.

3.  **Refine `AnthropicStreamTransformer`'s `transform` Method:**
    *   **Objective:** Implement logic to handle `tool_code` content without crashing.
    *   **Actions:**
        *   **Buffer Accumulation:** Continue accumulating `delta.content` as usual.
        *   **Pattern Detection:** Before yielding `content_block_delta` for text, check the accumulated content (or a window of it) for the `tool_code` pattern.
        *   **Conditional Yielding:**
            *   If `tool_code` is detected:
                *   Extract the `tool_code` block.
                *   Yield any preceding plain text as a `content_block_delta`.
                *   Decide how to represent the `tool_code` block in Anthropic's format. The simplest approach for now would be to treat it as a single text block, ensuring it's valid JSON. If Anthropic has a specific `tool_code` content type, that would be ideal, but for now, it's safer to ensure it's valid text.
                *   Yield the `tool_code` block as a `content_block_delta` (or potentially a new `content_block_start`/`delta`/`stop` sequence if it's a multi-part tool code block).
                *   Adjust internal text buffers/indices to account for the extracted `tool_code` content.
            *   If no `tool_code` is detected, proceed with normal text `content_block_delta` yielding.

4.  **Robust Error Handling within `transform`:**
    *   **Objective:** Prevent `TypeError: Cannot read properties of undefined` and `Invalid data` errors.
    *   **Action:** Add `try-catch` blocks around JSON parsing and data access operations within the `transform` method to gracefully handle malformed chunks or unexpected `undefined` values, logging the error but allowing the stream to continue. Ensure all variables are properly checked for `undefined` or `null` before property access.

5.  **Testing Strategy:**
    *   **Unit Tests (if possible):** Create isolated tests for `streamAnthropic.mjs` with mocked Gemini streaming chunks containing `tool_code` to verify the transformation logic.
    *   **Integration Test:** Re-run the `curl` command that triggered the `tool_code` output (`curl --data-binary @./curl_payload.json ...`) against the `wrangler dev` environment to observe the logs and verify successful streaming.
    *   **Deployment Test:** After applying the fix, deploy to the remote worker and re-run the `curl` command against the live endpoint to confirm the fix in production.

**Mermaid Diagram (High-Level Flow):**

```mermaid
graph TD
    A[Gemini API Stream Chunk] --> B{Parse Chunk};
    B -- text delta --> C{Accumulate Text};
    B -- tool_calls delta --> D{Process Tool Call Delta};
    C --> E{Detect tool_code pattern?};
    E -- Yes --> F[Extract tool_code & Preceding Text];
    F --> G[Yield Text Content Block Delta];
    F --> H[Yield tool_code Content Block Delta];
    E -- No --> I[Yield Text Content Block Delta];
    D --> J[Yield Tool Use Content Block Delta];
    G --> K[Anthropic SSE Output];
    H --> K;
    I --> K;
    J --> K;