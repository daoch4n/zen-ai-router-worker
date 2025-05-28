import { jest } from '@jest/globals';
import { optimizeTextForJson, handleTTS } from '../../src/handlers/tts.mjs';
import { errorHandler } from '../../src/utils/error.mjs';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;


describe('optimizeTextForJson', () => {
  test('should replace specific Unicode characters with ASCII equivalents', async () => {
    const text = 'Hello\u2013world\u2014this\u2018is\u2019a\u201Ctest\u201D.';
    const expected = "Hello-world--this'is'a\"test\".";
    expect(await optimizeTextForJson(text)).toBe(expected);
  });

  test('should remove invisible control characters except newlines, carriage returns, and tabs', async () => {
    const text = 'Hello\u0001\u0002\u0003world\u000B\u000C\u000E\u001F\u007F\u0080\u009F\n\r\t.';
    const expected = 'Helloworld\n\r\t.';
    expect(await optimizeTextForJson(text)).toBe(expected);
  });

  test('should normalize line endings from \\r\\n to \\n', async () => {
    const text = 'Line1\r\nLine2\r\nLine3';
    const expected = 'Line1\nLine2\nLine3';
    expect(await optimizeTextForJson(text)).toBe(expected);
  });

  test('should trim leading and trailing whitespace', async () => {
    const text = '   Hello World   ';
    const expected = 'Hello World';
    expect(await optimizeTextForJson(text)).toBe(expected);
  });

  test('should handle a combination of all optimizations', async () => {
    const text = ' \r\n  Hello\u2013world\u2014this\u2018is\u2019a\u201Ctest\u201D.\u0001\u000B\r\n   ';
    const expected = "Hello-world--this'is'a\"test\".";
    expect(await optimizeTextForJson(text)).toBe(expected);
  });

  test('should return an empty string for an empty string input', async () => {
    const text = '';
    const expected = '';
    expect(await optimizeTextForJson(text)).toBe(expected);
  });

  test('should handle text with no special characters or whitespace', async () => {
    const text = 'SimpleText';
    const expected = 'SimpleText';
    expect(await optimizeTextForJson(text)).toBe(expected);
  });
});



describe('handleTTS', () => {

  beforeEach(() => {
    mockFetch.mockClear();
    errorHandler.mockClear();
  });

  test('should return a 200 response with JSON containing audioContentBase64 and mimeType for a successful API call', async () => {
    const mockAudioContentBase64 = 'base64encodedAudio';
    const mockMimeType = 'audio/wav';

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              data: mockAudioContentBase64,
              mimeType: mockMimeType
            }
          }]
        }
      }]
    }), { status: 200 }));

    const requestBody = { text: 'Hello, world!', voiceId: 'someVoiceId' };
    const response = await handleTTS(requestBody, 'mockApiKey');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const jsonResponse = await response.json();
    expect(jsonResponse.audioContentBase64).toBe(mockAudioContentBase64);
    expect(jsonResponse.mimeType).toBe(mockMimeType);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=mockApiKey',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello, world!' }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'someVoiceId',
              },
            },
          },
        }),
      })
    );
    expect(errorHandler).not.toHaveBeenCalled();
  });

  test('should return a 400 response if text is missing from the request body', async () => {
    const requestBody = { text: undefined, voiceId: 'someVoiceId' }; // Missing text
    const response = await handleTTS(requestBody, 'mockApiKey');

    expect(response.status).toBe(400);
    const jsonResponse = await response.json();
    expect(jsonResponse.error).toBe('Missing required parameters: text or voiceId');
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(new Error('Missing required parameters: text or voiceId'), 400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('should return a 400 response if voiceId is missing from the request body', async () => {
    const requestBody = { text: 'Hello, world!', voiceId: undefined }; // Missing voiceId
    const response = await await handleTTS(requestBody, 'mockApiKey');

    expect(response.status).toBe(400);
    const jsonResponse = await response.json();
    expect(jsonResponse.error).toBe('Missing required parameters: text or voiceId');
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(new Error('Missing required parameters: text or voiceId'), 400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('should handle API errors (e.g., 401, 404, 500) and return a 500 response', async () => {
    const mockApiErrorResponse = { error: { message: 'API error occurred' } };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(mockApiErrorResponse), { status: 401 }));

    const requestBody = { text: 'Test error handling', voiceId: 'someVoiceId' };
    const response = await handleTTS(requestBody, 'mockApiKey');

    expect(response.status).toBe(500);
    const jsonResponse = await response.json();
    expect(jsonResponse.error).toBe('Google Generative AI TTS API error: 401 - API error occurred');
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(new Error('Google Generative AI TTS API error: 401 - API error occurred'), 500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('should handle malformed API responses (e.g., missing audioContent)', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ someOtherField: 'value' }), { status: 200 }));

    const requestBody = { text: 'Test malformed response', voiceId: 'someVoiceId' };
    const response = await handleTTS(requestBody, 'mockApiKey');

    expect(response.status).toBe(500);
    const jsonResponse = await response.json();
    expect(jsonResponse.error).toBe('No audio content received from Google Generative AI TTS API');
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(new Error('No audio content received from Google Generative AI TTS API'), 500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('should handle network errors during fetch', async () => {
    const networkError = new TypeError('Failed to fetch');
    mockFetch.mockRejectedValueOnce(networkError);

    const requestBody = { text: 'Test network error', voiceId: 'someVoiceId' };
    const response = await handleTTS(requestBody, 'mockApiKey');

    expect(response.status).toBe(500);
    const jsonResponse = await response.json();
    expect(jsonResponse.error).toBe('Failed to convert text to speech: Failed to fetch');
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledWith(new Error('Failed to convert text to speech: Failed to fetch'), 500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});