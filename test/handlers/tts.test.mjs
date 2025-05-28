/**
 * Tests for TTS (Text-to-Speech) handler functionality.
 * Validates request parsing, parameter validation, and error handling.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { handleTTS } from '../../src/handlers/tts.mjs';

// Mock the fetch function
global.fetch = jest.fn();

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
      expect(await response.text()).toBe('text must be a non-empty string');
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

    it('should handle Google API errors gracefully', async () => {
      // Mock Google API error response
      const errorResponse = {
        error: {
          code: 400,
          message: "Invalid voice name"
        }
      };

      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify(errorResponse))
      });

      const request = new Request('https://example.com/tts?voiceName=invalid-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);

      expect(response.status).toBe(400);
      expect(await response.text()).toBe('Google API error: Invalid voice name');
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
