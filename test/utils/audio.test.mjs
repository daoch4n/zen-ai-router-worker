/**
 * Tests for audio utilities
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { decodeBase64Audio, generateWavHeader } from '../../src/utils/audio.mjs';

describe('audio utilities', () => {
  beforeEach(() => {
    // Clear any mocks if needed
  });

  describe('decodeBase64Audio', () => {
    it('should decode valid base64 string to Uint8Array', () => {
      // "Hello" in base64 is "SGVsbG8="
      const base64 = 'SGVsbG8=';
      const result = decodeBase64Audio(base64);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(5);
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]); // "Hello" in ASCII
    });

    it('should decode empty base64 string', () => {
      const base64 = '';
      const result = decodeBase64Audio(base64);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });

    it('should decode base64 with padding', () => {
      // "Hi" in base64 is "SGk="
      const base64 = 'SGk=';
      const result = decodeBase64Audio(base64);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2);
      expect(Array.from(result)).toEqual([72, 105]); // "Hi" in ASCII
    });

    it('should decode base64 without padding', () => {
      // "Hi" in base64 without padding is "SGk"
      const base64 = 'SGk';
      const result = decodeBase64Audio(base64);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2);
      expect(Array.from(result)).toEqual([72, 105]); // "Hi" in ASCII
    });

    it('should handle binary audio data', () => {
      // Simulate some binary audio data encoded as base64
      const binaryData = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00]);
      const base64 = btoa(String.fromCharCode(...binaryData));
      const result = decodeBase64Audio(base64);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual(Array.from(binaryData));
    });

    it('should throw error for null input', () => {
      expect(() => decodeBase64Audio(null)).toThrow('Invalid base64 string: must be a non-empty string');
    });

    it('should throw error for undefined input', () => {
      expect(() => decodeBase64Audio(undefined)).toThrow('Invalid base64 string: must be a non-empty string');
    });

    it('should throw error for non-string input', () => {
      expect(() => decodeBase64Audio(123)).toThrow('Invalid base64 string: must be a non-empty string');
      expect(() => decodeBase64Audio({})).toThrow('Invalid base64 string: must be a non-empty string');
      expect(() => decodeBase64Audio([])).toThrow('Invalid base64 string: must be a non-empty string');
    });

    it('should throw error for invalid base64 characters', () => {
      const invalidBase64 = 'SGVsbG8@#$%';
      expect(() => decodeBase64Audio(invalidBase64)).toThrow('Failed to decode base64 audio');
    });
  });

  describe('generateWavHeader', () => {
    it('should generate correct WAV header for standard parameters', () => {
      const dataLength = 1000;
      const sampleRate = 44100;
      const channels = 1;
      const bitsPerSample = 16;

      const header = generateWavHeader(dataLength, sampleRate, channels, bitsPerSample);

      expect(header).toBeInstanceOf(Uint8Array);
      expect(header.length).toBe(44);

      // Check RIFF signature
      expect(header[0]).toBe(0x52); // 'R'
      expect(header[1]).toBe(0x49); // 'I'
      expect(header[2]).toBe(0x46); // 'F'
      expect(header[3]).toBe(0x46); // 'F'

      // Check WAVE signature
      expect(header[8]).toBe(0x57);  // 'W'
      expect(header[9]).toBe(0x41);  // 'A'
      expect(header[10]).toBe(0x56); // 'V'
      expect(header[11]).toBe(0x45); // 'E'

      // Check fmt signature
      expect(header[12]).toBe(0x66); // 'f'
      expect(header[13]).toBe(0x6D); // 'm'
      expect(header[14]).toBe(0x74); // 't'
      expect(header[15]).toBe(0x20); // ' '

      // Check data signature
      expect(header[36]).toBe(0x64); // 'd'
      expect(header[37]).toBe(0x61); // 'a'
      expect(header[38]).toBe(0x74); // 't'
      expect(header[39]).toBe(0x61); // 'a'
    });

    it('should calculate correct chunk size', () => {
      const dataLength = 1000;
      const header = generateWavHeader(dataLength, 44100, 1, 16);

      // Chunk size should be 36 + dataLength (little-endian at bytes 4-7)
      const expectedChunkSize = 36 + dataLength;
      const actualChunkSize = header[4] | (header[5] << 8) | (header[6] << 16) | (header[7] << 24);

      expect(actualChunkSize).toBe(expectedChunkSize);
    });

    it('should set correct audio format (PCM = 1)', () => {
      const header = generateWavHeader(1000, 44100, 1, 16);

      // Audio format at bytes 20-21 (little-endian)
      const audioFormat = header[20] | (header[21] << 8);
      expect(audioFormat).toBe(1); // PCM
    });

    it('should set correct number of channels', () => {
      const channels = 2;
      const header = generateWavHeader(1000, 44100, channels, 16);

      // Channels at bytes 22-23 (little-endian)
      const actualChannels = header[22] | (header[23] << 8);
      expect(actualChannels).toBe(channels);
    });

    it('should set correct sample rate', () => {
      const sampleRate = 24000;
      const header = generateWavHeader(1000, sampleRate, 1, 16);

      // Sample rate at bytes 24-27 (little-endian)
      const actualSampleRate = header[24] | (header[25] << 8) | (header[26] << 16) | (header[27] << 24);
      expect(actualSampleRate).toBe(sampleRate);
    });

    it('should calculate correct byte rate', () => {
      const sampleRate = 44100;
      const channels = 2;
      const bitsPerSample = 16;
      const expectedByteRate = sampleRate * channels * (bitsPerSample / 8);

      const header = generateWavHeader(1000, sampleRate, channels, bitsPerSample);

      // Byte rate at bytes 28-31 (little-endian)
      const actualByteRate = header[28] | (header[29] << 8) | (header[30] << 16) | (header[31] << 24);
      expect(actualByteRate).toBe(expectedByteRate);
    });

    it('should calculate correct block align', () => {
      const channels = 2;
      const bitsPerSample = 16;
      const expectedBlockAlign = channels * (bitsPerSample / 8);

      const header = generateWavHeader(1000, 44100, channels, bitsPerSample);

      // Block align at bytes 32-33 (little-endian)
      const actualBlockAlign = header[32] | (header[33] << 8);
      expect(actualBlockAlign).toBe(expectedBlockAlign);
    });

    it('should set correct bits per sample', () => {
      const bitsPerSample = 24;
      const header = generateWavHeader(1000, 44100, 1, bitsPerSample);

      // Bits per sample at bytes 34-35 (little-endian)
      const actualBitsPerSample = header[34] | (header[35] << 8);
      expect(actualBitsPerSample).toBe(bitsPerSample);
    });

    it('should set correct data chunk size', () => {
      const dataLength = 2048;
      const header = generateWavHeader(dataLength, 44100, 1, 16);

      // Data chunk size at bytes 40-43 (little-endian)
      const actualDataSize = header[40] | (header[41] << 8) | (header[42] << 16) | (header[43] << 24);
      expect(actualDataSize).toBe(dataLength);
    });

    it('should handle different parameter combinations', () => {
      const testCases = [
        { dataLength: 0, sampleRate: 8000, channels: 1, bitsPerSample: 8 },
        { dataLength: 5000, sampleRate: 22050, channels: 1, bitsPerSample: 16 },
        { dataLength: 10000, sampleRate: 48000, channels: 2, bitsPerSample: 24 },
        { dataLength: 100000, sampleRate: 96000, channels: 6, bitsPerSample: 32 }
      ];

      testCases.forEach(({ dataLength, sampleRate, channels, bitsPerSample }) => {
        const header = generateWavHeader(dataLength, sampleRate, channels, bitsPerSample);
        expect(header).toBeInstanceOf(Uint8Array);
        expect(header.length).toBe(44);
      });
    });

    it('should throw error for negative dataLength', () => {
      expect(() => generateWavHeader(-1, 44100, 1, 16)).toThrow('dataLength must be a non-negative integer');
    });

    it('should throw error for non-integer dataLength', () => {
      expect(() => generateWavHeader(1000.5, 44100, 1, 16)).toThrow('dataLength must be a non-negative integer');
    });

    it('should throw error for invalid sampleRate', () => {
      expect(() => generateWavHeader(1000, 0, 1, 16)).toThrow('sampleRate must be a positive integer');
      expect(() => generateWavHeader(1000, -44100, 1, 16)).toThrow('sampleRate must be a positive integer');
      expect(() => generateWavHeader(1000, 44100.5, 1, 16)).toThrow('sampleRate must be a positive integer');
    });

    it('should throw error for invalid channels', () => {
      expect(() => generateWavHeader(1000, 44100, 0, 16)).toThrow('channels must be a positive integer');
      expect(() => generateWavHeader(1000, 44100, -1, 16)).toThrow('channels must be a positive integer');
      expect(() => generateWavHeader(1000, 44100, 1.5, 16)).toThrow('channels must be a positive integer');
    });

    it('should throw error for invalid bitsPerSample', () => {
      expect(() => generateWavHeader(1000, 44100, 1, 0)).toThrow('bitsPerSample must be a positive integer');
      expect(() => generateWavHeader(1000, 44100, 1, -16)).toThrow('bitsPerSample must be a positive integer');
      expect(() => generateWavHeader(1000, 44100, 1, 16.5)).toThrow('bitsPerSample must be a positive integer');
    });
  });
});
