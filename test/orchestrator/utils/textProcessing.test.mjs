import { splitIntoSentences } from '../../orchestrator/src/utils/textProcessing.mjs';

describe('splitIntoSentences', () => {
  it('should split a basic text into sentences', () => {
    const text = "Hello world. How are you? I'm fine.";
    const expected = ["Hello world.", "How are you?", "I'm fine."];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should handle abbreviations correctly', () => {
    const text = "Mr. Smith went to Dr. Jones. Etc. The end.";
    const expected = ["Mr. Smith went to Dr. Jones.", "Etc.", "The end."];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should handle decimals correctly', () => {
    const text = "The value is 3.14. It's pi.";
    const expected = ["The value is 3.14.", "It's pi."];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should handle multiple punctuation marks at the end of a sentence', () => {
    const text = "Hello!!! How are you???";
    const expected = ["Hello!!!", "How are you???"];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should return an empty array for an empty string', () => {
    const text = "";
    expect(splitIntoSentences(text)).toEqual([]);
  });

  it('should return an empty array for a string with only spaces', () => {
    const text = "   ";
    expect(splitIntoSentences(text)).toEqual([]);
  });

  it('should handle mixed cases', () => {
    const text = "FIRST sentence. second SENTENCE! Third sentence?";
    const expected = ["FIRST sentence.", "second SENTENCE!", "Third sentence?"];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should handle periods within quotes', () => {
    const text = 'He said, "Hello world." She replied, "Hi."';
    const expected = ['He said, "Hello world."', 'She replied, "Hi."'];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should handle text with leading/trailing whitespace', () => {
    const text = "  Sentence one. Sentence two.  ";
    const expected = ["Sentence one.", "Sentence two."];
    expect(splitIntoSentences(text)).toEqual(expected);
  });

  it('should handle text with no punctuation', () => {
    const text = "This is a single sentence without punctuation";
    const expected = ["This is a single sentence without punctuation"];
    expect(splitIntoSentences(text)).toEqual(expected);
  });
});