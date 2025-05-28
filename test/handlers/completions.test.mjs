/**
 * Tests for completions handler
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleCompletions } from '../../src/handlers/completions.mjs';
import { THINKING_MODES } from '../../src/constants/index.mjs';

// Mock the fetch function
global.fetch = jest.fn();

describe('Completions Handler', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('handleCompletions', () => {
    it('should handle basic chat completion request', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello! How can I help you?" }]
            },
            finishReason: "STOP"
          }
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 10,
          totalTokenCount: 15
        }
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        temperature: 0.7,
        max_tokens: 100,
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("generateContent"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-goog-api-key": "test-api-key",
            "Content-Type": "application/json"
          }),
          body: expect.any(String)
        })
      );

      expect(response).toBeInstanceOf(Response);
      const responseText = await response.text();
      const responseData = JSON.parse(responseText);

      expect(responseData.object).toBe("chat.completion");
      expect(responseData.choices).toHaveLength(1);
      expect(responseData.choices[0].message.content).toBe("Hello! How can I help you?");
    });

    it('should handle streaming request', async () => {
      const mockStreamResponse = {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            const chunk = 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}]}\n\n';
            controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          }
        })
      };

      fetch.mockResolvedValueOnce(mockStreamResponse);

      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        stream: true
      };

      const response = await handleCompletions(req, "test-api-key");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("streamGenerateContent?alt=sse"),
        expect.any(Object)
      );

      expect(response).toBeInstanceOf(Response);
      expect(response.body).toBeInstanceOf(ReadableStream);
    });

    it('should handle thinking mode models', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "<thinking>Let me think...</thinking>The answer is 42." }]
            },
            finishReason: "STOP"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const req = {
        model: "gemini-2.0-flash-thinking-high",
        messages: [
          { role: "user", content: "What is the meaning of life?" }
        ],
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      // Verify the request body includes thinking configuration
      const callArgs = fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.generationConfig.thinkingConfig).toEqual({
        thinkingBudget: 24576,
        includeThoughts: true
      });

      const responseText = await response.text();
      const responseData = JSON.parse(responseText);
      expect(responseData.choices[0].message.content).toContain("<thinking>");
    });

    it('should handle refined thinking mode', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "<thinking>Let me think...</thinking>The answer is 42." }]
            },
            finishReason: "STOP"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const req = {
        model: "gemini-2.0-flash-refined-medium",
        messages: [
          { role: "user", content: "What is the meaning of life?" }
        ],
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      const responseText = await response.text();
      const responseData = JSON.parse(responseText);
      // In refined mode, thinking tags should be removed
      expect(responseData.choices[0].message.content).toBe("The answer is 42.");
    });

    it('should handle search models', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Search results show..." }]
            },
            finishReason: "STOP"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const req = {
        model: "gemini-2.0-flash-search-preview",
        messages: [
          { role: "user", content: "What's the latest news?" }
        ],
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      // Verify search tool was added
      const callArgs = fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.tools).toContainEqual({ googleSearch: {} });
    });

    it('should handle models/ prefix', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Response" }]
            },
            finishReason: "STOP"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const req = {
        model: "models/gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        stream: false
      };

      await handleCompletions(req, "test-api-key");

      // Verify the URL uses the correct model name without models/ prefix
      const callArgs = fetch.mock.calls[0];
      expect(callArgs[0]).toContain("/models/gemini-2.0-flash:");
    });

    it('should handle API errors', async () => {
      const errorResponse = {
        error: {
          code: 400,
          message: "Invalid request"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        stream: false
      };

      // With enhanced error handling, non-streaming requests now throw HttpError instead of returning Response
      await expect(handleCompletions(req, "test-api-key")).rejects.toThrow('Invalid request format or parameters.');
    });

    it('should handle invalid completion response', async () => {
      const invalidResponse = {
        // Missing candidates field
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 0,
          totalTokenCount: 5
        }
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(invalidResponse))
      });

      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      // The handler catches the error and returns the response as-is with original status
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      // The response body should be the original text response (before parsing)
      const responseText = await response.text();
      // When the Response constructor gets an object, it converts it to "[object Object]"
      expect(responseText).toBe("[object Object]");
    });

    it('should handle reasoning_effort parameter', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Thoughtful response" }]
            },
            finishReason: "STOP"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Think carefully about this..." }
        ],
        reasoning_effort: "medium",
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      // Verify reasoning_effort was transformed to thinkingConfig
      const callArgs = fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.generationConfig.thinkingConfig.thinkingBudget).toBe(8192);
    });

    it('should handle stream_options with include_usage', async () => {
      const mockStreamResponse = {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            const chunk = 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":10,"totalTokenCount":15}}\n\n';
            controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          }
        })
      };

      fetch.mockResolvedValueOnce(mockStreamResponse);

      const req = {
        model: "gemini-2.0-flash",
        messages: [
          { role: "user", content: "Hello" }
        ],
        stream: true,
        stream_options: {
          include_usage: true
        }
      };

      const response = await handleCompletions(req, "test-api-key");

      expect(response).toBeInstanceOf(Response);
      expect(response.body).toBeInstanceOf(ReadableStream);
    });

    it('should properly convert JSON schema requests to Gemini format', async () => {
      // Mock response that matches the expected JSON schema structure
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{
                text: JSON.stringify([
                  {
                    "recipeName": "Chocolate Chip Cookies",
                    "ingredients": [
                      "1 cup (2 sticks) unsalted butter, softened",
                      "3/4 cup granulated sugar",
                      "3/4 cup packed brown sugar",
                      "1 teaspoon vanilla extract",
                      "2 large eggs",
                      "2 1/4 cups all-purpose flour",
                      "1 teaspoon baking soda",
                      "1 teaspoon salt",
                      "2 cups chocolate chips"
                    ]
                  },
                  {
                    "recipeName": "Sugar Cookies",
                    "ingredients": [
                      "2 3/4 cups all-purpose flour",
                      "1 teaspoon baking soda",
                      "1/2 teaspoon salt",
                      "1 cup butter, softened",
                      "1 1/2 cups white sugar",
                      "1 egg",
                      "1 teaspoon vanilla extract"
                    ]
                  }
                ])
              }]
            },
            finishReason: "STOP"
          }
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 120,
          totalTokenCount: 135
        }
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      // OpenAI-style request with JSON schema (similar to the curl example)
      const req = {
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "user",
            content: "List a few popular cookie recipes, and include the amounts of ingredients."
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recipeName: { type: "string" },
                  ingredients: {
                    type: "array",
                    items: { type: "string" }
                  }
                },
                propertyOrdering: ["recipeName", "ingredients"]
              }
            }
          }
        },
        stream: false
      };

      const response = await handleCompletions(req, "test-api-key");

      // Verify the request was transformed correctly for Gemini API
      const callArgs = fetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      // Check that responseSchema is properly set (Gemini format)
      expect(requestBody.generationConfig.responseJsonSchema).toEqual({
        type: "array",
        items: {
          type: "object",
          properties: {
            recipeName: { type: "string" },
            ingredients: {
              type: "array",
              items: { type: "string" }
            }
          },
          propertyOrdering: ["recipeName", "ingredients"]
        }
      });

      // Check that responseMimeType is set to application/json
      expect(requestBody.generationConfig.responseMimeType).toBe("application/json");

      // Verify the URL is correct for Gemini API
      expect(callArgs[0]).toContain("generateContent");
      expect(callArgs[0]).toContain("gemini-2.0-flash");

      // Verify headers include API key and content type
      expect(callArgs[1].headers).toEqual(expect.objectContaining({
        "x-goog-api-key": "test-api-key",
        "Content-Type": "application/json"
      }));

      // Verify the response is properly formatted
      expect(response).toBeInstanceOf(Response);
      const responseText = await response.text();
      const responseData = JSON.parse(responseText);

      expect(responseData.object).toBe("chat.completion");
      expect(responseData.choices).toHaveLength(1);

      // Parse the JSON content to verify it matches the schema
      const content = JSON.parse(responseData.choices[0].message.content);
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(2);
      expect(content[0]).toHaveProperty('recipeName');
      expect(content[0]).toHaveProperty('ingredients');
      expect(Array.isArray(content[0].ingredients)).toBe(true);
    });
  });
});
