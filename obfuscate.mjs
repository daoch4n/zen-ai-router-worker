import { default as JsConfuser } from 'js-confuser';
import { readFileSync, writeFileSync } from 'fs';
import { stringLiteral } from '@babel/types';

const SALT_LENGTH = 2 + Math.floor(Math.random() * 4);

/**
 * Generates a random Cyrillic string of the specified length.
 * @param {number} length The length of the string to generate.
 * @returns {string} The generated random Cyrillic string.
 */
function generateRandomCyrillicString(length) {
  return Array.from({ length }, () =>
    String.fromCodePoint(Math.floor(Math.random() * 32) + 0x0430)
  ).join('');
}

/**
 * Shuffles an array in place using the Fisher-Yates algorithm.
 * @param {Array} array The array to shuffle.
 * @returns {Array} The shuffled array.
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Creates a custom string encoding object with encode and decode functions.
 * @returns {{code: JsConfuser.Template, encode: function, identity: string}} An object containing the encoding functions and identity.
 */
function createCustomStringEncoding() {
  /**
   * Generates a random charset of the specified length using printable ASCII characters.
   * @param {number} length The length of the charset to generate.
   * @returns {string} The generated random charset.
   */
  function generateRandomCharset(length = 32) {
    const charset = new Set();
    while (charset.size < length) {
      charset.add(String.fromCharCode((Math.random() * 94 + 33) | 0));
    }
    return Array.from(charset).join('');
  }

  /**
   * Adds random padding to a string to make its length a multiple of the block size.
   * @param {string} str The string to pad.
   * @returns {string} The padded string.
   */
  function addRandomPadding(str) {
    const blockSize = (Math.random() * 4 + 4) | 0;
    const padding = blockSize - (str.length % blockSize);
    return (
      str +
      Array(padding)
        .fill(0)
        .map(() => String.fromCharCode((Math.random() * 14 + 33) | 0))
        .join('') +
      padding
    );
  }

  /**
   * Removes random padding from a string.
   * @param {string} str The string to unpad.
   * @returns {string} The unpadded string.
   */
  function removeRandomPadding(str) {
    const len = str.length;
    const padding = +str[len - 1];
    return str.slice(0, len - padding - 1);
  }

  /**
   * Generates a random salt string of the specified length.
   * @returns {string} The generated salt string.
   */
  function generateSalt() {
    const salt = new Uint8Array(SALT_LENGTH);
    for (let i = 0; i < SALT_LENGTH; i++) {
      salt[i] = Math.floor(Math.random() * 256);
    }
    return String.fromCharCode(...salt.map((x) => (x % 62) + 48));
  }

  /**
   * Encodes the input string using the specified charset.
   * @param {string} input The string to encode.
   * @param {string} charset The charset to use for encoding.
   * @returns {string} The encoded string.
   */
  function encode(input, charset) {
    const data = new TextEncoder().encode(generateSalt() + input);
    let output = '';
    let buffer = 0;
    let bits = 0;

    for (let i = 0; i < data.length; i++) {
      buffer = (buffer << 8) | data[i];
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        output += charset[(buffer >> bits) & 31];
      }
    }

    if (bits > 0) {
      output += charset[(buffer << (5 - bits)) & 31];
    }

    return addRandomPadding(output);
  }

  /**
   * Decodes the input string using the specified charset.
   * @param {string} input The string to decode.
   * @param {string} charset The charset to use for decoding.
   * @returns {string} The decoded string.
   */
  function decode(input, charset) {
    const lookup = new Uint8Array(128);
    for (let i = 0; i < charset.length; i++) {
      lookup[charset.charCodeAt(i)] = i;
    }

    input = removeRandomPadding(input);
    const bytes = [];
    let buffer = 0;
    let bits = 0;

    for (let i = 0; i < input.length; i++) {
      buffer = (buffer << 5) | lookup[input.charCodeAt(i)];
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }

    return new TextDecoder().decode(new Uint8Array(bytes)).slice(SALT_LENGTH);
  }

  const charset = generateRandomCharset();
  const shuffledCharset = shuffle(charset.split('')).join('');
  const randomVariable = `_0x${Math.random().toString(36).slice(2)}`;
  const randomVariable2 = `_0x${Math.random().toString(36).slice(2)}`;

  return {
    code: new JsConfuser.Template(`
      const ${randomVariable} = new Uint8Array(128);
      ${shuffledCharset
        .split('')
        .map((c, i) => `${randomVariable}[${c.charCodeAt(0)}]=${i};`)
        .join('')}
      var {fnName} = function(i) {
        const d = (s) => s.slice(0, -s.slice(-1) - 1);
        let b = 0, n = 0, o = [];
        for(let c of d(i)) {
          b = (b << 5) | ${randomVariable}[c.charCodeAt(0)];
          n += 5;
          if(n >= 8) {
            n -= 8;
            o.push((b >> n) & 0xFF);
          }
        }
        return new TextDecoder().decode(new Uint8Array(o)).slice(${SALT_LENGTH});
      };
    `).setDefaultVariables({
      shuffledCharset: stringLiteral(shuffledCharset),
    }),
    encode: (input) => encode(input, shuffledCharset),
    decode: (input) => decode(input, shuffledCharset),
    identity: shuffledCharset,
  };
}

// DO NOT TOUCH CODE BELOW //

// Read input code
const sourceCode = readFileSync('output/worker.js', 'utf8');

// Use the new advanced configuration
const options = {
  target: 'node', // CF worker type
  calculator: true, // lightweight
  compact: true, // lightweight
  hexadecimalNumbers: true, // lightweight
  controlFlowFlattening: false, // too slow
  deadCode: false, // no need for CF worker
  dispatcher: false, // no need for CF worker
  duplicateLiteralsRemoval: true, // lightweight
  flatten: true, // dont use with lock
  globalConcealing: false, // SLOW
  identifierGenerator: function () {
    return generateRandomCyrillicString(2); // harden auto decode
  },
  minify: false, // fucks CSS, dont enable
  movedDeclarations: true, // lightweight
  objectExtraction: true, // lightweight
  opaquePredicates: true, // lightweight
  renameVariables: true, // must have to avoid sig detections
  renameGlobals: true, // must have to avoid sig detections
  shuffle: true, // lightweight
  variableMasking: true, // must process 100% to avoid sig detections
  stringConcealing: true, // must have to avoid sig detections
  customStringEncodings: [createCustomStringEncoding], // harden auto decode
  stringCompression: false, // no need for CF worker
  stringSplitting: true, // must process 100% to avoid sig detections
  astScrambler: true, // lightweight
  renameLabels: true, // must have to avoid sig detections
  rgf: false, // too slow x5
  preserveFunctionLength: false, // no need for CF worker
  //lock: // too slow for CF worker
};

console.log('Using salt length ' + SALT_LENGTH);
// Obfuscate the code
JsConfuser.obfuscate(sourceCode, options)
  .then((result) => {
    writeFileSync('output/_worker.js', result.code);
    console.log('Obfuscation completed successfully!');
  })
  .catch((err) => {
    console.error('Obfuscation failed:', err);
  });