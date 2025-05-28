/**
 * Tests for TTS handler utilities
 */
import { describe, it, expect } from '@jest/globals';
import { optimizeTextForJson } from '../../src/handlers/tts.mjs';

describe('TTS Utilities', () => {
  describe('optimizeTextForJson', () => {
    it('should replace en dash with hyphen', async () => {
      const text = 'This is an en–dash.';
      const expected = 'This is an en-dash.'; // Corrected expectation
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should replace em dash with double hyphen', async () => {
      const text = 'This is an em—dash.';
      const expected = 'This is an em--dash.'; // Corrected expectation
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should replace left single quote with apostrophe', async () => {
      const text = '‘Hello’ world.';
      const expected = "'Hello' world.";
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should replace right single quote with apostrophe', async () => {
      const text = "It’s a beautiful day.";
      const expected = "It's a beautiful day.";
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should replace left double quote with standard double quote', async () => {
      const text = '“Greetings,” she said.';
      const expected = '"Greetings," she said.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should replace right double quote with standard double quote', async () => {
      const text = 'He replied, “Indeed.”';
      const expected = 'He replied, "Indeed."';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should remove invisible control characters', async () => {
      const text = 'Text with \u0000null and \u001Funit separator.';
      const expected = 'Text with null and unit separator.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should not remove newline, carriage return, or tab characters', async () => {
      const text = 'Line one\nLine two\rLine three\tIndented.';
      const expected = 'Line one\nLine two\rLine three\tIndented.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should normalize line endings from \\r\\n to \\n', async () => {
      const text = 'First line\r\nSecond line.';
      const expected = 'First line\nSecond line.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should trim leading and trailing whitespace', async () => {
      const text = '  Spaced out text.  ';
      const expected = 'Spaced out text.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should handle a combination of replacements and removals', async () => {
      const text = '  \u201CHello\u201D – world\u2019s best\r\n\u0000text with \u001Ftabs\t.  ';
      const expected = '"Hello" - world\'s best\ntext with tabs\t.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should return an empty string if input is empty', async () => {
      const text = '';
      const expected = '';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should return an empty string if input is only whitespace', async () => {
      const text = '   ';
      const expected = '';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });

    it('should handle text that needs no optimization', async () => {
      const text = 'This is a clean text.';
      const expected = 'This is a clean text.';
      expect(await optimizeTextForJson(text)).toBe(expected);
    });
  });
});