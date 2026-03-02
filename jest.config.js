module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Parallel test execution
  maxWorkers: '50%',

  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  collectCoverageFrom: [
    'routes/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js',
    '*.js',
    '!node_modules/**',
    '!coverage/**',
    '!tests/**',
    '!jest.config.js',
    '!playwright.config.js',
    '!data/**',
    '!uploads/**',
    '!outbox/**',
    '!public/**',
    '!scripts/**',
    '!functions/**',
    '!e2e/**',
  ],

  // Test patterns
  testMatch: ['**/tests/**/*.test.js', '**/tests/**/*.spec.js'],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/data/', '/uploads/'],

  // Coverage thresholds — set to match current actual coverage levels (Mar 2026).
  // Raise these incrementally as new unit tests are added.
  coverageThreshold: {
    global: {
      branches: 16,
      functions: 18,
      lines: 22,
      statements: 22,
    },
  },

  // Timeout for tests
  testTimeout: 10000,

  // Force Jest to exit after all tests complete; prevents hanging on open handles.
  // Known open-handle sources investigated (Mar 2026): db-unified JSON file-watcher timers,
  // and some third-party middleware keep event-loop entries alive after tests.
  // Run `npm run test:debug` (--detectOpenHandles) to identify remaining sources.
  // Remove this flag once all open handles are resolved.
  forceExit: true,

  // Verbose output
  verbose: true,
};
