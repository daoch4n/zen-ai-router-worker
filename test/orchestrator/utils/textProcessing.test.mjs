import { splitIntoSentences, optimizeTextForJson } from '../../orchestrator/src/utils/textProcessing.mjs';

describe('splitIntoSentences', () => {
  test('should split a single sentence correctly', () => {
    const text = 'Hello, world.';
    expect(splitIntoSentences(text)).toEqual(['Hello, world.']);
  });

  test('should split multiple sentences correctly', () => {
    const text = 'First sentence. Second sentence! Third sentence?';
    expect(splitIntoSentences(text)).toEqual(['First sentence.', 'Second sentence!', 'Third sentence?']);
  });

  test('should handle abbreviations without splitting', () => {
    const text = 'Dr. Smith visited Mr. Jones. He was happy.';
    expect(splitIntoSentences(text)).toEqual(['Dr. Smith visited Mr. Jones.', 'He was happy.']);
  });

  test('should handle decimals without splitting', () => {
    const text = 'The value is 3.14. It is important.';
    expect(splitIntoSentences(text)).toEqual(['The value is 3.14.', 'It is important.']);
  });

  test('should handle mixed abbreviations and decimals', () => {
    const text = 'Mr. Smith paid $10.50. Dr. Brown arrived.';
    expect(splitIntoSentences(text)).toEqual(['Mr. Smith paid $10.50.', 'Dr. Brown arrived.']);
  });

  test('should trim leading and trailing whitespace from sentences', () => {
    const text = '  Hello.   World.  ';
    expect(splitIntoSentences(text)).toEqual(['Hello.', 'World.']);
  });

  test('should handle sentences ending with multiple punctuation marks', () => {
    const text = 'Wow!!! Really?? Yes.';
    expect(splitIntoSentences(text)).toEqual(['Wow!!!', 'Really??', 'Yes.']);
  });

  test('should return an empty array for an empty string', () => {
    const text = '';
    expect(splitIntoSentences(text)).toEqual([]);
  });

  test('should return an empty array for a string with only whitespace', () => {
    const text = '   \t  \n ';
    expect(splitIntoSentences(text)).toEqual([]);
  });

  test('should handle common abbreviations like "etc." and "e.g."', () => {
    const text = 'List items, etc. This is another sentence. For example, e.g. like this.';
    expect(splitIntoSentences(text)).toEqual(['List items, etc.', 'This is another sentence.', 'For example, e.g. like this.']);
  });

  test('should handle multiple spaces between sentences', () => {
    const text = 'First.  Second.   Third.';
    expect(splitIntoSentences(text)).toEqual(['First.', 'Second.', 'Third.']);
  });

  test('should handle sentences with no ending punctuation', () => {
    const text = 'This is a sentence without punctuation';
    expect(splitIntoSentences(text)).toEqual(['This is a sentence without punctuation']);
  });
});

describe('optimizeTextForJson', () => {
  test('should remove invisible control characters', () => {
    const text = 'Hello\u0000World\u0007!';
    expect(optimizeTextForJson(text)).toBe('HelloWorld!');
  });

  test('should not remove newline, carriage return, and tab characters', () => {
    const text = 'Hello\nWorld\r\t!';
    expect(optimizeTextForJson(text)).toBe('Hello\nWorld\r\t!');
  });

  test('should replace (e.g., with (e.g.', () => {
    const text = 'This is an example (e.g., something).';
    expect(optimizeTextForJson(text)).toBe('This is an example (e.g. something).');
  });

  test('should normalize line endings from \\r\\n to \\n', () => {
    const text = 'Line 1\r\nLine 2\r\nLine 3';
    expect(optimizeTextForJson(text)).toBe('Line 1\nLine 2\nLine 3');
  });

  test('should trim leading and trailing whitespace', () => {
    const text = '  Hello World  ';
    expect(optimizeTextForJson(text)).toBe('Hello World');
  });

  test('should handle a combination of optimizations', () => {
    const text = '\u0000  First line\r\n(e.g., with control char) Second line.  \u0007';
    expect(optimizeTextForJson(text)).toBe('First line\n(e.g. with control char) Second line.');
  });

  test('should return an empty string for an empty input', () => {
    const text = '';
    expect(optimizeTextForJson(text)).toBe('');
  });

  test('should return an empty string for input with only whitespace and control characters', () => {
    const text = '\u0000  \r\n \u0007 ';
    expect(optimizeTextForJson(text)).toBe('');
  });
});