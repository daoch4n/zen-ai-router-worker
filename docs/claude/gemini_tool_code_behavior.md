# Gemini `tool_code` Behavior and Proxy Handling

## 1. Problem Description

When interacting with the Google Gemini API (specifically `gemini-2.0-flash` and potentially other models) through the `zen-ai-router-thinking` proxy, it has been observed that the model, when intending to suggest a tool-related action or provide information about a tool, sometimes generates content that *looks like* a tool call but is embedded directly within its text response. This content is typically formatted as a markdown code block with a `tool_code` language identifier, similar to:

```
```tool_code
# I will now use the Read tool to read the file src/transformers/requestAnthropic.mjs to understand its content and generate documentation.
read_file(path="/home/vi/zen-ai-router-thinking/src/transformers/requestAnthropic.mjs")
```
```

This behavior differs from a formal tool invocation, where the model would generate a structured `tool_calls` object that the proxy is designed to translate into an Anthropic `tool_use` message. Instead, the `tool_code` is treated as regular text content by Gemini.

## 2. Observed Errors in Proxy Streaming Responses

When the proxy attempts to stream responses from Gemini that contain this `tool_code` embedded within the text content, the Cloudflare Worker logs show critical errors:

*   `Invalid data: undefineddata: ...`
*   `TypeError: Cannot read properties of undefined (reading 'anthropicStreamTransformer')`

These errors indicate a failure in our proxy's streaming response processing logic.

## 3. Root Cause Analysis

The root cause lies in how our proxy's streaming transformer, primarily implemented in `src/transformers/streamAnthropic.mjs` (and potentially related logic in `src/handlers/anthropicCompletions.mjs`), processes incoming chunks from Gemini.

The proxy's streaming logic is designed to parse `delta` objects from OpenAI-compatible streaming responses, expecting either:
*   Plain text content (`delta.content`)
*   Formal tool call chunks (`delta.tool_calls`)

When Gemini injects the `tool_code` markdown block directly into the `delta.content` stream, our current parsing logic seems to encounter an unexpected format or sequence, leading to:
*   **`Invalid data: undefined`:** Suggests that a part of the incoming data stream is `undefined` or malformed, causing JSON parsing or data access issues within the transformer.
*   **`TypeError: Cannot read properties of undefined (reading 'anthropicStreamTransformer')`:** This specifically points to an attempt to access a property (`anthropicStreamTransformer`) on an object that is `undefined` at some point during the streaming transformation. This typically happens when an internal state or an expected object within the streaming pipeline is not correctly initialized or maintained due to the unexpected `tool_code` content.

## 4. Distinction from Previous Issues

It is crucial to differentiate this issue from the previously resolved "Upstream error: An internal error has occurred":

*   **Previous Issue (Resolved):** This was related to Gemini *failing to process a request* that *contained tool definitions* (i.e., our proxy sending a malformed request for tool *invocation*). This was resolved by implementing `cleanGeminiSchema` and correctly handling `top_k` and `thinking` parameters in `src/transformers/requestAnthropic.mjs`. The problem was with the *request format being sent to Gemini*.
*   **Current Issue (Unresolved):** This is about our proxy *failing to process a response* from Gemini when Gemini *generates content* that includes `tool_code` as part of its text output in a streaming scenario. The problem is with our proxy's *response parsing/transformation* of Gemini's output.

## 5. Implications

This issue prevents the proxy from reliably streaming responses from Gemini when the model generates tool-related content as `tool_code`. It leads to errors and incomplete responses, hindering the full functionality of the proxy for certain Gemini behaviors.

## 6. Proposed Solution (High-Level)

The primary solution involves making the streaming response handling in `src/transformers/streamAnthropic.mjs` more resilient. This could entail:

*   **Robust Content Parsing:** Enhancing the parsing logic to correctly handle `tool_code` blocks within the `delta.content` stream. This might involve regex or string manipulation to extract the `tool_code` and then decide how to represent it in the Anthropic-compatible streaming format (e.g., as plain text, or potentially as a specially formatted text block if Anthropic's API has a way to render such suggestions).
*   **Error Handling Refinement:** Adding specific error handling within the streaming pipeline to gracefully manage `undefined` data or unexpected structures, preventing crashes and allowing the stream to continue.
*   **State Management Review:** Ensuring that all necessary objects and states within the `AnthropicStreamTransformer` are correctly initialized and updated, even when encountering non-standard content.

Further investigation into the exact structure of streaming chunks when `tool_code` is present will be necessary to implement a precise fix.
