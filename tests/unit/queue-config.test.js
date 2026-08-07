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

  it('reports production as not ready when REDIS_URL is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    const queue = require('../../services/queue');
    await expect(queue.getQueueHealth({ force: true })).resolves.toMatchObject({
      ready: false,
      producer: 'missing_configuration',
      worker: 'unavailable',
      reason: 'missing_redis_configuration',
    });
  });

  it('classifies current, stale and missing worker heartbeats', () => {
    process.env.NODE_ENV = 'test';
    const queue = require('../../services/queue');
    const now = 100_000;

    expect(queue.evaluateWorkerHeartbeat(String(now - 1_000), now)).toMatchObject({
      status: 'healthy',
      healthy: true,
      ageMs: 1_000,
    });
    expect(queue.evaluateWorkerHeartbeat(String(now - 31_000), now)).toMatchObject({
      status: 'stale',
      healthy: false,
    });
    expect(queue.evaluateWorkerHeartbeat(null, now)).toEqual({
      status: 'missing',
      ageMs: null,
      healthy: false,
    });
  });
});
