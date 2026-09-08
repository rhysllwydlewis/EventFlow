/**
 * Unit tests for cache.js's Redis connection handling.
 *
 * initializeCache() used to set cacheType = 'redis' the instant an ioredis
 * client object was constructed, without waiting for a real connection —
 * ioredis connects lazily in the background with its own indefinite retry
 * strategy, so a genuinely unreachable Redis meant every get()/set() call
 * silently failed forever instead of falling back to the in-memory cache
 * the module is supposed to use when Redis isn't available.
 *
 * A first fix bounded the initial connection with a custom retryStrategy,
 * but that strategy also governs *reconnection* after a successful startup
 * — a review caught that a later, transient outage would then permanently
 * strand the cache on a dead 'redis' client instead of recovering the way
 * ioredis's default strategy would. The tests below cover the corrected
 * design: a timeout races only the initial connect() attempt, leaving
 * ioredis's own indefinite default strategy in force once connected, plus
 * concurrent initializeCache() calls sharing one in-flight attempt instead
 * of each racing to construct — and potentially leak — their own client.
 */

'use strict';

describe('cache.js Redis connection handling', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    jest.dontMock('ioredis');
    jest.resetModules();
    jest.useRealTimers();
    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
  });

  it('falls back to the in-memory cache when the Redis connection is refused', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';

    jest.doMock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1')),
        disconnect: jest.fn(),
      }))
    );

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
  });

  it('falls back to memory if the initial connection never settles within the timeout', async () => {
    jest.useFakeTimers();
    process.env.REDIS_URL = 'redis://127.0.0.1:1';

    jest.doMock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        // Never resolves or rejects — simulates ioredis retrying forever in
        // the background against an unreachable host.
        connect: jest.fn().mockImplementation(() => new Promise(() => {})),
        disconnect: jest.fn(),
      }))
    );

    let cache;
    jest.isolateModules(() => {
      cache = require('../../cache');
    });

    const initPromise = cache.initializeCache();
    await jest.advanceTimersByTimeAsync(5000);

    await expect(initPromise).resolves.toBe('memory');
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

  it('shares one in-flight connection attempt across concurrent initializeCache calls', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';

    let resolveConnect;
    const IORedisMock = jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      connect: jest.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolveConnect = resolve;
          })
      ),
      disconnect: jest.fn(),
    }));
    jest.doMock('ioredis', () => IORedisMock);

    let cache;
    jest.isolateModules(() => {
      cache = require('../../cache');
    });

    const first = cache.initializeCache();
    const second = cache.initializeCache();
    resolveConnect();
    const [firstType, secondType] = await Promise.all([first, second]);

    expect(firstType).toBe('redis');
    expect(secondType).toBe('redis');
    // Only one client should have been constructed for the two concurrent
    // calls, not one per call.
    expect(IORedisMock).toHaveBeenCalledTimes(1);
  });
});
