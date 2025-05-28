/**
 * Integration tests for the main Cloudflare Worker
 * Tests end-to-end request routing, CORS, error handling, and API validation
 */

import { jest } from '@jest/globals';

// Mock all handler modules
jest.unstable_mockModule('../src/handlers/index.mjs', () => ({
  handleCompletions: jest.fn(),
  handleEmbeddings: jest.fn(),
  handleModels: jest.fn(),
  handleTTS: jest.fn()
}));

// Mock utils
jest.unstable_mockModule('../src/utils/index.mjs', () => ({
  getRandomApiKey: jest.fn(),
  forceSetWorkerLocation: jest.fn(),
  fixCors: jest.fn(),
  errorHandler: jest.fn(),
  HttpError: class HttpError extends Error {
    constructor(message, status = 500) {
      super(message);
      this.status = status;
    }
  }
}));

jest.unstable_mockModule('../src/utils/cors.mjs', () => ({
  handleOPTIONS: jest.fn()
}));

// Import modules after mocking
const { handleCompletions, handleEmbeddings, handleModels, handleTTS } = await import('../src/handlers/index.mjs');
const { getRandomApiKey, forceSetWorkerLocation, fixCors, errorHandler, HttpError } = await import('../src/utils/index.mjs');
const { handleOPTIONS } = await import('../src/utils/cors.mjs');
const worker = (await import('../src/worker.mjs')).default;

describe('Cloudflare Worker', () => {
  let mockEnv;
  let mockRequest;

  beforeEach(() => {
    jest.clearAllMocks();

    mockEnv = {
      API_KEYS: 'test-key-1,test-key-2',
      MOCK_DB: {}
    };

    // Default successful responses
    handleOPTIONS.mockReturnValue(new Response(null, { status: 200 }));
    getRandomApiKey.mockReturnValue('test-api-key');
    forceSetWorkerLocation.mockResolvedValue();
    fixCors.mockImplementation((response) => response);
    errorHandler.mockImplementation((err, corsHandler) => {
      const response = new Response(JSON.stringify({ error: err.message }), {
        status: err.status || 500,
        headers: { 'Content-Type': 'application/json' }
      });
      return corsHandler ? corsHandler(response) : response;
    });

    handleCompletions.mockResolvedValue(new Response('{"choices":[]}', { status: 200 }));
    handleEmbeddings.mockResolvedValue(new Response('{"data":[]}', { status: 200 }));
    handleModels.mockResolvedValue(new Response('{"data":[]}', { status: 200 }));
    handleTTS.mockResolvedValue(new Response('TTS endpoint hit', { status: 200 }));
  });

  describe('CORS Handling', () => {
    test('should handle OPTIONS requests for CORS preflight', async () => {
      mockRequest = new Request('https://api.example.com/v1/chat/completions', {
        method: 'OPTIONS'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(handleOPTIONS).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    });
  });

  describe('Request Routing', () => {
    test('should route POST /chat/completions to handleCompletions', async () => {
      mockRequest = new Request('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(getRandomApiKey).toHaveBeenCalledWith(mockRequest, mockEnv);
      expect(forceSetWorkerLocation).toHaveBeenCalledWith(mockEnv);
      expect(handleCompletions).toHaveBeenCalledWith(
        { messages: [{ role: 'user', content: 'Hello' }] },
        'test-api-key'
      );
      expect(response.status).toBe(200);
    });

    test('should route POST /embeddings to handleEmbeddings', async () => {
      mockRequest = new Request('https://api.example.com/v1/embeddings', {
        method: 'POST',
        body: JSON.stringify({ input: 'test text', model: 'text-embedding-ada-002' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(handleEmbeddings).toHaveBeenCalledWith(
        { input: 'test text', model: 'text-embedding-ada-002' },
        'test-api-key'
      );
      expect(response.status).toBe(200);
    });

    test('should route GET /models to handleModels', async () => {
      mockRequest = new Request('https://api.example.com/v1/models', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(handleModels).toHaveBeenCalledWith('test-api-key');
      expect(response.status).toBe(200);
    });

    test('should route POST /tts to handleTTS', async () => {
      mockRequest = new Request('https://api.example.com/v1/tts', {
        method: 'POST',
        body: JSON.stringify({ text: 'Hello world', model: 'gemini-2.0-flash' }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(handleTTS).toHaveBeenCalledWith(mockRequest, 'test-api-key');
      expect(response.status).toBe(200);
    });

    test('should return 404 for unknown endpoints', async () => {
      mockRequest = new Request('https://api.example.com/v1/unknown', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '404 Not Found',
          status: 404
        }),
        expect.any(Function)
      );
    });
  });

  describe('HTTP Method Validation', () => {
    test('should reject non-POST requests to /chat/completions', async () => {
      mockRequest = new Request('https://api.example.com/v1/chat/completions', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Assertion failed: expected POST request'
        }),
        expect.any(Function)
      );
    });

    test('should reject non-POST requests to /embeddings', async () => {
      mockRequest = new Request('https://api.example.com/v1/embeddings', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Assertion failed: expected POST request'
        }),
        expect.any(Function)
      );
    });

    test('should reject non-GET requests to /models', async () => {
      mockRequest = new Request('https://api.example.com/v1/models', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Assertion failed: expected GET request'
        }),
        expect.any(Function)
      );
    });

    test('should reject non-POST requests to /tts', async () => {
      mockRequest = new Request('https://api.example.com/v1/tts', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Assertion failed: expected POST request'
        }),
        expect.any(Function)
      );
    });
  });

  describe('Cloudflare Colo Restrictions', () => {
    test('should block restricted Cloudflare colos', async () => {
      const restrictedColos = ['DME', 'LED', 'SVX', 'KJA'];

      for (const colo of restrictedColos) {
        // Create a request with cf property containing the colo
        const mockRequestWithColo = {
          method: 'GET',
          url: 'https://api.example.com/v1/models',
          cf: { colo },
          json: jest.fn()
        };

        const response = await worker.fetch(mockRequestWithColo, mockEnv);

        expect(response.status).toBe(429);
        expect(await response.text()).toBe(`Bad Cloudflare colo: ${colo}. Try again`);
      }
    });

    test('should allow non-restricted Cloudflare colos', async () => {
      const mockRequestWithColo = {
        method: 'GET',
        url: 'https://api.example.com/v1/models',
        cf: { colo: 'LAX' },
        json: jest.fn()
      };

      const response = await worker.fetch(mockRequestWithColo, mockEnv);

      expect(response.status).toBe(200);
      expect(handleModels).toHaveBeenCalled();
    });

    test('should work when cf.colo is undefined', async () => {
      mockRequest = new Request('https://api.example.com/v1/models', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(response.status).toBe(200);
      expect(handleModels).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle handler errors with CORS', async () => {
      const testError = new Error('Handler failed');
      handleModels.mockRejectedValue(testError);

      mockRequest = new Request('https://api.example.com/v1/models', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(testError, expect.any(Function));
    });

    test('should handle JSON parsing errors', async () => {
      mockRequest = new Request('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: 'invalid json',
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SyntaxError'
        }),
        expect.any(Function)
      );
    });

    test('should handle API key validation errors', async () => {
      getRandomApiKey.mockImplementation(() => {
        throw new Error('No API key provided');
      });

      mockRequest = new Request('https://api.example.com/v1/models', {
        method: 'GET'
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'No API key provided'
        }),
        expect.any(Function)
      );
    });
  });

  describe('Integration Flow', () => {
    test('should complete full request flow successfully', async () => {
      mockRequest = new Request('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello, world!' }]
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      const response = await worker.fetch(mockRequest, mockEnv);

      // Verify the complete flow
      expect(getRandomApiKey).toHaveBeenCalledWith(mockRequest, mockEnv);
      expect(forceSetWorkerLocation).toHaveBeenCalledWith(mockEnv);
      expect(handleCompletions).toHaveBeenCalledWith(
        {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello, world!' }]
        },
        'test-api-key'
      );
      expect(response.status).toBe(200);
    });
  });
});
