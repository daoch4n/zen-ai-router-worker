// src/utils/textProcessing.mjs

// Extracted from src/durable_objects/TtsJobDurableObject.mjs
const abbreviationPattern = new RegExp(
  '([A-Z][a-z]{0,2}\\.(?:\\s?[A-Z][a-z]{0,2}\\.)+|[A-Z]\\.([A-Z]\\.)+|[Mm](?:rs?|s)\\.|[Ee]tc\\.|[Cc]f\\.|[Vv]s\\.|[DSJ]r\\.|[Pp]rof\\.|[Ii].e\\.|[Ee].g\\.)(?=\\s|$)',
  'g'
);

// Extracted from src/durable_objects/TtsJobDurableObject.mjs
export function splitIntoSentences(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Temporarily replace abbreviations to prevent incorrect sentence splitting
  const placeholders = [];
  text = text.replace(abbreviationPattern, (match) => {
    placeholders.push(match);
    return `__ABBR_${placeholders.length - 1}__`;
  });

  // Split by common sentence terminators, ensuring they are followed by space or end of string
  // Adjusted to better handle cases like "Hello!How are you?" vs "Hello! How are you?"
  // It now looks for a terminator followed by either whitespace, a quote, or end of string.
  // Or, it handles multiple terminators like "!!?"
  const sentences = text.split(/(?<=[.?!])(?=(?:\s+["']?|[A-Z])|$|[.!?"']+)/g)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Restore abbreviations
  return sentences.map(sentence =>
    sentence.replace(/__ABBR_(\d+)__/g, (match, index) => placeholders[parseInt(index, 10)])
  );
}

// Extracted from orchestrator/src/utils/textProcessing.mjs
export function getTextByteCount(text) {
  if (!text) return 0; // Ensure TextEncoder doesn't error on null/undefined
  return new TextEncoder().encode(text).length;
}
