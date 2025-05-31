import assert from 'assert';
import { transformAnthropicToGeminiRequest } from '../../src/transformers/requestAnthropic.mjs';
import { cleanGeminiSchema } from '../../src/transformers/requestAnthropic.mjs'; // Assuming cleanGeminiSchema is exported or testable

// Mock environment, if your function uses it (e.g., for model mapping)
const mockEnv = {
    MODEL_MAP_OPUS: "gemini-opus-equivalent",
    MODEL_MAP_SONNET: "gemini-sonnet-equivalent",
    MODEL_MAP_HAIKU: "gemini-haiku-equivalent",
};

describe('transformAnthropicToGeminiRequest', () => {
    describe('Tool Definitions', () => {
        it('should map a basic tool definition', () => {
            const anthropicReq = {
                model: "claude-3-sonnet-20240229",
                messages: [{ role: "user", content: "Hello" }],
                tools: [{
                    name: "get_weather",
                    description: "Get the current weather",
                    input_schema: {
                        type: "object",
                        properties: { location: { type: "string", description: "City and state" } },
                        required: ["location"]
                    }
                }]
            };
            const expectedGeminiReq = {
                contents: [{ role: "user", parts: [{ text: "Hello" }] }],
                tools: [{
                    functionDeclarations: [{
                        name: "get_weather",
                        description: "Get the current weather",
                        parameters: {
                            type: "object",
                            properties: { location: { type: "string", description: "City and state" } },
                            required: ["location"]
                        }
                    }]
                }],
                tool_config: { function_calling_config: { mode: "AUTO" } } // Default when tools are present
            };
            const actualGeminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.deepStrictEqual(actualGeminiReq.contents, expectedGeminiReq.contents);
            assert.deepStrictEqual(actualGeminiReq.tools, expectedGeminiReq.tools);
            assert.deepStrictEqual(actualGeminiReq.tool_config, expectedGeminiReq.tool_config);
        });

        it('should map multiple tool definitions', () => {
            const anthropicReq = {
                model: "claude-3-sonnet-20240229",
                messages: [{ role: "user", content: "Hello" }],
                tools: [
                    {
                        name: "get_weather",
                        description: "Get the current weather",
                        input_schema: { type: "object", properties: { location: { type: "string" } } }
                    },
                    {
                        name: "get_stock_price",
                        description: "Get stock price",
                        input_schema: { type: "object", properties: { symbol: { type: "string" } } }
                    }
                ]
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.strictEqual(geminiReq.tools[0].functionDeclarations.length, 2);
            assert.strictEqual(geminiReq.tools[0].functionDeclarations[0].name, "get_weather");
            assert.strictEqual(geminiReq.tools[0].functionDeclarations[1].name, "get_stock_price");
            assert.deepStrictEqual(geminiReq.tool_config, { function_calling_config: { mode: "AUTO" } });
        });
    });

    describe('Tool Choice Mapping', () => {
        const tools = [{ name: "get_weather", description: "Weather tool", input_schema: { type: "object", properties: { location: { type: "string" } } } }];

        it('should map tool_choice: "auto"', () => {
            const anthropicReq = { messages: [], tools, tool_choice: { type: "auto" } };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.deepStrictEqual(geminiReq.tool_config, { function_calling_config: { mode: "AUTO" } });
        });

        it('should map tool_choice: "any"', () => {
            const anthropicReq = { messages: [], tools, tool_choice: { type: "any" } };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.deepStrictEqual(geminiReq.tool_config, { function_calling_config: { mode: "ANY" } });
        });

        it('should map tool_choice: "tool"', () => {
            const anthropicReq = { messages: [], tools, tool_choice: { type: "tool", name: "get_weather" } };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.deepStrictEqual(geminiReq.tool_config, {
                function_calling_config: { mode: "ANY", allowed_function_names: ["get_weather"] }
            });
        });

        it('should default to AUTO if tools are present and tool_choice is undefined', () => {
            const anthropicReq = { messages: [], tools };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.deepStrictEqual(geminiReq.tool_config, { function_calling_config: { mode: "AUTO" } });
        });
    });

    describe('No Tools or Tool Choice None', () => {
        it('should set mode to NONE if no tools are in the request', () => {
            const anthropicReq = { messages: [{ role: "user", content: "Hi" }] };
            // In the implementation, if `anthropicReq.tools` is undefined or empty,
            // `geminiReq.tool_config` gets `mode: "NONE"`.
            // If `mode` is "NONE" and there were no tools, `tool_config` might be deleted.
            // Let's check against the actual implementation behavior.
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
             if (geminiReq.tool_config) { // If tool_config is present
                assert.deepStrictEqual(geminiReq.tool_config.function_calling_config.mode, "NONE");
             } else { // If tool_config is absent (because no tools implies no function calling config needed)
                assert.ok(true, "tool_config is correctly omitted when no tools are present and mode is NONE");
             }
             assert.strictEqual(geminiReq.tools, undefined, "tools property should be undefined");
        });

        it('should set mode to NONE if tools are present but tool_choice is "none"', () => {
            const anthropicReq = {
                messages: [],
                tools: [{ name: "get_weather", description: "Weather", input_schema: { type: "object" } }],
                tool_choice: { type: "none" } // Assuming Anthropic supports this or similar
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.deepStrictEqual(geminiReq.tool_config, { function_calling_config: { mode: "NONE" } });
            // Tools might still be defined in geminiReq.tools if mode is NONE, Gemini might ignore them or use for context.
            assert.ok(geminiReq.tools && geminiReq.tools[0].functionDeclarations.length > 0, "Tools can be defined even if mode is NONE");
        });
    });

    describe('Message History Transformation for Function Calling', () => {
        it('should map Anthropic tool_result to Gemini functionResponse', () => {
            const anthropicReq = {
                messages: [
                    { role: "user", content: "Call the tool." },
                    { role: "assistant", content: [{ type: "text", text: "OK." }, { type: "tool_use", id: "toolu_123", name: "run_query", input: { query: "test" } }] },
                    {
                        role: "user",
                        content: [{
                            type: "tool_result",
                            tool_use_id: "toolu_123",
                            content: { success: true, data: "result_data" }
                        }]
                    }
                ]
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.strictEqual(geminiReq.contents.length, 3);
            const geminiUserToolResultMsg = geminiReq.contents[2];
            assert.strictEqual(geminiUserToolResultMsg.role, "user");
            assert.strictEqual(geminiUserToolResultMsg.parts.length, 1);
            assert.ok(geminiUserToolResultMsg.parts[0].functionResponse);
            // TODO: The 'name' ideally should be the actual function name called by the model.
            // Using tool_use_id due to statelessness. This might need adjustment if Gemini
            // strictly requires the original function name from the model's functionCall.
            assert.strictEqual(geminiUserToolResultMsg.parts[0].functionResponse.name, "toolu_123");
            assert.deepStrictEqual(geminiUserToolResultMsg.parts[0].functionResponse.response, {
                result: { success: true, data: "result_data" }
            });
        });

        it('should map Anthropic assistant message with tool_use to Gemini model message with functionCall', () => {
            const anthropicReq = {
                messages: [
                    { role: "user", content: "Call the tool." },
                    {
                        role: "assistant",
                        content: [
                            { type: "text", text: "Okay, I will call the tool." },
                            { type: "tool_use", id: "toolu_abc", name: "fetch_data", input: { param: "value" } }
                        ]
                    }
                ]
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            assert.strictEqual(geminiReq.contents.length, 2);
            const geminiModelMsg = geminiReq.contents[1];
            assert.strictEqual(geminiModelMsg.role, "model");
            // Expecting two parts: one text, one functionCall
            assert.strictEqual(geminiModelMsg.parts.length, 2);
            assert.ok(geminiModelMsg.parts[0].text);
            assert.strictEqual(geminiModelMsg.parts[0].text, "Okay, I will call the tool.");
            assert.ok(geminiModelMsg.parts[1].functionCall);
            assert.strictEqual(geminiModelMsg.parts[1].functionCall.name, "fetch_data");
            assert.deepStrictEqual(geminiModelMsg.parts[1].functionCall.args, { param: "value" });
        });
    });

    describe('Schema Cleaning', () => {
        it('should remove "additionalProperties" and "default" from schema', () => {
            const schema = {
                type: "object",
                properties: {
                    location: { type: "string", default: "SF" }
                },
                additionalProperties: false
            };
            const cleaned = cleanGeminiSchema(schema);
            assert.strictEqual(cleaned.additionalProperties, undefined);
            assert.strictEqual(cleaned.properties.location.default, undefined);
        });
         it('should remove unsupported "format" from string types in schema', () => {
            const schema = {
                type: "object",
                properties: {
                    email: { type: "string", format: "email" }, // "email" is often unsupported
                    timestamp: { type: "string", format: "date-time" } // "date-time" is often supported
                }
            };
            const cleaned = cleanGeminiSchema(schema);
            assert.strictEqual(cleaned.properties.email.format, undefined);
            assert.strictEqual(cleaned.properties.timestamp.format, "date-time");
        });
    });
});

// Helper to run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const test = await import('node:test');
    const spec = await import('node:test/reporters');

    test.run({ files: [process.argv[1]] })
        .on('test:fail', () => process.exitCode = 1)
        .pipe(new spec.Spec())
        .pipe(process.stdout);
}
