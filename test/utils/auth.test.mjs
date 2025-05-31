/**
 * Tests for authentication utilities
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  makeHeaders,
  selectRandomGoogleApiKey,
  selectAnthropicApiKey,
  selectOpenAiApiKey,
  // getApiKeysFromEnv, // Not exported, tested via other functions
  // getGoogleApiKeysFromEnv, // Not exported, tested via other functions
  HttpError
} from '../../src/utils/auth.mjs'; // HttpError is also exported from error.mjs, but auth.mjs re-exports it.
import { createMockEnv } from '../setup.mjs';

describe('Auth Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock Math.random for predictable random selection tests
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
  });

  // Tests for getApiKeysFromEnv are implicit in the tests for the functions that use it.

  describe('selectRandomGoogleApiKey', () => {
    it('should select a random key from GOOGLE_API_KEY and KEY prefixed keys', () => {
      const env = createMockEnv({
        KEY1: 'key_one',
        GOOGLE_API_KEY_MAIN: 'google_main',
        KEY_EXTRA: 'key_extra',
        OTHER_VAR: 'not_a_key'
      });
      const selectedKey = selectRandomGoogleApiKey(env);
      // With Math.random mocked to 0.5, it will select the middle key if count is odd,
      // or second of two if even. Order is determined by Object.keys.
      // Assuming Object.keys returns: GOOGLE_API_KEY_MAIN, KEY1, KEY_EXTRA
      // Total 3 keys. 0.5 * 3 = 1.5. Math.floor(1.5) = 1. So, KEY1.
      const keys = ['google_main', 'key_one', 'key_extra'].sort(); // Actual order depends on Object.keys
      // Let's check if it's one of the valid keys
      expect(keys).toContain(selectedKey);
    });

    it('should select from only KEYn if only those exist', () => {
      const env = createMockEnv({
        KEY1: 'key_one',
        KEY2: 'key_two',
      });
      const selectedKey = selectRandomGoogleApiKey(env);
       // Math.random = 0.5, 0.5 * 2 = 1. Math.floor(1) = 1. So, KEY2 (if order is KEY1, KEY2)
      expect(['key_one', 'key_two']).toContain(selectedKey);
    });

    it('should select from only GOOGLE_API_KEY_... if only those exist', () => {
        const env = createMockEnv({
            GOOGLE_API_KEY_ALPHA: 'alpha_key',
            GOOGLE_API_KEY_BETA: 'beta_key',
        });
        const selectedKey = selectRandomGoogleApiKey(env);
        expect(['alpha_key', 'beta_key']).toContain(selectedKey);
    });

    it('should throw HttpError if no suitable Google API keys are found', () => {
      const env = createMockEnv({
        OTHER_VAR: 'some_value',
        ANTHROPIC_API_KEY: 'anthropic_key' // Should not be picked
      });
      expect(() => selectRandomGoogleApiKey(env)).toThrow(HttpError);
      try {
        selectRandomGoogleApiKey(env);
      } catch (e) {
        expect(e.message).toBe("No Google API keys (KEY... or GOOGLE_API_KEY...) configured for random selection in worker environment.");
        expect(e.statusCode).toBe(500);
      }
    });

    it('should ignore empty or non-string keys', () => {
      const env = createMockEnv({
        KEY1: 'valid_key',
        KEY2: '', // empty
        GOOGLE_API_KEY_EMPTY: '',
        GOOGLE_API_KEY_NULL: null, // not a string
        KEY_UNDEFINED: undefined // not a string
      });
      const selectedKey = selectRandomGoogleApiKey(env);
      expect(selectedKey).toBe('valid_key');
    });
  });

  describe('selectAnthropicApiKey', () => {
    it('should select the first ANTHROPIC_API_KEY', () => {
      const env = createMockEnv({
        ANTHROPIC_API_KEY: 'anthropic_primary',
        ANTHROPIC_API_KEY_SECONDARY: 'anthropic_secondary' // This would also be found if ANTHROPIC_API_KEY didn't exist
      });
      expect(selectAnthropicApiKey(env)).toBe('anthropic_primary');
    });

    it('should select a ANTHROPIC_API_KEY_whatever if primary ANTHROPIC_API_KEY is not set', () => {
        const env = createMockEnv({
          ANTHROPIC_API_KEY_SECONDARY: 'anthropic_secondary'
        });
        expect(selectAnthropicApiKey(env)).toBe('anthropic_secondary');
      });


    it('should return the first key if multiple ANTHROPIC_API_KEY_n keys exist', () => {
      // Object.keys order is not guaranteed, but typically insertion order for non-numeric like keys
      const env = createMockEnv({
        ANTHROPIC_API_KEY_B: 'key_b',
        ANTHROPIC_API_KEY_A: 'key_a', // Assuming "ANTHROPIC_API_KEY" prefix is used
      });
      // The test for getApiKeysFromEnv ensures it finds all, this tests selection of first
      // The actual first depends on Object.keys, so we check if it's one of them.
      // Given the implementation returns apiKeys[0]
      const keys = Object.keys(env).filter(k => k.startsWith("ANTHROPIC_API_KEY")).map(k => env[k]);
      expect(selectAnthropicApiKey(env)).toBe(keys[0]);
    });

    it('should throw HttpError if no ANTHROPIC_API_KEY is found', () => {
      const env = createMockEnv({
        GOOGLE_API_KEY: 'google_key',
        OTHER_VAR: 'value'
      });
      expect(() => selectAnthropicApiKey(env)).toThrow(HttpError);
      try {
        selectAnthropicApiKey(env);
      } catch (e) {
        expect(e.message).toBe("No Anthropic API keys (ANTHROPIC_API_KEY...) configured.");
        expect(e.statusCode).toBe(500);
      }
    });

    it('should ignore empty or non-string ANTHROPIC_API_KEYs', () => {
        const env = createMockEnv({
          ANTHROPIC_API_KEY_EMPTY: '',
          ANTHROPIC_API_KEY_NULL: null,
          ANTHROPIC_API_KEY_VALID: 'valid_anthropic_key'
        });
        expect(selectAnthropicApiKey(env)).toBe('valid_anthropic_key');
      });
  });

  describe('selectOpenAiApiKey', () => {
    it('should select the first OPENAI_API_KEY', () => {
      const env = createMockEnv({
        OPENAI_API_KEY: 'openai_primary',
        OPENAI_API_KEY_SECONDARY: 'openai_secondary'
      });
      expect(selectOpenAiApiKey(env)).toBe('openai_primary');
    });

    it('should select an OPENAI_API_KEY_whatever if primary OPENAI_API_KEY is not set', () => {
        const env = createMockEnv({
          OPENAI_API_KEY_SECONDARY: 'openai_secondary'
        });
        expect(selectOpenAiApiKey(env)).toBe('openai_secondary');
      });

    it('should return the first key if multiple OPENAI_API_KEY_n keys exist', () => {
      const env = createMockEnv({
        OPENAI_API_KEY_ZULU: 'key_z',
        OPENAI_API_KEY_XRAY: 'key_x'
      });
      const keys = Object.keys(env).filter(k => k.startsWith("OPENAI_API_KEY")).map(k => env[k]);
      expect(selectOpenAiApiKey(env)).toBe(keys[0]);
    });

    it('should throw HttpError if no OPENAI_API_KEY is found', () => {
      const env = createMockEnv({
        GOOGLE_API_KEY: 'google_key'
      });
      expect(() => selectOpenAiApiKey(env)).toThrow(HttpError);
      try {
        selectOpenAiApiKey(env);
      } catch (e) {
        expect(e.message).toBe("No OpenAI API keys (OPENAI_API_KEY...) configured.");
        expect(e.statusCode).toBe(500);
      }
    });

    it('should ignore empty or non-string OPENAI_API_KEYs', () => {
        const env = createMockEnv({
          OPENAI_API_KEY_EMPTY: '',
          OPENAI_API_KEY_NULL: null,
          OPENAI_API_KEY_VALID: 'valid_openai_key'
        });
        expect(selectOpenAiApiKey(env)).toBe('valid_openai_key');
      });
  });
});
