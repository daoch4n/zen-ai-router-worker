/**
 * Tests for TTS (Text-to-Speech) handler functionality.
 * Validates request parsing, parameter validation, and error handling.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { handleTTS } from '../../src/handlers/tts.mjs';

describe('TTS Handler', () => {
  let mockApiKey;

  beforeEach(() => {
    mockApiKey = 'test-api-key-123';
  });

  describe('Request Parsing and Validation', () => {
    it('should successfully parse valid request with all required parameters', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.message).toBe('TTS request parsed successfully');
      expect(result.parameters).toEqual({
        voiceName: 'en-US-Standard-A',
        secondVoiceName: null,
        text: 'Hello, world!',
        model: 'gemini-2.0-flash-exp'
      });
    });

    it('should successfully parse request with optional secondVoiceName', async () => {
      const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A&secondVoiceName=en-US-Standard-B', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, world!',
          model: 'gemini-2.0-flash-exp'
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.parameters.secondVoiceName).toBe('en-US-Standard-B');
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
      const request = new Request('https://example.com/tts?voiceName=%20en-US-Standard-A%20&secondVoiceName=%20en-US-Standard-B%20', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '  Hello, world!  ',
          model: '  gemini-2.0-flash-exp  '
        })
      });

      const response = await handleTTS(request, mockApiKey);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.parameters).toEqual({
        voiceName: 'en-US-Standard-A',
        secondVoiceName: 'en-US-Standard-B',
        text: 'Hello, world!',
        model: 'gemini-2.0-flash-exp'
      });
    });
  });
});
