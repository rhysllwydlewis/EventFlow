/**
 * Unit tests for cache.js's Redis connection fallback.
 *
 * initializeCache() used to set cacheType = 'redis' the instant an ioredis
 * client object was constructed, without waiting for a real connection —
 * ioredis connects lazily in the background with its own indefinite retry
 * strategy, so a genuinely unreachable Redis meant every get()/set() call
 * silently failed forever instead of falling back to the in-memory cache
 * the module is supposed to use when Redis isn't available.
 */

'use strict';

describe('cache.js Redis connection fallback', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    jest.dontMock('ioredis');
    jest.resetModules();
    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
  });

  it('falls back to the in-memory cache when the Redis connection is refused', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';

    let capturedOptions;
    const IORedisMock = jest.fn().mockImplementation((_url, options) => {
      capturedOptions = options;
      return {
        on: jest.fn(),
        connect: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1')),
        disconnect: jest.fn(),
      };
    });
    jest.doMock('ioredis', () => IORedisMock);

    let cache;
    jest.isolateModules(() => {
      cache = require('../../cache');
    });

    const type = await cache.initializeCache();
    expect(type).toBe('memory');
    expect(cache.getStats().type).toBe('memory');

    // The in-memory fallback must actually work, not just be selected.
    expect(await cache.set('greeting', 'hello')).toBe(true);
    expect(await cache.get('greeting')).toBe('hello');

    // The bounded retry strategy passed to ioredis must actually give up
    // after a few attempts, rather than retrying forever in the background.
    expect(capturedOptions.retryStrategy(1)).toBeGreaterThan(0);
    expect(capturedOptions.retryStrategy(10)).toBeNull();
  });

  it('still falls back to memory when disconnecting the dead client itself throws', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';

    jest.doMock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1')),
        disconnect: jest.fn(() => {
          throw new Error('already closed');
        }),
      }))
    );

    let cache;
    jest.isolateModules(() => {
      cache = require('../../cache');
    });

    await expect(cache.initializeCache()).resolves.toBe('memory');
    expect(await cache.set('greeting', 'hello')).toBe(true);
    expect(await cache.get('greeting')).toBe('hello');
  });

  it('uses Redis once the connection succeeds', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';

    const store = new Map();
    jest.doMock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        get: jest.fn(async key => store.get(key) ?? null),
        setex: jest.fn(async (key, _ttl, value) => {
          store.set(key, value);
        }),
        disconnect: jest.fn(),
      }))
    );

    let cache;
    jest.isolateModules(() => {
      cache = require('../../cache');
    });

    const type = await cache.initializeCache();
    expect(type).toBe('redis');
    expect(cache.getStats().type).toBe('redis');

    expect(await cache.set('greeting', 'hello')).toBe(true);
    expect(await cache.get('greeting')).toBe('hello');
  });
});
