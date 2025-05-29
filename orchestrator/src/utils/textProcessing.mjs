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

export function getTextCharacterCount(text) {
  return new TextEncoder().encode(text).length;
}