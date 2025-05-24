/**
 * Jest test setup file
 * Global test configuration and mocks
 */
import { jest } from '@jest/globals';

// Global test environment setup
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock fetch globally for tests
global.fetch = jest.fn();

// Mock crypto for ID generation
global.crypto = {
  getRandomValues: jest.fn((arr) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }),
  randomUUID: jest.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9))
};

// Mock Buffer for Node.js compatibility
// Always override Buffer to ensure our mock is used
const mockBuffer = {
  from: jest.fn((data, encoding) => {
    // Simulate proper base64 encoding for ArrayBuffer
    if (data instanceof ArrayBuffer) {
      return {
        toString: jest.fn((enc) => {
          if (enc === 'base64') {
            return 'mocked-base64-data';
          }
          return 'mocked-base64-data';
        })
      };
    }
    // For other data types
    return {
      toString: jest.fn(() => 'mocked-base64-data')
    };
  })
};

global.Buffer = mockBuffer;

// Mock the node:buffer module
jest.unstable_mockModule('node:buffer', () => ({
  Buffer: mockBuffer
}));

// Test utilities
export const createMockRequest = (options = {}) => {
  const defaultOptions = {
    method: 'POST',
    url: 'https://test.example.com/v1/chat/completions',
    headers: {
      'Authorization': 'Bearer test-pass',
      'Content-Type': 'application/json'
    },
    cf: {
      colo: 'SFO'
    }
  };

  return {
    ...defaultOptions,
    ...options,
    json: jest.fn().mockResolvedValue(options.body || {}),
    headers: {
      get: jest.fn((key) => {
        // If options.headers is explicitly provided, use only those headers
        // Otherwise, merge with defaults
        const headers = options.headers !== undefined
          ? options.headers
          : defaultOptions.headers;
        // Return null if header doesn't exist (like real Headers.get())
        return headers[key] ?? null;
      })
    }
  };
};

export const createMockEnv = (overrides = {}) => ({
  PASS: 'test-pass',
  KEY1: 'test-key-1',
  KEY2: 'test-key-2',
  KEY3: 'test-key-3',
  KEY4: 'test-key-4',
  DEFAULT_MODEL: 'gemini-2.0-flash',
  MOCK_DB: {
    prepare: jest.fn().mockReturnValue({
      run: jest.fn().mockResolvedValue({}),
      first: jest.fn().mockResolvedValue({ count: 0 })
    })
  },
  ...overrides
});

export const createMockResponse = (data, options = {}) => {
  const defaultOptions = {
    status: 200,
    statusText: 'OK',
    ok: true,
    headers: new Map([
      ['content-type', 'application/json']
    ])
  };

  return {
    ...defaultOptions,
    ...options,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0))
  };
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  fetch.mockClear();
});
