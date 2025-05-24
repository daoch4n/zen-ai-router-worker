/**
 * Tests for constants
 */
import { describe, it, expect } from '@jest/globals';
import {
  BASE_URL,
  API_VERSION,
  API_CLIENT,
  DEFAULT_MODEL,
  DEFAULT_EMBEDDINGS_MODEL,
  HARM_CATEGORIES,
  SAFETY_SETTINGS,
  THINKING_MODES,
  REASONING_EFFORT_MAP
} from '../../src/constants/index.mjs';

describe('constants', () => {
  describe('API configuration', () => {
    it('should have correct base URL', () => {
      expect(BASE_URL).toBe('https://generativelanguage.googleapis.com');
    });

    it('should have correct API version', () => {
      expect(API_VERSION).toBe('v1beta');
    });

    it('should have API client identifier', () => {
      expect(API_CLIENT).toMatch(/^genai-js\/\d+\.\d+\.\d+$/);
    });
  });

  describe('default models', () => {
    it('should have default chat model', () => {
      expect(DEFAULT_MODEL).toBe('gemini-2.0-flash');
      expect(typeof DEFAULT_MODEL).toBe('string');
    });

    it('should have default embeddings model', () => {
      expect(DEFAULT_EMBEDDINGS_MODEL).toBe('text-embedding-004');
      expect(typeof DEFAULT_EMBEDDINGS_MODEL).toBe('string');
    });
  });

  describe('safety settings', () => {
    it('should have all required harm categories', () => {
      const expectedCategories = [
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_CIVIC_INTEGRITY'
      ];

      expect(HARM_CATEGORIES).toEqual(expectedCategories);
    });

    it('should have safety settings for all categories', () => {
      expect(SAFETY_SETTINGS).toHaveLength(HARM_CATEGORIES.length);
      
      SAFETY_SETTINGS.forEach((setting, index) => {
        expect(setting).toEqual({
          category: HARM_CATEGORIES[index],
          threshold: 'BLOCK_NONE'
        });
      });
    });

    it('should block no content by default', () => {
      SAFETY_SETTINGS.forEach(setting => {
        expect(setting.threshold).toBe('BLOCK_NONE');
      });
    });
  });

  describe('thinking modes', () => {
    it('should have all thinking modes defined', () => {
      expect(THINKING_MODES).toEqual({
        STANDARD: 'standard',
        THINKING: 'thinking',
        REFINED: 'refined'
      });
    });

    it('should have string values for all modes', () => {
      Object.values(THINKING_MODES).forEach(mode => {
        expect(typeof mode).toBe('string');
      });
    });
  });

  describe('reasoning effort map', () => {
    it('should have correct budget mappings', () => {
      expect(REASONING_EFFORT_MAP).toEqual({
        none: 0,
        low: 1024,
        medium: 8192,
        high: 24576
      });
    });

    it('should have numeric values for all levels', () => {
      Object.values(REASONING_EFFORT_MAP).forEach(budget => {
        expect(typeof budget).toBe('number');
        expect(budget).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have increasing budget values', () => {
      const values = Object.values(REASONING_EFFORT_MAP);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    });
  });

  describe('constants immutability', () => {
    it('should not allow modification of arrays', () => {
      expect(() => {
        HARM_CATEGORIES.push('NEW_CATEGORY');
      }).toThrow();
    });

    it('should not allow modification of objects', () => {
      expect(() => {
        THINKING_MODES.NEW_MODE = 'new';
      }).toThrow();
    });
  });
});
