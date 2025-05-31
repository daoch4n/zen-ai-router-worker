import { describe, it, expect } from '@jest/globals';
import { splitIntoSentences, getTextByteCount } from '../../src/utils/textProcessing.mjs';

describe('Text Processing Utilities', () => {
  describe('splitIntoSentences', () => {
    it('should return an empty array for empty, null, or undefined input', () => {
      expect(splitIntoSentences('')).toEqual([]);
      expect(splitIntoSentences(null)).toEqual([]);
      expect(splitIntoSentences(undefined)).toEqual([]);
    });

    it('should correctly split sentences with standard terminators and spaces', () => {
      const text = 'Hello world. This is a test. How are you?';
      expect(splitIntoSentences(text)).toEqual(['Hello world.', 'This is a test.', 'How are you?']);
    });

    it('should handle multiple spaces after terminators', () => {
      const text = 'Hello world.  This is a test.   How are you?';
      expect(splitIntoSentences(text)).toEqual(['Hello world.', 'This is a test.', 'How are you?']);
    });

    it('should handle sentences with exclamation and question marks', () => {
      const text = 'Wow! That is great. Is it not? Yes!';
      expect(splitIntoSentences(text)).toEqual(['Wow!', 'That is great.', 'Is it not?', 'Yes!']);
    });

    it('should handle multiple terminators together', () => {
      const text = 'Really?!? Yes... It is.';
      expect(splitIntoSentences(text)).toEqual(['Really?!?', 'Yes...', 'It is.']);
    });

    // New tests for the updated regex
    it('should split sentences concatenated without whitespace but with a following capital letter', () => {
      const text = 'Hello!How are you?';
      expect(splitIntoSentences(text)).toEqual(['Hello!', 'How are you?']);
    });

    it('should split "First.Second.Third."', () => {
        const text = "First.Second.Third.";
        expect(splitIntoSentences(text)).toEqual(["First.", "Second.", "Third."]);
    });

    it('should split "Hello! This is a test.How are you?"', () => {
        const text = "Hello! This is a test.How are you?";
        expect(splitIntoSentences(text)).toEqual(["Hello!", "This is a test.", "How are you?"]);
    });

    it('should split sentences with terminators followed by quotes and then a capital letter', () => {
      const text = 'He said, "Hello!"Next sentence began.';
      // Note: The regex is designed to split after the quote if followed by a capital letter.
      // Depending on desired behavior for quotes, this might need refinement.
      // Current regex: /(?<=[.?!])(?=\s*["']?|$|[.!?"']+|[A-Z])/g
      // If "Hello!" is a sentence and "Next sentence began." is another.
      expect(splitIntoSentences(text)).toEqual(['He said, "Hello!"', 'Next sentence began.']);

      const text2 = 'Is it good?"Yes," he replied.';
      expect(splitIntoSentences(text2)).toEqual(['Is it good?', '"Yes," he replied.']);

      const text3 = 'She exclaimed, "Wow!"Then she left.';
      expect(splitIntoSentences(text3)).toEqual(['She exclaimed, "Wow!"', 'Then she left.']);
    });

    it('should correctly split sentences like "Okay."Next one."', () => {
        const text = '"Okay."Next one.';
        expect(splitIntoSentences(text)).toEqual(['"Okay."', 'Next one.']);
    });

    it('should handle sentences with multiple terminators followed by a capital letter', () => {
      const text = 'Really!!?Yes, it is.';
      expect(splitIntoSentences(text)).toEqual(['Really!!?', 'Yes, it is.']);
    });

    it('should correctly handle abbreviations and not split them internally or incorrectly', () => {
      const text = 'Mr. Smith went to Washington. Dr. Jones also went. They saw the U.S. Capitol building. Later, Gen. Motors made a statement. This is approx. correct.';
      expect(splitIntoSentences(text)).toEqual([
        'Mr. Smith went to Washington.',
        'Dr. Jones also went.',
        'They saw the U.S. Capitol building.',
        'Later, Gen. Motors made a statement.',
        'This is approx. correct.'
      ]);

      const text2 = 'Visit example.com.It is a good site.Also, test this Ph.D. level material.';
      expect(splitIntoSentences(text2)).toEqual([
        'Visit example.com.',
        'It is a good site.',
        'Also, test this Ph.D. level material.'
      ]);
    });

    it('should handle text ending with an abbreviation', () => {
        const text = 'The current time is approx. noon.';
        expect(splitIntoSentences(text)).toEqual(['The current time is approx. noon.']);
    });

    it('should handle text with various abbreviations and sentence structures', () => {
      const text = 'Lt. Gov. Brown visited a U.S. base. It was amazing!Gen. Motors is a company. E.g. this works. Etc.And so on.';
      expect(splitIntoSentences(text)).toEqual([
        'Lt. Gov. Brown visited a U.S. base.',
        'It was amazing!',
        'Gen. Motors is a company.',
        'E.g. this works.',
        'Etc.',
        'And so on.'
      ]);
    });

    it('should not split on decimal numbers or currency', () => {
        const text = 'The price is $12.99. Next item is 3.14 units.';
        expect(splitIntoSentences(text)).toEqual(['The price is $12.99.', 'Next item is 3.14 units.']);
    });

    it('should handle complex cases with quotes and capital letters', () => {
        const text = 'She asked, "Are you sure?It is important." Then she added, "Okay."';
        expect(splitIntoSentences(text)).toEqual(['She asked, "Are you sure?', 'It is important."', 'Then she added, "Okay."']);
    });
  });

  describe('getTextByteCount', () => {
    it('should return 0 for empty, null, or undefined input', () => {
      expect(getTextByteCount('')).toBe(0);
      expect(getTextByteCount(null)).toBe(0);
      expect(getTextByteCount(undefined)).toBe(0);
    });

    it('should return correct byte count for ASCII text', () => {
      expect(getTextByteCount('hello')).toBe(5);
    });

    it('should return correct byte count for text with spaces', () => {
      expect(getTextByteCount('hello world')).toBe(11);
    });

    it('should return correct byte count for text with multi-byte characters', () => {
      expect(getTextByteCount('你好世界')).toBe(12); // Each Chinese character is 3 bytes in UTF-8
      expect(getTextByteCount('😊')).toBe(4); // Emoji is 4 bytes in UTF-8
    });
  });
});
