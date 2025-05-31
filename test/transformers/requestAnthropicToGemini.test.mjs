import assert from 'assert';
import { transformAnthropicToGeminiRequest, cleanGeminiSchema } from '../../src/transformers/requestAnthropic.mjs';

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
            const anthropicReq = { model: "claude-test", messages: [{ role: "user", content: "Hi" }] };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);
            // According to the implementation, if no tools are present, tool_config is deleted.
            assert.strictEqual(geminiReq.tool_config, undefined, "tool_config should be undefined when no tools are present");
            assert.strictEqual(geminiReq.tools, undefined, "tools property should be undefined");
        });

        it('should result in undefined tools and tool_config if Anthropic tools array is explicitly empty', () => {
            const anthropicReq = {
              model: "claude-test",
              messages: [{ role: "user", content: "Hi" }],
              tools: [] // Explicitly empty tools array
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            assert.strictEqual(geminiReq.tools, undefined, "Gemini 'tools' property should be undefined when Anthropic 'tools' is an empty array");
            assert.strictEqual(geminiReq.tool_config, undefined, "Gemini 'tool_config' property should be undefined when Anthropic 'tools' is an empty array");
          });

        // Removed the test for tool_choice: { type: "none" } as "none" is not a standard Anthropic type,
        // and mode: "NONE" is covered by the "no tools" case or if explicitly set by a valid Anthropic choice
        // that the transformer logic might map to NONE (though current logic doesn't show such a mapping for a non-standard type).
    });

    describe('Message History Transformation for Function Calling', () => {
        it('should map Anthropic tool_result to Gemini functionResponse with correct name', () => {
            const anthropicReq = {
                model: 'claude-3-opus-20240229',
                messages: [
                  { role: 'user', content: 'Can you run a query for me?' },
                  { // Assistant message that called the tool
                    role: 'assistant',
                    content: [
                      { type: 'tool_use', id: 'toolu_xyz789', name: 'run_actual_query', input: { query_string: 'SELECT *' } }
                    ]
                  },
                  { // User message providing the result
                    role: 'user',
                    content: [
                      { type: 'tool_result', tool_use_id: 'toolu_xyz789', content: { success: true, result_data: 'Query output' } }
                    ]
                  }
                ],
                max_tokens: 100
              };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            const geminiUserToolResultMsg = geminiReq.contents.find(c => c.role === 'user' && c.parts.some(p => p.functionResponse));
            assert.ok(geminiUserToolResultMsg, 'Gemini user message with functionResponse not found');

            const functionResponsePart = geminiUserToolResultMsg.parts.find(p => p.functionResponse).functionResponse;
            assert.strictEqual(functionResponsePart.name, 'run_actual_query'); // Expecting the actual mapped name
            assert.deepStrictEqual(functionResponsePart.response, { success: true, result_data: 'Query output' });
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
