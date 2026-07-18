'use strict';

const base = require('./jest.config');

module.exports = {
  ...base,
  collectCoverage: false,
  forceExit: false,
  maxWorkers: 1,
  testTimeout: 20000,
  verbose: false,
};
