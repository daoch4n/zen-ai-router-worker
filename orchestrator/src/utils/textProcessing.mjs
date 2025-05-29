export function splitIntoSentences(text) {
  const abbreviationPlaceholder = "###ABBR###";
  const decimalPlaceholder = "###DEC###";

  let processedText = text
    .replace(new RegExp(abbreviationPattern, 'g'), `$1${abbreviationPlaceholder}`)
    .replace(/(\d+)\.(\d+)/g, `$1${decimalPlaceholder}$2`);

  const sentences = processedText.split(
    new RegExp(`(?<=[.!?])\\s*(?<!${abbreviationPlaceholder.replace('.', '\\.')})(?<!${decimalPlaceholder.replace('.', '\\.')})(?=\\S|$)`, 'g')
  );

  return sentences
    .map(s => s
      .replace(new RegExp(abbreviationPlaceholder, 'g'), '.')
      .replace(new RegExp(decimalPlaceholder, 'g'), '.')
      .trim()
    )
    .filter(s => s.length > 0 && /\S/.test(s));
}

export function optimizeTextForJson(text) {
  let optimizedText = text;

  // Remove invisible control characters, excluding newlines, carriage returns, and tabs.
  optimizedText = optimizedText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

  // Replace (e.g., with (e.g. to avoid pronunciation issues with TTS
  optimizedText = optimizedText.replace(/\(e\.g\.,/g, '(e.g.');

  // Normalize line endings from \r\n to \n
  optimizedText = optimizedText.replace(/\r\n/g, '\n');

  // Trim leading and trailing whitespace
  optimizedText = optimizedText.trim();

  return optimizedText;
}