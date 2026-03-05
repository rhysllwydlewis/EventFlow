/**
 * Integration Tests for Messaging API v2 Bulk Operations (Phase 1)
 * Tests the new bulk operation endpoints
 */

'use strict';

const fs = require('fs');
const path = require('path');

const messagingV2Path = path.join(process.cwd(), 'routes/messaging-v2.js');
const _messagingV2Exists = fs.existsSync(messagingV2Path);

const request = _messagingV2Exists ? require('supertest') : null;
const { ObjectId } = require('mongodb');
const express = require('express');

// ---------------------------------------------------------------------------
// Lightweight in-memory MongoDB-compatible mock.
// Replaces MongoMemoryServer so no binary download is required.
// ---------------------------------------------------------------------------
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
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        if (!value.some(c => matchesQuery(doc, c))) {
          return false;
        }
        continue;
      }
      if (key === '$and') {
        if (!value.every(c => matchesQuery(doc, c))) {
          return false;
        }
        continue;
      }
      let docVal;
      if (key.includes('.')) {
        const parts = key.split('.');
        docVal = parts.reduce((o, k) => {
          if (o === null || o === undefined) {
            return undefined;
          }
          if (Array.isArray(o)) {
            return o.map(item => item?.[k]);
          }
          return o[k];
        }, doc);
      } else {
        docVal = doc[key];
      }
      if (value instanceof RegExp) {
        const vals = Array.isArray(docVal) ? docVal : [docVal];
        if (!vals.some(v => v !== null && v !== undefined && value.test(String(v)))) {
          return false;
        }
        continue;
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof ObjectId) &&
        !(value instanceof Date)
      ) {
        if ('$in' in value) {
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!value.$in.some(v => vals.some(d => String(d) === String(v)))) {
            return false;
          }
          continue;
        }
        if ('$nin' in value) {
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (value.$nin.some(v => vals.some(d => String(d) === String(v)))) {
            return false;
          }
          continue;
        }
        if ('$gt' in value) {
          if (!(docVal > value.$gt)) {
            return false;
          }
          continue;
        }
        if ('$gte' in value) {
          if (!(docVal >= value.$gte)) {
            return false;
          }
          continue;
        }
        if ('$lt' in value) {
          if (!(docVal < value.$lt)) {
            return false;
          }
          continue;
        }
        if ('$lte' in value) {
          if (!(docVal <= value.$lte)) {
            return false;
          }
          continue;
        }
        if ('$ne' in value) {
          if (String(docVal) === String(value.$ne)) {
            return false;
          }
          continue;
        }
        if ('$exists' in value) {
          const exists = docVal !== undefined;
          if (exists !== value.$exists) {
            return false;
          }
          continue;
        }
        if ('$elemMatch' in value) {
          if (!Array.isArray(docVal) || !docVal.some(el => matchesQuery(el, value.$elemMatch))) {
            return false;
          }
          continue;
        }
        if ('$all' in value) {
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!value.$all.every(v => vals.some(d => String(d) === String(v)))) {
            return false;
          }
          continue;
        }
        if ('$regex' in value) {
          const re = new RegExp(value.$regex, value.$options || '');
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!vals.some(v => re.test(String(v)))) {
            return false;
          }
          continue;
        }
      }
      const docStr = String(docVal);
      const valStr = String(value);
      if (Array.isArray(docVal)) {
        if (!docVal.some(d => String(d) === valStr)) {
          return false;
        }
      } else if (docStr !== valStr && docVal !== value) {
        return false;
      }
    }
    return true;
  }

  function applyUpdate(doc, update) {
    if (update.$set) {
      for (const [path, val] of Object.entries(update.$set)) {
        if (path.includes('.')) {
          const parts = path.split('.');
          let target = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            if (target[parts[i]] === null || target[parts[i]] === undefined) {
              target[parts[i]] = {};
            }
            target = target[parts[i]];
          }
          target[parts[parts.length - 1]] = val;
        } else {
          doc[path] = val;
        }
      }
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) {
        delete doc[k];
      }
    }
    if (update.$inc) {
      for (const [path, amt] of Object.entries(update.$inc)) {
        const parts = path.split('.');
        let target = doc;
        for (let i = 0; i < parts.length - 1; i++) {
          if (target[parts[i]] === null || target[parts[i]] === undefined) {
            target[parts[i]] = {};
          }
          target = target[parts[i]];
        }
        const last = parts[parts.length - 1];
        target[last] = (target[last] || 0) + amt;
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        if (!doc[k]) {
          doc[k] = [];
        }
        if (v && typeof v === 'object' && '$each' in v) {
          doc[k].push(...v.$each);
        } else {
          doc[k].push(v);
        }
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (doc[k]) {
          doc[k] = doc[k].filter(item => !matchesQuery(item, v));
        }
      }
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        if (!doc[k]) {
          doc[k] = [];
        }
        const items = v && '$each' in v ? v.$each : [v];
        for (const item of items) {
          if (!doc[k].some(d => JSON.stringify(d) === JSON.stringify(item))) {
            doc[k].push(item);
          }
        }
      }
    }
    return doc;
  }

  function makeCollection(name) {
    return {
      async insertOne(doc, _opts) {
        const newDoc = { _id: new ObjectId(), ...doc };
        getCol(name).push(newDoc);
        return { insertedId: newDoc._id, acknowledged: true };
      },
      async insertMany(docs, _opts) {
        const ids = {};
        docs.forEach((doc, i) => {
          const newDoc = { _id: doc._id || new ObjectId(), ...doc };
          getCol(name).push(newDoc);
          ids[i] = newDoc._id;
        });
        return { insertedIds: ids, acknowledged: true };
      },
      async findOne(query, _opts) {
        return getCol(name).find(doc => matchesQuery(doc, query)) || null;
      },
      find(query, _opts) {
        const items = getCol(name).filter(doc => matchesQuery(doc, query || {}));
        let sortFn = null;
        let skipN = 0;
        let limitN = Infinity;
        const cursor = {
          sort(spec) {
            const entries = Object.entries(spec);
            sortFn = (a, b) => {
              for (const [k, dir] of entries) {
                const av = k.split('.').reduce((o, p) => o?.[p], a);
                const bv = k.split('.').reduce((o, p) => o?.[p], b);
                if (av < bv) {
                  return dir === -1 ? 1 : -1;
                }
                if (av > bv) {
                  return dir === -1 ? -1 : 1;
                }
              }
              return 0;
            };
            return cursor;
          },
          skip(n) {
            skipN = n;
            return cursor;
          },
          limit(n) {
            limitN = n;
            return cursor;
          },
          project() {
            return cursor;
          },
          async toArray() {
            const r = [...items];
            if (sortFn) {
              r.sort(sortFn);
            }
            return r.slice(skipN, Math.min(r.length, skipN + limitN));
          },
        };
        return cursor;
      },
      async updateOne(filter, update, _opts) {
        const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
        if (idx === -1) {
          return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
        }
        applyUpdate(getCol(name)[idx], update);
        return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
      },
      async updateMany(filter, update, _opts) {
        let count = 0;
        getCol(name).forEach((doc, idx) => {
          if (matchesQuery(doc, filter)) {
            applyUpdate(getCol(name)[idx], update);
            count++;
          }
        });
        return { matchedCount: count, modifiedCount: count, acknowledged: true };
      },
      async deleteMany(filter, _opts) {
        const before = getCol(name).length;
        if (!filter || Object.keys(filter).length === 0) {
          store[name] = [];
        } else {
          store[name] = getCol(name).filter(doc => !matchesQuery(doc, filter));
        }
        return { deletedCount: before - getCol(name).length, acknowledged: true };
      },
      async countDocuments(query, _opts) {
        return getCol(name).filter(doc => matchesQuery(doc, query || {})).length;
      },
      async createIndex() {
        return 'ok';
      },
      async createIndexes() {
        return 'ok';
      },
      async findOneAndUpdate(filter, update, _opts) {
        const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
        if (idx === -1) {
          return { value: null };
        }
        applyUpdate(getCol(name)[idx], update);
        return { value: getCol(name)[idx] };
      },
    };
  }

  // Mock session – transactions are no-ops (in-memory DB is always consistent)
  function makeSession() {
    return {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };
  }

  return {
    collection: name => makeCollection(name),
    startSession: () => makeSession(),
    // MongoDB driver exposes startSession on client; some services call this.db.client.startSession()
    client: { startSession: () => makeSession() },
  };
}
// ---------------------------------------------------------------------------

(_messagingV2Exists ? describe : describe.skip)(
  'Messaging API v2 - Bulk Operations Integration',
  () => {
    let db;
    let app;
    let testThread;
    let testMessages;

    beforeAll(async () => {
      // Create in-memory database (no external download required)
      db = createInMemoryDb();

      // Setup Express app
      app = express();
      app.use(express.json());

      // Mock middleware
      app.use((req, res, next) => {
        req.user = { id: 'test-user-123', email: 'test@example.com' };
        next();
      });

      // Initialize routes (simplified for testing)
      // eslint-disable-next-line node/no-missing-require
      const messagingRoutes = require('../../routes/messaging-v2');
      await messagingRoutes.initializeRouter({
        authRequired: (req, res, next) => next(),
        roleRequired: () => (req, res, next) => next(),
        csrfProtection: (req, res, next) => next(),
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
        mongoDb: { getDb: async () => db, db },
      });

      app.use('/api/v2/messages', messagingRoutes);
    }, 60000);

    afterAll(async () => {
      // Nothing to close – in-memory mock
    });

    beforeEach(async () => {
      // Create test thread
      testThread = {
        _id: new ObjectId(),
        participants: ['test-user-123', 'other-user-456'],
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.collection('threads').insertOne(testThread);

      // Create test messages
      testMessages = [
        {
          _id: new ObjectId(),
          threadId: testThread._id.toString(),
          senderId: 'other-user-456',
          recipientIds: ['test-user-123'],
          content: 'Test message 1',
          status: 'sent',
          readBy: [],
          isStarred: false,
          isArchived: false,
          messageStatus: 'new',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          _id: new ObjectId(),
          threadId: testThread._id.toString(),
          senderId: 'other-user-456',
          recipientIds: ['test-user-123'],
          content: 'Test message 2',
          status: 'sent',
          readBy: [],
          isStarred: false,
          isArchived: false,
          messageStatus: 'new',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
        {
          _id: new ObjectId(),
          threadId: testThread._id.toString(),
          senderId: 'test-user-123',
          recipientIds: ['other-user-456'],
          content: 'Test message 3',
          status: 'sent',
          readBy: [],
          isStarred: true,
          isArchived: false,
          messageStatus: 'waiting_response',
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];

      await db.collection('messages').insertMany(testMessages);
    });

    afterEach(async () => {
      await db.collection('threads').deleteMany({});
      await db.collection('messages').deleteMany({});
      await db.collection('messageOperations').deleteMany({});
    });

    describe('POST /api/v2/messages/bulk-delete', () => {
      it('should bulk delete messages with valid input', async () => {
        const messageIds = [testMessages[0]._id.toString(), testMessages[1]._id.toString()];

        const response = await request(app)
          .post('/api/v2/messages/bulk-delete')
          .send({
            messageIds,
            threadId: testThread._id.toString(),
            reason: 'Test deletion',
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.deletedCount).toBe(2);
        expect(response.body.operationId).toBeDefined();
        expect(response.body.undoToken).toBeDefined();

        // Verify messages are soft deleted
        const deletedMessages = await db
          .collection('messages')
          .find({ _id: { $in: messageIds.map(id => new ObjectId(id)) } })
          .toArray();

        deletedMessages.forEach(msg => {
          expect(msg.deletedAt).toBeDefined();
          expect(msg.deletedAt).toBeInstanceOf(Date);
        });

        // Verify operation record created
        const operation = await db.collection('messageOperations').findOne({
          operationId: response.body.operationId,
        });

        expect(operation).toBeDefined();
        expect(operation.operationType).toBe('delete');
        expect(operation.messageIds).toHaveLength(2);
      });

      it('should reject bulk delete with empty message IDs', async () => {
        const response = await request(app)
          .post('/api/v2/messages/bulk-delete')
          .send({
            messageIds: [],
            threadId: testThread._id.toString(),
          })
          .expect(400);

        expect(response.body.error).toContain('messageIds array is required');
      });

      it('should reject bulk delete with more than 100 messages', async () => {
        const messageIds = Array.from({ length: 101 }, () => new ObjectId().toString());

        const response = await request(app)
          .post('/api/v2/messages/bulk-delete')
          .send({
            messageIds,
            threadId: testThread._id.toString(),
          })
          .expect(400);

        expect(response.body.error).toBe('Cannot delete more than 100 messages at once');
      });

      it('should reject bulk delete without threadId', async () => {
        const response = await request(app)
          .post('/api/v2/messages/bulk-delete')
          .send({
            messageIds: [testMessages[0]._id.toString()],
          })
          .expect(400);

        expect(response.body.error).toBe('threadId is required');
      });
    });

    describe('POST /api/v2/messages/bulk-mark-read', () => {
      it('should bulk mark messages as read', async () => {
        const messageIds = [testMessages[0]._id.toString(), testMessages[1]._id.toString()];

        const response = await request(app)
          .post('/api/v2/messages/bulk-mark-read')
          .send({
            messageIds,
            isRead: true,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.updatedCount).toBe(2);

        // Verify messages are marked as read
        const readMessages = await db
          .collection('messages')
          .find({ _id: { $in: messageIds.map(id => new ObjectId(id)) } })
          .toArray();

        readMessages.forEach(msg => {
          expect(msg.status).toBe('read');
          expect(msg.readBy).toContainEqual(
            expect.objectContaining({
              userId: 'test-user-123',
            })
          );
        });
      });

      it('should bulk mark messages as unread', async () => {
        // First mark as read
        const messageIds = [testMessages[0]._id.toString()];
        await db.collection('messages').updateOne(
          { _id: new ObjectId(messageIds[0]) },
          {
            $set: { status: 'read' },
            $push: { readBy: { userId: 'test-user-123', readAt: new Date() } },
          }
        );

        // Then mark as unread
        const response = await request(app)
          .post('/api/v2/messages/bulk-mark-read')
          .send({
            messageIds,
            isRead: false,
          })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify message is marked as unread
        const unreadMessage = await db
          .collection('messages')
          .findOne({ _id: new ObjectId(messageIds[0]) });
        expect(unreadMessage.status).toBe('delivered');
      });

      it('should reject without message IDs', async () => {
        const response = await request(app)
          .post('/api/v2/messages/bulk-mark-read')
          .send({
            isRead: true,
          })
          .expect(400);

        expect(response.body.error).toContain('messageIds array is required');
      });

      it('should reject without isRead parameter', async () => {
        const response = await request(app)
          .post('/api/v2/messages/bulk-mark-read')
          .send({
            messageIds: [testMessages[0]._id.toString()],
          })
          .expect(400);

        expect(response.body.error).toBe('isRead must be a boolean');
      });
    });

    describe('POST /api/v2/messages/:id/flag', () => {
      it('should flag a message', async () => {
        const messageId = testMessages[0]._id.toString();

        const response = await request(app)
          .post(`/api/v2/messages/${messageId}/flag`)
          .send({
            isFlagged: true,
          })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify message is flagged
        const flaggedMessage = await db
          .collection('messages')
          .findOne({ _id: new ObjectId(messageId) });
        expect(flaggedMessage.isStarred).toBe(true);
      });

      it('should unflag a message', async () => {
        const messageId = testMessages[2]._id.toString(); // This one is already starred

        const response = await request(app)
          .post(`/api/v2/messages/${messageId}/flag`)
          .send({
            isFlagged: false,
          })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify message is unflagged
        const unflaggedMessage = await db
          .collection('messages')
          .findOne({ _id: new ObjectId(messageId) });
        expect(unflaggedMessage.isStarred).toBe(false);
      });

      it('should reject without isFlagged parameter', async () => {
        const messageId = testMessages[0]._id.toString();

        const response = await request(app)
          .post(`/api/v2/messages/${messageId}/flag`)
          .send({})
          .expect(400);

        expect(response.body.error).toBe('isFlagged must be a boolean');
      });
    });

    describe('POST /api/v2/messages/:id/archive', () => {
      it('should archive a message', async () => {
        const messageId = testMessages[0]._id.toString();

        const response = await request(app)
          .post(`/api/v2/messages/${messageId}/archive`)
          .send({
            action: 'archive',
          })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify message is archived
        const archivedMessage = await db
          .collection('messages')
          .findOne({ _id: new ObjectId(messageId) });
        expect(archivedMessage.isArchived).toBe(true);
        expect(archivedMessage.archivedAt).toBeDefined();
        expect(archivedMessage.archivedAt).toBeInstanceOf(Date);
      });

      it('should restore an archived message', async () => {
        const messageId = testMessages[0]._id.toString();

        // First archive it
        await db
          .collection('messages')
          .updateOne(
            { _id: new ObjectId(messageId) },
            { $set: { isArchived: true, archivedAt: new Date() } }
          );

        // Then restore it
        const response = await request(app)
          .post(`/api/v2/messages/${messageId}/archive`)
          .send({
            action: 'restore',
          })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify message is restored
        const restoredMessage = await db
          .collection('messages')
          .findOne({ _id: new ObjectId(messageId) });
        expect(restoredMessage.isArchived).toBe(false);
        expect(restoredMessage.archivedAt).toBeNull();
      });

      it('should reject with invalid action', async () => {
        const messageId = testMessages[0]._id.toString();

        const response = await request(app)
          .post(`/api/v2/messages/${messageId}/archive`)
          .send({
            action: 'invalid',
          })
          .expect(400);

        expect(response.body.error).toBe('action must be "archive" or "restore"');
      });
    });

    describe('POST /api/v2/messages/operations/:operationId/undo', () => {
      it('should undo a bulk delete operation', async () => {
        // First perform a bulk delete
        const messageIds = [testMessages[0]._id.toString(), testMessages[1]._id.toString()];
        const deleteResponse = await request(app).post('/api/v2/messages/bulk-delete').send({
          messageIds,
          threadId: testThread._id.toString(),
        });

        const { operationId, undoToken } = deleteResponse.body;

        // Then undo it
        const undoResponse = await request(app)
          .post(`/api/v2/messages/operations/${operationId}/undo`)
          .send({
            undoToken,
          })
          .expect(200);

        expect(undoResponse.body.success).toBe(true);
        expect(undoResponse.body.restoredCount).toBe(2);

        // Verify messages are restored
        const restoredMessages = await db
          .collection('messages')
          .find({ _id: { $in: messageIds.map(id => new ObjectId(id)) } })
          .toArray();

        restoredMessages.forEach(msg => {
          expect(msg.deletedAt).toBeNull();
        });

        // Verify operation is marked as undone
        const operation = await db.collection('messageOperations').findOne({ operationId });
        expect(operation.isUndone).toBe(true);
        expect(operation.undoneAt).toBeDefined();
      });

      it('should reject undo without token', async () => {
        const response = await request(app)
          .post('/api/v2/messages/operations/op123/undo')
          .send({})
          .expect(400);

        expect(response.body.error).toContain('undoToken is required');
      });

      it('should reject undo with invalid operation ID', async () => {
        const response = await request(app)
          .post('/api/v2/messages/operations/invalid-op/undo')
          .send({
            undoToken: 'some-token',
          })
          .expect(400);

        expect(response.body.error).toContain('Operation not found');
      });
    });

    describe('GET /api/v2/messages/:threadId with filters', () => {
      it('should fetch messages with date sorting', async () => {
        const response = await request(app)
          .get(`/api/v2/messages/${testThread._id.toString()}`)
          .query({ sortBy: 'date-asc' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.messages).toBeDefined();
        expect(Array.isArray(response.body.messages)).toBe(true);
      });

      it('should filter unread messages', async () => {
        const response = await request(app)
          .get(`/api/v2/messages/${testThread._id.toString()}`)
          .query({ filterBy: 'unread' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.messages).toBeDefined();

        // All returned messages should be unread
        response.body.messages.forEach(msg => {
          expect(msg.readBy || []).toHaveLength(0);
        });
      });

      it('should filter flagged messages', async () => {
        const response = await request(app)
          .get(`/api/v2/messages/${testThread._id.toString()}`)
          .query({ filterBy: 'flagged' })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Only flagged message should be returned
        expect(response.body.messages).toHaveLength(1);
        expect(response.body.messages[0].isStarred).toBe(true);
      });

      it('should filter by message status', async () => {
        const response = await request(app)
          .get(`/api/v2/messages/${testThread._id.toString()}`)
          .query({ status: 'waiting_response' })
          .expect(200);

        expect(response.body.success).toBe(true);

        // Only message with waiting_response status should be returned
        response.body.messages.forEach(msg => {
          expect(msg.messageStatus).toBe('waiting_response');
        });
      });
    });
  }
);
