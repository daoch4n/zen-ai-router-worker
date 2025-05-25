/**
 * Tests for helper utilities
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  generateId,
  parseImg,
  parseModelName,
  getBudgetFromLevel,
  removeThinkingTags,
  adjustProps,
  adjustSchema
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

  describe('adjustProps', () => {
    it('should remove unsupported JSON schema properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'https://example.com/schema',
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
        allOf: [{ type: 'string' }],
        anyOf: [{ type: 'string' }, { type: 'number' }],
        oneOf: [{ type: 'string' }],
        not: { type: 'null' },
        if: { type: 'string' },
        then: { minLength: 1 },
        else: { maxLength: 0 },
        readOnly: true,
        writeOnly: false,
        examples: ['example1', 'example2']
      };

      adjustProps(schema);

      // Should remove all unsupported properties
      expect(schema).not.toHaveProperty('$schema');
      expect(schema).not.toHaveProperty('$id');
      expect(schema).not.toHaveProperty('exclusiveMinimum');
      expect(schema).not.toHaveProperty('exclusiveMaximum');
      expect(schema).not.toHaveProperty('allOf');
      expect(schema).not.toHaveProperty('anyOf');
      expect(schema).not.toHaveProperty('oneOf');
      expect(schema).not.toHaveProperty('not');
      expect(schema).not.toHaveProperty('if');
      expect(schema).not.toHaveProperty('then');
      expect(schema).not.toHaveProperty('else');
      expect(schema).not.toHaveProperty('readOnly');
      expect(schema).not.toHaveProperty('writeOnly');
      expect(schema).not.toHaveProperty('examples');

      // Should preserve supported properties
      expect(schema.type).toBe('object');
      expect(schema.properties).toEqual({
        name: { type: 'string' }
      });
    });

    it('should transform const to enum', () => {
      const schema = {
        type: 'string',
        const: 'fixed-value'
      };

      adjustProps(schema);

      expect(schema).not.toHaveProperty('const');
      expect(schema.enum).toEqual(['fixed-value']);
      expect(schema.type).toBe('string');
    });

    it('should remove additionalProperties: false', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        additionalProperties: false
      };

      adjustProps(schema);

      expect(schema).not.toHaveProperty('additionalProperties');
      expect(schema.type).toBe('object');
      expect(schema.properties).toEqual({
        name: { type: 'string' }
      });
    });

    it('should preserve additionalProperties: true', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        },
        additionalProperties: true
      };

      adjustProps(schema);

      expect(schema.additionalProperties).toBe(true);
    });

    it('should handle nested objects recursively', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                exclusiveMinimum: 0,
                $schema: 'http://json-schema.org/draft-07/schema#'
              }
            },
            additionalProperties: false
          }
        },
        $id: 'root-schema'
      };

      adjustProps(schema);

      expect(schema).not.toHaveProperty('$id');
      expect(schema.properties.user).not.toHaveProperty('additionalProperties');
      expect(schema.properties.user.properties.name).not.toHaveProperty('exclusiveMinimum');
      expect(schema.properties.user.properties.name).not.toHaveProperty('$schema');
      expect(schema.properties.user.properties.name.type).toBe('string');
    });

    it('should handle arrays recursively', () => {
      const schema = {
        type: 'array',
        items: [
          {
            type: 'string',
            exclusiveMinimum: 0
          },
          {
            type: 'object',
            properties: {
              value: { type: 'number', $schema: 'test' }
            },
            additionalProperties: false
          }
        ]
      };

      adjustProps(schema);

      expect(schema.items[0]).not.toHaveProperty('exclusiveMinimum');
      expect(schema.items[0].type).toBe('string');
      expect(schema.items[1]).not.toHaveProperty('additionalProperties');
      expect(schema.items[1].properties.value).not.toHaveProperty('$schema');
      expect(schema.items[1].properties.value.type).toBe('number');
    });

    it('should handle null and primitive values safely', () => {
      expect(() => adjustProps(null)).not.toThrow();
      expect(() => adjustProps(undefined)).not.toThrow();
      expect(() => adjustProps('string')).not.toThrow();
      expect(() => adjustProps(123)).not.toThrow();
      expect(() => adjustProps(true)).not.toThrow();
    });

    it('should handle empty objects and arrays', () => {
      const emptyObject = {};
      const emptyArray = [];

      adjustProps(emptyObject);
      adjustProps(emptyArray);

      expect(emptyObject).toEqual({});
      expect(emptyArray).toEqual([]);
    });
  });

  describe('adjustSchema', () => {
    it('should remove strict property and adjust schema', () => {
      const schema = {
        type: 'function',
        function: {
          name: 'test_function',
          description: 'A test function',
          strict: true,
          parameters: {
            type: 'object',
            properties: {
              param1: {
                type: 'string',
                exclusiveMinimum: 0,
                $schema: 'http://json-schema.org/draft-07/schema#'
              }
            },
            additionalProperties: false,
            required: ['param1']
          }
        }
      };

      adjustSchema(schema);

      // Should remove strict property
      expect(schema.function).not.toHaveProperty('strict');

      // Should preserve function metadata
      expect(schema.function.name).toBe('test_function');
      expect(schema.function.description).toBe('A test function');

      // Should adjust nested schema properties
      expect(schema.function.parameters).not.toHaveProperty('additionalProperties');
      expect(schema.function.parameters.properties.param1).not.toHaveProperty('exclusiveMinimum');
      expect(schema.function.parameters.properties.param1).not.toHaveProperty('$schema');
      expect(schema.function.parameters.properties.param1.type).toBe('string');
      expect(schema.function.parameters.required).toEqual(['param1']);
    });

    it('should handle schema without strict property', () => {
      const schema = {
        type: 'function',
        function: {
          name: 'test_function',
          parameters: {
            type: 'object',
            properties: {
              param1: { type: 'string' }
            }
          }
        }
      };

      expect(() => adjustSchema(schema)).not.toThrow();
      expect(schema.function.name).toBe('test_function');
    });
  });
});
