/**
 * Route-level tests for the messenger's real-time events and request validation. They drive the
 * real router (routes/messenger-v4.js) with an in-memory database and stand-in websocket servers,
 * so they fail if an event is not emitted, goes to the wrong user, or is sent through an API the
 * server does not have:
 *
 * - The default (v2) websocket server only has emitToUser/emitToConversation: a conversation
 *   creation used to call Socket.IO's `to()` on it directly and answer 500.
 * - A bare Socket.IO server (custom setups) has `to()` and nothing else: each user's room is
 *   `user:<id>`.
 * - Sending a message tells the conversation room and every other, non-deleted participant on their
 *   own user channel (the unread badge and the dashboard inbox hear about it there).
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { createInMemoryDb } = require('../helpers/in-memory-mongo-double');

jest.mock('../../services/queue', () => ({
  enqueueNotificationJob: jest.fn().mockResolvedValue(undefined),
  setQueueContext: jest.fn(),
}));
jest.mock('../../services/spamDetection', () => ({
  checkSpam: jest.fn().mockResolvedValue({ isSpam: false, score: 0, reason: null }),
  cleanupCache: jest.fn(),
}));
jest.mock('../../services/contentSanitizer', () => ({
  sanitizeContent: jest.fn(content => content),
}));

const BASE = '/api/v4/messenger';
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Stand-in for the app's own (v2) websocket server: no Socket.IO `to()`. */
function createAppWsServer() {
  return {
    emitToUser: jest.fn(),
    emitToConversation: jest.fn(),
  };
}

/** Stand-in for a bare Socket.IO server: `to(room).emit(...)` only. */
function createRawSocketServer() {
  const emitted = [];
  return {
    emitted,
    to: jest.fn(room => ({ emit: (event, data) => emitted.push({ room, event, data }) })),
  };
}

function buildApp(db, currentUser, wsServer) {
  const messengerV4 = require('../../routes/messenger-v4');
  const router = messengerV4.initialize({
    authRequired: (req, _res, next) => {
      req.user = { email: `${currentUser.id}@example.com`, role: 'customer', ...currentUser };
      next();
    },
    csrfProtection: (_req, _res, next) => next(),
    requireVerifiedUser: (_req, _res, next) => next(),
    db,
    logger: silentLogger,
    wsServer,
  });
  const app = express();
  app.use(express.json());
  app.use(BASE, router);
  return app;
}

async function seedUsers(db) {
  await db.collection('users').insertMany([
    { _id: 'u1', id: 'u1', displayName: 'Alice', role: 'customer' },
    { _id: 'u2', id: 'u2', displayName: 'Bob', role: 'customer' },
    { _id: 'u3', id: 'u3', displayName: 'Cleo', role: 'customer' },
    { _id: 's1', id: 's1', displayName: 'Sam Supplier', role: 'supplier' },
  ]);
}

async function seedConversation(db, participants) {
  const MessengerV4Service = require('../../services/messenger-v4.service');
  const service = new MessengerV4Service(db, silentLogger);
  return service.createConversation({
    type: participants.length > 2 ? 'marketplace' : 'direct',
    creatorUserId: participants[0].userId,
    participants: participants.map(p => ({ displayName: p.userId, role: 'customer', ...p })),
  });
}

describe('messenger-v4 real-time events (route level)', () => {
  let db;

  beforeEach(async () => {
    jest.resetModules();
    db = createInMemoryDb();
    await seedUsers(db);
  });

  describe('POST /conversations emits conversation-created to the creator only', () => {
    it("uses the app websocket server's emitToUser (no Socket.IO to())", async () => {
      const ws = createAppWsServer();
      const res = await request(buildApp(db, { id: 'u1' }, ws))
        .post(`${BASE}/conversations`)
        .send({ type: 'direct', participantIds: ['u2'] });

      expect(res.status).toBe(201);
      expect(ws.emitToUser).toHaveBeenCalledTimes(1);
      const [userId, event, data] = ws.emitToUser.mock.calls[0];
      expect(userId).toBe('u1');
      expect(event).toBe('messenger:v4:conversation-created');
      expect(String(data.conversation._id)).toBe(String(res.body.conversation._id));
      expect(ws.emitToConversation).not.toHaveBeenCalled();
    });

    it("falls back to the creator's `user:<id>` room on a bare Socket.IO server", async () => {
      const ws = createRawSocketServer();
      const res = await request(buildApp(db, { id: 'u1' }, ws))
        .post(`${BASE}/conversations`)
        .send({ type: 'direct', participantIds: ['u2'] });

      expect(res.status).toBe(201);
      expect(ws.emitted).toHaveLength(1);
      expect(ws.emitted[0].room).toBe('user:u1');
      expect(ws.emitted[0].event).toBe('messenger:v4:conversation-created');
    });

    it('still creates the conversation when no websocket server is running', async () => {
      const res = await request(buildApp(db, { id: 'u1' }, null))
        .post(`${BASE}/conversations`)
        .send({ type: 'direct', participantIds: ['u2'] });
      expect(res.status).toBe(201);
    });
  });

  describe('POST /conversations/:id/messages emits to the room and to each other participant', () => {
    async function sendAs(userId, ws, conversation, body) {
      return request(buildApp(db, { id: userId }, ws))
        .post(`${BASE}/conversations/${conversation._id.toString()}/messages`)
        .send(body);
    }

    it("emits the room event, then new-message on every other participant's user channel", async () => {
      const conversation = await seedConversation(db, [
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      const ws = createAppWsServer();
      const res = await sendAs('u1', ws, conversation, { content: 'hello all' });

      expect(res.status).toBe(201);
      expect(ws.emitToConversation).toHaveBeenCalledTimes(1);
      expect(ws.emitToConversation.mock.calls[0][1]).toBe('messenger:v4:message');

      const newMessageTargets = ws.emitToUser.mock.calls
        .filter(([, event]) => event === 'messenger:v4:new-message')
        .map(([userId]) => userId)
        .sort();
      expect(newMessageTargets).toEqual(['u2', 'u3']);
      const payload = ws.emitToUser.mock.calls.find(([, e]) => e === 'messenger:v4:new-message')[2];
      expect(payload.conversationId).toBe(conversation._id.toString());
      expect(payload.message.content).toBe('hello all');
    });

    it('skips a participant who deleted the conversation', async () => {
      const conversation = await seedConversation(db, [
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      const idx = conversation.participants.findIndex(p => p.userId === 'u3');
      await db
        .collection('conversations_v4')
        .updateOne(
          { _id: conversation._id },
          { $set: { [`participants.${idx}.isDeleted`]: true } }
        );
      const ws = createAppWsServer();
      const res = await sendAs('u1', ws, conversation, { content: 'only bob' });

      expect(res.status).toBe(201);
      const targets = ws.emitToUser.mock.calls
        .filter(([, event]) => event === 'messenger:v4:new-message')
        .map(([userId]) => userId);
      expect(targets).toEqual(['u2']);
    });

    it("reaches the recipient's `user:<id>` room on a bare Socket.IO server", async () => {
      const conversation = await seedConversation(db, [{ userId: 'u1' }, { userId: 'u2' }]);
      const ws = createRawSocketServer();
      const res = await sendAs('u1', ws, conversation, { content: 'raw server' });

      expect(res.status).toBe(201);
      const newMessage = ws.emitted.filter(e => e.event === 'messenger:v4:new-message');
      expect(newMessage.map(e => e.room)).toEqual(['user:u2']);
    });
  });

  describe('other events: payloads and who hears them', () => {
    async function twoWay(ws) {
      const conversation = await seedConversation(db, [{ userId: 'u1' }, { userId: 'u2' }]);
      const send = await request(buildApp(db, { id: 'u1' }, ws))
        .post(`${BASE}/conversations/${conversation._id.toString()}/messages`)
        .send({ content: 'first' });
      expect(send.status).toBe(201);
      ws.emitToUser.mockClear();
      ws.emitToConversation.mockClear();
      return { conversation, message: send.body.message };
    }

    it('edit, delete and reaction carry the conversation id', async () => {
      const ws = createAppWsServer();
      const { conversation, message } = await twoWay(ws);
      const convId = conversation._id.toString();
      const as = request(buildApp(db, { id: 'u1' }, ws));

      await as.patch(`${BASE}/messages/${message._id}`).send({ content: 'edited' }).expect(200);
      await as.post(`${BASE}/messages/${message._id}/reactions`).send({ emoji: '👍' }).expect(200);
      await as.delete(`${BASE}/messages/${message._id}`).expect(200);

      const byEvent = Object.fromEntries(
        ws.emitToConversation.mock.calls.map(([, event, data]) => [event, data])
      );
      expect(byEvent['messenger:v4:message-edited'].conversationId).toBe(convId);
      expect(byEvent['messenger:v4:reaction'].conversationId).toBe(convId);
      expect(byEvent['messenger:v4:message-deleted'].conversationId).toBe(convId);
    });

    it("a read receipt reaches the other participant, and the reader's own other sessions", async () => {
      const ws = createAppWsServer();
      const { conversation } = await twoWay(ws);
      const res = await request(buildApp(db, { id: 'u2' }, ws))
        .post(`${BASE}/conversations/${conversation._id.toString()}/read`)
        .send({});
      expect(res.status).toBe(200);

      const calls = ws.emitToUser.mock.calls.map(([userId, event]) => `${userId}:${event}`);
      expect(calls).toContain('u1:messenger:v4:read');
      expect(calls).toContain('u2:messenger:v4:conversation-updated');
      expect(calls).not.toContain('u2:messenger:v4:read');
    });

    it('typing and read are not sent to a participant who deleted the conversation', async () => {
      const conversation = await seedConversation(db, [
        { userId: 'u1' },
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      const idx = conversation.participants.findIndex(p => p.userId === 'u3');
      await db
        .collection('conversations_v4')
        .updateOne(
          { _id: conversation._id },
          { $set: { [`participants.${idx}.isDeleted`]: true } }
        );
      const ws = createAppWsServer();
      const id = conversation._id.toString();
      await request(buildApp(db, { id: 'u1' }, ws))
        .post(`${BASE}/conversations/${id}/typing`)
        .send({ isTyping: true })
        .expect(200);
      await request(buildApp(db, { id: 'u1' }, ws))
        .post(`${BASE}/conversations/${id}/read`)
        .send({});

      const targets = ws.emitToUser.mock.calls
        .filter(([, event]) => event === 'messenger:v4:typing' || event === 'messenger:v4:read')
        .map(([userId]) => userId);
      expect(targets).not.toContain('u3');
      expect(targets).toContain('u2');
    });
  });

  describe('request validation', () => {
    const create = (body, user = { id: 'u1' }) =>
      request(buildApp(db, user, null))
        .post(`${BASE}/conversations`)
        .send(body);

    it.each([
      [{}, 'type and participantIds are required'],
      [{ type: 'direct', participantIds: [] }, 'type and participantIds are required'],
      [
        { type: 'direct', participantIds: Array.from({ length: 51 }, (_, i) => `x${i}`) },
        'Too many participants (max 50)',
      ],
      [{ type: 'direct', participantIds: [5] }, 'Each participant ID must be a non-empty string'],
      [
        { type: 'direct', participantIds: ['  '] },
        'Each participant ID must be a non-empty string',
      ],
      [
        { type: 'direct', participantIds: ['u2', 'u2'] },
        'Duplicate participant IDs are not allowed',
      ],
      [
        { type: 'direct', participantIds: ['u1'] },
        'A conversation must include at least one other participant',
      ],
      [{ type: 'nonsense', participantIds: ['u2'] }, 'Invalid conversation type'],
      [
        { type: 'direct', participantIds: ['u2'], context: { type: 'nonsense' } },
        'Invalid conversation context type',
      ],
      [{ type: 'direct', participantIds: ['nobody'] }, 'One or more participant IDs are invalid'],
    ])('rejects %j with 400', async (body, message) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(message);
    });

    it('accepts a context with no type', async () => {
      const res = await create({ type: 'direct', participantIds: ['u2'], context: {} });
      expect(res.status).toBe(201);
    });

    it('blocks a supplier starting a cold conversation with a customer from the generic form', async () => {
      const res = await create(
        { type: 'direct', participantIds: ['u2'], metadata: { source: 'generic_new_message' } },
        { id: 's1', role: 'supplier' }
      );
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('GENERIC_CUSTOMER_COLD_MESSAGE_BLOCKED');
    });

    it('allows the same supplier to message a customer they already have a conversation with', async () => {
      await seedConversation(db, [{ userId: 's1', role: 'supplier' }, { userId: 'u2' }]);
      const res = await create(
        { type: 'direct', participantIds: ['u2'], metadata: { source: 'generic_new_message' } },
        { id: 's1', role: 'supplier' }
      );
      expect(res.status).toBe(201);
    });

    describe('sending a message', () => {
      let conversation;
      beforeEach(async () => {
        conversation = await seedConversation(db, [{ userId: 'u1' }, { userId: 'u2' }]);
      });
      const send = body =>
        request(buildApp(db, { id: 'u1' }, null))
          .post(`${BASE}/conversations/${conversation._id.toString()}/messages`)
          .send(body);

      it.each([
        [{ content: 'hi', type: 'video' }, 'Invalid message type'],
        [{ content: 'hi', clientMessageId: 'has spaces!' }, 'Invalid clientMessageId'],
        [{ content: 'hi', clientMessageId: 'a'.repeat(65) }, 'Invalid clientMessageId'],
        [{ content: 'hi', clientMessageId: 42 }, 'Invalid clientMessageId'],
        [{ content: '   ' }, 'Message content or at least one attachment is required'],
        [{}, 'Message content or at least one attachment is required'],
        [{ content: 'hi', replyTo: '{not json' }, 'Invalid replyTo format'],
      ])('rejects %j with 400', async (body, message) => {
        const res = await send(body);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(message);
      });

      it('rejects a malformed conversation id', async () => {
        const res = await request(buildApp(db, { id: 'u1' }, null))
          .post(`${BASE}/conversations/not-an-id/messages`)
          .send({ content: 'hi' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid conversation ID');
      });

      it('accepts a valid clientMessageId and a JSON-string replyTo', async () => {
        const first = await send({ content: 'first', clientMessageId: 'abc-123_X:1.2' });
        expect(first.status).toBe(201);
        const reply = await send({
          content: 'second',
          replyTo: JSON.stringify({ _id: first.body.message._id, content: 'first' }),
        });
        expect(reply.status).toBe(201);
      });
    });
  });
});
