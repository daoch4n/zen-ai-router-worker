# Research Document: State Management for Anthropic Tool Calling (Deeper Dive)

## 1. Problem Statement

The current stateless proxy architecture for integrating Anthropic's Messages API with OpenAI's Chat Completions API (and subsequently Gemini) faces a critical limitation regarding bidirectional tool usage. Specifically, when an Anthropic client provides the result of a tool call via a `tool_result` content block within a `user` message, the proxy cannot reliably infer the original `tool_name` associated with the `tool_use_id`.

The `src/transformers/requestAnthropic.mjs` currently uses a placeholder (`UNKNOWN_TOOL_NAME_FOR_{tool_use_id}`) because it lacks the context from the preceding `assistant` message that contained the `tool_use` request. OpenAI's `function` role messages (to which Anthropic `tool_result` maps) require a precise `name` field. This mismatch leads to:
*   Downstream models failing to correctly process tool results.
*   Broken multi-turn conversations involving function calls.
*   Limited functionality for Anthropic clients requiring robust tool interaction.

## 2. Proposed Solutions for State Management

To overcome the stateless limitation, we need to introduce a mechanism to store and retrieve the `tool_use_id` to `tool_name` mapping across turns of a conversation. Cloudflare offers two primary services suitable for this in a Worker environment:

### 2.1. Cloudflare Durable Objects

**Description:** Durable Objects provide strongly consistent, low-latency storage for individual objects (e.g., conversation sessions). Each Durable Object instance lives on a single Cloudflare data center, ensuring data consistency for that instance.

**Pros:**
*   **Strong Consistency:** Guarantees that reads always return the most recent write.
*   **Low Latency:** Optimized for frequent, small state changes within a single logical unit.
*   **Session-Oriented:** Naturally fits the model of storing state per conversation session.
*   **Scalability:** Durable Objects scale by creating more instances, not by distributing a single instance.

**Cons:**
*   **Complexity:** Requires defining and managing Durable Object classes.
*   **Cost:** May incur higher costs for numerous, short-lived sessions if not managed efficiently.

### 2.2. Cloudflare KV (Key-Value) Store

**Description:** A highly distributed, eventually consistent key-value data store.

**Pros:**
*   **Simplicity:** Easy to use for simple key-value lookups.
*   **Cost-Effective:** Generally cheaper for less frequent access or larger data.
*   **High Read Throughput:** Excellent for read-heavy workloads.

**Cons:**
*   **Eventual Consistency:** Writes may take some time to propagate globally, meaning a subsequent read might return stale data (though typically fast enough for many use cases).
*   **Less Ideal for Complex Session State:** While possible, managing complex, frequently updated session state might be more cumbersome than with Durable Objects.
*   **No Transactions:** Lacks transactional guarantees for multiple operations.

**Recommendation:** For conversational state, **Cloudflare Durable Objects** are generally the superior choice due to their strong consistency and suitability for managing per-session state. KV could be a fallback for simpler, less critical scenarios or for read-heavy caches.

## 3. Detailed Implementation Plan (Using Durable Objects)

### 3.1. Define a Durable Object for Conversation State

Create a Durable Object class (e.g., `ConversationStateDO`) that will store the mapping of `tool_use_id` to `tool_name`.

```javascript
// durable_objects/ConversationStateDO.mjs
export class ConversationStateDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.toolNameMap = {}; // Stores { tool_use_id: tool_name }
  }

  async fetch(request) {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/store": {
        const { toolUseId, toolName } = await request.json();
        this.toolNameMap[toolUseId] = toolName;
        await this.state.storage.put("toolNameMap", this.toolNameMap);
        return new Response("OK");
      }
      case "/retrieve": {
        const { toolUseId } = await request.json();
        const toolName = this.toolNameMap[toolUseId];
        return new Response(JSON.stringify({ toolName }), {
          headers: { "Content-Type": "application/json" }
        });
      }
      case "/delete_map": { // New endpoint for cleanup
        const { toolUseId } = await request.json();
        delete this.toolNameMap[toolUseId];
        await this.state.storage.put("toolNameMap", this.toolNameMap);
        return new Response("OK");
      }
      default:
        return new Response("Not Found", { status: 404 });
    }
  }
}
```

### 3.2. Update `wrangler.toml`

Declare the Durable Object binding in `wrangler.toml` to make it accessible to the Worker.

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "CONVERSATION_STATE"
class_name = "ConversationStateDO"
script_name = "durable_objects/ConversationStateDO" # Path to your DO script
```

### 3.3. Modify `src/worker.mjs`

*   **Get Durable Object ID**: Generate or derive a unique ID for each conversation session (e.g., from `request.headers.get('x-conversation-id')` or a hash of `user` + `session_id`).
*   **Get Durable Object Stub**: Obtain a stub for the Durable Object.
*   **Pass Stub to Handlers**: Pass the Durable Object stub to `handleAnthropicCompletions` and other relevant handlers.

```javascript
// src/worker.mjs (snippet)
import {
  handleOpenAICompletions
} from './handlers/completions.mjs';
import {
  handleAnthropicCompletions
} from './handlers/anthropicCompletions.mjs';
import {
  handleEmbeddings,
  handleModels
} from './handlers/index.mjs';

import {
  getRandomApiKey,
  forceSetWorkerLocation,
  fixCors,
  errorHandler,
  HttpError,
  generateId // Assuming generateId is also in utils/index.mjs
} from './utils/index.mjs'; // Corrected import path for fixCors and generateId

import {
  handleOPTIONS
} from './utils/cors.mjs';

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleOPTIONS();
    }

    const errHandler = (err) => errorHandler(err, fixCors);

    try {
      const apiKey = getRandomApiKey(request, env);
      const colo = request.cf?.colo;
      if (colo && ["DME", "LED", "SVX", "KJA"].includes(colo)) {
        return new Response(`Bad Cloudflare colo: ${colo}. Try again`, {
          status: 429,
          headers: {
            "Content-Type": "text/plain"
          },
        });
      }
      await forceSetWorkerLocation(env);

      const conversationId = request.headers.get('X-Conversation-ID') || `conv_${generateId()}`;
      const id = env.CONVERSATION_STATE.idFromName(conversationId);
      const conversationStub = env.CONVERSATION_STATE.get(id);

      const {
        pathname
      } = new URL(request.url);
      switch (pathname) {
        case "/v1/messages":
          return handleAnthropicCompletions(await request.json(), apiKey, env, conversationStub)
            .catch(errHandler);

        case "/chat/completions":
          return handleOpenAICompletions(await request.json(), apiKey)
            .catch(errHandler);

        case pathname.endsWith("/embeddings"):
          return handleEmbeddings(await request.json(), apiKey)
            .catch(errHandler);

        case pathname.endsWith("/models"):
          return handleModels(apiKey)
            .catch(errHandler);

        default:
          throw new HttpError("404 Not Found", 404);
      }
    } catch (err) {
      return errHandler(err);
    }
  }
};
```

### 3.4. Modify `src/transformers/responseAnthropic.mjs`

When transforming an OpenAI `function_call` to an Anthropic `tool_use` block, store the mapping.

```javascript
// src/transformers/responseAnthropic.mjs (snippet)
import {
  generateId
} from '../utils/helpers.mjs';

export async function transformOpenAIToAnthropicResponse(openAIRes, anthropicModelName, openAIRequestId, conversationStub) {
  const anthropicRes = {
    id: openAIRequestId || `msg_${generateId()}`,
    type: "message",
    role: "assistant",
    model: anthropicModelName,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0
    }
  };

  if (openAIRes.error) {
    let errorType = "api_error";
    if (openAIRes.error.code === 429) {
      errorType = "rate_limit_error";
    } else if (openAIRes.error.code === 400) {
      errorType = "invalid_request_error";
    } else if (openAIRes.error.code === 401 || openAIRes.error.code === 403) {
      errorType = "authentication_error";
    } else if (openAIRes.error.code >= 500 && openAIRes.error.code < 600) {
      errorType = "api_error";
    }
    return {
      type: "error",
      error: {
        type: errorType,
        message: `Upstream error: ${openAIRes.error.message || 'Unknown'}` +
          (openAIRes.error.param ? ` (Param: ${openAIRes.error.param})` : '') +
          (openAIRes.error.type ? ` (Type: ${openAIRes.error.type})` : '') +
          (openAIRes.error.details ? ` (Details: ${JSON.stringify(openAIRes.error.details)})` : '')
      }
    };
  }

  if (!openAIRes.choices || openAIRes.choices.length === 0) {
    return anthropicRes;
  }

  const choice = openAIRes.choices[0];
  const message = choice.message;

  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      const toolUseId = toolCall.id || `toolu_${generateId()}`;
      anthropicRes.content.push({
        type: "tool_use",
        id: toolUseId,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments)
      });
      if (conversationStub) {
        await conversationStub.fetch(new Request("http://do/store", {
          method: "POST",
          body: JSON.stringify({
            toolUseId,
            toolName: toolCall.function.name
          }),
          headers: {
            "Content-Type": "application/json"
          }
        }));
      }
    }
    anthropicRes.stop_reason = "tool_use";
  } else if (message.function_call) {
    try {
      anthropicRes.content.push({
        type: "tool_use",
        id: `toolu_${generateId()}`,
        name: message.function_call.name,
        input: JSON.parse(message.function_call.arguments)
      });
    } catch (e) {
      console.error("Failed to parse function_call arguments:", e, message.function_call.arguments);
      anthropicRes.content.push({
        type: "tool_use",
        id: `toolu_${generateId()}`,
        name: message.function_call.name,
        input: {}
      });
    }
  } else if (message.content !== null) {
    anthropicRes.content.push({
      type: "text",
      text: message.content
    });
  }

  if (choice.finish_reason) {
    switch (choice.finish_reason) {
      case "stop":
        anthropicRes.stop_reason = "end_turn";
        break;
      case "length":
        anthropicRes.stop_reason = "max_tokens";
        break;
      case "content_filter":
        anthropicRes.stop_reason = "content_filter";
        break;
      default:
        anthropicRes.stop_reason = "end_turn";
    }
  }

  if (openAIRes.usage) {
    anthropicRes.usage.input_tokens = openAIRes.usage.prompt_tokens || 0;
    anthropicRes.usage.output_tokens = openAIRes.usage.completion_tokens || 0;
  }

  return anthropicRes;
}
```

### 3.5. Modify `src/transformers/requestAnthropic.mjs`

When transforming an Anthropic `tool_result` block, retrieve the `tool_name` from the state.

```javascript
// src/transformers/requestAnthropic.mjs (snippet)
import {
  DEFAULT_ANTHROPIC_VERSION
} from '../constants/index.mjs';
import {
  HttpError
} from '../utils/error.mjs';
import {
  generateId
} from '../utils/helpers.mjs';

function cleanGeminiSchema(schema) {
  if (typeof schema !== 'object' || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => cleanGeminiSchema(item));
  }

  const cleaned = { ...schema
  };
  delete cleaned.additionalProperties;
  delete cleaned.default;

  if (cleaned.type === "string" && cleaned.format) {
    const allowedFormats = new Set(["enum", "date-time"]);
    if (!allowedFormats.has(cleaned.format)) {
      delete cleaned.format;
    }
  }

  for (const key in cleaned) {
    if (Object.prototype.hasOwnProperty.call(cleaned, key)) {
      cleaned[key] = cleanGeminiSchema(cleaned[key]);
    }
  }
  return cleaned;
}

export async function transformAnthropicToOpenAIRequest(anthropicReq, env, conversationStub) {
  const openAIReq = {};
  const modelMap = {
    "claude-3-opus-20240229": env.MODEL_MAP_OPUS,
    "claude-3-sonnet-20240229": env.MODEL_MAP_SONNET,
    "claude-3-haiku-20240307": env.MODEL_MAP_HAIKU,
  };
  openAIReq.model = modelMap[anthropicReq.model] || anthropicReq.model;
  openAIReq.messages = [];

  if (anthropicReq.system) {
    openAIReq.messages.push({
      role: "system",
      content: anthropicReq.system
    });
  }

  for (const message of anthropicReq.messages) {
    const openAIMessage = {
      role: message.role
    };

    if (typeof message.content === "string") {
      openAIMessage.content = message.content;
    } else if (Array.isArray(message.content)) {
      let textContent = [];
      for (const block of message.content) {
        if (block.type === "text") {
          textContent.push(block.text);
        } else if (block.type === "tool_result" && message.role === "user") {
          let toolName = `UNKNOWN_TOOL_NAME_FOR_${block.tool_use_id}`;

          if (conversationStub) {
            const retrieveRes = await conversationStub.fetch(new Request("http://do/retrieve", {
              method: "POST",
              body: JSON.stringify({
                toolUseId: block.tool_use_id
              }),
              headers: {
                "Content-Type": "application/json"
              }
            }));
            if (retrieveRes.ok) {
              const data = await retrieveRes.json();
              if (data.toolName) {
                toolName = data.toolName;
              }
            } else {
              console.warn(`Failed to retrieve tool name for ${block.tool_use_id}:`, await retrieveRes.text());
            }
          }

          openAIReq.messages.push({
            role: "function",
            name: toolName,
            content: JSON.stringify(block.content)
          });
        }
      }
      if (textContent.length > 0) {
        openAIMessage.content = textContent.join("\n");
      } else if (openAIMessage.role !== "function") {
        openAIMessage.content = null;
      }
    }

    if (openAIMessage.content !== null || openAIMessage.role === "assistant") {
      openAIReq.messages.push(openAIMessage);
    }
  }

  if (anthropicReq.max_tokens) {
    openAIReq.max_tokens = anthropicReq.max_tokens;
  }
  if (anthropicReq.stop_sequences) {
    openAIReq.stop = anthropicReq.stop_sequences;
  }
  if (anthropicReq.stream !== undefined) {
    openAIReq.stream = anthropicReq.stream;
  }
  if (anthropicReq.temperature !== undefined) {
    openAIReq.temperature = anthropicReq.temperature;
  }
  if (anthropicReq.top_p !== undefined) {
    openAIReq.top_p = anthropicReq.top_p;
  }
  if (anthropicReq.top_k !== undefined) {
    openAIReq.top_k = anthropicReq.top_k;
  }
  if (anthropicReq.metadata && anthropicReq.metadata.user_id) {
    openAIReq.user = anthropicReq.metadata.user_id;
  }

  if (anthropicReq.tools && anthropicReq.tools.length > 0) {
    openAIReq.functions = anthropicReq.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: cleanGeminiSchema(tool.input_schema)
    }));

    if (anthropicReq.tool_choice) {
      if (anthropicReq.tool_choice.type === "auto" || anthropicReq.tool_choice.type === "any") {
        openAIReq.function_call = "auto";
      } else if (anthropicReq.tool_choice.type === "tool" && anthropicReq.tool_choice.name) {
        openAIReq.function_call = {
          name: anthropicReq.tool_choice.name
        };
      } else if (anthropicReq.tool_choice.type === "none") {
        openAIReq.function_call = "none";
      }
    } else {
      openAIReq.function_call = "auto";
    }
  }

  return openAIReq;
}
```

## 4. Deeper Research Insights

### 4.1. Robustness of `tool_use_id` Handling
*   **Uniqueness**: Anthropic's `tool_use_id`s are expected to be unique within a single `assistant` message. However, their global uniqueness across multiple messages or conversations is not explicitly guaranteed by the API specification. When mapping to Durable Objects, `tool_use_id` will be used as a key within the `toolNameMap` for a specific conversation. The uniqueness concern then shifts to the `conversationId` used for the Durable Object. Using a combination of `user` ID and a session identifier (e.g., `X-Conversation-ID` header, or a hash of the initial message and timestamp) is crucial to ensure each conversation gets its own Durable Object instance.
*   **Stateless Proxy Implications**: Without state, the proxy cannot verify if a `tool_use_id` provided by the client is valid or if it refers to a tool call that actually occurred in the preceding `assistant` turn. The Durable Object approach mitigates this by providing a lookup mechanism.
*   **Lifetime of Mappings**: Mappings within the Durable Object's `toolNameMap` should ideally have a lifecycle tied to the conversation. If a conversation ends or becomes inactive, the corresponding Durable Object instance (and its state) should eventually be garbage collected or explicitly deleted to manage resources and costs. This might involve setting a `state.storage.setAlarm()` for inactivity. A new endpoint `/delete_map` could be added to the Durable Object to allow explicit cleanup if a conversation is known to be finished.

### 4.2. Error Handling for Tool Calls
*   **Tool Execution Errors**: If an external tool invoked by the proxy (after receiving a `function_call` from OpenAI) returns an error, this error needs to be communicated back to the Anthropic client effectively.
    *   **Option 1 (Text Error)**: Return an assistant message with descriptive error text.
    *   **Option 2 (Tool Result with Error)**: If the tool result structure allows, return a `tool_result` block with an error indicator or message within its content. This depends on how the external tool's error is structured.
    *   **Option 3 (Proxy Error)**: If the error is critical (e.g., proxy internal error), return an Anthropic-style error response.
*   **Malformed `tool_result` from Client**: If the `tool_result` block from the Anthropic client is malformed (e.g., `content` is not valid JSON, `tool_use_id` is missing or invalid), the proxy should catch these errors and return an `invalid_request_error` to the client.

### 4.3. Concurrency and Asynchronicity
*   **Durable Object Guarantees**: Durable Objects provide a single-threaded execution model for their instances. This means that concurrent requests to the *same* Durable Object instance are queued and processed sequentially, simplifying state management within the object and preventing race conditions. This is highly beneficial for conversational state.
*   **Long-Running Tool Executions**: If an external tool call is long-running, the proxy Worker's `fetch` request to the Durable Object (to store/retrieve tool names) will be fast. The main `fetch` handler in `src/worker.mjs` will be responsible for making the actual call to the external tool. If that external call is long-running, the client connection might time out. This problem is orthogonal to `tool_name` mapping but relevant for robust tool integration. Solutions include:
    *   **Asynchronous Tool Execution**: Use Cloudflare Queues or another messaging system to offload long-running tool executions to a separate Worker. The original Worker would immediately return a "tool in progress" or similar response, and the client would poll or receive a webhook when the tool completes.
    *   **Increased Worker Timeout**: Configure the Cloudflare Worker to have a longer execution timeout, though this has limits.

### 4.4. Scaling and Cost Considerations for Durable Objects
*   **Scaling**: Durable Objects scale by creating more instances. Each unique `conversationId` maps to a unique Durable Object instance. This allows for massive parallelism across different conversations.
*   **Cost**: Costs are typically based on:
    *   **Requests**: Invocations of Durable Object methods.
    *   **Storage**: Data stored within the Durable Object.
    *   **Duration**: How long Durable Object instances are active.
    *   **Egress**: Data transfer out.
    *   **Optimization**: To manage costs, especially for inactive conversations, implement lifecycle management:
        *   **Alarms**: Use `state.storage.setAlarm()` to schedule a callback for an object after a period of inactivity. This alarm handler can then check for continued inactivity and `state.storage.deleteAll()` to clear the state and effectively "destroy" the object (it will be re-created if the conversation resumes).
        *   **Explicit Cleanup**: Provide an API endpoint or mechanism for clients to explicitly signal the end of a conversation, allowing the proxy to delete the Durable Object state immediately.

### 4.5. Alternative Approaches (Brief)
*   **Encoding Context in `tool_use_id`**: Instead of storing the mapping, one could try to encode the `tool_name` directly into the `tool_use_id` (e.g., `toolu_base64encoded_toolname_randomid`). However, this has drawbacks:
    *   **Security/Privacy**: Exposes internal tool names to the client.
    *   **Length Limits**: IDs can become long.
    *   **Complexity**: Requires careful encoding/decoding.
    *   **Reliability**: Still relies on the `tool_use_id` being passed back correctly.
*   **Simplified Tool Usage**: If full bidirectional tool calling is not strictly necessary, limit the proxy to only *generating* tool calls, and not processing `tool_result` messages. This would avoid the state management complexity but significantly reduce functionality.

### 4.6. Integration with Existing Translation and Guidance Mechanisms

The proposed Durable Objects solution is highly complementary to existing translation logic (like `server.py` or our `src/transformers`) and semantic guidance mechanisms (like `CLAUDE.md`).

*   **Translation Layer (`server.py` / `src/transformers`)**: This layer handles the **syntactic** mapping of tool definitions and tool call requests/responses between Anthropic and OpenAI/Gemini formats. Durable Objects do not replace this; instead, they provide the **missing state** that makes this syntactic translation robust for bidirectional tool calls. Specifically, Durable Objects will store the `tool_use_id` to `tool_name` mapping created when an OpenAI `function_call` is translated to an Anthropic `tool_use` block. This stored information is then retrieved when an Anthropic `tool_result` comes back, ensuring the correct `tool_name` is passed to the downstream OpenAI/Gemini API.
*   **Semantic Guidance (`CLAUDE.md`)**: This document aims to influence the **semantic** behavior of Gemini, guiding it to make more appropriate and useful tool suggestions. This is about the *quality* of the tool calls. The Durable Objects solution is about the *technical correctness* of linking `tool_use_id`s to `tool_name`s, making the tool-calling *functional*. Both aspects are crucial for a complete and intelligent Claude-Gemini integration.

This deeper research confirms that Durable Objects are the most appropriate solution for this problem and highlights key considerations for a robust implementation.