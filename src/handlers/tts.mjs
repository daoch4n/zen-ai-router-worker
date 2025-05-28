export async function optimizeTextForJson(text) {
  let optimizedText = text;

  // Replace specific Unicode characters with ASCII equivalents
  optimizedText = optimizedText.replace(/\u2013/g, '-'); // en dash
  optimizedText = optimizedText.replace(/\u2014/g, '--'); // em dash
  optimizedText = optimizedText.replace(/\u2018/g, "'"); // left single quote
  optimizedText = optimizedText.replace(/\u2019/g, "'"); // right single quote
  optimizedText = optimizedText.replace(/\u201C/g, '"'); // left double quote
  optimizedText = optimizedText.replace(/\u201D/g, '"'); // right double quote

  // Remove invisible control characters, excluding newlines, carriage returns, and tabs.
  // The regex [^\P{C}\n\r\t] from PowerShell needs to be adapted for JavaScript.
  // \p{C} matches invisible control characters. \P{C} matches anything that is NOT an invisible control character.
  // So, [^\P{C}\n\r\t] means "any character that is NOT (not a control character OR newline OR carriage return OR tab)".
  // This simplifies to "any control character that is NOT newline, carriage return, or tab".
  optimizedText = optimizedText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');

  // Normalize line endings from \r\n to \n
  optimizedText = optimizedText.replace(/\r\n/g, '\n');

  // Trim leading and trailing whitespace
  optimizedText = optimizedText.trim();

  return optimizedText;
}