import assert from 'assert';
import { transformGeminiToAnthropicResponse } from '../../src/transformers/responseAnthropic.mjs';
import { generateId } from '../../src/utils/helpers.mjs'; // Used internally, mock if needed or ensure testable

// Mock generateId if its randomness affects predictability, though for these tests it might be fine.
// For simplicity, we'll let the actual generateId run. If tests become flaky, mock it.
// import sinon from 'sinon';
// let generateIdStub;
// before(() => { generateIdStub = sinon.stub(helpers, 'generateId').returns('fixed_id_123'); });
// after(() => { generateIdStub.restore(); });


describe('transformGeminiToAnthropicResponse', () => {
    const anthropicModelName = "claude-custom-model";
    const originalRequestId = "req_123";

    it('should map Gemini response with a single functionCall to Anthropic tool_use', () => {
        const geminiResp = {
            candidates: [{
                content: {
                    role: "model", // Gemini uses "model" for assistant
                    parts: [{
                        functionCall: {
                            name: "get_weather",
                            args: { location: "Boston, MA" }
                        }
                    }]
                },
                finishReason: "TOOL_CODE_EXECUTED" // Or "STOP" if that's what Gemini sends
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }
        };

        const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);

        assert.strictEqual(anthropicRes.id, originalRequestId);
        assert.strictEqual(anthropicRes.type, "message");
        assert.strictEqual(anthropicRes.role, "assistant");
        assert.strictEqual(anthropicRes.model, anthropicModelName);
        assert.strictEqual(anthropicRes.content.length, 1);
        assert.strictEqual(anthropicRes.content[0].type, "tool_use");
        assert.ok(anthropicRes.content[0].id.startsWith("toolu_")); // ID is generated
        assert.strictEqual(anthropicRes.content[0].name, "get_weather");
        assert.deepStrictEqual(anthropicRes.content[0].input, { location: "Boston, MA" });
        assert.strictEqual(anthropicRes.stop_reason, "tool_use");
        assert.deepStrictEqual(anthropicRes.usage, { input_tokens: 10, output_tokens: 20 });
    });

    it('should map Gemini response with parallel functionCalls to multiple Anthropic tool_use blocks', () => {
        const geminiResp = {
            candidates: [{
                content: {
                    role: "model",
                    parts: [
                        { functionCall: { name: "get_weather", args: { location: "Boston, MA" } } },
                        { functionCall: { name: "get_stock_price", args: { symbol: "GOOG" } } }
                    ]
                },
                finishReason: "TOOL_CODE_EXECUTED"
            }],
             usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 35 }
        };

        const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);

        assert.strictEqual(anthropicRes.content.length, 2);
        assert.strictEqual(anthropicRes.content[0].type, "tool_use");
        assert.strictEqual(anthropicRes.content[0].name, "get_weather");
        assert.deepStrictEqual(anthropicRes.content[0].input, { location: "Boston, MA" });
        assert.strictEqual(anthropicRes.content[1].type, "tool_use");
        assert.strictEqual(anthropicRes.content[1].name, "get_stock_price");
        assert.deepStrictEqual(anthropicRes.content[1].input, { symbol: "GOOG" });
        assert.strictEqual(anthropicRes.stop_reason, "tool_use");
         assert.deepStrictEqual(anthropicRes.usage, { input_tokens: 15, output_tokens: 35 });
    });

    it('should map Gemini response with only a text part', () => {
        const geminiResp = {
            candidates: [{
                content: {
                    role: "model",
                    parts: [{ text: "Hello, world!" }]
                },
                finishReason: "STOP"
            }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 }
        };

        const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);

        assert.strictEqual(anthropicRes.content.length, 1);
        assert.strictEqual(anthropicRes.content[0].type, "text");
        assert.strictEqual(anthropicRes.content[0].text, "Hello, world!");
        assert.strictEqual(anthropicRes.stop_reason, "end_turn");
        assert.deepStrictEqual(anthropicRes.usage, { input_tokens: 5, output_tokens: 3 });
    });

    it('should map Gemini response with mixed text and functionCall parts (if Gemini supports this, ensure graceful handling)', () => {
        // This tests if the transformer correctly processes all parts, even if mixed.
        // Typically, a model turn is either text OR tool_calls, but testing robustness.
        const geminiResp = {
            candidates: [{
                content: {
                    role: "model",
                    parts: [
                        { text: "Okay, I will get the weather." },
                        { functionCall: { name: "get_weather", args: { location: "London" } } }
                    ]
                },
                finishReason: "TOOL_CODE_EXECUTED"
            }]
        };
        const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);
        assert.strictEqual(anthropicRes.content.length, 2);
        assert.strictEqual(anthropicRes.content[0].type, "text");
        assert.strictEqual(anthropicRes.content[0].text, "Okay, I will get the weather.");
        assert.strictEqual(anthropicRes.content[1].type, "tool_use");
        assert.strictEqual(anthropicRes.content[1].name, "get_weather");
        assert.deepStrictEqual(anthropicRes.content[1].input, { location: "London" });
        assert.strictEqual(anthropicRes.stop_reason, "tool_use");
    });


    describe('Finish Reason Mapping', () => {
        const baseGeminiResp = {
            candidates: [{
                content: { role: "model", parts: [{ text: "Test" }] },
                // finishReason will be overridden
            }]
        };

        it('should map finishReason: MAX_TOKENS', () => {
            const geminiResp = { ...baseGeminiResp, candidates: [{ ...baseGeminiResp.candidates[0], finishReason: "MAX_TOKENS" }] };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.stop_reason, "max_tokens");
        });

        it('should map finishReason: SAFETY', () => {
            const geminiResp = { ...baseGeminiResp, candidates: [{ ...baseGeminiResp.candidates[0], finishReason: "SAFETY" }] };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.stop_reason, "content_filter");
        });

        it('should map finishReason: RECITATION', () => {
            const geminiResp = { ...baseGeminiResp, candidates: [{ ...baseGeminiResp.candidates[0], finishReason: "RECITATION" }] };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.stop_reason, "content_filter");
        });

        it('should map finishReason: STOP (with functionCall present) to tool_use', () => {
            // If Gemini sends "STOP" but there was a functionCall, it should be "tool_use"
            const geminiRespWithTool = {
                candidates: [{
                    content: {
                        role: "model",
                        parts: [{ functionCall: { name: "tool_func", args: {} } }]
                    },
                    finishReason: "STOP" // Gemini might send STOP if it considers the tool call the "stop"
                }]
            };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiRespWithTool, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.stop_reason, "tool_use");
        });

        it('should handle empty parts array and still map finish_reason', () => {
            const geminiResp = {
                candidates: [{
                    content: { role: "model", parts: [] }, // Empty parts
                    finishReason: "MAX_TOKENS"
                }]
            };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.content.length, 0); // No content blocks
            assert.strictEqual(anthropicRes.stop_reason, "max_tokens");
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should return an error structure if Gemini response has top-level error', () => {
            const geminiErrorResp = {
                error: {
                    code: 400,
                    message: "Invalid request",
                    status: "INVALID_ARGUMENT"
                }
            };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiErrorResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.type, "error");
            assert.ok(anthropicRes.error);
            assert.strictEqual(anthropicRes.error.type, "invalid_request_error");
            assert.ok(anthropicRes.error.message.includes("Upstream Gemini error: Invalid request"));
        });

        it('should return an error structure if promptFeedback indicates blockage', () => {
            const geminiBlockedResp = {
                promptFeedback: {
                    blockReason: "SAFETY",
                    safetyRatings: [{ category: "HARM_CATEGORY_SEXUAL", probability: "HIGH" }]
                }
                // No candidates usually in this case
            };
            const anthropicRes = transformGeminiToAnthropicResponse(geminiBlockedResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.type, "error");
            assert.ok(anthropicRes.error);
            assert.strictEqual(anthropicRes.error.type, "invalid_request_error"); // As per current mapping
            assert.ok(anthropicRes.error.message.includes("Request blocked due to SAFETY"));
        });

        it('should return an error if no candidates and no clear block reason', () => {
            const geminiNoCandidatesResp = {
                // No error, no promptFeedback, no candidates
            };
             const anthropicRes = transformGeminiToAnthropicResponse(geminiNoCandidatesResp, anthropicModelName, originalRequestId);
            assert.strictEqual(anthropicRes.type, "error");
            assert.ok(anthropicRes.error);
            assert.strictEqual(anthropicRes.error.type, "api_error");
            assert.strictEqual(anthropicRes.error.message, "No content generated by the model.");
        });
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
