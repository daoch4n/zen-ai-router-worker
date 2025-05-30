/**
 * Performance tests for the TTS handler focusing on text length thresholds.
 * Measures latency for different text lengths to validate IMMEDIATE_TEXT_LENGTH_THRESHOLD.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { handleTTS } from '../../src/handlers/tts.mjs';
import { TTS_LIMITS } from '../../src/constants/index.mjs';
import fs from 'fs/promises';

// Mock the fetch function
global.fetch = jest.fn();

describe('TTS Performance Threshold Tests', () => {
  let performanceResults = {};
  const mockApiKey = 'test-api-key-123';
  const taskId = 'ROO#SUB_PRREVIEW_S001_20250530232840_A1B2C3D4';
  const outputPath = `.rooroo/tasks/${taskId}/tts_performance_results.json`;

  beforeAll(() => {
    performanceResults = {};
  });

  afterAll(async () => {
    try {
      await fs.mkdir(`.rooroo/tasks/${taskId}`, { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(performanceResults, null, 2));
      console.log(`TTS performance results written to ${outputPath}`);
    } catch (error) {
      console.error(`Failed to write performance results to file: ${error.message}`);
    }
  });

  beforeEach(() => {
    fetch.mockClear();
  });

  /**
   * Helper function to measure execution time of a function
   * @param {string} label - Label for the measurement
   * @param {Function} fn - Function to measure
   * @returns {any} Result of the function execution
   */
  function measurePerformance(label, fn) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    const duration = end - start;
    
    performanceResults[label] = duration;
    console.log(`${label}: ${duration.toFixed(3)}ms`);
    
    return result;
  }

  /**
   * Generates a string of specified length for testing.
   * @param {number} length - The desired length of the string.
   * @returns {string} A string of the specified length.
   */
  function generateText(length) {
    return 'a'.repeat(length);
  }

  // Mock a successful Google API response with minimal audio data
  const mockGoogleResponse = {
    candidates: [{
      content: {
        parts: [{
          inlineData: {
            data: 'dGVzdC1hdWRpby1kYXRh', // base64 encoded "test-audio-data"
            mimeType: 'audio/L16;rate=24000'
          }
        }]
      }
    }]
  };

  it('should process text below the threshold efficiently', async () => {
    const textLength = TTS_LIMITS.IMMEDIATE_TEXT_LENGTH_THRESHOLD - 100; // e.g., 400 characters
    const testText = generateText(textLength);

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGoogleResponse)
    });

    const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        model: 'gemini-2.0-flash-exp'
      })
    });

    await measurePerformance(`TTS-BelowThreshold-${textLength}Chars`, async () => {
      await handleTTS(request, mockApiKey);
    });

    // Expect a reasonable performance for immediate processing (e.g., under 50ms)
    expect(performanceResults[`TTS-BelowThreshold-${textLength}Chars`]).toBeLessThan(50);
  });

  it('should process text at the threshold efficiently', async () => {
    const textLength = TTS_LIMITS.IMMEDIATE_TEXT_LENGTH_THRESHOLD; // e.g., 500 characters
    const testText = generateText(textLength);

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGoogleResponse)
    });

    const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        model: 'gemini-2.0-flash-exp'
      })
    });

    await measurePerformance(`TTS-AtThreshold-${textLength}Chars`, async () => {
      await handleTTS(request, mockApiKey);
    });

    // Expect a reasonable performance for immediate processing (e.g., under 50ms)
    expect(performanceResults[`TTS-AtThreshold-${textLength}Chars`]).toBeLessThan(50);
  });

  it('should process text slightly above the threshold, potentially triggering streaming logic', async () => {
    const textLength = TTS_LIMITS.IMMEDIATE_TEXT_LENGTH_THRESHOLD + 100; // e.g., 600 characters
    const testText = generateText(textLength);

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGoogleResponse)
    });

    const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        model: 'gemini-2.0-flash-exp'
      })
    });

    await measurePerformance(`TTS-AboveThreshold-${textLength}Chars`, async () => {
      await handleTTS(request, mockApiKey);
    });

    // Expect a slightly higher but still acceptable performance (e.g., under 100ms)
    expect(performanceResults[`TTS-AboveThreshold-${textLength}Chars`]).toBeLessThan(100);
  });

  it('should process long text (e.g., 2000 characters) efficiently for streaming', async () => {
    const textLength = 2000;
    const testText = generateText(textLength);

    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockGoogleResponse)
    });

    const request = new Request('https://example.com/tts?voiceName=en-US-Standard-A', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        model: 'gemini-2.0-flash-exp'
      })
    });

    await measurePerformance(`TTS-LongText-${textLength}Chars`, async () => {
      await handleTTS(request, mockApiKey);
    });

    // Expect performance for long texts to be managed by streaming (e.g., under 200ms)
    expect(performanceResults[`TTS-LongText-${textLength}Chars`]).toBeLessThan(200);
  });

});