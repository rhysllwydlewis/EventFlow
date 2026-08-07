/**
 * Integration tests for the block/unblock/blocked routes added to
 * routes/messenger-v4.js. Mounts the real router via its initialize()
 * entrypoint against a minimal in-memory Mongo-compatible double so the
 * request/response wiring (auth, CSRF, status codes, JSON shape) is
 * exercised end-to-end rather than just the underlying service methods
 * (which are covered separately in tests/unit/messenger-v4.test.js).
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../services/queue', () => ({
  enqueueNotificationJob: jest.fn().mockResolvedValue(undefined),
  setQueueContext: jest.fn(),
}));

function createInMemoryDb() {
  const store = {};

  function getCol(name) {
    if (!store[name]) {
      store[name] = [];
    }
    return store[name];
  }

  function matchesQuery(doc, query) {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }
    return Object.entries(query).every(([key, value]) => {
      const docVal = doc[key];
      if (value && typeof value === 'object' && Array.isArray(value.$in)) {
        return value.$in.some(v => String(v) === String(docVal));
      }
      if (value instanceof ObjectId) {
        return String(docVal) === String(value);
      }
      return docVal === value;
    });
  }

  function makeCollection(name) {
    return {
      async insertOne(doc) {
        const newDoc = { _id: doc._id || new ObjectId(), ...doc };
        getCol(name).push(newDoc);
        return { insertedId: newDoc._id, acknowledged: true };
      },
      async insertMany(docs) {
        docs.forEach(doc => getCol(name).push({ _id: doc._id || new ObjectId(), ...doc }));
        return { acknowledged: true };
      },
      async findOne(query) {
        return getCol(name).find(doc => matchesQuery(doc, query)) || null;
      },
      find(query) {
        const items = getCol(name).filter(doc => matchesQuery(doc, query));
        const cursor = {
          sort: () => cursor,
          skip: () => cursor,
          limit: () => cursor,
          async toArray() {
            return items;
          },
        };
        return cursor;
      },
      async deleteOne(filter) {
        const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
        if (idx === -1) {
          return { deletedCount: 0 };
        }
        getCol(name).splice(idx, 1);
        return { deletedCount: 1 };
      },
      async createIndex() {
        return 'ok';
      },
    };
  }

  return { collection: makeCollection };
}

function buildApp(db, currentUserId) {
  const messengerV4 = require('../../routes/messenger-v4');
  const router = messengerV4.initialize({
    authRequired: (req, _res, next) => {
      req.user = { id: currentUserId, email: 'me@example.com', role: 'customer' };
      next();
    },
    csrfProtection: (_req, _res, next) => next(),
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v4/messenger', router);
  return app;
}

describe('Messenger v4 block routes', () => {
  let db;
  let app;

  beforeEach(async () => {
    jest.resetModules();
    db = createInMemoryDb();
    await db.collection('users').insertMany([
      { _id: 'user1', id: 'user1', displayName: 'Alice', name: 'Alice' },
      { _id: 'user2', id: 'user2', displayName: 'Bob', name: 'Bob' },
    ]);
    app = buildApp(db, 'user1');
  });

  it('GET /blocked starts empty', async () => {
    const res = await request(app).get('/api/v4/messenger/blocked');
    expect(res.status).toBe(200);
    expect(res.body.blocked).toEqual([]);
  });

  it('POST /block creates a block and it shows up in GET /blocked', async () => {
    const blockRes = await request(app)
      .post('/api/v4/messenger/block')
      .send({ userId: 'user2', reason: 'spam' });
    expect(blockRes.status).toBe(200);
    expect(blockRes.body.block).toMatchObject({ userId: 'user2', reason: 'spam' });

    const listRes = await request(app).get('/api/v4/messenger/blocked');
    expect(listRes.body.blocked).toHaveLength(1);
    expect(listRes.body.blocked[0]).toMatchObject({ userId: 'user2', displayName: 'Bob' });
  });

  it('POST /block rejects blocking yourself', async () => {
    const res = await request(app).post('/api/v4/messenger/block').send({ userId: 'user1' });
    expect(res.status).toBe(400);
  });

  it('POST /block requires a userId', async () => {
    const res = await request(app).post('/api/v4/messenger/block').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /block/:userId removes a block', async () => {
    await request(app).post('/api/v4/messenger/block').send({ userId: 'user2' });

    const delRes = await request(app).delete('/api/v4/messenger/block/user2');
    expect(delRes.status).toBe(200);
    expect(delRes.body.removed).toBe(true);

    const listRes = await request(app).get('/api/v4/messenger/blocked');
    expect(listRes.body.blocked).toEqual([]);
  });
});

describe('Messenger v4 block routes — error handling', () => {
  function buildBrokenApp(currentUserId) {
    const brokenCollection = {
      findOne: () => Promise.reject(new Error('db unavailable')),
      find: () => ({
        sort: () => ({
          toArray: () => Promise.reject(new Error('db unavailable')),
        }),
      }),
      insertOne: () => Promise.reject(new Error('db unavailable')),
      deleteOne: () => Promise.reject(new Error('db unavailable')),
      createIndex: () => Promise.resolve('ok'),
    };
    const brokenDb = { collection: () => brokenCollection };
    return buildApp(brokenDb, currentUserId);
  }

  it('GET /blocked returns 500 rather than crashing when the database is unavailable', async () => {
    const app = buildBrokenApp('user1');
    const res = await request(app).get('/api/v4/messenger/blocked');
    expect(res.status).toBe(500);
  });

  it('POST /block returns 500 rather than crashing when the database is unavailable', async () => {
    const app = buildBrokenApp('user1');
    const res = await request(app).post('/api/v4/messenger/block').send({ userId: 'user2' });
    expect(res.status).toBe(500);
  });

  it('DELETE /block/:userId returns 500 rather than crashing when the database is unavailable', async () => {
    const app = buildBrokenApp('user1');
    const res = await request(app).delete('/api/v4/messenger/block/user2');
    expect(res.status).toBe(500);
  });
});
