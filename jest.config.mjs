/**
 * Jest configuration for Cloudflare Worker testing
 * Configured for ES modules
 */
export default {
  // Use ES modules
  preset: null,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.mjs$': '$1'
  },

  // Test environment
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/test/**/*.test.mjs',
    '**/test/**/*.spec.mjs'
  ],

  // Module file extensions
  moduleFileExtensions: ['mjs', 'js', 'json'],

  // Transform configuration
transform: {
   '^.+\\.mjs$': 'babel-jest',
 },
 transformIgnorePatterns: [
   'node_modules/(?!(@whatwg-node/server)/)',
 ],

  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    'src/**/*.mjs',
    '!src/**/*.test.mjs',
    '!src/**/*.spec.mjs'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Test setup
  setupFilesAfterEnv: ['<rootDir>/test/setup.mjs'],

  // Verbose output
  verbose: false,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,

  // Test timeout
  testTimeout: 10000
};
