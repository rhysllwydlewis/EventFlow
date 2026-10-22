'use strict';

/**
 * The supplier enquiry indexes and atomic upsert in db-unified, run against a recording stand-in for
 * the MongoDB driver (the real-database versions are in supplier-enquiries-real-mongo.test.js, which
 * needs a replica set). This checks which indexes are asked for, that duplicate status documents are
 * removed before a unique index is created, that one failing index does not stop the rest, and how
 * a lost upsert race is handled.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

/** A collection that records every call and answers the few that return data. */
function makeCollection(name, state) {
  const calls = [];
  const overrides = {
    aggregate: jest.fn(() => ({ toArray: async () => state.duplicateGroups[name] || [] })),
    find: jest.fn(query => ({
      sort: () => ({ toArray: async () => state.documents[`${name}:${query.id}`] || [] }),
      toArray: async () => [],
      limit: () => ({ toArray: async () => [] }),
    })),
    createIndex: jest.fn(async (keys, options) => {
      calls.push(['createIndex', keys, options]);
      if (state.failIndexOn === name) {
        throw new Error('E11000 duplicate key');
      }
      return 'idx';
    }),
    deleteMany: jest.fn(async filter => {
      calls.push(['deleteMany', filter]);
      return { deletedCount: filter._id.$in.length };
    }),
    updateOne: jest.fn(async (...args) => {
      calls.push(['updateOne', ...args]);
      const failure = state.updateFailures.shift();
      if (failure) {
        throw failure;
      }
      return { modifiedCount: 1 };
    }),
  };
  const collection = new Proxy(
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
        return jest.fn(async () => undefined);
      },
    }
  );
  return collection;
}

function loadWithFakeMongo(state) {
  jest.resetModules();
  const collections = new Map();
  const fakeDb = {
    collection: name => {
      if (!collections.has(name)) {
        collections.set(name, makeCollection(name, state));
      }
      return collections.get(name);
    },
  };
  jest.doMock('../../db', () => ({
    isMongoAvailable: jest.fn(() => true),
    connect: jest.fn(async () => fakeDb),
  }));
  const dbUnified = require('../../db-unified');
  return { dbUnified, collections };
}

describe('db-unified supplier enquiry indexes (MongoDB driver stand-in)', () => {
  let state;
  beforeEach(() => {
    state = { duplicateGroups: {}, documents: {}, failIndexOn: null, updateFailures: [] };
  });

  it('asks for the indexes the enquiry queries use', async () => {
    const { dbUnified, collections } = loadWithFakeMongo(state);
    await dbUnified.initializeDatabase();

    const indexes = name => collections.get(name).calls.filter(c => c[0] === 'createIndex');
    expect(indexes('quoteRequests').map(c => c[1])).toContainEqual({
      'suppliers.supplierId': 1,
      createdAt: -1,
    });
    expect(indexes('enquiries').map(c => c[1])).toContainEqual({ supplierId: 1, createdAt: -1 });
    expect(indexes('reviewRequests').map(c => c[1])).toContainEqual({
      supplierId: 1,
      createdAt: -1,
    });
    expect(indexes('supplier_enquiry_states')).toEqual(
      expect.arrayContaining([
        ['createIndex', { id: 1 }, { unique: true }],
        ['createIndex', { supplierId: 1 }, undefined],
      ])
    );
    expect(indexes('supplier_enquiry_replies').map(c => c[1])).toEqual([
      { id: 1 },
      { supplierId: 1, sentAt: -1 },
      { supplierId: 1, enquiryId: 1 },
    ]);
    expect(indexes('supplier_enquiry_replies')[0][2]).toEqual({ unique: true });
  });

  it('removes older duplicate status documents before the unique index is created', async () => {
    state.duplicateGroups.supplier_enquiry_states = [{ _id: 's1:qr_1', n: 3 }];
    state.documents['supplier_enquiry_states:s1:qr_1'] = [
      { _id: 'newest', id: 's1:qr_1' },
      { _id: 'older', id: 's1:qr_1' },
      { _id: 'oldest', id: 's1:qr_1' },
    ];
    const { dbUnified, collections } = loadWithFakeMongo(state);
    await dbUnified.initializeDatabase();

    const calls = collections.get('supplier_enquiry_states').calls;
    expect(calls.find(c => c[0] === 'deleteMany')[1]).toEqual({
      _id: { $in: ['older', 'oldest'] },
    });
    const deleteAt = calls.findIndex(c => c[0] === 'deleteMany');
    const uniqueAt = calls.findIndex(c => c[0] === 'createIndex' && c[2]?.unique);
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeLessThan(uniqueAt);
  });

  it('leaves a document alone when it has no duplicate', async () => {
    state.duplicateGroups.supplier_enquiry_states = [{ _id: 's1:qr_2', n: 2 }];
    state.documents['supplier_enquiry_states:s1:qr_2'] = [{ _id: 'only', id: 's1:qr_2' }];
    const { dbUnified, collections } = loadWithFakeMongo(state);
    await dbUnified.initializeDatabase();
    expect(collections.get('supplier_enquiry_states').calls.some(c => c[0] === 'deleteMany')).toBe(
      false
    );
  });

  it('carries on when an index cannot be created', async () => {
    state.failIndexOn = 'supplier_enquiry_states';
    const { dbUnified } = loadWithFakeMongo(state);
    await expect(dbUnified.initializeDatabase()).resolves.toBeDefined();
    expect(dbUnified.getDatabaseType()).toBe('mongodb');
  });

  it('upserts in one step and sets creation-only fields only on insert', async () => {
    const { dbUnified, collections } = loadWithFakeMongo(state);
    await dbUnified.initializeDatabase();

    const saved = await dbUnified.upsertOne(
      'supplier_enquiry_states',
      { id: 's1:qr_1' },
      { status: 'read' },
      { createdAt: 'then' }
    );
    expect(saved).toBe(true);
    const call = collections
      .get('supplier_enquiry_states')
      .calls.filter(c => c[0] === 'updateOne')
      .pop();
    expect(call.slice(1)).toEqual([
      { id: 's1:qr_1' },
      { $set: { status: 'read' }, $setOnInsert: { createdAt: 'then' } },
      { upsert: true },
    ]);

    await dbUnified.upsertOne('supplier_enquiry_states', { id: 's1:qr_9' }, { status: 'new' });
    const plain = collections
      .get('supplier_enquiry_states')
      .calls.filter(c => c[0] === 'updateOne')
      .pop();
    expect(plain[2]).toEqual({ $set: { status: 'new' } });
  });

  it('turns a lost creation race (duplicate key) into a plain update', async () => {
    const { dbUnified, collections } = loadWithFakeMongo(state);
    await dbUnified.initializeDatabase();
    state.updateFailures.push(Object.assign(new Error('E11000'), { code: 11000 }));

    const saved = await dbUnified.upsertOne(
      'supplier_enquiry_states',
      { id: 's1:qr_1' },
      { status: 'handled' },
      { createdAt: 'then' }
    );
    expect(saved).toBe(true);
    const updates = collections
      .get('supplier_enquiry_states')
      .calls.filter(c => c[0] === 'updateOne');
    expect(updates).toHaveLength(2);
    expect(updates[1].slice(1)).toEqual([{ id: 's1:qr_1' }, { $set: { status: 'handled' } }]);
  });

  it('reports false for any other database error', async () => {
    const { dbUnified } = loadWithFakeMongo(state);
    await dbUnified.initializeDatabase();
    state.updateFailures.push(new Error('network down'));
    expect(await dbUnified.upsertOne('supplier_enquiry_states', { id: 'x' }, { a: 1 })).toBe(false);
  });
});

describe('db-unified upsertOne on local storage', () => {
  let dbUnified;
  let storeData;

  beforeEach(() => {
    jest.resetModules();
    storeData = {};
    jest.doMock('../../db', () => ({ isMongoAvailable: jest.fn(() => false), connect: jest.fn() }));
    jest.doMock('../../store', () => ({
      uid: jest.fn(p => `${p}_1`),
      read: jest.fn(name => (storeData[name] ? [...storeData[name]] : [])),
      write: jest.fn((name, data) => {
        storeData[name] = [...data];
      }),
    }));
    dbUnified = require('../../db-unified');
  });

  it('creates the document with the filter, fields and creation-only fields', async () => {
    await dbUnified.initializeDatabase();
    expect(
      await dbUnified.upsertOne('states', { id: 'a' }, { status: 'new' }, { createdAt: 't' })
    ).toBe(true);
    expect(storeData.states).toEqual([{ id: 'a', createdAt: 't', status: 'new' }]);
  });

  it('updates the one document that exists and leaves createdAt as it was', async () => {
    await dbUnified.initializeDatabase();
    storeData.states = [{ id: 'a', createdAt: 'first', status: 'new' }];
    await dbUnified.upsertOne('states', { id: 'a' }, { status: 'read' }, { createdAt: 'second' });
    expect(storeData.states).toEqual([{ id: 'a', createdAt: 'first', status: 'read' }]);
  });
});
