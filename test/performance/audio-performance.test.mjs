/**
 * Performance tests for audio processing functions
 * Tests the efficiency of base64 decoding, WAV header generation, and audio concatenation
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { decodeBase64Audio, generateWavHeader } from '../../src/utils/audio.mjs';

describe('Audio Processing Performance Tests', () => {
  let performanceResults = {};

  beforeEach(() => {
    performanceResults = {};
  });

  /**
   * Helper function to measure execution time of a function
   * @param {string} label - Label for the measurement
   * @param {Function} fn - Function to measure
   * @returns {any} Result of the function execution
   */
  function measurePerformance(label, fn) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    const duration = end - start;
    
    performanceResults[label] = duration;
    console.log(`${label}: ${duration.toFixed(3)}ms`);
    
    return result;
  }

  /**
   * Generate test base64 data of specified size
   * @param {number} sizeKB - Size in kilobytes
   * @returns {string} Base64 encoded test data
   */
  function generateTestBase64(sizeKB) {
    const bytes = new Uint8Array(sizeKB * 1024);
    // Fill with pseudo-random data for realistic testing
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }

    // Convert to string in chunks to avoid call stack overflow
    let binaryString = '';
    const chunkSize = 8192; // Process in 8KB chunks
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      binaryString += String.fromCharCode(...chunk);
    }

    return btoa(binaryString);
  }

  describe('Base64 Decoding Performance', () => {
    it('should decode small audio files (10KB) efficiently', () => {
      const testData = generateTestBase64(10); // 10KB
      
      const result = measurePerformance('Base64-Decode-10KB', () => {
        return decodeBase64Audio(testData);
      });

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(10 * 1024);
      
      // Performance target: should complete in under 5ms for 10KB
      console.log(`✓ Base64 decode 10KB: ${performanceResults['Base64-Decode-10KB'].toFixed(3)}ms (target: <5ms)`);
      expect(performanceResults['Base64-Decode-10KB']).toBeLessThan(5);
    });

    it('should decode medium audio files (100KB) efficiently', () => {
      const testData = generateTestBase64(100); // 100KB
      
      const result = measurePerformance('Base64-Decode-100KB', () => {
        return decodeBase64Audio(testData);
      });

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(100 * 1024);
      
      // Performance target: should complete in under 20ms for 100KB
      console.log(`✓ Base64 decode 100KB: ${performanceResults['Base64-Decode-100KB'].toFixed(3)}ms (target: <20ms)`);
      expect(performanceResults['Base64-Decode-100KB']).toBeLessThan(20);
    });

    it('should decode large audio files (1MB) efficiently', () => {
      const testData = generateTestBase64(1024); // 1MB
      
      const result = measurePerformance('Base64-Decode-1MB', () => {
        return decodeBase64Audio(testData);
      });

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(1024 * 1024);
      
      // Performance target: should complete in under 100ms for 1MB
      console.log(`✓ Base64 decode 1MB: ${performanceResults['Base64-Decode-1MB'].toFixed(3)}ms (target: <100ms)`);
      expect(performanceResults['Base64-Decode-1MB']).toBeLessThan(100);
    });
  });

  describe('WAV Header Generation Performance', () => {
    it('should generate WAV headers very quickly', () => {
      const testCases = [
        { dataLength: 10 * 1024, sampleRate: 24000, label: 'WAV-Header-10KB' },
        { dataLength: 100 * 1024, sampleRate: 44100, label: 'WAV-Header-100KB' },
        { dataLength: 1024 * 1024, sampleRate: 48000, label: 'WAV-Header-1MB' }
      ];

      testCases.forEach(({ dataLength, sampleRate, label }) => {
        const result = measurePerformance(label, () => {
          return generateWavHeader(dataLength, sampleRate, 1, 16);
        });

        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(44);
        
        // Performance target: WAV header generation should be under 1ms regardless of data size
        expect(performanceResults[label]).toBeLessThan(1);
      });
    });
  });

  describe('Audio Concatenation Performance', () => {
    it('should concatenate audio data efficiently', () => {
      const testSizes = [
        { size: 10, label: 'Concatenation-10KB' },
        { size: 100, label: 'Concatenation-100KB' },
        { size: 1024, label: 'Concatenation-1MB' }
      ];

      testSizes.forEach(({ size, label }) => {
        const pcmData = new Uint8Array(size * 1024);
        const wavHeader = generateWavHeader(pcmData.length, 24000, 1, 16);

        const result = measurePerformance(label, () => {
          const wavFileData = new Uint8Array(wavHeader.length + pcmData.length);
          wavFileData.set(wavHeader, 0);
          wavFileData.set(pcmData, wavHeader.length);
          return wavFileData;
        });

        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(44 + size * 1024);
        
        // Performance targets for concatenation
        if (size === 10) {
          expect(performanceResults[label]).toBeLessThan(2);
        } else if (size === 100) {
          expect(performanceResults[label]).toBeLessThan(10);
        } else if (size === 1024) {
          expect(performanceResults[label]).toBeLessThan(50);
        }
      });
    });
  });

  describe('End-to-End Audio Processing Performance', () => {
    it('should process complete audio pipeline within target time', () => {
      const testData = generateTestBase64(100); // 100KB test file
      
      const result = measurePerformance('E2E-AudioProcessing-100KB', () => {
        // Simulate the complete audio processing pipeline
        const pcmAudioData = decodeBase64Audio(testData);
        const dataLength = pcmAudioData.length;
        const wavHeader = generateWavHeader(dataLength, 24000, 1, 16);
        
        const wavFileData = new Uint8Array(wavHeader.length + pcmAudioData.length);
        wavFileData.set(wavHeader, 0);
        wavFileData.set(pcmAudioData, wavHeader.length);
        
        return wavFileData;
      });

      expect(result).toBeInstanceOf(Uint8Array);
      
      // Performance target: Complete audio processing should be under 10ms for 100KB
      // This is our critical target for Cloudflare Workers
      console.log(`✓ End-to-End 100KB: ${performanceResults['E2E-AudioProcessing-100KB'].toFixed(3)}ms (target: <10ms)`);
      expect(performanceResults['E2E-AudioProcessing-100KB']).toBeLessThan(10);
    });
  });

  afterEach(() => {
    // Log performance summary
    console.log('\n=== Performance Summary ===');
    Object.entries(performanceResults).forEach(([label, duration]) => {
      console.log(`${label}: ${duration.toFixed(3)}ms`);
    });
    console.log('===========================\n');
  });
});
