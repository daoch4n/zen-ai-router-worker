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
    // Use atob for base64 decoding in Cloudflare Workers environment
    const binaryString = atob(base64String);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);

    // Optimized loop with unrolling for better performance
    let i = 0;
    for (; i < length - 3; i += 4) {
      bytes[i] = binaryString.charCodeAt(i);
      bytes[i + 1] = binaryString.charCodeAt(i + 1);
      bytes[i + 2] = binaryString.charCodeAt(i + 2);
      bytes[i + 3] = binaryString.charCodeAt(i + 3);
    }

    // Handle remaining bytes
    for (; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
  } catch (error) {
    throw new Error(`Failed to decode base64 audio: ${error.message}`);
  }
}

/**
 * Encodes a Uint8Array (or ArrayBuffer) into a Base64 string.
 * This function handles large inputs by processing them in chunks to avoid
 * "Maximum call stack size exceeded" errors with String.fromCharCode.
 *
 * @param {Uint8Array|ArrayBuffer} buffer - The binary data to encode.
 * @returns {string} The Base64 encoded string.
 * @throws {Error} If the input is not a valid Uint8Array or ArrayBuffer.
 */
export function arrayBufferToBase64(buffer) {
  if (!(buffer instanceof Uint8Array) && !(buffer instanceof ArrayBuffer)) {
    throw new Error('Invalid input: must be a Uint8Array or ArrayBuffer.');
  }

  const uint8Array = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = '';
  const len = uint8Array.byteLength;
  const chunkSize = 16384; // Process in 16KB chunks

  for (let i = 0; i < len; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
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
