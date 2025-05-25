import {
  transformAnthropicToOpenAIRequest
} from '../transformers/requestAnthropic.mjs';
import {
  transformOpenAIToAnthropicResponse
} from '../transformers/responseAnthropic.mjs';
import {
  createAnthropicStreamTransformer
} from '../transformers/streamAnthropic.mjs';
import {
  handleOpenAICompletions
} from './completions.mjs'; // This is the refactored core logic
import {
  parseStream,
  parseStreamFlush
} from '../transformers/stream.mjs'; // For parsing raw stream data
import {
  generateId
} from '../utils/helpers.mjs'; // For generating IDs
import {
  fixCors
} from '../utils/cors.mjs'; // For applying CORS headers
import {
  errorHandler
} from '../utils/error.mjs'; // For handling errors

/**
 * Handles requests to the Anthropic chat completions endpoint.
 * This function acts as an adapter, transforming Anthropic requests
 * to OpenAI format, calling the core OpenAI completions handler,
 * and then transforming the response back to Anthropic format.
 * @param {Object} req - The incoming Anthropic request object.
 * @param {string} apiKey - The API key.
 * @returns {Promise<Response>} - The Anthropic-compatible response.
 */
/**
 * Placeholder for external tool execution.
 * In a real scenario, this would dispatch to an MCP server or other external service.
 * @param {Object} toolCall - The tool call object from the LLM.
 * @param {Object} env - The environment bindings.
 * @returns {Promise<any>} - The result of the tool execution.
 */
async function executeExternalTool(toolCall, env) {
  // Simulate tool execution success or failure
  console.log(`Executing tool: ${toolCall.function.name} with arguments:`, toolCall.function.arguments);

  // Example: Simulate a tool failure for a specific tool name or argument
  if (toolCall.function.name === 'failing_tool' || toolCall.function.arguments.includes('error')) {
    throw new Error(`Simulated failure for tool '${toolCall.function.name}'`);
  }

  // In a real implementation, you would:
  // 1. Resolve the tool name to an actual function/API endpoint.
  // 2. Call the external tool with the parsed arguments.
  // 3. Return the result.
  // For now, we'll just return a success message.

  return {
    status: 'success',
    message: `Tool '${toolCall.function.name}' executed successfully with arguments: ${toolCall.function.arguments}`
  };
}


export async function handleAnthropicCompletions(req, apiKey, env) {
  const anthropicModelName = req.model; // Store original Anthropic model name

  // 1. Transform Anthropic request to OpenAI format
  let openAIReq = transformAnthropicToOpenAIRequest(req, env);

  // 2. Call the core OpenAI completions handler (which now handles OpenAI to Gemini)
  // This function will return an OpenAI-formatted response (either full JSON or a stream)
  let openAIRes;
  try {
    openAIRes = await handleOpenAICompletions(openAIReq, apiKey);
  } catch (error) {
    // Catch errors from handleOpenAICompletions and transform to Anthropic error
    return errorHandler(error, fixCors);
  }

  // 3. Handle non-streaming responses and potential tool calls
  if (!openAIReq.stream) {
    let openAIResBody;
    try {
      openAIResBody = await openAIRes.json();
      console.log('DEBUG: Raw OpenAI/Gemini non-streaming response:', JSON.stringify(openAIResBody, null, 2));
    } catch (error) {
      // Catch JSON parsing errors and transform to Anthropic error
      return errorHandler(error, fixCors);
    }

    const message = openAIResBody.choices?.[0]?.message;

    if (message && (message.tool_calls?.length > 0 || message.function_call)) {
      const toolMessages = [];
      const toolCalls = message.tool_calls || (message.function_call ? [{ function: message.function_call, id: `call_${generateId()}` }] : []);

      for (const toolCall of toolCalls) {
        try {
          const toolResult = await executeExternalTool(toolCall, env);
          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        } catch (error) {
          console.error(`Error executing tool ${toolCall.function.name}:`, error);
          const toolExecutionError = new ToolExecutionError(`Failed to execute tool '${toolCall.function.name}': ${error.message}`, error);
          toolMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            // Include a custom flag for the Anthropic transformer to recognize this as an error result
            content: JSON.stringify({ error: toolExecutionError.message, is_error: true }),
          });
        }
      }

      // Re-prompt the LLM with tool results
      const newMessages = [...openAIReq.messages, message, ...toolMessages];
      const newOpenAIReq = { ...openAIReq, messages: newMessages };

      // Call handleOpenAICompletions again with the tool results
      try {
        const finalOpenAIRes = await handleOpenAICompletions(newOpenAIReq, apiKey);
        const finalOpenAIResBody = await finalOpenAIRes.json();
        console.log('DEBUG: Final OpenAI/Gemini non-streaming response after tool execution:', JSON.stringify(finalOpenAIResBody, null, 2));
        return new Response(JSON.stringify(transformOpenAIToAnthropicResponse(
          finalOpenAIResBody,
          anthropicModelName,
          finalOpenAIResBody.id,
          env.CONVERSATION_STATE
        )), {
          headers: {
            'Content-Type': 'application/json',
            ...fixCors(finalOpenAIRes).headers
          }
        });
      } catch (error) {
        return errorHandler(error, fixCors);
      }
    }

    // If no tool calls, or if the LLM responds with text after tool execution,
    // transform the original response body to Anthropic format
    const anthropicResBody = transformOpenAIToAnthropicResponse(
      openAIResBody,
      anthropicModelName,
      openAIResBody.id, // Use OpenAI's ID for traceability
      env.CONVERSATION_STATE // Pass the Durable Object binding
    );
    return new Response(JSON.stringify(anthropicResBody), {
      headers: {
        'Content-Type': 'application/json',
        ...fixCors(openAIRes).headers // Apply CORS headers
      }
    });

  } else {
    // For streaming, pipe through the Anthropic stream transformer
    const openAIRequestId = openAIRes.headers.get('openai-request-id') || `chatcmpl-${generateId()}`; // Get ID for traceability
    const anthropicStream = openAIRes.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream({
        transform: parseStream, // This handles parsing raw stream data into JSON chunks
        flush: parseStreamFlush,
      }))
      .pipeThrough(new TransformStream({
        transform: (chunk, controller) => {
          if (!this.anthropicStreamTransformer) {
            this.anthropicStreamTransformer = createAnthropicStreamTransformer(
              anthropicModelName,
              openAIRequestId,
              req.stream_options?.include_usage, // Anthropic-specific stream option
              req // Pass original Anthropic request for input token calculation
            );
          }
          const anthropicSse = this.anthropicStreamTransformer.transform(chunk); // chunk should already be parsed object
          if (anthropicSse) {
            controller.enqueue(anthropicSse);
          }
        },
        flush: (controller) => {
          if (this.anthropicStreamTransformer) {
            const finalSse = this.anthropicStreamTransformer.transform("[DONE]");
            if (finalSse) {
              controller.enqueue(finalSse);
            }
          }
        }
      }))
      .pipeThrough(new TextEncoderStream());

    return new Response(anthropicStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...fixCors(openAIRes).headers // Apply CORS headers
      }
    });
  }
}