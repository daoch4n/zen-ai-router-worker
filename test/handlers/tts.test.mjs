import { optimizeTextForJson, newWavHeader, convertToWavFormat } from '../../src/handlers/tts.mjs';

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

describe('newWavHeader', () => {
  test('should return a 44-byte Uint8Array', () => {
    const header = newWavHeader(1000, 44100, 2, 16);
    expect(header.length).toBe(44);
  });

  test('should correctly populate RIFF chunk fields', () => {
    const dataLength = 1000;
    const header = newWavHeader(dataLength, 44100, 2, 16);
    const view = new DataView(header.buffer);

    // "RIFF"
    expect(view.getUint32(0, false)).toBe(0x52494646);
    // ChunkSize
    expect(view.getUint32(4, true)).toBe(36 + dataLength);
    // "WAVE"
    expect(view.getUint32(8, false)).toBe(0x57415645);
  });

  test('should correctly populate fmt subchunk fields', () => {
    const sampleRate = 44100;
    const channels = 2;
    const bitsPerSample = 16;
    const header = newWavHeader(1000, sampleRate, channels, bitsPerSample);
    const view = new DataView(header.buffer);

    // "fmt "
    expect(view.getUint32(12, false)).toBe(0x666d7420);
    // Subchunk1Size
    expect(view.getUint32(16, true)).toBe(16);
    // AudioFormat
    expect(view.getUint16(20, true)).toBe(1);
    // NumChannels
    expect(view.getUint16(22, true)).toBe(channels);
    // SampleRate
    expect(view.getUint32(24, true)).toBe(sampleRate);
    // ByteRate
    expect(view.getUint32(28, true)).toBe(sampleRate * channels * bitsPerSample / 8);
    // BlockAlign
    expect(view.getUint16(32, true)).toBe(channels * bitsPerSample / 8);
    // BitsPerSample
    expect(view.getUint16(34, true)).toBe(bitsPerSample);
  });

  test('should correctly populate data subchunk fields', () => {
    const dataLength = 2000;
    const header = newWavHeader(dataLength, 44100, 2, 16);
    const view = new DataView(header.buffer);

    // "data"
    expect(view.getUint32(36, false)).toBe(0x64617461);
    // Subchunk2Size
    expect(view.getUint32(40, true)).toBe(dataLength);
  });

  test('should handle different parameters correctly', () => {
    const dataLength = 500;
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 8;
    const header = newWavHeader(dataLength, sampleRate, channels, bitsPerSample);
    const view = new DataView(header.buffer);

    expect(header.length).toBe(44);
    expect(view.getUint32(4, true)).toBe(36 + dataLength);
    expect(view.getUint16(22, true)).toBe(channels);
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(sampleRate * channels * bitsPerSample / 8);
    expect(view.getUint16(32, true)).toBe(channels * bitsPerSample / 8);
    expect(view.getUint16(34, true)).toBe(bitsPerSample);
    expect(view.getUint32(40, true)).toBe(dataLength);
  });
});

describe('convertToWavFormat', () => {
  test('should correctly concatenate WAV header and PCM data', () => {
    const pcmData = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A]);
    const sampleRate = 24000;
    const channels = 1;
    const bitsPerSample = 16;

    const expectedWavHeader = newWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
    const result = convertToWavFormat(pcmData, sampleRate, channels, bitsPerSample);

    // Assert that the returned Uint8Array has the correct length
    expect(result.length).toBe(44 + pcmData.length);

    // Verify that the first 44 bytes match the expected WAV header
    const actualHeader = result.slice(0, 44);
    expect(actualHeader).toEqual(expectedWavHeader);

    // Verify that the bytes following the header exactly match the input pcmData
    const actualPcmData = result.slice(44);
    expect(actualPcmData).toEqual(pcmData);
  });

  test('should handle empty PCM data', () => {
    const pcmData = new Uint8Array([]);
    const sampleRate = 24000;
    const channels = 1;
    const bitsPerSample = 16;

    const expectedWavHeader = newWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
    const result = convertToWavFormat(pcmData, sampleRate, channels, bitsPerSample);

    expect(result.length).toBe(44);
    expect(result).toEqual(expectedWavHeader);
  });

  test('should handle different audio parameters', () => {
    const pcmData = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
    const sampleRate = 16000;
    const channels = 2;
    const bitsPerSample = 8;

    const expectedWavHeader = newWavHeader(pcmData.length, sampleRate, channels, bitsPerSample);
    const result = convertToWavFormat(pcmData, sampleRate, channels, bitsPerSample);

    expect(result.length).toBe(44 + pcmData.length);
    expect(result.slice(0, 44)).toEqual(expectedWavHeader);
    expect(result.slice(44)).toEqual(pcmData);
  });
});