'use strict';

const { _private } = require('../../middleware/rateLimits');

describe('backend E2E rate-limit isolation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalE2EMode = process.env.E2E_MODE;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalE2EMode === undefined) delete process.env.E2E_MODE;
    else process.env.E2E_MODE = originalE2EMode;
  });

  test('isolates the explicit full backend browser server', () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_MODE = 'full';
    expect(_private.isBackendE2ERequest()).toBe(true);
  });

  test('does not weaken ordinary tests, development or production', () => {
    for (const [nodeEnv, e2eMode] of [
      ['test', 'static'],
      ['development', 'full'],
      ['production', 'full'],
    ]) {
      process.env.NODE_ENV = nodeEnv;
      process.env.E2E_MODE = e2eMode;
      expect(_private.isBackendE2ERequest()).toBe(false);
    }
  });
});
