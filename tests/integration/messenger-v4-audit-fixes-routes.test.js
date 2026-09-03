/**
 * Route-level integration tests for two of the messenger-v4 audit fixes that
 * are easiest to get wrong at the route layer specifically (status codes,
 * response shape) rather than the service layer alone (already covered by
 * tests/unit/messenger-v4.test.js):
 *
 * - GET /contacts must not return admin/staff accounts when the caller
 *   doesn't request an explicit (allowed) role.
 * - DELETE /messages/:id must map a hard-delete-lockout rejection to a
 *   user-facing status/message via the route's catch block, not just at
 *   the service layer.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

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

// Fuller in-memory Mongo-compatible double (supports $elemMatch/$ne/$in/$or,
// dotted paths) — needed because the audit fixes use $elemMatch queries that
// the simpler double in messenger-v4-block-routes.test.js doesn't model.
function createInMemoryDb() {
  const store = {};

  function getCol(name) {
    if (!store[name]) {
      store[name] = [];
    }
    return store[name];
  }

  function matches(doc, query) {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or') {
        if (!value.some(cond => matches(doc, cond))) {
          return false;
        }
        continue;
      }
      if (key === '$and') {
        if (!value.every(cond => matches(doc, cond))) {
          return false;
        }
        continue;
      }
      let docVal;
      if (key.includes('.')) {
        docVal = key
          .split('.')
          .reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), doc);
      } else {
        docVal = doc[key];
      }
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof ObjectId)
      ) {
        if ('$in' in value) {
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!value.$in.some(v => vals.some(d => String(d) === String(v)))) {
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
        if ('$elemMatch' in value) {
          if (!Array.isArray(docVal) || !docVal.some(el => matches(el, value.$elemMatch))) {
            return false;
          }
          continue;
        }
        if ('$regex' in value) {
          const re = new RegExp(value.$regex, value.$options || '');
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!vals.some(v => re.test(v))) {
            return false;
          }
          continue;
        }
      }
      if (value instanceof RegExp) {
        const vals = Array.isArray(docVal) ? docVal : [docVal];
        if (!vals.some(v => v !== null && v !== undefined && value.test(String(v)))) {
          return false;
        }
        continue;
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
              target[parts[i]] = isNaN(Number(parts[i + 1])) ? {} : [];
            }
            target = target[parts[i]];
          }
          target[parts[parts.length - 1]] = val;
        } else {
          doc[path] = val;
        }
      }
    }
    return doc;
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
        return getCol(name).find(doc => matches(doc, query)) || null;
      },
      find(query) {
        const items = getCol(name).filter(doc => matches(doc, query || {}));
        const cursor = {
          sort: () => cursor,
          skip: () => cursor,
          limit: () => cursor,
          project: () => cursor,
          async toArray() {
            return items;
          },
        };
        return cursor;
      },
      async updateOne(filter, update) {
        const idx = getCol(name).findIndex(doc => matches(doc, filter));
        if (idx === -1) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        applyUpdate(getCol(name)[idx], update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      async countDocuments(query) {
        return getCol(name).filter(doc => matches(doc, query || {})).length;
      },
      async createIndex() {
        return 'ok';
      },
      async bulkWrite(operations) {
        for (const op of operations) {
          if (op.updateOne) {
            const idx = getCol(name).findIndex(doc => matches(doc, op.updateOne.filter));
            if (idx !== -1) {
              applyUpdate(getCol(name)[idx], op.updateOne.update);
            }
          }
        }
        return { ok: 1 };
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

describe('messenger-v4 audit fixes — route layer', () => {
  let db;

  beforeEach(() => {
    jest.resetModules();
    db = createInMemoryDb();
  });

  describe('GET /contacts', () => {
    beforeEach(async () => {
      await db.collection('users').insertMany([
        { _id: 'user1', id: 'user1', displayName: 'Zed User', name: 'Zed User', role: 'customer' },
        {
          _id: 'admin1',
          id: 'admin1',
          displayName: 'Zed Admin',
          name: 'Zed Admin',
          email: 'zed-admin@example.com',
          role: 'admin',
        },
        {
          _id: 'supplier1',
          id: 'supplier1',
          displayName: 'Zed Supplier',
          name: 'Zed Supplier',
          role: 'supplier',
        },
      ]);
    });

    it('excludes admin accounts when no role filter is requested (regression: admin enumeration)', async () => {
      const app = buildApp(db, 'user1');
      const res = await request(app).get('/api/v4/messenger/contacts').query({ q: 'Zed' });

      expect(res.status).toBe(200);
      expect(res.body.contacts.some(c => c.role === 'admin')).toBe(false);
      expect(res.body.contacts.some(c => c.userId === 'supplier1')).toBe(true);
    });

    it('still supports an explicit allowed role filter', async () => {
      const app = buildApp(db, 'user1');
      const res = await request(app)
        .get('/api/v4/messenger/contacts')
        .query({ q: 'Zed', role: 'supplier' });

      expect(res.status).toBe(200);
      expect(res.body.contacts.every(c => c.role === 'supplier')).toBe(true);
    });
  });

  describe('DELETE /messages/:id', () => {
    it('rejects with the access-denied message (not a generic 500) once the author hard-deleted the conversation (regression)', async () => {
      const MessengerV4Service = require('../../services/messenger-v4.service');
      const setupService = new MessengerV4Service(db, {
        info: () => {},
        warn: () => {},
        error: () => {},
      });

      const conversation = await setupService.createConversation({
        type: 'direct',
        creatorUserId: 'user1',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });
      const message = await setupService.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'hello',
      });

      const idx = conversation.participants.findIndex(p => p.userId === 'user1');
      await db
        .collection('conversations_v4')
        .updateOne(
          { _id: conversation._id },
          { $set: { [`participants.${idx}.isDeleted`]: true } }
        );

      const app = buildApp(db, 'user1');
      const res = await request(app).delete(`/api/v4/messenger/messages/${message._id.toString()}`);

      // messengerErrorStatus checks "not found" before "access denied", and
      // this shared error message contains both — 404 here is consistent
      // with every other hard-delete-lockout path (getConversation etc.).
      // The key regression check is that it's a recognised status with the
      // real message, not a generic 500.
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/access denied/i);
    });
  });
});
