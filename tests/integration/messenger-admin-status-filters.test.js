'use strict';

/**
 * The admin Messenger page offers Active / Closed / Archived / Deleted. A conversation itself is
 * only ever active or closed; archived and deleted are what each person did with their own copy,
 * so the server must look for them on the participants (it used to ignore both words and return
 * everything).
 */

const express = require('express');
const request = require('supertest');
const { createInMemoryDb } = require('../helpers/in-memory-mongo-double');

jest.mock('../../services/queue', () => ({
  enqueueNotificationJob: jest.fn().mockResolvedValue(undefined),
  setQueueContext: jest.fn(),
}));

function buildApp(db) {
  const messengerV4 = require('../../routes/messenger-v4');
  const router = messengerV4.initialize({
    authRequired: (req, _res, next) => {
      req.user = { id: 'admin1', email: 'admin@example.com', role: 'admin' };
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

const person = (userId, extra = {}) => ({ userId, displayName: userId, ...extra });

describe('GET /api/v4/messenger/admin/conversations status filter', () => {
  let app;

  beforeEach(async () => {
    jest.resetModules();
    const db = createInMemoryDb();
    await db.collection('conversations_v4').insertMany([
      {
        _id: 'c-active',
        status: 'active',
        messageCount: 3,
        participants: [person('a'), person('b')],
        updatedAt: new Date('2026-01-04'),
      },
      {
        _id: 'c-closed',
        status: 'closed',
        messageCount: 2,
        participants: [person('a'), person('b')],
        updatedAt: new Date('2026-01-03'),
      },
      {
        _id: 'c-archived',
        status: 'active',
        messageCount: 2,
        participants: [person('a', { isArchived: true }), person('b')],
        updatedAt: new Date('2026-01-02'),
      },
      {
        _id: 'c-deleted',
        status: 'active',
        messageCount: 2,
        participants: [person('a'), person('b', { isDeleted: true })],
        updatedAt: new Date('2026-01-01'),
      },
    ]);
    app = buildApp(db);
  });

  const list = async status => {
    const res = await request(app)
      .get('/api/v4/messenger/admin/conversations')
      .query(status ? { status } : {});
    expect(res.status).toBe(200);
    return res.body.conversations.map(item => String(item._id)).sort();
  };

  it('shows everything when no status is chosen, each labelled with what it is', async () => {
    const res = await request(app).get('/api/v4/messenger/admin/conversations');
    const labels = Object.fromEntries(
      res.body.conversations.map(item => [String(item._id), item.displayStatus])
    );
    expect(labels).toEqual({
      'c-active': 'active',
      'c-closed': 'closed',
      'c-archived': 'archived',
      'c-deleted': 'deleted',
    });
  });

  it('Archived finds only conversations someone archived', async () => {
    expect(await list('archived')).toEqual(['c-archived']);
  });

  it('Deleted finds only conversations someone deleted', async () => {
    expect(await list('deleted')).toEqual(['c-deleted']);
  });

  it('Closed and Active still filter on the conversation status', async () => {
    expect(await list('closed')).toEqual(['c-closed']);
    expect(await list('active')).toEqual(['c-active', 'c-archived', 'c-deleted']);
  });
});
