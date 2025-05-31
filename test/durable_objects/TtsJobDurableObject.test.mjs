// test/durable_objects/TtsJobDurableObject.test.mjs

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TtsJobDurableObject, MAX_TEXT_LENGTH_CHAR_COUNT } from '../../src/durable_objects/TtsJobDurableObject.mjs';
import { HttpError } from '../../src/utils/error.mjs';

describe('TtsJobDurableObject', () => {
  let state;
  let env;
  let durableObject;
  const testJobId = 'test-job-id-123';

  beforeEach(() => {
    // Reset mocks for each test
    const mockPut = jest.fn(() => Promise.resolve());
    const mockGet = jest.fn(() => Promise.resolve(undefined));

    state = {
      id: {
        toString: jest.fn(() => testJobId),
      },
      storage: {
        put: mockPut,
        get: mockGet,
        // Add other storage methods if they are called and need mocking (e.g., transaction, deleteAll)
      },
      // Mock blockConcurrencyWhile if you use it:
      // blockConcurrencyWhile: jest.fn(async (fn) => await fn()),
    };
    env = {
        // Mock any bindings used by the DO, e.g., R2 buckets, KV namespaces
        // TTS_AUDIO_BUCKET: { put: jest.fn(), get: jest.fn() },
    };
    durableObject = new TtsJobDurableObject(state, env);
  });

  describe('initializeJob', () => {
    it('should throw HttpError if a single sentence exceeds MAX_TEXT_LENGTH_CHAR_COUNT with characterCount splitting', async () => {
      const longSentence = 'a'.repeat(MAX_TEXT_LENGTH_CHAR_COUNT + 1);

      const requestBody = {
        jobId: testJobId,
        text: longSentence,
        voiceId: 'voice-1',
        model: 'model-1',
        splittingPreference: 'characterCount',
      };

      // Construct the request to simulate how Cloudflare Workers passes it to fetch
      // The URL path is what the DO's fetch handler will parse
      const request = new Request(`https://example.com/tts-job/${testJobId}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      // We need to await the fetch call since initializeJob is async
      // and then check the properties of the thrown error.
      expect.assertions(3); // Ensures that all assertions in the catch block are checked
      try {
        await durableObject.fetch(request);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe(`A single sentence exceeds the maximum allowed length of ${MAX_TEXT_LENGTH_CHAR_COUNT} characters.`);
      }
    });

    // Add more tests for initializeJob:
    // - Successful initialization
    // - Missing required fields
    // - Invalid splittingPreference
    // - Job ID mismatch (if state.id.toString() is different from body.jobId)
    // - Text too long with splittingPreference 'none'
    // - Correct batching logic for characterCount when sentences are within limits
  });

  // Add describe blocks for other methods like:
  // describe('getNextSentenceToProcess', () => { ... });
  // describe('markSentenceAsProcessed', () => { ... });
  // describe('getJobState', () => { ... });
  // etc.
});
