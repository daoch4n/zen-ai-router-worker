/**
 * Performance comparison of different optimization approaches
 * Tests alternative implementations to see if any improvements are possible
 */
import { decodeBase64Audio, generateWavHeader } from '../../src/utils/audio.mjs';

/**
 * Generate test base64 data
 */
function generateTestBase64(sizeKB) {
  const bytes = new Uint8Array(sizeKB * 1024);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  
  let binaryString = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binaryString += String.fromCharCode(...chunk);
  }
  
  return btoa(binaryString);
}

/**
 * Alternative base64 decoding implementation using TextDecoder
 */
function decodeBase64AudioAlt1(base64String) {
  if (!base64String) return new Uint8Array(0);
  
  try {
    const binaryString = atob(base64String);
    // Alternative: Use Uint8Array.from with map
    return Uint8Array.from(binaryString, char => char.charCodeAt(0));
  } catch (error) {
    throw new Error(`Failed to decode base64 audio: ${error.message}`);
  }
}

/**
 * Alternative base64 decoding with pre-allocated buffer
 */
function decodeBase64AudioAlt2(base64String) {
  if (!base64String) return new Uint8Array(0);
  
  try {
    const binaryString = atob(base64String);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    
    // Unrolled loop for potential performance gain
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
 * Measure and compare performance
 */
function comparePerformance(label, implementations, testData, iterations = 10) {
  console.log(`\n=== ${label} ===`);
  
  const results = {};
  
  implementations.forEach(({ name, fn }) => {
    const times = [];
    
    // Warm up
    fn(testData);
    
    // Measure
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      fn(testData);
      const end = performance.now();
      times.push(end - start);
    }
    
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    
    results[name] = { avg, min, times };
    console.log(`${name}: ${avg.toFixed(3)}ms avg, ${min.toFixed(3)}ms min`);
  });
  
  // Find the fastest
  const fastest = Object.entries(results).reduce((a, b) => 
    a[1].avg < b[1].avg ? a : b
  );
  
  console.log(`🏆 Fastest: ${fastest[0]} (${fastest[1].avg.toFixed(3)}ms)`);
  
  return results;
}

console.log('=== OPTIMIZATION COMPARISON TESTS ===');

// Test data
const testData100KB = generateTestBase64(100);

// Compare base64 decoding implementations
const base64Implementations = [
  { name: 'Current Implementation', fn: decodeBase64Audio },
  { name: 'Uint8Array.from', fn: decodeBase64AudioAlt1 },
  { name: 'Unrolled Loop', fn: decodeBase64AudioAlt2 }
];

const base64Results = comparePerformance(
  'Base64 Decoding (100KB)',
  base64Implementations,
  testData100KB
);

// Test concatenation alternatives
function concatenateAlt1(header, pcmData) {
  // Current implementation
  const wavFileData = new Uint8Array(header.length + pcmData.length);
  wavFileData.set(header, 0);
  wavFileData.set(pcmData, header.length);
  return wavFileData;
}

function concatenateAlt2(header, pcmData) {
  // Alternative: Manual copy
  const totalLength = header.length + pcmData.length;
  const wavFileData = new Uint8Array(totalLength);
  
  for (let i = 0; i < header.length; i++) {
    wavFileData[i] = header[i];
  }
  
  for (let i = 0; i < pcmData.length; i++) {
    wavFileData[header.length + i] = pcmData[i];
  }
  
  return wavFileData;
}

// Prepare test data for concatenation
const pcmData = decodeBase64Audio(testData100KB);
const header = generateWavHeader(pcmData.length, 24000, 1, 16);

const concatImplementations = [
  { name: 'Current (set method)', fn: () => concatenateAlt1(header, pcmData) },
  { name: 'Manual copy', fn: () => concatenateAlt2(header, pcmData) }
];

const concatResults = comparePerformance(
  'Audio Concatenation (100KB)',
  concatImplementations,
  null
);

// Overall performance test
console.log('\n=== OVERALL PERFORMANCE COMPARISON ===');

function currentPipeline(base64Data) {
  const pcmAudioData = decodeBase64Audio(base64Data);
  const dataLength = pcmAudioData.length;
  const wavHeader = generateWavHeader(dataLength, 24000, 1, 16);
  
  const wavFileData = new Uint8Array(wavHeader.length + pcmAudioData.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmAudioData, wavHeader.length);
  
  return wavFileData;
}

function optimizedPipeline(base64Data) {
  // Use the fastest implementations found
  const pcmAudioData = decodeBase64AudioAlt1(base64Data); // or whichever was fastest
  const dataLength = pcmAudioData.length;
  const wavHeader = generateWavHeader(dataLength, 24000, 1, 16);
  
  const wavFileData = new Uint8Array(wavHeader.length + pcmAudioData.length);
  wavFileData.set(wavHeader, 0);
  wavFileData.set(pcmAudioData, wavHeader.length);
  
  return wavFileData;
}

const pipelineImplementations = [
  { name: 'Current Pipeline', fn: currentPipeline },
  { name: 'Optimized Pipeline', fn: optimizedPipeline }
];

const pipelineResults = comparePerformance(
  'Complete Pipeline (100KB)',
  pipelineImplementations,
  testData100KB
);

console.log('\n=== OPTIMIZATION RECOMMENDATIONS ===');

// Analyze results and provide recommendations
const currentBase64Time = base64Results['Current Implementation'].avg;
const fastestBase64Time = Math.min(...Object.values(base64Results).map(r => r.avg));
const base64Improvement = ((currentBase64Time - fastestBase64Time) / currentBase64Time * 100);

if (base64Improvement > 5) {
  console.log(`✅ Base64 decoding can be improved by ${base64Improvement.toFixed(1)}%`);
} else {
  console.log(`✅ Base64 decoding is already well optimized (potential improvement: ${base64Improvement.toFixed(1)}%)`);
}

const currentConcatTime = concatResults['Current (set method)'].avg;
const fastestConcatTime = Math.min(...Object.values(concatResults).map(r => r.avg));
const concatImprovement = ((currentConcatTime - fastestConcatTime) / currentConcatTime * 100);

if (concatImprovement > 5) {
  console.log(`✅ Concatenation can be improved by ${concatImprovement.toFixed(1)}%`);
} else {
  console.log(`✅ Concatenation is already well optimized (potential improvement: ${concatImprovement.toFixed(1)}%)`);
}

const currentPipelineTime = pipelineResults['Current Pipeline'].avg;
const optimizedPipelineTime = pipelineResults['Optimized Pipeline'].avg;
const overallImprovement = ((currentPipelineTime - optimizedPipelineTime) / currentPipelineTime * 100);

console.log(`\nOverall pipeline improvement potential: ${overallImprovement.toFixed(1)}%`);
console.log(`Current: ${currentPipelineTime.toFixed(3)}ms → Optimized: ${optimizedPipelineTime.toFixed(3)}ms`);

if (Math.abs(overallImprovement) < 5) {
  console.log('\n🎉 CONCLUSION: Current implementation is already highly optimized!');
  console.log('   No significant performance improvements are needed.');
} else if (overallImprovement > 0) {
  console.log('\n📈 CONCLUSION: Minor optimizations possible');
} else {
  console.log('\n✅ CONCLUSION: Current implementation is optimal');
}

console.log('\n=== END OPTIMIZATION COMPARISON ===');
