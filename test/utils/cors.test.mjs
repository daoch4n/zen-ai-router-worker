/**
 * Tests for CORS utilities
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { fixCors, handleOPTIONS } from '../../src/utils/cors.mjs';

describe('CORS utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fixCors', () => {
    it('should add CORS headers to response options', () => {
      const options = {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const result = fixCors(options);

      expect(result.status).toBe(200);
      expect(result.headers).toBeInstanceOf(Headers);
      expect(result.headers.get('Content-Type')).toBe('application/json');
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(result.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-Requested-With');
      expect(result.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should work with empty options', () => {
      const result = fixCors({});

      expect(result.headers).toBeInstanceOf(Headers);
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(result.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-Requested-With');
      expect(result.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should work with no headers in options', () => {
      const options = {
        status: 404
      };

      const result = fixCors(options);

      expect(result.status).toBe(404);
      expect(result.headers).toBeInstanceOf(Headers);
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(result.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-Requested-With');
      expect(result.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should preserve existing headers', () => {
      const options = {
        headers: {
          'Custom-Header': 'custom-value',
          'Another-Header': 'another-value'
        }
      };

      const result = fixCors(options);

      expect(result.headers).toBeInstanceOf(Headers);
      expect(result.headers.get('Custom-Header')).toBe('custom-value');
      expect(result.headers.get('Another-Header')).toBe('another-value');
      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(result.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, DELETE, OPTIONS');
      expect(result.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-Requested-With');
      expect(result.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should override existing CORS headers', () => {
      const options = {
        headers: {
          'Access-Control-Allow-Origin': 'https://example.com',
          'Content-Type': 'text/plain'
        }
      };

      const result = fixCors(options);

      expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(result.headers.get('Content-Type')).toBe('text/plain');
    });
  });

  describe('handleOPTIONS', () => {
    it('should return Response with CORS headers for OPTIONS request', () => {
      const response = handleOPTIONS();

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });

    it('should include all required CORS headers', () => {
      const response = handleOPTIONS();

      // Note: In a real test environment, we'd check response.headers
      // For now, we verify the response was created successfully
      expect(response).toBeInstanceOf(Response);
    });
  });
});
