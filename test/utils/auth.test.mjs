/**
 * Tests for authentication utilities
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { makeHeaders, getRandomApiKey } from '../../src/utils/auth.mjs';
import { HttpError } from '../../src/utils/error.mjs';
import { createMockRequest, createMockEnv } from '../setup.mjs';

describe('auth utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('makeHeaders', () => {
    it('should create headers with API key', () => {
      const apiKey = 'test-api-key';
      const headers = makeHeaders(apiKey);

      expect(headers).toEqual({
        'x-goog-api-client': 'genai-js/0.24.1',
        'x-goog-api-key': 'test-api-key'
      });
    });

    it('should create headers without API key when not provided', () => {
      const headers = makeHeaders(null);

      expect(headers).toEqual({
        'x-goog-api-client': 'genai-js/0.24.1'
      });
    });

    it('should merge additional headers', () => {
      const apiKey = 'test-api-key';
      const additionalHeaders = {
        'Content-Type': 'application/json',
        'Custom-Header': 'custom-value'
      };
      const headers = makeHeaders(apiKey, additionalHeaders);

      expect(headers).toEqual({
        'x-goog-api-client': 'genai-js/0.24.1',
        'x-goog-api-key': 'test-api-key',
        'Content-Type': 'application/json',
        'Custom-Header': 'custom-value'
      });
    });

    it('should handle undefined additional headers', () => {
      const apiKey = 'test-api-key';
      const headers = makeHeaders(apiKey, undefined);

      expect(headers).toEqual({
        'x-goog-api-client': 'genai-js/0.24.1',
        'x-goog-api-key': 'test-api-key'
      });
    });
  });

  describe('getRandomApiKey', () => {
    it('should extract API key from Authorization header', () => {
      const request = createMockRequest({
        headers: {
          'Authorization': 'Bearer test-pass'
        }
      });
      const env = createMockEnv();

      const apiKey = getRandomApiKey(request, env);

      expect(apiKey).toMatch(/^test-key-[1-4]$/);
    });

    it('should throw error when no Authorization header', () => {
      const request = createMockRequest({
        headers: {}
      });
      const env = createMockEnv();

      expect(() => getRandomApiKey(request, env)).toThrow(HttpError);
      expect(() => getRandomApiKey(request, env)).toThrow('Bad credentials - no api key');
    });

    it('should throw error when wrong password', () => {
      const request = createMockRequest({
        headers: {
          'Authorization': 'Bearer wrong-pass'
        }
      });
      const env = createMockEnv();

      expect(() => getRandomApiKey(request, env)).toThrow(HttpError);
      expect(() => getRandomApiKey(request, env)).toThrow('Bad credentials - wrong api key');
    });

    it('should throw error when no API keys in environment', () => {
      const request = createMockRequest({
        headers: {
          'Authorization': 'Bearer test-pass'
        }
      });
      const env = createMockEnv({
        KEY1: null,
        KEY2: null,
        KEY3: null,
        KEY4: null
      });

      expect(() => getRandomApiKey(request, env)).toThrow(HttpError);
      expect(() => getRandomApiKey(request, env)).toThrow('Bad credentials - check api keys in worker');
    });

    it('should return random API key from available keys', () => {
      const request = createMockRequest({
        headers: {
          'Authorization': 'Bearer test-pass'
        }
      });
      const env = createMockEnv({
        KEY1: 'api-key-1',
        KEY2: 'api-key-2',
        KEY3: null,
        KEY4: null
      });

      const apiKey = getRandomApiKey(request, env);

      expect(['api-key-1', 'api-key-2']).toContain(apiKey);
    });
  });
});
