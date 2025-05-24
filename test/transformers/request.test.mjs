/**
 * Tests for request transformation functions
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  transformConfig,
  transformMsg,
  transformMessages,
  transformTools,
  transformRequest
} from '../../src/transformers/request.mjs';
import { THINKING_MODES } from '../../src/constants/index.mjs';

describe('Request Transformers', () => {
  describe('transformConfig', () => {
    it('should transform basic OpenAI config to Gemini format', () => {
      const req = {
        temperature: 0.7,
        max_tokens: 100,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3
      };

      const result = transformConfig(req);

      expect(result).toEqual({
        temperature: 0.7,
        maxOutputTokens: 100,
        topP: 0.9,
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
        temperature: 0.7
      });
    });

    it('should handle empty request', () => {
      const result = transformConfig({});
      expect(result).toEqual({});
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

      expect(result.system_instruction).toEqual({
        parts: [{ text: "You are a helpful assistant." }]
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
  });

  describe('transformTools', () => {
    it('should return empty object when no tools', () => {
      const req = { messages: [] };
      const result = transformTools(req);
      expect(result).toEqual({});
    });

    it('should transform function tools', () => {
      const req = {
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get weather information",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" }
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
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" }
            }
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
        maxOutputTokens: 100
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
});
