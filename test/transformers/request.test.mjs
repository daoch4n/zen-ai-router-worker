/**
 * Tests for request transformation functions
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  transformConfig,
  transformMsg,
  transformMessages,
  transformTools,
  transformRequest,
  transformFnResponse,
  transformFnCalls
} from '../../src/transformers/request.mjs';
import { THINKING_MODES } from '../../src/constants/index.mjs';

describe('Request Transformers', () => {
  describe('transformConfig', () => {
    it('should transform basic OpenAI config to Gemini format', () => {
      const req = {
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.8,  // This will be overridden to 0.9
        frequency_penalty: 0.5,
        presence_penalty: 0.3
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.7,
        maxOutputTokens: 100,
        topP: 0.95,  // Always forced to 0.9
        frequencyPenalty: 0.5,
        presencePenalty: 0.3
      });
    });

    it('should handle reasoning_effort parameter', () => {
      const req = {
        reasoning_effort: "high",
        temperature: 0.5
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.5,
        topP: 0.95,
        thinkingConfig: {
          thinkingBudget: 24576
        }
      });
    });

    it('should handle thinking config parameter', () => {
      const req = {
        temperature: 0.7
      };
      const thinkingConfig = {
        thinkingBudget: 8192,
        includeThoughts: true
      };

      const result = transformConfig(req, thinkingConfig);

      expect(result).toEqual({
        temperature: 0.7,
        topP: 0.95,
        thinkingConfig: {
          thinkingBudget: 8192,
          includeThoughts: true
        }
      });
    });

    it('should ignore unmapped fields', () => {
      const req = {
        temperature: 0.7,
        unknown_field: "value",
        another_unknown: 123
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.7,
        topP: 0.95
      });
    });

    it('should handle empty request', () => {
      const result = transformConfig({});
      expect(result).toEqual({
        temperature: 0.2,
        topP: 0.95
      });
    });

    it('should set default temperature when not provided', () => {
      const req = {
        max_tokens: 100
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.2,
        maxOutputTokens: 100,
        topP: 0.95
      });
    });

    it('should force topP to 0.9 regardless of input', () => {
      const req = {
        temperature: 0.5,
        top_p: 0.7  // This should be overridden
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.5,
        topP: 0.95  // Should be 0.95, not 0.7
      });
    });

    it('should preserve provided temperature and force topP', () => {
      const req = {
        temperature: 0.8,
        max_tokens: 200,
        top_p: 0.5  // This should be overridden
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.8,
        maxOutputTokens: 200,
        topP: 0.95  // Should be 0.95, not 0.5
      });
    });
  });

  describe('transformMsg', () => {
    it('should transform simple text message', async () => {
      const message = {
        role: "user",
        content: "Hello, world!"
      };

      const result = await transformMsg(message);

      expect(result).toEqual([
        { text: "Hello, world!" }
      ]);
    });

    it('should transform array content with text', async () => {
      const message = {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" }
        ]
      };

      const result = await transformMsg(message);

      expect(result).toEqual([
        { text: "Hello" },
        { text: "World" }
      ]);
    });

    it('should transform image content', async () => {
      const message = {
        role: "user",
        content: [
          { type: "text", text: "What's in this image?" },
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
            }
          }
        ]
      };

      const result = await transformMsg(message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ text: "What's in this image?" });
      expect(result[1]).toHaveProperty('inlineData');
      expect(result[1].inlineData).toHaveProperty('mimeType', 'image/jpeg');
      expect(result[1].inlineData).toHaveProperty('data');
    });

    it('should transform audio content', async () => {
      const message = {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: "base64audiodata",
              format: "wav"
            }
          }
        ]
      };

      const result = await transformMsg(message);

      expect(result).toEqual([
        {
          inlineData: {
            mimeType: "audio/wav",
            data: "base64audiodata"
          }
        }
      ]);
    });

    it('should add empty text for image-only content', async () => {
      const message = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
            }
          }
        ]
      };

      const result = await transformMsg(message);

      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ text: "" });
    });

    it('should throw error for unknown content type', async () => {
      const message = {
        role: "user",
        content: [
          { type: "unknown_type", data: "test" }
        ]
      };

      await expect(transformMsg(message)).rejects.toThrow('Unknown "content" item type: "unknown_type"');
    });
  });

  describe('transformMessages', () => {
    it('should transform basic user and assistant messages', async () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" }
      ];

      const result = await transformMessages(messages);

      expect(result.contents).toHaveLength(3);
      expect(result.contents[0]).toEqual({
        role: "user",
        parts: [{ text: "Hello" }]
      });
      expect(result.contents[1]).toEqual({
        role: "model",
        parts: [{ text: "Hi there!" }]
      });
      expect(result.contents[2]).toEqual({
        role: "user",
        parts: [{ text: "How are you?" }]
      });
    });

    it('should handle system instruction', async () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" }
      ];

      const result = await transformMessages(messages);

      // Token reduction should remove " a " from "You are a helpful assistant."
      expect(result.system_instruction).toEqual({
        parts: [{ text: "You helpful assistant." }]
      });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe("user");
    });

    it('should throw error for unknown role', async () => {
      const messages = [
        { role: "unknown_role", content: "test" }
      ];

      await expect(transformMessages(messages)).rejects.toThrow('Unknown message role: "unknown_role"');
    });

    it('should handle tool messages correctly', async () => {
      const messages = [
        { role: "user", content: "Get weather" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location": "NYC"}'
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"temperature": 72}'
        }
      ];

      const result = await transformMessages(messages);

      expect(result.contents).toHaveLength(3);
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[1].parts).toHaveLength(1);
      expect(result.contents[1].parts[0]).toHaveProperty("functionCall");
      expect(result.contents[2].role).toBe("function");
      expect(result.contents[2].parts[0]).toHaveProperty("functionResponse");
    });

    it('should handle multiple tool messages in sequence', async () => {
      const messages = [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "func1",
                arguments: '{}'
              }
            },
            {
              id: "call_456",
              type: "function",
              function: {
                name: "func2",
                arguments: '{}'
              }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"result": "first"}'
        },
        {
          role: "tool",
          tool_call_id: "call_456",
          content: '{"result": "second"}'
        }
      ];

      const result = await transformMessages(messages);

      expect(result.contents).toHaveLength(2);
      expect(result.contents[1].role).toBe("function");
      expect(result.contents[1].parts).toHaveLength(2);
    });

    it('should handle system instruction with empty first message', async () => {
      const messages = [
        { role: "system", content: "You are helpful" },
        { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,test" } }] }
      ];

      const result = await transformMessages(messages);

      // Token reduction should remove " are " from "You are helpful"
      expect(result.system_instruction).toEqual({
        parts: [{ text: "You helpful" }]
      });
      expect(result.contents).toHaveLength(2);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[0].parts).toEqual({ text: " " });
    });

    it('should return undefined for null messages', async () => {
      const result = await transformMessages(null);
      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined messages', async () => {
      const result = await transformMessages(undefined);
      expect(result).toBeUndefined();
    });
  });

  describe('transformTools', () => {
    it('should return empty object when no tools', () => {
      const req = { messages: [] };
      const result = transformTools(req);
      expect(result).toEqual({});
    });

    it('should transform function tools with Gemini compatibility adjustments', () => {
      const req = {
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather information",
              strict: true,  // This should be removed
              parameters: {
                $schema: "http://json-schema.org/draft-07/schema#",  // This will be removed
                type: "object",
                properties: {
                  location: { type: "string" },
                  temperature_range: {
                    type: "object",
                    properties: {
                      min: {
                        type: "number",
                        exclusiveMinimum: -273.15  // This will be removed
                      },
                      max: {
                        type: "number",
                        exclusiveMaximum: 1000     // This will be removed
                      }
                    },
                    allOf: [{ required: ["min"] }]  // This will be removed
                  }
                },
                additionalProperties: false,  // This will be removed
                if: {  // This will be removed
                  properties: { location: { const: "Antarctica" } }
                },
                then: {  // This will be removed
                  properties: {
                    temperature_range: {
                      properties: {
                        max: { maximum: 0 }
                      }
                    }
                  }
                }
              }
            }
          }
        ]
      };

      const result = transformTools(req);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toEqual({
        function_declarations: [{
          name: "get_weather",
          description: "Get weather information",
          // strict property should be removed
          parameters: {
            // $schema removed by adjustSchema
            type: "object",
            properties: {
              location: { type: "string" },
              temperature_range: {
                type: "object",
                properties: {
                  min: {
                    type: "number"
                    // exclusiveMinimum removed by adjustSchema
                  },
                  max: {
                    type: "number"
                    // exclusiveMaximum removed by adjustSchema
                  }
                }
                // allOf removed by adjustSchema
              }
            }
            // additionalProperties removed by adjustSchema
            // if/then removed by adjustSchema
          }
        }]
      });
    });

    it('should filter out unsupported tool types', () => {
      const req = {
        tools: [
          { type: "unsupported_type" },
          {
            type: "function",
            function: {
              name: "test_func",
              description: "Test function"
            }
          }
        ]
      };

      const result = transformTools(req);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].function_declarations).toHaveLength(1);
      expect(result.tools[0].function_declarations[0].name).toBe("test_func");
    });

    it('should handle tool_choice with specific function', () => {
      const req = {
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather"
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: {
            name: "get_weather"
          }
        }
      };

      const result = transformTools(req);

      expect(result.tool_config).toEqual({
        function_calling_config: {
          mode: "ANY",
          allowed_function_names: ["get_weather"]
        }
      });
    });

    it('should handle tool_choice with string value', () => {
      const req = {
        tools: [
          {
            type: "function",
            function: {
              name: "test_func",
              description: "Test"
            }
          }
        ],
        tool_choice: "auto"
      };

      const result = transformTools(req);

      expect(result.tool_config).toEqual({
        function_calling_config: {
          mode: "AUTO",
          allowed_function_names: undefined
        }
      });
    });

    it('should handle tool_choice with "none" value', () => {
      const req = {
        tools: [
          {
            type: "function",
            function: {
              name: "test_func",
              description: "Test"
            }
          }
        ],
        tool_choice: "none"
      };

      const result = transformTools(req);

      expect(result.tool_config).toEqual({
        function_calling_config: {
          mode: "NONE",
          allowed_function_names: undefined
        }
      });
    });

    it('should not set tool_config for unsupported tool_choice types', () => {
      const req = {
        tools: [
          {
            type: "function",
            function: {
              name: "test_func",
              description: "Test"
            }
          }
        ],
        tool_choice: {
          type: "unsupported_type"
        }
      };

      const result = transformTools(req);

      expect(result.tool_config).toBeUndefined();
    });
  });

  describe('transformRequest', () => {
    it('should transform complete request', async () => {
      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        temperature: 0.7,
        max_tokens: 100
      };

      const result = await transformRequest(req);

      expect(result).toHaveProperty('contents');
      expect(result).toHaveProperty('safetySettings');
      expect(result).toHaveProperty('generationConfig');
      expect(result.generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 100,
        topP: 0.95
      });
    });

    it('should include thinking config when provided', async () => {
      const req = {
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.5
      };
      const thinkingConfig = {
        thinkingBudget: 8192,
        includeThoughts: true
      };

      const result = await transformRequest(req, thinkingConfig);

      expect(result.generationConfig.thinkingConfig).toEqual(thinkingConfig);
    });
  });

  // Additional tests for missing coverage areas
  describe('transformConfig - Response Format Handling', () => {
    it('should handle json_schema response format', () => {
      const req = {
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: {
                  type: "number",
                  exclusiveMinimum: 0,  // Response format schemas are passed through
                  exclusiveMaximum: 150
                }
              },
              $schema: "http://json-schema.org/draft-07/schema#",  // Response format schemas are passed through
              allOf: [{ required: ["name"] }]  // Response format schemas are passed through
            }
          }
        }
      };

      const result = transformConfig(req);

      expect(result.responseJsonSchema).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          age: {
            type: "number",
            exclusiveMinimum: 0,
            exclusiveMaximum: 150
          }
        },
        $schema: "http://json-schema.org/draft-07/schema#",
        allOf: [{ required: ["name"] }]
      });
      expect(result.responseMimeType).toBe("application/json");
    });

    it('should handle json_schema with enum as text/x.enum', () => {
      const req = {
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              enum: ["option1", "option2", "option3"]
            }
          }
        }
      };

      const result = transformConfig(req);

      expect(result.responseJsonSchema).toEqual({
        enum: ["option1", "option2", "option3"]
      });
      expect(result.responseMimeType).toBe("text/x.enum");
    });

    it('should handle json_object response format', () => {
      const req = {
        response_format: {
          type: "json_object"
        }
      };

      const result = transformConfig(req);

      expect(result.responseMimeType).toBe("application/json");
    });

    it('should handle text response format', () => {
      const req = {
        response_format: {
          type: "text"
        }
      };

      const result = transformConfig(req);

      expect(result.responseMimeType).toBe("text/plain");
    });

    it('should throw error for unsupported response format', () => {
      const req = {
        response_format: {
          type: "unsupported_format"
        }
      };

      expect(() => transformConfig(req)).toThrow("Unsupported response_format.type");
    });

    it('should transform cookie recipes JSON schema to Gemini format', () => {
      // Test case based on the curl example for cookie recipes
      const req = {
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  recipeName: { type: "STRING" },
                  ingredients: {
                    type: "ARRAY",
                    items: { type: "STRING" }
                  }
                },
                propertyOrdering: ["recipeName", "ingredients"]
              }
            }
          }
        }
      };

      const result = transformConfig(req);

      // Verify the schema is passed through exactly as provided for Gemini API
      expect(result.responseJsonSchema).toEqual({
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            recipeName: { type: "STRING" },
            ingredients: {
              type: "ARRAY",
              items: { type: "STRING" }
            }
          },
          propertyOrdering: ["recipeName", "ingredients"]
        }
      });

      // Verify responseMimeType is set correctly
      expect(result.responseMimeType).toBe("application/json");
    });

    it('should handle Gemini-style type enums (uppercase) in JSON schema', () => {
      // Test with Gemini API's uppercase type enums
      const req = {
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "OBJECT",
              properties: {
                status: { type: "STRING" },
                count: { type: "NUMBER" },
                active: { type: "BOOLEAN" },
                tags: {
                  type: "ARRAY",
                  items: { type: "STRING" }
                }
              },
              propertyOrdering: ["status", "count", "active", "tags"]
            }
          }
        }
      };

      const result = transformConfig(req);

      // Verify uppercase types are preserved (Gemini API format)
      expect(result.responseJsonSchema).toEqual({
        type: "OBJECT",
        properties: {
          status: { type: "STRING" },
          count: { type: "NUMBER" },
          active: { type: "BOOLEAN" },
          tags: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        propertyOrdering: ["status", "count", "active", "tags"]
      });

      expect(result.responseMimeType).toBe("application/json");
    });
  });

  describe('transformFnCalls', () => {
    it('should transform function calls correctly', () => {
      const message = {
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"location": "New York"}'
            }
          },
          {
            id: "call_456",
            type: "function",
            function: {
              name: "get_time",
              arguments: '{"timezone": "UTC"}'
            }
          }
        ]
      };

      const result = transformFnCalls(message);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        functionCall: {
          id: null, // call_ prefix removed
          name: "get_weather",
          args: { location: "New York" }
        }
      });
      expect(result[1]).toEqual({
        functionCall: {
          id: null,
          name: "get_time",
          args: { timezone: "UTC" }
        }
      });
      expect(result.calls).toEqual({
        "call_123": { i: 0, name: "get_weather" },
        "call_456": { i: 1, name: "get_time" }
      });
    });

    it('should preserve non-call_ prefixed IDs', () => {
      const message = {
        tool_calls: [
          {
            id: "custom_id_123",
            type: "function",
            function: {
              name: "test_func",
              arguments: '{}'
            }
          }
        ]
      };

      const result = transformFnCalls(message);

      expect(result[0].functionCall.id).toBe("custom_id_123");
    });

    it('should throw error for unsupported tool call type', () => {
      const message = {
        tool_calls: [
          {
            id: "call_123",
            type: "unsupported_type",
            function: {
              name: "test",
              arguments: '{}'
            }
          }
        ]
      };

      expect(() => transformFnCalls(message)).toThrow('Unsupported tool_call type: "unsupported_type"');
    });

    it('should throw error for invalid function arguments JSON', () => {
      const message = {
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: {
              name: "test_func",
              arguments: 'invalid json'
            }
          }
        ]
      };

      expect(() => transformFnCalls(message)).toThrow('Invalid function arguments: invalid json');
    });
  });

  describe('transformFnResponse', () => {
    it('should transform function response correctly', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "get_weather" }
        }
      };
      const fnResponse = {
        tool_call_id: "call_123",
        content: '{"temperature": 72, "condition": "sunny"}'
      };

      transformFnResponse(fnResponse, parts);

      expect(parts[0]).toEqual({
        functionResponse: {
          id: null, // call_ prefix removed
          name: "get_weather",
          response: {
            temperature: 72,
            condition: "sunny"
          }
        }
      });
    });

    it('should preserve non-call_ prefixed tool_call_id', () => {
      const parts = {
        calls: {
          "custom_id": { i: 0, name: "test_func" }
        }
      };
      const fnResponse = {
        tool_call_id: "custom_id",
        content: '{"result": "success"}'
      };

      transformFnResponse(fnResponse, parts);

      expect(parts[0].functionResponse.id).toBe("custom_id");
    });

    it('should wrap non-object responses in result property', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "get_number" }
        }
      };
      const fnResponse = {
        tool_call_id: "call_123",
        content: '42'
      };

      transformFnResponse(fnResponse, parts);

      expect(parts[0].functionResponse.response).toEqual({ result: 42 });
    });

    it('should handle string responses', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "get_text" }
        }
      };
      const fnResponse = {
        tool_call_id: "call_123",
        content: '"hello world"'
      };

      transformFnResponse(fnResponse, parts);

      expect(parts[0].functionResponse.response).toEqual({ result: "hello world" });
    });

    it('should handle array responses', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "get_list" }
        }
      };
      const fnResponse = {
        tool_call_id: "call_123",
        content: '[1, 2, 3]'
      };

      transformFnResponse(fnResponse, parts);

      expect(parts[0].functionResponse.response).toEqual({ result: [1, 2, 3] });
    });

    it('should throw error when no function calls found', () => {
      const parts = {}; // No calls property
      const fnResponse = {
        tool_call_id: "call_123",
        content: '{"result": "test"}'
      };

      expect(() => transformFnResponse(fnResponse, parts)).toThrow("No function calls found in the previous message");
    });

    it('should throw error when tool_call_id is missing', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "test_func" }
        }
      };
      const fnResponse = {
        content: '{"result": "test"}'
        // tool_call_id missing
      };

      expect(() => transformFnResponse(fnResponse, parts)).toThrow("tool_call_id not specified");
    });

    it('should throw error for unknown tool_call_id', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "test_func" }
        }
      };
      const fnResponse = {
        tool_call_id: "unknown_id",
        content: '{"result": "test"}'
      };

      expect(() => transformFnResponse(fnResponse, parts)).toThrow("Unknown tool_call_id: unknown_id");
    });

    it('should throw error for duplicated tool_call_id', () => {
      const parts = {
        0: { existing: "response" }, // Already has response at index 0
        calls: {
          "call_123": { i: 0, name: "test_func" }
        }
      };
      const fnResponse = {
        tool_call_id: "call_123",
        content: '{"result": "test"}'
      };

      expect(() => transformFnResponse(fnResponse, parts)).toThrow("Duplicated tool_call_id: call_123");
    });

    it('should throw error for invalid JSON content', () => {
      const parts = {
        calls: {
          "call_123": { i: 0, name: "test_func" }
        }
      };
      const fnResponse = {
        tool_call_id: "call_123",
        content: 'invalid json'
      };

      expect(() => transformFnResponse(fnResponse, parts)).toThrow("Invalid function response: invalid json");
    });
  });
});
