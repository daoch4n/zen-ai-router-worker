import { optimizeTextForJson } from '../../src/handlers/tts.mjs';

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