/**
 * Tests for TTS (Text-to-Speech) handler functionality.
 * Validates request parsing, parameter validation, and error handling.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleTTS, handleRawTTS } from '../../src/handlers/tts.mjs';
import { TtsJobDurableObject } from '../../src/durable_objects/TtsJobDurableObject.mjs';

// Mock the fetch function
global.fetch = jest.fn();

// Mock Durable Object storage and R2 bucket for TtsJobDurableObject tests
const mockStorage = new Map();
const mockR2Bucket = new Map();

const mockState = {
  storage: {
    get: jest.fn(async (key) => mockStorage.get(key)),
    put: jest.fn(async (key, value, options) => {
      mockStorage.set(key, value);
      // Simulate expiration if needed for more complex tests
    }),
    delete: jest.fn(async (key) => mockStorage.delete(key)),
    // Add other storage methods if used by the DO and needed for tests
  },
};

const mockEnv = {
  TTS_AUDIO_BUCKET: {
    put: jest.fn(async (key, value, options) => {
      mockR2Bucket.set(key, { body: value, ...options });
    }),
    get: jest.fn(async (key) => {
      const obj = mockR2Bucket.get(key);
      if (obj) {
        return {
          arrayBuffer: async () => obj.body.buffer, // Return ArrayBuffer from Uint8Array
          contentType: obj.contentType,
        };
      }
      return null;
    }),
    // Add other R2 methods if used by the DO and needed for tests
  },
};


describe('TTS Handler', () => {
  let mockApiKey;

  beforeEach(() => {
    mockApiKey = 'test-api-key-123';
    fetch.mockClear();
  });

  describe('Request Parsing and Validation', () => {
    it('should successfully parse valid request with all required parameters', async () => {
      // Mock Google API response
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'dGVzdC1hdWRpby1kYXRh', // base64 encoded "test-audio-data"
                    mimeType: 'audio/L16;rate=24000'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const wavData = await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/wav');

      // Verify WAV file structure
      const wavBytes = new Uint8Array(wavData);
      expect(wavBytes.length).toBeGreaterThan(44); // Should have header + audio data

      // Check WAV header signature (RIFF)
      expect(wavBytes[0]).toBe(0x52); // 'R'
      expect(wavBytes[1]).toBe(0x49); // 'I'
      expect(wavBytes[2]).toBe(0x46); // 'F'
      expect(wavBytes[3]).toBe(0x46); // 'F'

      // Check WAVE format signature
      expect(wavBytes[8]).toBe(0x57);  // 'W'
      expect(wavBytes[9]).toBe(0x41);  // 'A'
      expect(wavBytes[10]).toBe(0x56); // 'V'
      expect(wavBytes[11]).toBe(0x45); // 'E'

      // Verify the fetch call was made correctly
      expect(fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': mockApiKey
          }),
          body: expect.stringContaining('"text":"Hello, world!"')
        })
      );
    });

    it('should successfully parse request with optional secondVoiceName', async () => {
      // Mock Google API response
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'bXVsdGktc3BlYWtlci1hdWRpbw==', // base64 encoded "multi-speaker-audio"
                    mimeType: 'audio/L16;rate=22050'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A&secondVoiceName=en-US-Standard-B', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const wavData = await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/wav');

      // Verify WAV file structure
      const wavBytes = new Uint8Array(wavData);
      expect(wavBytes.length).toBeGreaterThan(44); // Should have header + audio data

      // Check WAV header signature (RIFF)
      expect(wavBytes[0]).toBe(0x52); // 'R'
      expect(wavBytes[1]).toBe(0x49); // 'I'
      expect(wavBytes[2]).toBe(0x46); // 'F'
      expect(wavBytes[3]).toBe(0x46); // 'F'

      // Verify the fetch call was made with multi-speaker configuration
      expect(fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': mockApiKey
          }),
          body: expect.stringContaining('"multiSpeakerVoiceConfig"')
        })
      );
    });

    it('should return 400 when voiceName is missing', async () => {
      const request = new Request('https://example.com/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('voiceName query parameter is required');
    });

    it('should return 400 when text is missing from request body', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('text field is required in request body');
    });

    it('should return 400 when model is missing from request body', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('model field is required in request body');
    });

    it('should return 400 when text is empty string', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '   ',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Text must be at least 1 character long');
    });

    it('should return 400 when text exceeds byte limit', async () => {
      const longText = 'A'.repeat(6000); // Exceeds 5000 byte limit
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: longText,
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      const responseText = await response.text();
      expect(responseText).toContain('Text is too long');
      expect(responseText).toContain('6000 bytes');
      expect(responseText).toContain('Maximum allowed is 5000 bytes');
    });

    it('should return 400 for invalid voice name format', async () => {
      const request = new Request('https://example.com/tts?voiceName=invalid-voice-format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      const responseText = await response.text();
      expect(responseText).toContain('Invalid voice name format');
      expect(responseText).toContain('invalid-voice-format');
    });

    it('should accept valid Gemini voice names', async () => {
      // Mock Google API response
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'dGVzdC1hdWRpby1kYXRh', // base64 encoded "test-audio-data"
                    mimeType: 'audio/L16;rate=24000'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/tts?voiceName=Puck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/wav');
    });

    it('should return 400 when request body is invalid JSON', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Invalid JSON in request body');
    });

    it('should return 401 when API key is missing', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, null);

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('API key is required');
    });

    it('should trim whitespace from parameters', async () => {
      // Mock Google API response
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'dHJpbW1lZC1hdWRpbw==', // base64 encoded "trimmed-audio"
                    mimeType: 'audio/L16;rate=16000'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/tts?voiceName=%20en-US-Standard-A%20&secondVoiceName=%20en-US-Standard-B%20', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '  Hello, world!  ',
          model: '  gemini-2.0-flash-exp  '
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const wavData = await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/wav');

      // Verify WAV file structure
      const wavBytes = new Uint8Array(wavData);
      expect(wavBytes.length).toBeGreaterThan(44); // Should have header + audio data

      // Check WAV header signature (RIFF)
      expect(wavBytes[0]).toBe(0x52); // 'R'
      expect(wavBytes[1]).toBe(0x49); // 'I'
      expect(wavBytes[2]).toBe(0x46); // 'F'
      expect(wavBytes[3]).toBe(0x46); // 'F'
    });

    it('should handle Google API errors gracefully with enhanced error mapping', async () => {
      // Mock Google API error response
      const errorResponse = {
        error: {
          code: 400,
          message: "Invalid voice name specified"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      // Use a valid voice name format so it passes validation and reaches the API
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('The specified voice is not available. Please check the voice name and try again.');
    });

    it('should handle quota exceeded errors with user-friendly messages', async () => {
      const errorResponse = {
        error: {
          code: 429,
          message: "Quota exceeded for this project"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(429);
      expect(await response.text()).toBe('API quota exceeded. Please try again later or contact support.');
    });

    it('should handle content policy violations with clear messages', async () => {
      const errorResponse = {
        error: {
          code: 400,
          message: "Content policy violation detected"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Inappropriate content here',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Content violates usage policies. Please modify your text and try again.');
    });

    it('should map 5xx errors to 502 status for client', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service temporarily unavailable')
      });

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(502);
      expect(await response.text()).toBe('Service overloaded. Please try again later.');
    });

    it('should handle network errors', async () => {
      // Mock network error
      fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(502);
      expect(await response.text()).toBe('Network error: Unable to connect to Google API');
    });

    it('should parse sample rate from different mimeType formats', async () => {
      // Mock Google API response with different mimeType format
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'dGVzdC1hdWRpby1kYXRh',
                    mimeType: 'audio/wav; codecs=pcm; rate=44100'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const wavData = await response.arrayBuffer();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/wav');

      // Verify WAV file structure
      const wavBytes = new Uint8Array(wavData);
      expect(wavBytes.length).toBeGreaterThan(44); // Should have header + audio data

      // Check sample rate in WAV header (bytes 24-27, little-endian)
      const sampleRate = wavBytes[24] | (wavBytes[25] << 8) | (wavBytes[26] << 16) | (wavBytes[27] << 24);
      expect(sampleRate).toBe(44100);
    });
  });
});

describe('Raw TTS Handler', () => {
  let mockApiKey;

  beforeEach(() => {
    mockApiKey = 'test-api-key-123';
    fetch.mockClear();
  });

  describe('Request Parsing and Validation', () => {
    it('should successfully parse valid request and return base64 audio', async () => {
      // Mock Google API response
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'dGVzdC1hdWRpby1kYXRh', // base64 encoded "test-audio-data"
                    mimeType: 'audio/L16;rate=24000'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);
      const responseText = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/L16;rate=24000');
      expect(responseText).toBe('dGVzdC1hdWRpby1kYXRh'); // Should return base64 audio directly

      // Verify the fetch call was made correctly
      expect(fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': mockApiKey
          }),
          body: expect.stringContaining('"text":"Hello, world!"')
        })
      );
    });

    it('should successfully parse request with optional secondVoiceName', async () => {
      // Mock Google API response
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: 'bXVsdGktc3BlYWtlci1hdWRpbw==', // base64 encoded "multi-speaker-audio"
                    mimeType: 'audio/L16;rate=22050'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A&secondVoiceName=en-US-Standard-B', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);
      const responseText = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/L16;rate=22050');
      expect(responseText).toBe('bXVsdGktc3BlYWtlci1hdWRpbw=='); // Should return base64 audio directly

      // Verify the fetch call was made with multi-speaker configuration
      expect(fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': mockApiKey
          }),
          body: expect.stringContaining('"multiSpeakerVoiceConfig"')
        })
      );
    });

    it('should return 400 when voiceName is missing', async () => {
      const request = new Request('https://example.com/rawtts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('voiceName query parameter is required');
    });

    it('should return 400 when text is missing from request body', async () => {
      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('text field is required in request body');
    });

    it('should return 400 when model is missing from request body', async () => {
      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('model field is required in request body');
    });

    it('should return 401 when API key is missing', async () => {
      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, null);

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('API key is required');
    });

    it('should return 400 when request body is invalid JSON', async () => {
      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Invalid JSON in request body');
    });

    it('should handle Google API errors gracefully', async () => {
      // Mock Google API error response
      const errorResponse = {
        error: {
          code: 400,
          message: "Invalid voice name specified"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('The specified voice is not available. Please check the voice name and try again.');
    });

    it('should handle 5xx Google API errors and map to 502', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service temporarily unavailable')
      });

      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(502);
      expect(await response.text()).toBe('Service overloaded. Please try again later.');
    });

    it('should validate text length limits', async () => {
      const longText = 'A'.repeat(6000); // Exceeds 5000 byte limit
      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: longText,
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      const responseText = await response.text();
      expect(responseText).toContain('Text is too long');
      expect(responseText).toContain('6000 bytes');
      expect(responseText).toContain('Maximum allowed is 5000 bytes');
    });

    it('should validate voice name format', async () => {
      const request = new Request('https://example.com/rawtts?voiceName=invalid-voice-format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      const responseText = await response.text();
      expect(responseText).toContain('Invalid voice name format');
      expect(responseText).toContain('invalid-voice-format');
    });

    it('should explicitly verify no WAV conversion occurs', async () => {
      // Mock Google API response with specific base64 data
      const mockBase64Audio = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEA'; // Sample base64
      const mockGoogleResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: mockBase64Audio,
                    mimeType: 'audio/L16;rate=16000'
                  }
                }
              ]
            }
          }
        ]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGoogleResponse)
      });

      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);
      const responseText = await response.text();

      // Verify response is exactly the base64 string, not binary WAV data
      expect(responseText).toBe(mockBase64Audio);
      expect(response.headers.get('Content-Type')).toBe('audio/L16;rate=16000');
      expect(response.headers.get('Content-Type')).not.toBe('audio/wav');

      // Verify response is text, not binary
      expect(typeof responseText).toBe('string');
      expect(responseText.length).toBe(mockBase64Audio.length);
    });

    it('should handle network errors gracefully', async () => {
      // Mock network error
      fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const request = new Request('https://example.com/rawtts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleRawTTS(request, mockApiKey);

      expect(response.status).toBe(502);
      expect(await response.text()).toBe('Network error: Unable to connect to Google API');
    });
  });
});

describe('TtsJobDurableObject - handleGetResult', () => {
  let durableObject;
  const jobId = 'test-job-id-123';
  const mimeType = 'audio/mpeg';

  beforeEach(() => {
    // Clear mocks and reset storage/bucket before each test
    mockStorage.clear();
    mockR2Bucket.clear();
    jest.clearAllMocks();
    durableObject = new TtsJobDurableObject(mockState, mockEnv);
  });

  it('should retrieve and base64 encode large audio result from R2 without stack overflow', async () => {
    // Create a large ArrayBuffer (e.g., 5MB)
    const largeBufferSize = 5 * 1024 * 1024; // 5 MB
    const largeUint8Array = new Uint8Array(largeBufferSize);
    for (let i = 0; i < largeBufferSize; i++) {
      largeUint8Array[i] = i % 256; // Fill with some data
    }

    // Simulate job data in DO storage
    mockStorage.set(jobId, { status: 'completed', mimeType: mimeType });

    // Simulate audio data in R2
    await mockEnv.TTS_AUDIO_BUCKET.put(jobId, largeUint8Array, { contentType: mimeType });

    const request = new Request(`https://example.com/tts-job/${jobId}/result`);
    const response = await durableObject.fetch(request);
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody.jobId).toBe(jobId);
    expect(responseBody.status).toBe('completed');
    expect(responseBody.mimeType).toBe(mimeType);
    expect(typeof responseBody.base64Audio).toBe('string');
    expect(responseBody.base64Audio.length).toBeGreaterThan(0);

    // Verify that the retrieved base64 audio can be decoded back to the original size
    const decodedAudio = Uint8Array.from(atob(responseBody.base64Audio), c => c.charCodeAt(0));
    expect(decodedAudio.byteLength).toBe(largeBufferSize);
    // Optionally, verify content of a few bytes
    expect(decodedAudio[0]).toBe(largeUint8Array[0]);
    expect(decodedAudio[largeBufferSize - 1]).toBe(largeUint8Array[largeBufferSize - 1]);
  });

  it('should return 404 if job not found in DO storage', async () => {
    const request = new Request(`https://example.com/tts-job/${jobId}/result`);
    const response = await durableObject.fetch(request);
    const responseBody = await response.json();

    expect(response.status).toBe(404);
    expect(responseBody.error).toBe('Job not found');
  });

  it('should return 404 if audio result not found in R2', async () => {
    // Simulate job data in DO storage, but no audio in R2
    mockStorage.set(jobId, { status: 'completed', mimeType: mimeType });

    const request = new Request(`https://example.com/tts-job/${jobId}/result`);
    const response = await durableObject.fetch(request);
    const responseBody = await response.json();

    expect(response.status).toBe(404);
    expect(responseBody.error).toBe('Audio result not found in R2');
  });

  it('should return 500 if an error occurs during R2 fetch or base64 encoding', async () => {
    // Simulate an error during R2 fetch
    mockEnv.TTS_AUDIO_BUCKET.get.mockImplementationOnce(() => {
      throw new Error('Simulated R2 error');
    });

    // Simulate job data in DO storage
    mockStorage.set(jobId, { status: 'completed', mimeType: mimeType });

    const request = new Request(`https://example.com/tts-job/${jobId}/result`);
    const response = await durableObject.fetch(request);
    const responseBody = await response.json();

    expect(response.status).toBe(500);
    expect(responseBody.error).toBe('Failed to retrieve audio result');
  });
});
