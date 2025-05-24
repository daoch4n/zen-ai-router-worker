/**
 * Tests for models handler
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleModels } from '../../src/handlers/models.mjs';

// Mock the fetch function
global.fetch = jest.fn();

describe('Models Handler', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('handleModels', () => {
    it('should fetch and transform models list successfully', async () => {
      const mockGeminiResponse = {
        models: [
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash",
            description: "Fast and versatile multimodal model",
            inputTokenLimit: 1000000,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
          },
          {
            name: "models/gemini-pro",
            displayName: "Gemini Pro",
            description: "Best model for scaling across a wide range of tasks",
            inputTokenLimit: 30720,
            outputTokenLimit: 2048,
            supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
          },
          {
            name: "models/text-embedding-004",
            displayName: "Text Embedding 004",
            description: "Text embedding model",
            inputTokenLimit: 2048,
            outputTokenLimit: 1,
            supportedGenerationMethods: ["embedText"]
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      });

      const response = await handleModels("test-api-key");

      // Verify the fetch call
      expect(fetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-goog-api-key": "test-api-key"
          })
        })
      );

      // Verify the response
      expect(response).toBeInstanceOf(Response);
      expect(response.ok).toBe(true);

      const responseText = await response.text();
      const responseData = JSON.parse(responseText);

      expect(responseData).toEqual({
        object: "list",
        data: [
          {
            id: "gemini-2.0-flash",
            object: "model",
            created: 0,
            owned_by: ""
          },
          {
            id: "gemini-pro",
            object: "model",
            created: 0,
            owned_by: ""
          },
          {
            id: "text-embedding-004",
            object: "model",
            created: 0,
            owned_by: ""
          }
        ]
      });
    });

    it('should handle empty models list', async () => {
      const mockGeminiResponse = {
        models: []
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      });

      const response = await handleModels("test-api-key");

      expect(response.ok).toBe(true);

      const responseText = await response.text();
      const responseData = JSON.parse(responseText);

      expect(responseData).toEqual({
        object: "list",
        data: []
      });
    });

    it('should remove models/ prefix from model names', async () => {
      const mockGeminiResponse = {
        models: [
          {
            name: "models/gemini-2.0-flash-exp",
            displayName: "Gemini 2.0 Flash Experimental"
          },
          {
            name: "models/gemma-2-9b-it",
            displayName: "Gemma 2 9B IT"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      });

      const response = await handleModels("test-api-key");

      const responseText = await response.text();
      const responseData = JSON.parse(responseText);

      expect(responseData.data).toEqual([
        {
          id: "gemini-2.0-flash-exp",
          object: "model",
          created: 0,
          owned_by: ""
        },
        {
          id: "gemma-2-9b-it",
          object: "model",
          created: 0,
          owned_by: ""
        }
      ]);
    });

    it('should handle API errors gracefully', async () => {
      const errorResponse = {
        error: {
          code: 401,
          message: "Invalid API key"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        body: JSON.stringify(errorResponse)
      });

      const response = await handleModels("invalid-api-key");

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('should handle network errors', async () => {
      fetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(handleModels("test-api-key")).rejects.toThrow("Network error");
    });

    it('should handle malformed JSON response', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("invalid json")
      });

      await expect(handleModels("test-api-key")).rejects.toThrow();
    });

    it('should handle response without models field', async () => {
      const mockResponse = {
        // Missing models field
        someOtherField: "value"
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse))
      });

      await expect(handleModels("test-api-key")).rejects.toThrow();
    });

    it('should preserve CORS headers from original response', async () => {
      const mockGeminiResponse = {
        models: [
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash"
          }
        ]
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Content-Type': 'application/json'
        }),
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      };

      fetch.mockResolvedValueOnce(mockResponse);

      const response = await handleModels("test-api-key");

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
    });

    it('should format JSON response with proper indentation', async () => {
      const mockGeminiResponse = {
        models: [
          {
            name: "models/gemini-2.0-flash",
            displayName: "Gemini 2.0 Flash"
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      });

      const response = await handleModels("test-api-key");

      const responseText = await response.text();

      // Check that the JSON is formatted with indentation
      expect(responseText).toContain('  "object": "list"');
      expect(responseText).toContain('    "id": "gemini-2.0-flash"');
    });

    it('should use correct API endpoint', async () => {
      const mockGeminiResponse = {
        models: []
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      });

      await handleModels("test-api-key");

      expect(fetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models",
        expect.any(Object)
      );
    });

    it('should include proper authorization header', async () => {
      const mockGeminiResponse = {
        models: []
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockGeminiResponse))
      });

      await handleModels("my-secret-key");

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-goog-api-key": "my-secret-key",
            "x-goog-api-client": expect.any(String)
          })
        })
      );
    });
  });
});
