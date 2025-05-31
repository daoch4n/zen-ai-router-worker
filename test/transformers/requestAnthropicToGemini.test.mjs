import assert from 'assert';
import {
    transformAnthropicToGeminiRequest,
    cleanGeminiSchema,
    anthropicToGeminiModelMap // Import the map
} from '../../src/transformers/requestAnthropic.mjs';
import { REASONING_EFFORT_MAP } from '../../src/constants/index.mjs';

// Mock environment, if your function uses it (e.g., for model mapping within transform function)
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

    describe('Generation Parameter Mapping', () => {
        it('should map Anthropic generation parameters to Gemini generationConfig', () => {
            const anthropicReq = {
              model: "claude-test",
              messages: [{ role: "user", content: "Generate text" }],
              max_tokens: 500,
              temperature: 0.7,
              top_p: 0.9,
              top_k: 40,
              stop_sequences: ["\n", "user:"]
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            assert.deepStrictEqual(geminiReq.generationConfig, {
              maxOutputTokens: 500,
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              stopSequences: ["\n", "user:"],
              thinkingConfig: { thinkingBudget: REASONING_EFFORT_MAP.high }
            }, "Gemini generationConfig should be correctly mapped and include default thinkingConfig");
        });

        it('should result in a generationConfig with only default thinkingConfig if no Anthropic generation parameters are set', () => {
            const anthropicReq = {
              model: "claude-test",
              messages: [{ role: "user", content: "Generate text" }]
              // No max_tokens, temperature, top_p, top_k, stop_sequences
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            assert.deepStrictEqual(geminiReq.generationConfig, {
                thinkingConfig: { thinkingBudget: REASONING_EFFORT_MAP.high }
            }, "Gemini generationConfig should only contain default thinkingConfig if no Anthropic params provided");
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

        it('should map Anthropic tool_choice: { type: "none" } to Gemini mode: NONE, keeping tool definitions', () => {
            const tools = [
                { name: "get_weather", description: "Get weather", input_schema: { type: "object", properties: {} } }
            ];
            const anthropicReq = {
                model: "claude-test",
                messages: [{ role: "user", content: "Hi" }],
                tools: tools,
                tool_choice: { type: "none" }
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            assert.deepStrictEqual(geminiReq.tool_config, {
                function_calling_config: { mode: "NONE" }
            }, "Gemini tool_config.function_calling_config.mode should be NONE");

            assert.ok(geminiReq.tools && geminiReq.tools[0].functionDeclarations.length > 0, "Gemini 'tools' should still be defined if Anthropic tools were provided, even if mode is NONE");
            assert.strictEqual(geminiReq.tools[0].functionDeclarations[0].name, "get_weather");
        });

        // Removed the test for tool_choice: { type: "none" } as "none" is not a standard Anthropic type,
        // and mode: "NONE" is covered by the "no tools" case or if explicitly set by a valid Anthropic choice
        // that the transformer logic might map to NONE (though current logic doesn't show such a mapping for a non-standard type).
        // RE-ADDITION: The above comment about removing the test for "none" was from a previous iteration.
        // The current task specifically asks to test for `tool_choice: { type: "none" }` if Anthropic supports it
        // or if the transformer has logic for it. The transformer *does* have logic for it.
    });

    describe('System Prompt Mapping', () => {
        it('should map Anthropic system prompt to Gemini systemInstruction', () => {
            const anthropicReq = {
              model: "claude-test",
              system: "You are a helpful assistant.",
              messages: [{ role: "user", content: "Hi" }]
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            assert.deepStrictEqual(geminiReq.systemInstruction, {
              role: "system", // As per current implementation which adds role:"system"
              parts: [{ text: "You are a helpful assistant." }]
            }, "Gemini systemInstruction should be correctly mapped");

            // Ensure messages are still processed
            assert.ok(geminiReq.contents && geminiReq.contents.length === 1);
            assert.strictEqual(geminiReq.contents[0].parts[0].text, "Hi");
        });

        it('should not have systemInstruction if Anthropic system prompt is absent', () => {
            const anthropicReq = {
              model: "claude-test",
              messages: [{ role: "user", content: "Hi" }]
            };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

            assert.strictEqual(geminiReq.systemInstruction, undefined, "Gemini systemInstruction should be undefined if no Anthropic system prompt");
        });
    });

    it('should reflect model mapping from env if transformAnthropicToGeminiRequest set geminiReq.model', () => {
      const anthropicReq = {
        model: 'claude-3-opus-20240229',
        messages: [{ role: 'user', content: 'Hello' }]
      };
      // mockEnv is assumed to be defined in the scope of the describe block, as per existing file structure.
      // const mockEnv = {
      //   MODEL_MAP_OPUS: "gemini-opus-equivalent",
      //   MODEL_MAP_SONNET: "gemini-sonnet-equivalent",
      //   MODEL_MAP_HAIKU: "gemini-haiku-equivalent",
      // };
      const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, mockEnv);

      // IMPORTANT: The current transformAnthropicToGeminiRequest function DOES NOT set geminiReq.model.
      // This assertion is written based on the user feedback's implication that geminiReq.model *should* be set
      // by the transformer using the env variables.
      // This test is expected to fail with the current code, highlighting this gap/assumption.
      assert.strictEqual(geminiReq.model, mockEnv.MODEL_MAP_OPUS,
        "Test Failed: transformAnthropicToGeminiRequest does not set geminiReq.model. It is currently undefined. If this behavior is desired, the function needs modification.");
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

    describe('Thinking Budget Configuration', () => {
        it('should default to high budget and no includeThoughts for model with no suffix', () => {
            const anthropicReq = { model: 'claude-3-opus-20240229', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = {}; // Rely on anthropicToGeminiModelMap
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            assert.ok(geminiReq.generationConfig, 'generationConfig should exist');
            assert.deepStrictEqual(geminiReq.generationConfig.thinkingConfig, {
                thinkingBudget: REASONING_EFFORT_MAP.high, // 24576
                // includeThoughts should not be present or false for standard mode
            }, 'Thinking config should default to high budget and no includeThoughts for standard model');
             assert.ok(geminiReq.generationConfig.thinkingConfig.includeThoughts === undefined || geminiReq.generationConfig.thinkingConfig.includeThoughts === false);
        });

        it('should apply thinking-low budget and includeThoughts: true for -thinking-low suffix', () => {
            const anthropicReq = { model: 'claude-3-opus-20240229', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = { MODEL_MAP_OPUS: "gemini-pro-thinking-low" };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            assert.ok(geminiReq.generationConfig, 'generationConfig should exist');
            assert.deepStrictEqual(geminiReq.generationConfig.thinkingConfig, {
                thinkingBudget: REASONING_EFFORT_MAP.low, // 1024
                includeThoughts: true
            }, 'Thinking config should be low budget and includeThoughts true');
        });

        it('should apply refined-medium budget and includeThoughts: false for -refined-medium suffix', () => {
            const anthropicReq = { model: 'claude-3-sonnet-20240229', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = { MODEL_MAP_SONNET: "gemini-pro-refined-medium" };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            assert.ok(geminiReq.generationConfig, 'generationConfig should exist');
            assert.deepStrictEqual(geminiReq.generationConfig.thinkingConfig, {
                thinkingBudget: REASONING_EFFORT_MAP.medium, // 8192
                includeThoughts: false
            }, 'Thinking config should be medium budget and includeThoughts false for refined');
        });

        it('should not include thinkingConfig for -thinking-none suffix (budget 0)', () => {
            const anthropicReq = { model: 'claude-3-haiku-20240307', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = { MODEL_MAP_HAIKU: "gemini-pro-thinking-none" };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            // thinkingBudget will be 0, so thinkingConfig itself should not be added.
            // If generationConfig only had thinkingConfig, it might be deleted.
            // For this test, ensure max_tokens is set so generationConfig is not empty.
            anthropicReq.max_tokens = 100; // Ensure generationConfig isn't empty for other reasons
            const updatedGeminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);

            assert.ok(updatedGeminiReq.generationConfig, 'generationConfig should still exist');
            assert.strictEqual(updatedGeminiReq.generationConfig.thinkingConfig, undefined, 'thinkingConfig should be undefined for thinking-none (budget 0)');
        });

        it('should default to high budget and includeThoughts: true for -thinking-garbage suffix', () => {
            const anthropicReq = { model: 'claude-3-opus-20240229', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = { MODEL_MAP_OPUS: "gemini-pro-thinking-garbage" };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            assert.ok(geminiReq.generationConfig, 'generationConfig should exist');
            assert.deepStrictEqual(geminiReq.generationConfig.thinkingConfig, {
                thinkingBudget: REASONING_EFFORT_MAP.high, // 24576 (default high)
                includeThoughts: true // because mode is 'thinking'
            }, 'Thinking config should default to high budget and includeThoughts true for invalid budget level in thinking mode');
        });

        it('should default to high budget and includeThoughts: false for -refined-nonsense suffix', () => {
            const anthropicReq = { model: 'claude-3-sonnet-20240229', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = { MODEL_MAP_SONNET: "gemini-pro-refined-nonsense" };
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            assert.ok(geminiReq.generationConfig, 'generationConfig should exist');
            assert.deepStrictEqual(geminiReq.generationConfig.thinkingConfig, {
                thinkingBudget: REASONING_EFFORT_MAP.high, // 24576 (default high)
                includeThoughts: false // because mode is 'refined'
            }, 'Thinking config should default to high budget and includeThoughts false for invalid budget level in refined mode');
        });

        it('should default to high budget for a different Anthropic model with no suffix', () => {
            const anthropicReq = { model: 'claude-2.1', messages: [{ role: 'user', content: 'Hello' }] };
            const currentMockEnv = {}; // Rely on anthropicToGeminiModelMap
            const geminiReq = transformAnthropicToGeminiRequest(anthropicReq, currentMockEnv);
            assert.ok(geminiReq.generationConfig, 'generationConfig should exist');
            assert.deepStrictEqual(geminiReq.generationConfig.thinkingConfig, {
                thinkingBudget: REASONING_EFFORT_MAP.high, // 24576
                 // includeThoughts should not be present or false for standard mode
            }, 'Thinking config should default to high budget for standard model claude-2.1');
            assert.ok(geminiReq.generationConfig.thinkingConfig.includeThoughts === undefined || geminiReq.generationConfig.thinkingConfig.includeThoughts === false);
        });
    });
});

describe('Anthropic to Gemini Model Mapping (anthropicToGeminiModelMap)', () => {
    it('should correctly map claude-3-opus-20240229', () => {
      assert.strictEqual(anthropicToGeminiModelMap['claude-3-opus-20240229'], "gemini-2.5-flash-preview-05-20", "Mapping for Opus model is incorrect");
    });

    it('should correctly map claude-3-sonnet-20240229', () => {
      assert.strictEqual(anthropicToGeminiModelMap['claude-3-sonnet-20240229'], "gemini-2.5-flash-preview-05-20", "Mapping for Sonnet model is incorrect");
    });

    it('should correctly map claude-3-haiku-20240307', () => {
      assert.strictEqual(anthropicToGeminiModelMap['claude-3-haiku-20240307'], "gemini-2.5-flash-preview-05-20", "Mapping for Haiku model is incorrect");
    });

    it('should correctly map claude-2.1', () => {
      assert.strictEqual(anthropicToGeminiModelMap['claude-2.1'], "gemini-2.5-flash-preview-05-20", "Mapping for Claude 2.1 model is incorrect");
    });

    it('should correctly map claude-2.0', () => {
      assert.strictEqual(anthropicToGeminiModelMap['claude-2.0'], "gemini-2.5-flash-preview-05-20", "Mapping for Claude 2.0 model is incorrect");
    });

    it('should correctly map claude-instant-1.2', () => {
      assert.strictEqual(anthropicToGeminiModelMap['claude-instant-1.2'], "gemini-2.5-flash-preview-05-20", "Mapping for Claude Instant 1.2 model is incorrect");
    });

    it('should return undefined for an unmapped Anthropic model', () => {
      assert.strictEqual(anthropicToGeminiModelMap['unmapped-claude-model-xyz'], undefined, "Should be undefined for unmapped models");
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
