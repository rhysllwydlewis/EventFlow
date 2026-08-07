/**
 * Regression test: reporting a messenger v4 chat message via the shared
 * POST /api/reports endpoint. Legacy chat messages live in the `messages`
 * collection keyed by a string `id`; messenger v4 messages live in a
 * separate `chat_messages_v4` collection keyed by a Mongo ObjectId `_id`.
 * Before this fix, `type: 'message'` reports always 404'd for v4 messages
 * because only the legacy collection was checked.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'user-1', email: 'reporter@example.com', role: 'customer' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {},
}));

const mockMessageV4Id = new ObjectId();

jest.mock('../../db-unified', () => ({
  findOne: jest.fn(async (collection, filter) => {
    if (collection === 'messages') {
      return null; // not present in the legacy collection
    }
    if (collection === 'chat_messages_v4' && String(filter._id) === String(mockMessageV4Id)) {
      return { _id: mockMessageV4Id, senderId: 'user-2', content: 'hello' };
    }
    return null;
  }),
  read: jest.fn(async () => []),
  insertOne: jest.fn(async () => true),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reports', require('../../routes/reports'));
  return app;
}

describe('POST /api/reports — messenger v4 message fallback', () => {
  it('finds a v4 chat message by ObjectId when the legacy lookup misses', async () => {
    const res = await request(createApp())
      .post('/api/reports')
      .send({ type: 'message', targetId: mockMessageV4Id.toString(), reason: 'harassment' });

    expect(res.status).toBe(201);
    expect(res.body.report.type).toBe('message');
  });

  it('still 404s for a message id that exists in neither collection', async () => {
    const res = await request(createApp())
      .post('/api/reports')
      .send({ type: 'message', targetId: new ObjectId().toString(), reason: 'harassment' });

    expect(res.status).toBe(404);
  });
});
