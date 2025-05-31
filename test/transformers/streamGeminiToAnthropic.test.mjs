import assert from 'assert';
import { createGeminiToAnthropicStreamTransformer } from '../../src/transformers/streamAnthropic.mjs';

describe('GeminiToAnthropicStreamTransformer', () => {
    const anthropicModelName = "claude-custom-model-stream";
    const originalRequestId = "req_stream_456";

    function collectStreamOutput(transformer, geminiChunks) {
        let sseOutput = "";
        for (const chunk of geminiChunks) {
            sseOutput += transformer.transform(chunk);
        }
        return sseOutput;
    }

    function parseSseEvents(sseString) {
        const events = [];
        const lines = sseString.split('\n\n');
        for (const line of lines) {
            if (line.trim() === "") continue;
            const eventLines = line.split('\n');
            const typeLine = eventLines.find(l => l.startsWith("event: "));
            const dataLine = eventLines.find(l => l.startsWith("data: "));
            if (typeLine && dataLine) {
                events.push({
                    type: typeLine.substring("event: ".length),
                    data: JSON.parse(dataLine.substring("data: ".length))
                });
            }
        }
        return events;
    }

    it('should stream a functionCall: name then args, then stop', () => {
        const transformer = createGeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, false, {});
        const geminiChunks = [
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "test_func" } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { args: "{\\"param\\": \\"val" } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { args: "ue\\"}" } }] } }] },
            { candidates: [{ finishReason: "TOOL_CODE_EXECUTED", content: {parts: []} }], usageMetadata: {promptTokenCount:10, candidatesTokenCount:5} } // Ensure content is present even if empty for finish chunk
        ];

        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        assert.strictEqual(events[0].type, "message_start");
        assert.strictEqual(events[0].data.message.id, originalRequestId);
        assert.strictEqual(events[0].data.message.role, "assistant");

        assert.strictEqual(events[1].type, "content_block_start");
        assert.strictEqual(events[1].data.content_block.type, "tool_use");
        assert.strictEqual(events[1].data.content_block.name, "test_func");
        assert.ok(events[1].data.content_block.id.startsWith("toolu_"));
        const toolUseId = events[1].data.content_block.id;
        const toolUseIndex = events[1].data.index;

        assert.strictEqual(events[2].type, "content_block_delta");
        assert.strictEqual(events[2].data.index, toolUseIndex);
        assert.strictEqual(events[2].data.delta.type, "input_json_delta");
        assert.strictEqual(events[2].data.delta.partial_json, "{\\"param\\": \\"val");

        assert.strictEqual(events[3].type, "content_block_delta");
        assert.strictEqual(events[3].data.index, toolUseIndex);
        assert.strictEqual(events[3].data.delta.type, "input_json_delta");
        assert.strictEqual(events[3].data.delta.partial_json, "ue\\"}");

        assert.strictEqual(events[4].type, "content_block_stop");
        assert.strictEqual(events[4].data.index, toolUseIndex);

        assert.strictEqual(events[5].type, "message_delta");
        assert.strictEqual(events[5].data.delta.stop_reason, "tool_use");
        assert.deepStrictEqual(events[5].data.usage, { output_tokens: 5 }); // from usageMetadata

        assert.strictEqual(events[6].type, "message_stop");
    });

    it('should stream a functionCall: name and full args in one part', () => {
        const transformer = createGeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, false, {});
        const geminiChunks = [
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "test_func", args: "{\\"param\\": \\"value\\"}" } }] } }] },
            { candidates: [{ finishReason: "TOOL_CODE_EXECUTED", content: {parts: []} }], usageMetadata: {promptTokenCount:10, candidatesTokenCount:3} }
        ];

        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        assert.strictEqual(events[0].type, "message_start");
        assert.strictEqual(events[1].type, "content_block_start");
        assert.strictEqual(events[1].data.content_block.type, "tool_use");
        assert.strictEqual(events[1].data.content_block.name, "test_func");
        const toolUseIndex = events[1].data.index;

        assert.strictEqual(events[2].type, "content_block_delta");
        assert.strictEqual(events[2].data.delta.type, "input_json_delta");
        assert.strictEqual(events[2].data.delta.partial_json, "{\\"param\\": \\"value\\"}");

        assert.strictEqual(events[3].type, "content_block_stop");
        assert.strictEqual(events[4].type, "message_delta");
        assert.strictEqual(events[4].data.delta.stop_reason, "tool_use");
        assert.deepStrictEqual(events[4].data.usage, { output_tokens: 3 });
        assert.strictEqual(events[5].type, "message_stop");
    });

    it('should stream text, then a functionCall', () => {
        const transformer = createGeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, false, {});
        const geminiChunks = [
            { candidates: [{ content: { role: "model", parts: [{ text: "Hello. " }] } }] },
            { candidates: [{ content: { parts: [{ text: "Let me call a tool. " }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { name: "query_db" } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { args: "{\\"query\\":\\"select all\\"}" } }] } }] },
            { candidates: [{ finishReason: "TOOL_CODE_EXECUTED", content: {parts: []} }] }
        ];
        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        assert.strictEqual(events[0].type, "message_start");

        // Text block 1
        assert.strictEqual(events[1].type, "content_block_start");
        assert.strictEqual(events[1].data.content_block.type, "text");
        const textIndex1 = events[1].data.index;
        assert.strictEqual(events[2].type, "content_block_delta");
        assert.strictEqual(events[2].data.delta.text, "Hello. ");
        assert.strictEqual(events[3].type, "content_block_delta"); // Second text part appends to the same block
        assert.strictEqual(events[3].data.delta.text, "Let me call a tool. ");

        // Text block 1 stops, tool block starts
        assert.strictEqual(events[4].type, "content_block_stop"); // Stop for text block
        assert.strictEqual(events[4].data.index, textIndex1);

        assert.strictEqual(events[5].type, "content_block_start"); // Start for tool block
        assert.strictEqual(events[5].data.content_block.type, "tool_use");
        assert.strictEqual(events[5].data.content_block.name, "query_db");
        const toolIndex1 = events[5].data.index;

        assert.strictEqual(events[6].type, "content_block_delta");
        assert.strictEqual(events[6].data.delta.type, "input_json_delta");
        assert.strictEqual(events[6].data.delta.partial_json, "{\\"query\\":\\"select all\\"}");

        assert.strictEqual(events[7].type, "content_block_stop"); // Stop for tool block
        assert.strictEqual(events[7].data.index, toolIndex1);

        assert.strictEqual(events[8].type, "message_delta");
        assert.strictEqual(events[8].data.delta.stop_reason, "tool_use");
        assert.strictEqual(events[9].type, "message_stop");
    });

    it('should handle stream ending with MAX_TOKENS after a functionCall started', () => {
        const transformer = createGeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, false, {});
        const geminiChunks = [
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "long_running_tool" } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { args: "{\\"input\\": \\"start" } }] } }] },
            // Stream cuts off, MAX_TOKENS is the reason
            { candidates: [{ finishReason: "MAX_TOKENS", content: {parts: []} }] }
        ];

        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        assert.strictEqual(events[0].type, "message_start");
        assert.strictEqual(events[1].type, "content_block_start"); // Tool start
        const toolIndex = events[1].data.index;
        assert.strictEqual(events[1].data.content_block.name, "long_running_tool");

        assert.strictEqual(events[2].type, "content_block_delta"); // Args delta
        assert.strictEqual(events[2].data.delta.partial_json, "{\\"input\\": \\"start");

        assert.strictEqual(events[3].type, "content_block_stop"); // Tool stop due to finish_reason
        assert.strictEqual(events[3].data.index, toolIndex);

        assert.strictEqual(events[4].type, "message_delta");
        // Even though a tool was active, MAX_TOKENS should take precedence.
        // The current implementation of emitMessageDelta in streamAnthropic.mjs prioritizes MAX_TOKENS.
        assert.strictEqual(events[4].data.delta.stop_reason, "max_tokens");
        assert.strictEqual(events[5].type, "message_stop");
    });

    it('should correctly handle multiple separate tool calls in a stream', () => {
        const transformer = createGeminiToAnthropicStreamTransformer(anthropicModelName, originalRequestId, false, {});
        const geminiChunks = [
            // First tool call
            { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "tool_one" } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { args: "{\\"p1\\":\\"v1\\"}" } }] } }] },
            // Second tool call, Gemini might send a new part for it
            { candidates: [{ content: { parts: [{ functionCall: { name: "tool_two" } }] } }] },
            { candidates: [{ content: { parts: [{ functionCall: { args: "{\\"p2\\":\\"v2\\"}" } }] } }] },
            { candidates: [{ finishReason: "TOOL_CODE_EXECUTED", content: {parts: []} }] }
        ];
        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        // message_start
        assert.strictEqual(events[0].type, "message_start");

        // Tool One
        assert.strictEqual(events[1].type, "content_block_start");
        assert.strictEqual(events[1].data.content_block.type, "tool_use");
        assert.strictEqual(events[1].data.content_block.name, "tool_one");
        const toolOneIndex = events[1].data.index;
        assert.strictEqual(events[2].type, "content_block_delta");
        assert.strictEqual(events[2].data.delta.partial_json, "{\\"p1\\":\\"v1\\"}");

        // Tool One stops, Tool Two starts
        assert.strictEqual(events[3].type, "content_block_stop"); // Stop for tool_one
        assert.strictEqual(events[3].data.index, toolOneIndex);

        assert.strictEqual(events[4].type, "content_block_start"); // Start for tool_two
        assert.strictEqual(events[4].data.content_block.type, "tool_use");
        assert.strictEqual(events[4].data.content_block.name, "tool_two");
        const toolTwoIndex = events[4].data.index;
        assert.strictEqual(events[5].type, "content_block_delta");
        assert.strictEqual(events[5].data.delta.partial_json, "{\\"p2\\":\\"v2\\"}");

        // Tool Two stops
        assert.strictEqual(events[6].type, "content_block_stop");
        assert.strictEqual(events[6].data.index, toolTwoIndex);

        // Message end
        assert.strictEqual(events[7].type, "message_delta");
        assert.strictEqual(events[7].data.delta.stop_reason, "tool_use");
        assert.strictEqual(events[8].type, "message_stop");
    });

    it('should correctly transform a pure text-only stream from Gemini', () => {
        // Mock original request for input token calculation in message_start
        const mockOriginalRequest = {
            messages: [{ role: "user", content: "Test prompt" }]
            // input_tokens for this would be roughly len("Test prompt")/4 = ~3 if using rough calc
        };
        const transformer = createGeminiToAnthropicStreamTransformer(
            anthropicModelName,
            originalRequestId,
            true, // streamIncludeUsage
            mockOriginalRequest
        );

        const geminiChunks = [
            // First text chunk, also implies role: "model"
            { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }] },
            // Second text chunk
            { candidates: [{ content: { parts: [{ text: " world" }] } }] },
            // Final chunk with finish reason and last text part
            {
              candidates: [{
                finishReason: "STOP",
                content: { parts: [{ text: "!" }] }
                // Note: Gemini might not have 'tokenCount' here; usage is from usageMetadata
              }],
              usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3 } // Example usage
            }
        ];

        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        assert.strictEqual(events.length, 8, "Should be 8 SSE events for this text stream");

        // 1. message_start
        assert.strictEqual(events[0].type, "message_start");
        assert.strictEqual(events[0].data.message.id, originalRequestId);
        assert.strictEqual(events[0].data.message.role, "assistant");
        assert.strictEqual(events[0].data.message.model, anthropicModelName);
        assert.ok(events[0].data.message.usage.input_tokens > 0, "Input tokens should be estimated");

        // 2. content_block_start (for text)
        assert.strictEqual(events[1].type, "content_block_start");
        assert.strictEqual(events[1].data.index, 0);
        assert.strictEqual(events[1].data.content_block.type, "text");
        assert.strictEqual(events[1].data.content_block.text, "");

        // 3. content_block_delta (Hello)
        assert.strictEqual(events[2].type, "content_block_delta");
        assert.strictEqual(events[2].data.index, 0);
        assert.strictEqual(events[2].data.delta.type, "text_delta");
        assert.strictEqual(events[2].data.delta.text, "Hello");

        // 4. content_block_delta ( world)
        assert.strictEqual(events[3].type, "content_block_delta");
        assert.strictEqual(events[3].data.index, 0);
        assert.strictEqual(events[3].data.delta.type, "text_delta");
        assert.strictEqual(events[3].data.delta.text, " world");

        // 5. content_block_delta (!) - from the final chunk part
        assert.strictEqual(events[4].type, "content_block_delta");
        assert.strictEqual(events[4].data.index, 0);
        assert.strictEqual(events[4].data.delta.type, "text_delta");
        assert.strictEqual(events[4].data.delta.text, "!");

        // 6. content_block_stop
        assert.strictEqual(events[5].type, "content_block_stop");
        assert.strictEqual(events[5].data.index, 0);

        // 7. message_delta
        assert.strictEqual(events[6].type, "message_delta");
        assert.strictEqual(events[6].data.delta.stop_reason, "end_turn");
        assert.strictEqual(events[6].data.delta.stop_sequence, null);
        assert.deepStrictEqual(events[6].data.usage, { output_tokens: 3 }); // from usageMetadata.candidatesTokenCount

        // 8. message_stop
        assert.strictEqual(events[7].type, "message_stop");
    });

    it('should map Gemini finishReason SAFETY to Anthropic stop_reason content_filter', () => {
        const mockOriginalRequest = { messages: [{ role: "user", content: "Unsafe prompt" }] };
        const transformer = createGeminiToAnthropicStreamTransformer(
            anthropicModelName,
            originalRequestId,
            true,
            mockOriginalRequest
        );

        const geminiChunks = [
            { candidates: [{ content: { role: "model", parts: [{ text: "Some initial text" }] } }] },
            {
              candidates: [{
                finishReason: "SAFETY",
                safetyRatings: [ // Example safetyRatings
                    { category: "HARM_CATEGORY_HATE_SPEECH", probability: "HIGH" }
                ],
                content: { parts: [{ text: "" }] } // Content might be empty or partial
              }],
              // Gemini might also include promptFeedback in the same final chunk or separately
              promptFeedback: {
                blockReason: "SAFETY", // This might be redundant if finishReason is SAFETY
                safetyRatings: [
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }
                ]
              },
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 }
            }
        ];

        const sseOutput = collectStreamOutput(transformer, geminiChunks);
        const events = parseSseEvents(sseOutput);

        // Expected: message_start, content_block_start, content_block_delta (for "Some initial text"),
        // content_block_stop, message_delta, message_stop
        assert.strictEqual(events.length, 6, "Should be 6 SSE events");

        assert.strictEqual(events[0].type, "message_start");
        assert.strictEqual(events[1].type, "content_block_start");
        assert.strictEqual(events[1].data.content_block.type, "text");
        assert.strictEqual(events[2].type, "content_block_delta");
        assert.strictEqual(events[2].data.delta.text, "Some initial text");
        assert.strictEqual(events[3].type, "content_block_stop");

        const messageDeltaEvent = events.find(e => e.type === "message_delta");
        assert.ok(messageDeltaEvent, "message_delta event not found");
        assert.strictEqual(messageDeltaEvent.data.delta.stop_reason, "content_filter");
        assert.deepStrictEqual(messageDeltaEvent.data.usage, { output_tokens: 2 });

        const messageStopEvent = events.find(e => e.type === "message_stop");
        assert.ok(messageStopEvent, "message_stop event not found");
    });
});

// Helper to run tests
if (import.meta.url === `file://${process.argv[1]}`) {
    const test = await import('node:test');
    const spec = await import('node:test/reporters');

    test.run({ files: [process.argv[1]] })
        .on('test:fail', () => process.exitCode = 1)
        .pipe(new spec.Spec())
        .pipe(process.stdout);
}
