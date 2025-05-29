/**
 * Baseline performance measurements for audio processing functions
 * This script measures current performance to establish baseline before optimizations
 */
import { decodeBase64Audio, generateWavHeader } from '../../src/utils/audio.mjs';

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

/**
 * Measure execution time of a function
 * @param {string} label - Label for the measurement
 * @param {Function} fn - Function to measure
 * @param {number} iterations - Number of iterations to run
 * @returns {Object} Performance results
 */
function measurePerformance(label, fn, iterations = 5) {
  const times = [];
  
  // Warm up
  fn();
  
  // Measure multiple iterations
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log(`${label}:`);
  console.log(`  Average: ${avg.toFixed(3)}ms`);
  console.log(`  Min: ${min.toFixed(3)}ms`);
  console.log(`  Max: ${max.toFixed(3)}ms`);
  console.log(`  All times: [${times.map(t => t.toFixed(3)).join(', ')}]ms`);
  
  return { avg, min, max, times };
}

console.log('=== BASELINE PERFORMANCE MEASUREMENTS ===\n');

// Test Base64 Decoding Performance
console.log('1. Base64 Decoding Performance:');

const testData10KB = generateTestBase64(10);
const testData100KB = generateTestBase64(100);
const testData1MB = generateTestBase64(1024);

const base64_10KB = measurePerformance('Base64 Decode 10KB', () => {
  decodeBase64Audio(testData10KB);
});

const base64_100KB = measurePerformance('Base64 Decode 100KB', () => {
  decodeBase64Audio(testData100KB);
});

const base64_1MB = measurePerformance('Base64 Decode 1MB', () => {
  decodeBase64Audio(testData1MB);
});

console.log('\n2. WAV Header Generation Performance:');

const wavHeader_10KB = measurePerformance('WAV Header 10KB', () => {
  generateWavHeader(10 * 1024, 24000, 1, 16);
});

const wavHeader_100KB = measurePerformance('WAV Header 100KB', () => {
  generateWavHeader(100 * 1024, 44100, 1, 16);
});

const wavHeader_1MB = measurePerformance('WAV Header 1MB', () => {
  generateWavHeader(1024 * 1024, 48000, 1, 16);
});

console.log('\n3. Audio Concatenation Performance:');

const pcmData10KB = decodeBase64Audio(testData10KB);
const pcmData100KB = decodeBase64Audio(testData100KB);
const pcmData1MB = decodeBase64Audio(testData1MB);

const concat_10KB = measurePerformance('Concatenation 10KB', () => {
  const wavHeader = generateWavHeader(pcmData10KB.length, 24000, 1, 16);
  const wavFileData = new Uint8Array(wavHeader.length + pcmData10KB.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmData10KB, wavHeader.length);
});

const concat_100KB = measurePerformance('Concatenation 100KB', () => {
  const wavHeader = generateWavHeader(pcmData100KB.length, 24000, 1, 16);
  const wavFileData = new Uint8Array(wavHeader.length + pcmData100KB.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmData100KB, wavHeader.length);
});

const concat_1MB = measurePerformance('Concatenation 1MB', () => {
  const wavHeader = generateWavHeader(pcmData1MB.length, 24000, 1, 16);
  const wavFileData = new Uint8Array(wavHeader.length + pcmData1MB.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmData1MB, wavHeader.length);
});

console.log('\n4. End-to-End Performance:');

const e2e_100KB = measurePerformance('E2E Processing 100KB', () => {
  const pcmAudioData = decodeBase64Audio(testData100KB);
  const dataLength = pcmAudioData.length;
  const wavHeader = generateWavHeader(dataLength, 24000, 1, 16);
  
  const wavFileData = new Uint8Array(wavHeader.length + pcmAudioData.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmAudioData, wavHeader.length);
});

console.log('\n=== PERFORMANCE ANALYSIS ===');

console.log('\nTarget Analysis (for 100KB typical audio file):');
console.log(`Base64 Decode: ${base64_100KB.avg.toFixed(3)}ms (target: <20ms) - ${base64_100KB.avg < 20 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`WAV Header: ${wavHeader_100KB.avg.toFixed(3)}ms (target: <1ms) - ${wavHeader_100KB.avg < 1 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`Concatenation: ${concat_100KB.avg.toFixed(3)}ms (target: <10ms) - ${concat_100KB.avg < 10 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`End-to-End: ${e2e_100KB.avg.toFixed(3)}ms (target: <10ms) - ${e2e_100KB.avg < 10 ? '✓ PASS' : '✗ FAIL'}`);

console.log('\nBottleneck Identification:');
const totalTime = base64_100KB.avg + wavHeader_100KB.avg + concat_100KB.avg;
console.log(`Base64 Decode: ${((base64_100KB.avg / totalTime) * 100).toFixed(1)}% of total time`);
console.log(`WAV Header: ${((wavHeader_100KB.avg / totalTime) * 100).toFixed(1)}% of total time`);
console.log(`Concatenation: ${((concat_100KB.avg / totalTime) * 100).toFixed(1)}% of total time`);

if (base64_100KB.avg > 10) {
  console.log('\n⚠️  BOTTLENECK IDENTIFIED: Base64 decoding is the primary performance bottleneck');
}
if (concat_100KB.avg > 5) {
  console.log('\n⚠️  BOTTLENECK IDENTIFIED: Audio concatenation needs optimization');
}
if (e2e_100KB.avg > 10) {
  console.log('\n⚠️  PERFORMANCE TARGET MISSED: End-to-end processing exceeds 10ms target');
}

console.log('\n=== END BASELINE MEASUREMENTS ===');
