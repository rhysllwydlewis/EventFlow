'use strict';

describe('queue production Redis config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws in production when REDIS_URL is missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    const queue = require('../../services/queue');
    expect(() => queue.getQueues()).toThrow(/REDIS_URL is required when NODE_ENV=production/i);
  });
});
