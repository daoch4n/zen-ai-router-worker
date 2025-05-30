/**
 * Audio utilities for WAV file generation and base64 audio processing.
 * Provides high-performance functions for audio manipulation in Cloudflare Workers.
 */

/**
 * Decodes a Base64 encoded audio string into a Uint8Array.
 * Efficiently converts base64 audio data to binary format for processing.
 *
 * @param {string} base64String - Base64 encoded audio data
 * @returns {Uint8Array} Decoded binary audio data
 * @throws {Error} When base64 string is invalid or empty
 */
export function decodeBase64Audio(base64String) {
  if (base64String === null || base64String === undefined || typeof base64String !== 'string') {
    throw new Error('Invalid base64 string: must be a non-empty string');
  }

  // Handle empty string case
  if (base64String === '') {
    return new Uint8Array(0);
  }

  try {
    // Use the more robust base64ToArrayBuffer and convert to Uint8Array
    const arrayBuffer = base64ToArrayBuffer(base64String);
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    throw new Error(`Failed to decode base64 audio: ${error.message}`);
  }
}

/**
 * Encodes an ArrayBuffer into a Base64 string using `btoa`.
 * This function manually converts the ArrayBuffer to a binary string
 * before encoding. While `btoa` is efficient, this intermediate step
 * might have performance implications for very large ArrayBuffers.
 *
 * @param {ArrayBuffer} buffer - The binary data to encode.
 * @returns {string} The Base64 encoded string.
 * @throws {Error} When input is not an ArrayBuffer.
 */
export function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('Invalid input: must be an ArrayBuffer.');
  }

  const bytes = new Uint8Array(buffer);
  let base64 = '';
  const chunkSize = 16384; // 16KB chunk size, common for avoiding call stack limits with apply

  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    // Apply String.fromCharCode to the chunk to create a binary string
    // This is generally more efficient than concatenating in a loop for smaller chunks
    base64 += btoa(String.fromCharCode.apply(null, chunk));
  }
  return base64;
}
/**
 * Decodes a Base64 encoded string into an ArrayBuffer.
 * This function is designed to handle large inputs efficiently without
 * encountering "Maximum call stack size exceeded" errors, by processing
 * the Base64 string in chunks or using a more robust decoding method
 * like `atob` with a Blob/FileReader approach if available in the environment,
 * or a byte-by-byte conversion if `atob` is still problematic for very large strings.
 * Given that `atob` is still the most direct method in Cloudflare Workers,
 * the primary improvement will come from handling potential size limitations
 * by returning an ArrayBuffer directly from the `atob` result.
 *
 * @param {string} base64String - Base64 encoded string.
 * @returns {ArrayBuffer} Decoded binary data as an ArrayBuffer.
 * @throws {Error} When base64 string is invalid or decoding fails.
 */
export function base64ToArrayBuffer(base64String) {
  if (base64String === null || base64String === undefined || typeof base64String !== 'string') {
    throw new Error('Invalid base64 string: must be a non-empty string.');
  }

  // Handle empty string case
  if (base64String === '') {
    return new ArrayBuffer(0);
  }

  try {
    // atob is optimized for performance in browser-like environments (e.g., Cloudflare Workers)
    // and is generally more efficient than manual byte-by-byte conversion for large strings.
    // The previous issue with "Maximum call stack size exceeded" for atob usually relates
    // to subsequent operations on the *result* of atob (like `Uint8Array.from` on a very
    // long string), rather than atob itself. This function will directly convert to ArrayBuffer.
    const binaryString = atob(base64String);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes.buffer; // Return as ArrayBuffer
  } catch (error) {
    throw new Error(`Failed to decode base64 to ArrayBuffer: ${error.message}`);
  }
}

/**
 * Generates a WAV file header as a Uint8Array.
 * Creates a 44-byte RIFF/WAV header with proper byte ordering and chunk structure.
 * Optimized for performance using DataView for efficient byte manipulation.
 *
 * @param {number} dataLength - Size of PCM audio data in bytes
 * @param {number} sampleRate - Audio sample rate (e.g., 44100, 24000)
 * @param {number} channels - Number of audio channels (1 for mono, 2 for stereo)
 * @param {number} bitsPerSample - Bits per sample (typically 16 or 24)
 * @returns {Uint8Array} 44-byte WAV header
 * @throws {Error} When parameters are invalid
 */
export function generateWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
  // Validate input parameters
  if (!Number.isInteger(dataLength) || dataLength < 0) {
    throw new Error('dataLength must be a non-negative integer');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error('sampleRate must be a positive integer');
  }
  if (!Number.isInteger(channels) || channels <= 0) {
    throw new Error('channels must be a positive integer');
  }
  if (!Number.isInteger(bitsPerSample) || bitsPerSample <= 0) {
    throw new Error('bitsPerSample must be a positive integer');
  }

  // Calculate derived values
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const chunkSize = 36 + dataLength; // Total file size - 8 bytes
  const subchunk2Size = dataLength;

  // Create 44-byte header buffer
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk descriptor (12 bytes)
  // "RIFF" signature (4 bytes)
  view.setUint8(0, 0x52); // 'R'
  view.setUint8(1, 0x49); // 'I'
  view.setUint8(2, 0x46); // 'F'
  view.setUint8(3, 0x46); // 'F'
  
  // Chunk size (4 bytes, little-endian)
  view.setUint32(4, chunkSize, true);
  
  // "WAVE" format (4 bytes)
  view.setUint8(8, 0x57);  // 'W'
  view.setUint8(9, 0x41);  // 'A'
  view.setUint8(10, 0x56); // 'V'
  view.setUint8(11, 0x45); // 'E'

  // fmt subchunk (24 bytes)
  // "fmt " signature (4 bytes)
  view.setUint8(12, 0x66); // 'f'
  view.setUint8(13, 0x6D); // 'm'
  view.setUint8(14, 0x74); // 't'
  view.setUint8(15, 0x20); // ' '
  
  // Subchunk1 size (4 bytes, little-endian) - always 16 for PCM
  view.setUint32(16, 16, true);
  
  // Audio format (2 bytes, little-endian) - 1 for PCM
  view.setUint16(20, 1, true);
  
  // Number of channels (2 bytes, little-endian)
  view.setUint16(22, channels, true);
  
  // Sample rate (4 bytes, little-endian)
  view.setUint32(24, sampleRate, true);
  
  // Byte rate (4 bytes, little-endian)
  view.setUint32(28, byteRate, true);
  
  // Block align (2 bytes, little-endian)
  view.setUint16(32, blockAlign, true);
  
  // Bits per sample (2 bytes, little-endian)
  view.setUint16(34, bitsPerSample, true);

  // data subchunk (8 bytes header)
  // "data" signature (4 bytes)
  view.setUint8(36, 0x64); // 'd'
  view.setUint8(37, 0x61); // 'a'
  view.setUint8(38, 0x74); // 't'
  view.setUint8(39, 0x61); // 'a'
  
  // Subchunk2 size (4 bytes, little-endian)
  view.setUint32(40, subchunk2Size, true);

  return new Uint8Array(header);
}
