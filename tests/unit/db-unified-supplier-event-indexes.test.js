'use strict';

/**
 * The `events` and `profile_view_caps` indexes and the atomic counter in db-unified, against a
 * recording stand-in for the MongoDB driver.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

function makeCollection(name, state) {
  const calls = [];
  const cursor = { toArray: async () => [], sort: () => ({ toArray: async () => [] }) };
  const overrides = {
    createIndex: jest.fn(async (keys, options) => {
      calls.push(['createIndex', keys, options]);
      if (state.failIndexOn === name) {
        throw new Error('IndexOptionsConflict');
      }
      return 'idx';
    }),
    findOneAndUpdate: jest.fn(async (...args) => {
      calls.push(['findOneAndUpdate', ...args]);
      const failure = state.counterFailures.shift();
      if (failure) {
        throw failure;
      }
      return state.counterResult;
    }),
  };
  return new Proxy(
    { calls },
    {
      get(target, prop) {
        if (prop in target) {
          return target[prop];
        }
        if (prop in overrides) {
          return overrides[prop];
        }
        if (prop === 'then') {
          return undefined;
        }
        return jest.fn(() => cursor);
      },
    }
  );
}

function load(state) {
  jest.resetModules();
  const collections = new Map();
  const fakeMongo = {
    collection: name => {
      if (!collections.has(name)) {
        collections.set(name, makeCollection(name, state));
      }
      return collections.get(name);
    },
  };
  jest.doMock('../../db', () => ({
    isMongoAvailable: jest.fn(() => true),
    connect: jest.fn(async () => fakeMongo),
  }));
  return { dbUnified: require('../../db-unified'), collections };
}

describe('supplier event indexes', () => {
  let state;
  beforeEach(() => {
    state = { failIndexOn: null, counterFailures: [], counterResult: { count: 1 } };
  });

  it('creates the event indexes and the cap-counter indexes (unique key, TTL on expiresAt)', async () => {
    const { dbUnified, collections } = load(state);
    await dbUnified.initializeDatabase();

    const events = collections.get('events').calls.filter(c => c[0] === 'createIndex');
    expect(events.map(c => c[1])).toEqual(
      expect.arrayContaining([
        { supplierId: 1, timestamp: -1 },
        { dedupeKey: 1 },
        { supplierId: 1, visitorKey: 1, timestamp: -1 },
      ])
    );
    // Nothing is indexed by an address-derived key any more.
    expect(JSON.stringify(events.map(c => c[1]))).not.toContain('ipKey');
    expect(collections.get('profile_view_caps').calls.map(c => c.slice(0, 3))).toEqual([
      ['createIndex', { key: 1 }, { unique: true }],
      ['createIndex', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ]);
  });

  it('a failing events index is logged as a warning and does not skip the later indexes', async () => {
    state.failIndexOn = 'events';
    const { dbUnified, collections } = load(state);
    await dbUnified.initializeDatabase();

    expect(require('../../utils/logger').warn).toHaveBeenCalledWith(
      expect.stringContaining('Supplier event indexes'),
      expect.any(String)
    );
    // The indexes that come after the events block, including the scheduler lock ones.
    const locks = collections.get('scheduler_locks').calls.filter(c => c[0] === 'createIndex');
    expect(locks).toHaveLength(2);
  });
});

describe('incrementCounter', () => {
  let state;
  beforeEach(() => {
    state = { failIndexOn: null, counterFailures: [], counterResult: { count: 3 } };
  });

  it('increments and upserts in one operation, setting expiresAt only on insert', async () => {
    const { dbUnified, collections } = load(state);
    await dbUnified.initializeDatabase();
    const expiresAt = new Date(Date.now() + 1000);

    const total = await dbUnified.incrementCounter('profile_view_caps', 'k1', { expiresAt });

    expect(total).toBe(3);
    const call = collections.get('profile_view_caps').calls.find(c => c[0] === 'findOneAndUpdate');
    expect(call.slice(1)).toEqual([
      { key: 'k1' },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after' },
    ]);
  });

  it('accepts the older { value } result shape and a negative step', async () => {
    state.counterResult = { value: { count: 0 } };
    const { dbUnified, collections } = load(state);
    await dbUnified.initializeDatabase();

    expect(await dbUnified.incrementCounter('profile_view_caps', 'k1', { by: -1 })).toBe(0);
    const call = collections.get('profile_view_caps').calls.find(c => c[0] === 'findOneAndUpdate');
    expect(call[2]).toEqual({ $inc: { count: -1 } });
  });

  it('repeats once when two requests race to create the row (duplicate key)', async () => {
    state.counterFailures.push(Object.assign(new Error('E11000'), { code: 11000 }));
    const { dbUnified, collections } = load(state);
    await dbUnified.initializeDatabase();

    expect(await dbUnified.incrementCounter('profile_view_caps', 'k1')).toBe(3);
    expect(
      collections.get('profile_view_caps').calls.filter(c => c[0] === 'findOneAndUpdate')
    ).toHaveLength(2);
  });

  it('returns null on a database error, or throws it with throwOnError', async () => {
    const { dbUnified } = load(state);
    await dbUnified.initializeDatabase();
    state.counterFailures.push(new Error('down'));
    expect(await dbUnified.incrementCounter('profile_view_caps', 'k1')).toBeNull();
    state.counterFailures.push(new Error('down'));
    await expect(
      dbUnified.incrementCounter('profile_view_caps', 'k1', { throwOnError: true })
    ).rejects.toThrow('down');
  });
});

describe('incrementCounter on local storage', () => {
  it('adds up, and starts again over a row whose expiry has passed', async () => {
    jest.resetModules();
    const storeData = {};
    jest.doMock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.doMock('../../store', () => ({
      uid: jest.fn(p => `${p}_1`),
      read: jest.fn(name => (storeData[name] ? [...storeData[name]] : [])),
      write: jest.fn((name, data) => {
        storeData[name] = [...data];
      }),
    }));
    const dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();

    expect(await dbUnified.incrementCounter('caps', 'a')).toBe(1);
    expect(await dbUnified.incrementCounter('caps', 'a')).toBe(2);
    expect(await dbUnified.incrementCounter('caps', 'a', { by: -1 })).toBe(1);
    storeData.caps = [{ key: 'a', count: 9, expiresAt: new Date(Date.now() - 1000) }];
    expect(await dbUnified.incrementCounter('caps', 'a')).toBe(1);
    expect(storeData.caps).toHaveLength(1);
  });
});
