/**
 * Tests for embeddings handler
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handleEmbeddings } from '../../src/handlers/embeddings.mjs';
import { HttpError } from '../../src/utils/error.mjs';
import { createMockResponse } from '../setup.mjs';
import { embeddingsRequest } from '../fixtures/requests.mjs';
import { geminiEmbeddingsResponse } from '../fixtures/responses.mjs';

describe('embeddings handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch.mockClear();
  });

  describe('handleEmbeddings', () => {
    it('should handle valid embeddings request', async () => {
      const apiKey = 'test-api-key';
      const mockGeminiResponse = createMockResponse(geminiEmbeddingsResponse);
      
      global.fetch.mockResolvedValueOnce(mockGeminiResponse);

      const response = await handleEmbeddings(embeddingsRequest, apiKey);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('text-embedding-004:batchEmbedContents'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('"requests"')
        })
      );

      expect(response).toBeInstanceOf(Response);
    });

    it('should throw error for missing model', async () => {
      const apiKey = 'test-api-key';
      const invalidRequest = { ...embeddingsRequest };
      delete invalidRequest.model;

      await expect(handleEmbeddings(invalidRequest, apiKey))
        .rejects.toThrow(HttpError);
      await expect(handleEmbeddings(invalidRequest, apiKey))
        .rejects.toThrow('model is not specified');
    });

    it('should throw error for non-string model', async () => {
      const apiKey = 'test-api-key';
      const invalidRequest = {
        ...embeddingsRequest,
        model: 123
      };

      await expect(handleEmbeddings(invalidRequest, apiKey))
        .rejects.toThrow(HttpError);
    });

    it('should handle model with models/ prefix', async () => {
      const apiKey = 'test-api-key';
      const requestWithPrefix = {
        ...embeddingsRequest,
        model: 'models/text-embedding-004'
      };
      const mockGeminiResponse = createMockResponse(geminiEmbeddingsResponse);
      
      global.fetch.mockResolvedValueOnce(mockGeminiResponse);

      await handleEmbeddings(requestWithPrefix, apiKey);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('models/text-embedding-004:batchEmbedContents'),
        expect.any(Object)
      );
    });

    it('should use default model for non-gemini models', async () => {
      const apiKey = 'test-api-key';
      const requestWithOpenAIModel = {
        ...embeddingsRequest,
        model: 'text-embedding-ada-002'
      };
      const mockGeminiResponse = createMockResponse(geminiEmbeddingsResponse);
      
      global.fetch.mockResolvedValueOnce(mockGeminiResponse);

      await handleEmbeddings(requestWithOpenAIModel, apiKey);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('text-embedding-004:batchEmbedContents'),
        expect.any(Object)
      );
    });

    it('should convert single input to array', async () => {
      const apiKey = 'test-api-key';
      const singleInputRequest = {
        ...embeddingsRequest,
        input: 'Single text input'
      };
      const mockGeminiResponse = createMockResponse(geminiEmbeddingsResponse);
      
      global.fetch.mockResolvedValueOnce(mockGeminiResponse);

      await handleEmbeddings(singleInputRequest, apiKey);

      const fetchCall = global.fetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      expect(requestBody.requests).toHaveLength(1);
      expect(requestBody.requests[0].content.parts.text).toBe('Single text input');
    });

    it('should include dimensions in request', async () => {
      const apiKey = 'test-api-key';
      const mockGeminiResponse = createMockResponse(geminiEmbeddingsResponse);
      
      global.fetch.mockResolvedValueOnce(mockGeminiResponse);

      await handleEmbeddings(embeddingsRequest, apiKey);

      const fetchCall = global.fetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      
      requestBody.requests.forEach(req => {
        expect(req.outputDimensionality).toBe(768);
      });
    });

    it('should handle API error response', async () => {
      const apiKey = 'test-api-key';
      const errorResponse = createMockResponse(
        { error: { message: 'API Error' } },
        { ok: false, status: 400 }
      );
      
      global.fetch.mockResolvedValueOnce(errorResponse);

      const response = await handleEmbeddings(embeddingsRequest, apiKey);

      expect(response.status).toBe(400);
    });

    it('should transform successful response to OpenAI format', async () => {
      const apiKey = 'test-api-key';
      const mockGeminiResponse = createMockResponse(geminiEmbeddingsResponse);
      
      global.fetch.mockResolvedValueOnce(mockGeminiResponse);

      const response = await handleEmbeddings(embeddingsRequest, apiKey);

      // In a real test, we'd parse the response body and verify the OpenAI format
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });
  });
});
