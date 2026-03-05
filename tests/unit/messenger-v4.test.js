/**
 * Unit Tests for Messenger v4 Service
 */

'use strict';

// Mock spam detection to avoid cross-test cache pollution
jest.mock('../../services/spamDetection', () => ({
  checkSpam: jest.fn().mockResolvedValue({ isSpam: false, score: 0, reason: null }),
  cleanupCache: jest.fn(),
}));
// Mock content sanitizer - strips HTML tags to prevent XSS
jest.mock('../../services/contentSanitizer', () => ({
  sanitizeContent: jest.fn(content =>
    typeof content === 'string' ? content.replace(/</g, '&lt;').replace(/>/g, '&gt;') : content
  ),
}));

const MessengerV4Service = require('../../services/messenger-v4.service');
const { ObjectId } = require('mongodb');

// ---------------------------------------------------------------------------
// Lightweight in-memory MongoDB-compatible database for unit tests.
// Avoids the need for a real MongoDB connection.
// ---------------------------------------------------------------------------
function createInMemoryDb() {
  const store = {}; // { collectionName: [...docs] }

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
        if (!value.some(cond => matchesQuery(doc, cond))) {
          return false;
        }
        continue;
      }
      if (key === '$and') {
        if (!value.every(cond => matchesQuery(doc, cond))) {
          return false;
        }
        continue;
      }
      // For dotted paths, traverse the document; if an intermediate is an array,
      // project the rest of the path from each element (MongoDB array field projection)
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
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof ObjectId) &&
        !(value instanceof Date)
      ) {
        if ('$in' in value) {
          // docVal might be an array (projected from nested array field)
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
        if ('$regex' in value) {
          const re = new RegExp(value.$regex, value.$options || '');
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!vals.some(v => re.test(v))) {
            return false;
          }
          continue;
        }
        if ('$all' in value) {
          // docVal might be an array projected from nested array field
          const vals = Array.isArray(docVal) ? docVal : [docVal];
          if (!value.$all.every(v => vals.some(d => String(d) === String(v)))) {
            return false;
          }
          continue;
        }
      }
      // Handle RegExp values directly (e.g. when query uses new RegExp(...) instead of { $regex: ... })
      if (value instanceof RegExp) {
        const vals = Array.isArray(docVal) ? docVal : [docVal];
        if (!vals.some(v => v !== null && v !== undefined && value.test(String(v)))) {
          return false;
        }
        continue;
      }
      // $expr: evaluate aggregation expressions against the document
      if (key === '$expr') {
        if (!evalExpr(doc, value)) {
          return false;
        }
        continue;
      }
      // Plain equality – docVal might be projected array (e.g., participants.userId)
      // Match if docVal equals value, or if docVal is an array containing value
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

  function evalExpr(doc, expr) {
    if (expr === null || expr === undefined) {
      return expr;
    }
    if (typeof expr !== 'object') {
      // Field reference (e.g. '$participants'), or plain scalar
      if (typeof expr === 'string' && expr.startsWith('$')) {
        return expr
          .slice(1)
          .split('.')
          .reduce((o, k) => o?.[k], doc);
      }
      return expr; // Return scalar as-is (number, boolean, plain string)
    }
    if ('$eq' in expr) {
      const [a, b] = expr.$eq.map(v => evalExpr(doc, v));
      return String(a) === String(b);
    }
    if ('$size' in expr) {
      const field = expr.$size;
      const val =
        typeof field === 'string' && field.startsWith('$')
          ? field
              .slice(1)
              .split('.')
              .reduce((o, k) => o?.[k], doc)
          : evalExpr(doc, field);
      return Array.isArray(val) ? val.length : 0;
    }
    return expr;
  }

  function applyUpdate(doc, update) {
    if (update.$set) {
      for (const [path, val] of Object.entries(update.$set)) {
        if (path.includes('.')) {
          const parts = path.split('.');
          let target = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (target[k] === null || target[k] === undefined) {
              target[k] = isNaN(Number(parts[i + 1])) ? {} : [];
            }
            target = target[k];
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
      async insertOne(doc) {
        const newDoc = { _id: new ObjectId(), ...doc };
        getCol(name).push(newDoc);
        return { insertedId: newDoc._id, acknowledged: true };
      },
      async insertMany(docs) {
        const ids = {};
        docs.forEach((doc, i) => {
          const newDoc = { _id: doc._id || new ObjectId(), ...doc };
          getCol(name).push(newDoc);
          ids[i] = newDoc._id;
        });
        return { insertedIds: ids, acknowledged: true };
      },
      async findOne(query) {
        return getCol(name).find(doc => matchesQuery(doc, query)) || null;
      },
      find(query) {
        const items = getCol(name).filter(doc => matchesQuery(doc, query));
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
      async updateOne(filter, update) {
        const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
        if (idx === -1) {
          return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
        }
        applyUpdate(getCol(name)[idx], update);
        return { matchedCount: 1, modifiedCount: 1, acknowledged: true };
      },
      async updateMany(filter, update) {
        let count = 0;
        getCol(name).forEach((doc, idx) => {
          if (matchesQuery(doc, filter)) {
            applyUpdate(getCol(name)[idx], update);
            count++;
          }
        });
        return { matchedCount: count, modifiedCount: count, acknowledged: true };
      },
      async deleteMany(filter) {
        const before = getCol(name).length;
        if (!filter || Object.keys(filter).length === 0) {
          store[name] = [];
        } else {
          store[name] = getCol(name).filter(doc => !matchesQuery(doc, filter));
        }
        return { deletedCount: before - getCol(name).length, acknowledged: true };
      },
      async countDocuments(query) {
        return getCol(name).filter(doc => matchesQuery(doc, query || {})).length;
      },
      async createIndex() {
        return 'ok';
      },
      async createIndexes() {
        return 'ok';
      },
      async bulkWrite(operations) {
        let nModified = 0;
        for (const op of operations) {
          if (op.updateOne) {
            const { filter, update } = op.updateOne;
            const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
            if (idx !== -1) {
              applyUpdate(getCol(name)[idx], update);
              nModified++;
            }
          } else if (op.insertOne) {
            const newDoc = { _id: new ObjectId(), ...op.insertOne.document };
            getCol(name).push(newDoc);
          } else if (op.deleteOne) {
            const idx = getCol(name).findIndex(doc => matchesQuery(doc, op.deleteOne.filter));
            if (idx !== -1) {
              getCol(name).splice(idx, 1);
            }
          }
        }
        return { ok: 1, nModified };
      },
    };
  }

  const db = {
    collection(name) {
      return makeCollection(name);
    },
    // Expose raw store for test inspection
    _store: store,
  };
  return db;
}

// ---------------------------------------------------------------------------

describe('MessengerV4Service', () => {
  let db;
  let service;

  beforeEach(async () => {
    // Fresh in-memory database for every test
    db = createInMemoryDb();
    service = new MessengerV4Service(db, console);

    // Seed test users
    await db.collection('users').insertMany([
      {
        _id: 'user1',
        id: 'user1',
        displayName: 'Alice Johnson',
        email: 'alice@example.com',
        role: 'customer',
        subscriptionTier: 'premium',
      },
      {
        _id: 'user2',
        id: 'user2',
        displayName: 'Bob Smith',
        email: 'bob@example.com',
        role: 'supplier',
        subscriptionTier: 'free',
      },
      {
        _id: 'user3',
        id: 'user3',
        displayName: 'Charlie Brown',
        email: 'charlie@example.com',
        role: 'customer',
        subscriptionTier: 'pro',
      },
    ]);
  });

  describe('createConversation', () => {
    it('should create a new direct conversation', async () => {
      const data = {
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice Johnson', role: 'customer' },
          { userId: 'user2', displayName: 'Bob Smith', role: 'supplier' },
        ],
      };

      const conversation = await service.createConversation(data);

      expect(conversation).toBeDefined();
      expect(conversation._id).toBeDefined();
      expect(conversation.type).toBe('direct');
      expect(conversation.participants).toHaveLength(2);
      expect(conversation.status).toBe('active');
      expect(conversation.messageCount).toBe(0);
    });

    it('should deduplicate direct conversations', async () => {
      const data = {
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      };

      const conv1 = await service.createConversation(data);
      const conv2 = await service.createConversation(data);

      expect(conv1._id.toString()).toBe(conv2._id.toString());
    });

    it('should create conversation with context', async () => {
      const data = {
        type: 'enquiry',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
        context: {
          type: 'package',
          referenceId: 'pkg123',
          referenceTitle: 'Wedding Photography Package',
        },
      };

      const conversation = await service.createConversation(data);

      expect(conversation.type).toBe('enquiry');
      expect(conversation.context).toBeDefined();
      expect(conversation.context.type).toBe('package');
      expect(conversation.context.referenceId).toBe('pkg123');
    });

    it('should reject invalid conversation type', async () => {
      const data = {
        type: 'invalid_type',
        participants: [{ userId: 'user1', displayName: 'Alice', role: 'customer' }],
      };

      await expect(service.createConversation(data)).rejects.toThrow('Validation failed');
    });

    it('should reject empty participants', async () => {
      const data = {
        type: 'direct',
        participants: [],
      };

      await expect(service.createConversation(data)).rejects.toThrow('Validation failed');
    });
  });

  describe('getConversations', () => {
    beforeEach(async () => {
      // Create test conversations
      await db.collection('conversations_v4').insertMany([
        {
          type: 'direct',
          participants: [
            {
              userId: 'user1',
              displayName: 'Alice',
              role: 'customer',
              isPinned: false,
              isMuted: false,
              isArchived: false,
              unreadCount: 5,
              lastReadAt: null,
            },
            {
              userId: 'user2',
              displayName: 'Bob',
              role: 'supplier',
              isPinned: false,
              isMuted: false,
              isArchived: false,
              unreadCount: 0,
              lastReadAt: new Date(),
            },
          ],
          status: 'active',
          messageCount: 5,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-15'),
        },
        {
          type: 'direct',
          participants: [
            {
              userId: 'user1',
              displayName: 'Alice',
              role: 'customer',
              isPinned: true,
              isMuted: false,
              isArchived: false,
              unreadCount: 0,
              lastReadAt: new Date(),
            },
            {
              userId: 'user3',
              displayName: 'Charlie',
              role: 'customer',
              isPinned: false,
              isMuted: false,
              isArchived: false,
              unreadCount: 2,
              lastReadAt: null,
            },
          ],
          status: 'active',
          messageCount: 10,
          createdAt: new Date('2024-01-10'),
          updatedAt: new Date('2024-01-20'),
        },
        {
          type: 'direct',
          participants: [
            {
              userId: 'user1',
              displayName: 'Alice',
              role: 'customer',
              isPinned: false,
              isMuted: false,
              isArchived: true,
              unreadCount: 0,
              lastReadAt: new Date(),
            },
            {
              userId: 'user2',
              displayName: 'Bob',
              role: 'supplier',
              isPinned: false,
              isMuted: false,
              isArchived: false,
              unreadCount: 0,
              lastReadAt: new Date(),
            },
          ],
          status: 'active',
          messageCount: 2,
          createdAt: new Date('2024-01-05'),
          updatedAt: new Date('2024-01-10'),
        },
      ]);
    });

    it('should get all active conversations for a user', async () => {
      const conversations = await service.getConversations('user1');

      // Should exclude archived by default
      expect(conversations).toHaveLength(2);
    });

    it('should filter by unread', async () => {
      const conversations = await service.getConversations('user1', { unread: true });

      expect(conversations).toHaveLength(1);
      expect(conversations[0].participants.find(p => p.userId === 'user1').unreadCount).toBe(5);
    });

    it('should filter by pinned', async () => {
      const conversations = await service.getConversations('user1', { pinned: true });

      expect(conversations).toHaveLength(1);
      expect(conversations[0].participants.find(p => p.userId === 'user1').isPinned).toBe(true);
    });

    it('should include archived when explicitly requested', async () => {
      const conversations = await service.getConversations('user1', { archived: true });

      expect(conversations).toHaveLength(1);
      expect(conversations[0].participants.find(p => p.userId === 'user1').isArchived).toBe(true);
    });

    it('should sort by updatedAt descending', async () => {
      const conversations = await service.getConversations('user1');

      expect(conversations[0].updatedAt.getTime()).toBeGreaterThanOrEqual(
        conversations[1].updatedAt.getTime()
      );
    });
  });

  describe('sendMessage', () => {
    let conversation;

    beforeEach(async () => {
      // Create a test conversation
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });
    });

    it('should send a message successfully', async () => {
      const messageData = {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Hello Bob!',
      };

      const message = await service.sendMessage(conversation._id.toString(), messageData);

      expect(message).toBeDefined();
      expect(message._id).toBeDefined();
      expect(message.content).toBe('Hello Bob!');
      expect(message.senderId).toBe('user1');
      expect(message.type).toBe('text');
    });

    it('should update conversation lastMessage', async () => {
      const messageData = {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Test message',
      };

      await service.sendMessage(conversation._id.toString(), messageData);

      const updatedConv = await service.getConversation(conversation._id.toString(), 'user1');

      expect(updatedConv.lastMessage).toBeDefined();
      expect(updatedConv.lastMessage.content).toBe('Test message');
      expect(updatedConv.lastMessage.senderId).toBe('user1');
    });

    it('should increment message count', async () => {
      const messageData = {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Message 1',
      };

      await service.sendMessage(conversation._id.toString(), messageData);

      const updatedConv = await service.getConversation(conversation._id.toString(), 'user1');

      expect(updatedConv.messageCount).toBe(1);
    });

    it('should increment unread count for recipients', async () => {
      const messageData = {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'New message',
      };

      await service.sendMessage(conversation._id.toString(), messageData);

      const updatedConv = await service.getConversation(conversation._id.toString(), 'user2');
      const user2Participant = updatedConv.participants.find(p => p.userId === 'user2');

      expect(user2Participant.unreadCount).toBe(1);
    });

    it('should sanitize message content', async () => {
      const messageData = {
        senderId: 'user1',
        senderName: 'Alice',
        content: '<script>alert("xss")</script>Hello',
      };

      const message = await service.sendMessage(conversation._id.toString(), messageData);

      expect(message.content).not.toContain('<script>');
    });

    it('should reject empty message content', async () => {
      const messageData = {
        senderId: 'user1',
        senderName: 'Alice',
        content: '   ',
      };

      await expect(service.sendMessage(conversation._id.toString(), messageData)).rejects.toThrow(
        'validation failed'
      );
    });

    it('should reject message from non-participant', async () => {
      const messageData = {
        senderId: 'user3',
        senderName: 'Charlie',
        content: 'Hello',
      };

      await expect(service.sendMessage(conversation._id.toString(), messageData)).rejects.toThrow(
        'not a participant'
      );
    });
  });

  describe('updateConversation', () => {
    let conversation;

    beforeEach(async () => {
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });
    });

    it('should pin a conversation', async () => {
      const updated = await service.updateConversation(conversation._id.toString(), 'user1', {
        isPinned: true,
      });

      const participant = updated.participants.find(p => p.userId === 'user1');
      expect(participant.isPinned).toBe(true);
    });

    it('should mute a conversation', async () => {
      const updated = await service.updateConversation(conversation._id.toString(), 'user1', {
        isMuted: true,
      });

      const participant = updated.participants.find(p => p.userId === 'user1');
      expect(participant.isMuted).toBe(true);
    });

    it('should archive a conversation', async () => {
      const updated = await service.updateConversation(conversation._id.toString(), 'user1', {
        isArchived: true,
      });

      const participant = updated.participants.find(p => p.userId === 'user1');
      expect(participant.isArchived).toBe(true);
    });
  });

  describe('markAsRead', () => {
    let conversation;

    beforeEach(async () => {
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      // Send some messages
      await service.sendMessage(conversation._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Message 1',
      });
      await service.sendMessage(conversation._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Message 2',
      });
    });

    it('should mark conversation as read', async () => {
      await service.markAsRead(conversation._id.toString(), 'user1');

      const updated = await service.getConversation(conversation._id.toString(), 'user1');
      const participant = updated.participants.find(p => p.userId === 'user1');

      expect(participant.unreadCount).toBe(0);
      expect(participant.lastReadAt).toBeDefined();
    });
  });

  describe('getUnreadCount', () => {
    it('should return total unread count', async () => {
      // Create conversations with unread messages
      const conv1 = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      const conv2 = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user3', displayName: 'Charlie', role: 'customer' },
        ],
      });

      // Send messages from other users
      await service.sendMessage(conv1._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Message 1',
      });
      await service.sendMessage(conv1._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Message 2',
      });
      await service.sendMessage(conv2._id.toString(), {
        senderId: 'user3',
        senderName: 'Charlie',
        content: 'Message 3',
      });

      const unreadCount = await service.getUnreadCount('user1');

      expect(unreadCount).toBe(3); // 2 from conv1 + 1 from conv2
    });

    it('should exclude muted conversations from unread count', async () => {
      const conv = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      await service.sendMessage(conv._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Message',
      });

      // Mute the conversation
      await service.updateConversation(conv._id.toString(), 'user1', { isMuted: true });

      const unreadCount = await service.getUnreadCount('user1');

      expect(unreadCount).toBe(0);
    });
  });

  describe('searchContacts', () => {
    it('should find users by name', async () => {
      const contacts = await service.searchContacts('user1', 'Bob');

      expect(contacts).toHaveLength(1);
      expect(contacts[0].displayName).toBe('Bob Smith');
    });

    it('should exclude current user from results', async () => {
      const contacts = await service.searchContacts('user1', 'Alice');

      expect(contacts).toHaveLength(0);
    });

    it('should filter by role', async () => {
      const contacts = await service.searchContacts('user1', '', { role: 'supplier' });

      expect(contacts).toHaveLength(1);
      expect(contacts[0].role).toBe('supplier');
    });
  });

  describe('editMessage', () => {
    let conversation;
    let message;

    beforeEach(async () => {
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      message = await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Original message',
      });
    });

    it('should edit a message within time window', async () => {
      const edited = await service.editMessage(message._id.toString(), 'user1', 'Edited message');

      expect(edited.content).toBe('Edited message');
      expect(edited.editedAt).toBeDefined();
    });

    it('should reject edit from non-sender', async () => {
      await expect(
        service.editMessage(message._id.toString(), 'user2', 'Hacked message')
      ).rejects.toThrow('not found or access denied');
    });
  });

  describe('deleteMessage', () => {
    let conversation;
    let message;

    beforeEach(async () => {
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      message = await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Message to delete',
      });
    });

    it('should soft-delete a message', async () => {
      await service.deleteMessage(message._id.toString(), 'user1');

      const deleted = await service.messagesCollection.findOne({ _id: message._id });
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.content).toBe('This message was deleted');
    });

    it('should not include deleted messages in getMessages', async () => {
      await service.deleteMessage(message._id.toString(), 'user1');

      const result = await service.getMessages(conversation._id.toString(), 'user1');
      expect(result.messages).toHaveLength(0);
    });

    it('should reject deletion by non-sender', async () => {
      await expect(service.deleteMessage(message._id.toString(), 'user2')).rejects.toThrow(
        'Message not found or access denied'
      );
    });

    it('should update conversation lastMessage when the last message is deleted', async () => {
      // Use participants NOT in the beforeEach conversation (user2+user3 is fresh,
      // avoiding the deduplication that would return the existing user1+user2 conversation).
      const freshConv = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
          { userId: 'user3', displayName: 'Charlie', role: 'customer' },
        ],
      });
      const earlier = await service.sendMessage(freshConv._id.toString(), {
        senderId: 'user3',
        senderName: 'Charlie',
        content: 'Earlier message',
      });
      const latest = await service.sendMessage(freshConv._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Latest message',
      });

      await service.deleteMessage(latest._id.toString(), 'user2');

      const updatedConv = await service.conversationsCollection.findOne({
        _id: freshConv._id,
      });
      expect(updatedConv.lastMessage).not.toBeNull();
      expect(updatedConv.lastMessage.senderId).toBe(earlier.senderId);
      expect(updatedConv.lastMessage.content).toContain('Earlier message');
    });

    it('should set conversation lastMessage to null when the only message is deleted', async () => {
      await service.deleteMessage(message._id.toString(), 'user1');

      const updatedConv = await service.conversationsCollection.findOne({
        _id: conversation._id,
      });
      expect(updatedConv.lastMessage).toBeNull();
    });

    it('should not change lastMessage when a non-last message is deleted', async () => {
      await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Second message',
      });

      // Delete the first message (not the last)
      await service.deleteMessage(message._id.toString(), 'user1');

      const updatedConv = await service.conversationsCollection.findOne({
        _id: conversation._id,
      });
      expect(updatedConv.lastMessage.content).toContain('Second message');
    });
  });

  describe('toggleReaction', () => {
    let conversation;
    let message;

    beforeEach(async () => {
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      message = await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Test message',
      });
    });

    it('should add a reaction', async () => {
      const updated = await service.toggleReaction(message._id.toString(), 'user2', 'Bob', '👍');

      expect(updated.reactions).toHaveLength(1);
      expect(updated.reactions[0].emoji).toBe('👍');
      expect(updated.reactions[0].userId).toBe('user2');
    });

    it('should remove a reaction when toggled again', async () => {
      await service.toggleReaction(message._id.toString(), 'user2', 'Bob', '👍');
      const updated = await service.toggleReaction(message._id.toString(), 'user2', 'Bob', '👍');

      expect(updated.reactions).toHaveLength(0);
    });
  });
});
