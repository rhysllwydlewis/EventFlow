// Mutation testing starts deliberately narrow so the signal is useful and the
// scheduled run remains affordable. Expand `mutate` only after surviving mutants
// in this baseline have been reviewed and killed with meaningful assertions.
export default {
  mutate: ['utils/geocoding.js'],
  testRunner: 'command',
  commandRunner: {
    command: 'npx jest --runInBand --coverage=false tests/unit/property-fuzz.test.js',
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
