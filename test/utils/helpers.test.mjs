/**
 * Tests for helper utilities
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  generateId,
  parseImg,
  parseModelName,
  getBudgetFromLevel,
  removeThinkingTags
} from '../../src/utils/helpers.mjs';
import { HttpError } from '../../src/utils/error.mjs';
import { createMockResponse } from '../setup.mjs';

describe('helper utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateId', () => {
    it('should generate a 29-character random ID', () => {
      const id = generateId();

      expect(typeof id).toBe('string');
      expect(id).toHaveLength(29);
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
    });
  });

  describe('parseImg', () => {
    it('should parse data URL correctly', async () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD//gA7Q1JFQVRP';

      const result = await parseImg(dataUrl);

      expect(result).toEqual({
        inlineData: {
          mimeType: 'image/jpeg',
          data: '/9j/4AAQSkZJRgABAQAAAQABAAD//gA7Q1JFQVRP'
        }
      });
    });

    it('should fetch and parse HTTP URL', async () => {
      const imageUrl = 'https://example.com/image.jpg';
      const mockArrayBuffer = new ArrayBuffer(8);

      global.fetch.mockResolvedValueOnce(createMockResponse(null, {
        ok: true,
        headers: new Map([['content-type', 'image/jpeg']]),
        arrayBuffer: jest.fn().mockResolvedValue(mockArrayBuffer)
      }));

      const result = await parseImg(imageUrl);

      expect(result).toEqual({
        inlineData: {
          mimeType: 'image/jpeg',
          data: 'mocked-base64-data'
        }
      });
    });

    it('should throw error for invalid data URL', async () => {
      const invalidUrl = 'invalid-url';

      await expect(parseImg(invalidUrl)).rejects.toThrow(HttpError);
      await expect(parseImg(invalidUrl)).rejects.toThrow('Invalid image data');
    });

    it('should throw error for failed HTTP request', async () => {
      const imageUrl = 'https://example.com/nonexistent.jpg';

      global.fetch.mockResolvedValueOnce(createMockResponse(null, {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }));

      await expect(parseImg(imageUrl)).rejects.toThrow('Error fetching image');
    });
  });

  describe('parseModelName', () => {
    it('should parse standard model name', () => {
      const result = parseModelName('gemini-2.0-flash');

      expect(result).toEqual({
        baseModel: 'gemini-2.0-flash',
        mode: 'standard',
        budget: null
      });
    });

    it('should parse thinking mode model name', () => {
      const result = parseModelName('gemini-2.0-flash-thinking-high');

      expect(result).toEqual({
        baseModel: 'gemini-2.0-flash',
        mode: 'thinking',
        budget: 'high'
      });
    });

    it('should parse refined mode model name', () => {
      const result = parseModelName('gemini-2.0-flash-refined-medium');

      expect(result).toEqual({
        baseModel: 'gemini-2.0-flash',
        mode: 'refined',
        budget: 'medium'
      });
    });

    it('should handle null model name', () => {
      const result = parseModelName(null);

      expect(result).toEqual({
        baseModel: null,
        mode: 'standard',
        budget: null
      });
    });

    it('should handle non-string model name', () => {
      const result = parseModelName(123);

      expect(result).toEqual({
        baseModel: 123,
        mode: 'standard',
        budget: null
      });
    });
  });

  describe('getBudgetFromLevel', () => {
    it('should return correct budget for valid levels', () => {
      expect(getBudgetFromLevel('none')).toBe(0);
      expect(getBudgetFromLevel('low')).toBe(1024);
      expect(getBudgetFromLevel('medium')).toBe(8192);
      expect(getBudgetFromLevel('high')).toBe(24576);
    });

    it('should return none budget for invalid level', () => {
      expect(getBudgetFromLevel('invalid')).toBe(0);
      expect(getBudgetFromLevel(null)).toBe(0);
      expect(getBudgetFromLevel(undefined)).toBe(0);
    });
  });

  describe('removeThinkingTags', () => {
    it('should remove thinking tags from content', () => {
      const content = 'Hello <thinking>This is internal thought</thinking> world!';
      const result = removeThinkingTags(content);

      expect(result).toBe('Hello  world!');
    });

    it('should handle nested content in thinking tags', () => {
      const content = 'Start <thinking>Complex\nmultiline\nthought</thinking> end';
      const result = removeThinkingTags(content);

      expect(result).toBe('Start  end');
    });

    it('should return original content if no thinking tags', () => {
      const content = 'Hello world!';
      const result = removeThinkingTags(content);

      expect(result).toBe('Hello world!');
    });

    it('should handle null or undefined content', () => {
      expect(removeThinkingTags(null)).toBe(null);
      expect(removeThinkingTags(undefined)).toBe(undefined);
      expect(removeThinkingTags('')).toBe('');
    });
  });
});
