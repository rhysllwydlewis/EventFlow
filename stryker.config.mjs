// Mutation testing starts deliberately narrow so the signal is useful and the
// scheduled run remains affordable. The initial baseline covers provider lookup,
// timeout cleanup, distance calculation and postcode validation. Expand the ranges
// only after the additional function has dedicated behavioural contracts.
export default {
  mutate: ['utils/geocoding.js:19-76', 'utils/geocoding.js:138-175'],
  testRunner: 'command',
  commandRunner: {
    command:
      'npx jest --runInBand --coverage=false tests/unit/property-fuzz.test.js tests/unit/external-service-failure-contracts.test.js',
  },
  coverageAnalysis: 'off',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  thresholds: {
    high: 80,
    low: 60,
    break: 60,
  },
  concurrency: 2,
  timeoutMS: 20000,
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  htmlReporter: {
    fileName: 'reports/mutation/mutation.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
};
