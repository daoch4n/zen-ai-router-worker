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

export function newWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  // RIFF Chunk
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true); // ChunkSize
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt Subchunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, channels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * channels * bitsPerSample / 8, true); // ByteRate
  view.setUint16(32, channels * bitsPerSample / 8, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true); // BitsPerSample

  // data Subchunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true); // Subchunk2Size

  return header;
}

export function convertToWavFormat(pcmData, sampleRate, channels, bitsPerSample) {
  const wavHeader = newWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
  const wavFile = new Uint8Array(wavHeader.length + pcmData.length);

  wavFile.set(wavHeader, 0);
  wavFile.set(pcmData, wavHeader.length);

  return wavFile;
}