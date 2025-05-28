/**
 * Tests for enhanced error handling utilities.
 * Validates Google API error mapping, text validation, and voice name validation.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  HttpError,
  mapGoogleApiError,
  processGoogleApiError,
  validateTextLength,
  validateVoiceName
} from '../../src/utils/error.mjs';
import {
  GOOGLE_API_ERROR_MAP,
  GOOGLE_API_ERROR_PATTERNS,
  TTS_LIMITS,
  VOICE_NAME_PATTERNS
} from '../../src/constants/index.mjs';

describe('Enhanced Error Handling', () => {
  describe('mapGoogleApiError', () => {
    it('should map known status codes to user-friendly messages', () => {
      expect(mapGoogleApiError(401, 'Unauthorized')).toBe(
        'Invalid or missing API key. Please check your authentication credentials.'
      );
      expect(mapGoogleApiError(429, 'Too Many Requests')).toBe(
        'Rate limit exceeded. Please reduce your request frequency and try again.'
      );
      expect(mapGoogleApiError(500, 'Internal Server Error')).toBe(
        'Internal server error. Please try again later.'
      );
    });

    it('should map error message patterns to user-friendly messages', () => {
      expect(mapGoogleApiError(400, 'Invalid voice name specified')).toBe(
        'The specified voice is not available. Please check the voice name and try again.'
      );
      expect(mapGoogleApiError(400, 'Content policy violation detected')).toBe(
        'Content violates usage policies. Please modify your text and try again.'
      );
      expect(mapGoogleApiError(400, 'Quota exceeded for this project')).toBe(
        'API quota exceeded. Please try again later or contact support.'
      );
    });

    it('should fallback to generic message for unknown errors', () => {
      expect(mapGoogleApiError(418, 'I am a teapot')).toBe(
        'API error: I am a teapot'
      );
    });

    it('should handle case-insensitive pattern matching', () => {
      expect(mapGoogleApiError(400, 'VOICE NOT FOUND')).toBe(
        'The specified voice is not available. Please check the voice name and try again.'
      );
      expect(mapGoogleApiError(400, 'Model not supported')).toBe(
        'The specified model is not available or does not support this operation.'
      );
    });
  });

  describe('processGoogleApiError', () => {
    it('should process JSON error responses', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve(JSON.stringify({
          error: {
            message: 'Invalid voice name: invalid-voice'
          }
        }))
      };

      const error = await processGoogleApiError(mockResponse);
      
      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(400);
      expect(error.message).toBe(
        'The specified voice is not available. Please check the voice name and try again.'
      );
    });

    it('should handle non-JSON error responses', async () => {
      const mockResponse = {
        status: 502,
        statusText: 'Bad Gateway',
        text: () => Promise.resolve('Service temporarily unavailable')
      };

      const error = await processGoogleApiError(mockResponse);
      
      expect(error).toBeInstanceOf(HttpError);
      expect(error.status).toBe(502);
      expect(error.message).toBe('Service temporarily unavailable. Please try again later.');
    });

    it('should map 5xx status codes to 502 for client response', async () => {
      const mockResponse = {
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve('Service overloaded')
      };

      const error = await processGoogleApiError(mockResponse);
      
      expect(error.status).toBe(502);
    });

    it('should preserve 4xx status codes for client response', async () => {
      const mockResponse = {
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Invalid request')
      };

      const error = await processGoogleApiError(mockResponse);
      
      expect(error.status).toBe(400);
    });
  });

  describe('validateTextLength', () => {
    it('should pass validation for valid text', () => {
      expect(() => validateTextLength('Hello, world!', 5000, 1)).not.toThrow();
      expect(() => validateTextLength('A'.repeat(100), 5000, 1)).not.toThrow();
    });

    it('should throw error for null or undefined text', () => {
      expect(() => validateTextLength(null, 5000, 1)).toThrow(HttpError);
      expect(() => validateTextLength(undefined, 5000, 1)).toThrow(HttpError);
      expect(() => validateTextLength('', 5000, 1)).toThrow(HttpError);
    });

    it('should throw error for non-string text', () => {
      expect(() => validateTextLength(123, 5000, 1)).toThrow(HttpError);
      expect(() => validateTextLength({}, 5000, 1)).toThrow(HttpError);
    });

    it('should throw error for text shorter than minimum length', () => {
      expect(() => validateTextLength('', 5000, 1)).toThrow(HttpError);
      expect(() => validateTextLength('   ', 5000, 1)).toThrow(HttpError);
    });

    it('should throw error for text exceeding byte limit', () => {
      const longText = 'A'.repeat(6000); // Exceeds 5000 byte limit
      expect(() => validateTextLength(longText, 5000, 1)).toThrow(HttpError);
    });

    it('should handle multi-byte characters correctly', () => {
      // Japanese characters are typically 3 bytes each in UTF-8
      const japaneseText = 'こんにちは'.repeat(500); // ~7500 bytes
      expect(() => validateTextLength(japaneseText, 5000, 1)).toThrow(HttpError);
    });

    it('should provide helpful error messages', () => {
      try {
        validateTextLength('A'.repeat(6000), 5000, 1);
      } catch (error) {
        expect(error.message).toContain('Text is too long');
        expect(error.message).toContain('6000 bytes');
        expect(error.message).toContain('Maximum allowed is 5000 bytes');
      }
    });
  });

  describe('validateVoiceName', () => {
    it('should pass validation for standard voice names', () => {
      expect(() => validateVoiceName('en-US-Standard-A', VOICE_NAME_PATTERNS)).not.toThrow();
      expect(() => validateVoiceName('ja-JP-Wavenet-B', VOICE_NAME_PATTERNS)).not.toThrow();
      expect(() => validateVoiceName('fr-FR-Neural2-C', VOICE_NAME_PATTERNS)).not.toThrow();
    });

    it('should pass validation for Gemini voice names', () => {
      expect(() => validateVoiceName('Puck', VOICE_NAME_PATTERNS)).not.toThrow();
      expect(() => validateVoiceName('Charon', VOICE_NAME_PATTERNS)).not.toThrow();
      expect(() => validateVoiceName('Kore', VOICE_NAME_PATTERNS)).not.toThrow();
    });

    it('should pass validation for custom voice names', () => {
      expect(() => validateVoiceName('custom-my-voice', VOICE_NAME_PATTERNS)).not.toThrow();
      expect(() => validateVoiceName('custom-voice_123', VOICE_NAME_PATTERNS)).not.toThrow();
    });

    it('should throw error for null or undefined voice names', () => {
      expect(() => validateVoiceName(null, VOICE_NAME_PATTERNS)).toThrow(HttpError);
      expect(() => validateVoiceName(undefined, VOICE_NAME_PATTERNS)).toThrow(HttpError);
      expect(() => validateVoiceName('', VOICE_NAME_PATTERNS)).toThrow(HttpError);
    });

    it('should throw error for non-string voice names', () => {
      expect(() => validateVoiceName(123, VOICE_NAME_PATTERNS)).toThrow(HttpError);
      expect(() => validateVoiceName({}, VOICE_NAME_PATTERNS)).toThrow(HttpError);
    });

    it('should throw error for invalid voice name formats', () => {
      expect(() => validateVoiceName('invalid-voice', VOICE_NAME_PATTERNS)).toThrow(HttpError);
      expect(() => validateVoiceName('en-US-Invalid-A', VOICE_NAME_PATTERNS)).toThrow(HttpError);
      expect(() => validateVoiceName('lowercase', VOICE_NAME_PATTERNS)).toThrow(HttpError);
    });

    it('should provide helpful error messages', () => {
      try {
        validateVoiceName('invalid-voice', VOICE_NAME_PATTERNS);
      } catch (error) {
        expect(error.message).toContain('Invalid voice name format');
        expect(error.message).toContain('invalid-voice');
        expect(error.message).toContain('Expected formats');
      }
    });
  });
});
