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
// Keep service-unit tests independent from the in-process queue fallback. Queue
// delivery and recovery are covered by their own focused test suites.
jest.mock('../../services/queue', () => ({
  enqueueNotificationJob: jest.fn().mockImplementation(() => new Promise(() => {})),
}));

const MessengerV4Service = require('../../services/messenger-v4.service');
const { MongoClient, ObjectId } = require('mongodb');

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
          // Handle dotted paths that projected into an array (e.g. 'readBy.userId'
          // against [{userId: 'u1'}, {userId: 'u2'}]).  Mongo semantics: the doc
          // is excluded if ANY element matches the $ne target.
          if (Array.isArray(docVal)) {
            if (docVal.some(v => String(v) === String(value.$ne))) {
              return false;
            }
            continue;
          }
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

  function applyUpdate(doc, update, arrayFilters = []) {
    if (update.$set) {
      for (const [path, val] of Object.entries(update.$set)) {
        // Handle MongoDB positional-filtered operator: 'arr.$[elem].field'
        // Regex captures: (arrayPath).$[(placeholder)].(fieldPath)
        // Supports single-level positional filtering only (no nested $[a].$[b]).
        // Multiple filtered operators in one path are not needed by this codebase.
        const posFilterMatch = path.match(/^(.+?)\.\$\[([^\]]+)\]\.(.+)$/);
        if (posFilterMatch) {
          const [, arrayPath, placeholder, fieldPath] = posFilterMatch;
          const arr = arrayPath.split('.').reduce((o, k) => o?.[k], doc);
          if (Array.isArray(arr)) {
            // Find the arrayFilter for this placeholder and convert it to a matchable query
            const filterDef = arrayFilters.find(f =>
              Object.keys(f).some(k => k === placeholder || k.startsWith(`${placeholder}.`))
            );
            const filterQuery = {};
            if (filterDef) {
              for (const [k, v] of Object.entries(filterDef)) {
                filterQuery[k.replace(new RegExp(`^${placeholder}\\.`), '')] = v;
              }
            }
            arr.forEach(item => {
              if (!filterDef || matchesQuery(item, filterQuery)) {
                const parts = fieldPath.split('.');
                let target = item;
                for (let i = 0; i < parts.length - 1; i++) {
                  if (target[parts[i]] === null || target[parts[i]] === undefined) {
                    target[parts[i]] = {};
                  }
                  target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = val;
              }
            });
          }
          continue;
        }
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
      async updateOne(filter, update, options = {}) {
        const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
        if (idx === -1) {
          return { matchedCount: 0, modifiedCount: 0, acknowledged: true };
        }
        applyUpdate(getCol(name)[idx], update, options.arrayFilters || []);
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
      async deleteOne(filter) {
        const idx = getCol(name).findIndex(doc => matchesQuery(doc, filter));
        if (idx === -1) {
          return { deletedCount: 0, acknowledged: true };
        }
        getCol(name).splice(idx, 1);
        return { deletedCount: 1, acknowledged: true };
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
    client: {
      startSession() {
        return {
          async withTransaction(fn) {
            const snapshot = JSON.parse(JSON.stringify(store));
            try {
              return await fn();
            } catch (err) {
              Object.keys(store).forEach(k => delete store[k]);
              Object.entries(snapshot).forEach(([k, v]) => {
                store[k] = v.map(item => {
                  if (item && item._id && ObjectId.isValid(item._id)) {
                    return { ...item, _id: new ObjectId(item._id) };
                  }
                  return item;
                });
              });
              throw err;
            }
          },
          async endSession() {
            return undefined;
          },
        };
      },
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
        firstName: 'Alice',
        lastName: 'Johnson',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        role: 'customer',
        subscriptionTier: 'premium',
      },
      {
        _id: 'user2',
        id: 'user2',
        displayName: 'Bob Smith',
        firstName: 'Bob',
        lastName: 'Smith',
        name: 'Bob Smith',
        avatarUrl: '/uploads/profile/user2.jpg',
        email: 'bob@example.com',
        role: 'supplier',
        subscriptionTier: 'free',
      },
      {
        _id: 'user3',
        id: 'user3',
        displayName: 'Charlie Brown',
        firstName: 'Charlie',
        lastName: 'Brown',
        name: 'Charlie Brown',
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

    it('should hydrate participant display name and avatar from users collection', async () => {
      const conversations = await service.getConversations('user1');
      const withUser2 = conversations.find(c =>
        c.participants.some(participant => participant.userId === 'user2')
      );
      const user2Participant = withUser2.participants.find(
        participant => participant.userId === 'user2'
      );

      expect(user2Participant.displayName).toBe('Bob Smith');
      expect(user2Participant.avatar).toBe('/uploads/profile/user2.jpg');
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
      expect(message.notificationFanout).toMatchObject({
        status: 'pending',
        recipientIds: ['user2'],
        attempts: 0,
      });
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

    it('should return hydrated sender name and avatar in getMessages', async () => {
      await service.sendMessage(conversation._id.toString(), {
        senderId: 'user2',
        senderName: 'legacy-bob-slug',
        senderAvatar: '/uploads/legacy-avatar.jpg',
        content: 'Hydrate me',
      });

      const result = await service.getMessages(conversation._id.toString(), 'user1');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].senderName).toBe('Bob Smith');
      expect(result.messages[0].senderAvatar).toBe('/uploads/profile/user2.jpg');
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

    it('should auto-unarchive archived recipients when a new message is sent', async () => {
      // Archive the conversation for user2 (the recipient)
      await service.updateConversation(conversation._id.toString(), 'user2', {
        isArchived: true,
      });
      const beforeSend = await service.getConversation(conversation._id.toString(), 'user2');
      const recipientBefore = beforeSend.participants.find(p => p.userId === 'user2');
      expect(recipientBefore.isArchived).toBe(true);

      // user1 sends a message to user2 (who has archived the conversation)
      const message = await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Hey, still there?',
      });

      // The returned message should expose the auto-unarchived user IDs
      expect(message._autoUnarchivedUserIds).toContain('user2');

      // user2's participant record should now have isArchived: false
      const afterSend = await service.getConversation(conversation._id.toString(), 'user2');
      const recipientAfter = afterSend.participants.find(p => p.userId === 'user2');
      expect(recipientAfter.isArchived).toBe(false);
    });

    it('should NOT auto-unarchive the sender even if they archived the conversation', async () => {
      // Archive for BOTH participants
      await service.updateConversation(conversation._id.toString(), 'user1', {
        isArchived: true,
      });
      await service.updateConversation(conversation._id.toString(), 'user2', {
        isArchived: true,
      });

      // user1 sends a message (sender — should NOT be unarchived)
      const message = await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Breaking my own archive',
      });

      // Only user2 (the recipient) should be in the auto-unarchived list
      expect(message._autoUnarchivedUserIds).toContain('user2');
      expect(message._autoUnarchivedUserIds).not.toContain('user1');

      // Sender (user1) remains archived; recipient (user2) is unarchived
      const conv1 = await service.getConversations('user1', { archived: true });
      expect(conv1.some(c => String(c._id) === String(conversation._id))).toBe(true);
      const conv2 = await service.getConversations('user2', {});
      expect(conv2.some(c => String(c._id) === String(conversation._id))).toBe(true);
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

    it('ignores a non-boolean isPinned/isMuted/isArchived instead of coercing it (regression: Boolean("false") === true)', async () => {
      // A legacy/form-encoded client could send the string "false", which
      // Boolean("false") would wrongly evaluate to true — these must be
      // ignored (left unchanged) rather than coerced.
      const updated = await service.updateConversation(conversation._id.toString(), 'user1', {
        isPinned: 'false',
        isMuted: { not: 'a boolean' },
        isArchived: 0,
      });

      const participant = updated.participants.find(p => p.userId === 'user1');
      expect(participant.isPinned).not.toBe(true);
      expect(participant.isMuted).not.toBe(true);
      expect(participant.isArchived).not.toBe(true);
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

    it('supports an array of allowed roles and excludes roles outside it (regression: admin enumeration)', async () => {
      await db.collection('users').insertOne({
        _id: 'admin1',
        id: 'admin1',
        displayName: 'Zed Admin',
        name: 'Zed Admin',
        email: 'zed-admin@example.com',
        role: 'admin',
      });

      // Route now defaults to this array instead of leaving `role` unfiltered
      // when the caller didn't request a specific (allowed) role.
      const contacts = await service.searchContacts('user1', 'Z', {
        role: ['customer', 'supplier'],
      });

      expect(contacts).toHaveLength(0);
      expect(contacts.some(c => c.role === 'admin')).toBe(false);
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

  // ─── Admin override methods ─────────────────────────────────────────────────

  describe('getConversationAsAdmin', () => {
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

    it('returns the conversation without a participant check', async () => {
      const conv = await service.getConversationAsAdmin(conversation._id.toString());
      expect(conv).toBeDefined();
      expect(conv._id.toString()).toBe(conversation._id.toString());
    });

    it('throws "Conversation not found" for a non-existent id', async () => {
      const fakeId = new (require('mongodb').ObjectId)().toString();
      await expect(service.getConversationAsAdmin(fakeId)).rejects.toThrow(
        'Conversation not found'
      );
    });
  });

  describe('getMessagesAsAdmin', () => {
    let conversation;

    beforeEach(async () => {
      conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });

      // Send a couple of messages as user1 and user2
      await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'Hello from Alice',
      });
      await service.sendMessage(conversation._id.toString(), {
        senderId: 'user2',
        senderName: 'Bob',
        content: 'Hello from Bob',
      });
    });

    it('returns messages without a participant check', async () => {
      // user3 is NOT a participant — getMessages() would throw, getMessagesAsAdmin() must not
      await expect(service.getMessages(conversation._id.toString(), 'user3')).rejects.toThrow();

      const result = await service.getMessagesAsAdmin(conversation._id.toString());
      expect(result.messages).toHaveLength(2);
      const contents = result.messages.map(m => m.content);
      expect(contents).toContain('Hello from Alice');
      expect(contents).toContain('Hello from Bob');
    });

    it('returns hasMore and nextCursor when there are more messages', async () => {
      // Fetch only 1 at a time
      const result = await service.getMessagesAsAdmin(conversation._id.toString(), { limit: 1 });
      expect(result.messages).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeTruthy();
    });

    it('throws "Conversation not found" for a non-existent id', async () => {
      const fakeId = new (require('mongodb').ObjectId)().toString();
      await expect(service.getMessagesAsAdmin(fakeId)).rejects.toThrow('Conversation not found');
    });

    it('does not modify any participant read state', async () => {
      const before = await service.getConversationAsAdmin(conversation._id.toString());
      const unreadBefore = before.participants.map(p => p.unreadCount);

      await service.getMessagesAsAdmin(conversation._id.toString());

      const after = await service.getConversationAsAdmin(conversation._id.toString());
      const unreadAfter = after.participants.map(p => p.unreadCount);

      expect(unreadAfter).toEqual(unreadBefore);
    });
  });

  // =========================================================================
  // Reliability foundation: idempotent send, monotonic seq, per-message
  // delivery/read status, sinceSeq reconciliation.
  // =========================================================================
  describe('reliability foundation', () => {
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

    describe('monotonic seq', () => {
      it('assigns strictly increasing seq values to each new message', async () => {
        const m1 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'one',
        });
        const m2 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'two',
        });
        const m3 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user2',
          senderName: 'Bob',
          content: 'three',
        });

        expect(m1.seq).toBe(1);
        expect(m2.seq).toBe(2);
        expect(m3.seq).toBe(3);
      });

      it('uses independent counters per conversation', async () => {
        const other = await service.createConversation({
          type: 'direct',
          participants: [
            { userId: 'user1', displayName: 'Alice', role: 'customer' },
            { userId: 'user3', displayName: 'Charlie', role: 'customer' },
          ],
        });

        const a = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'in first',
        });
        const b = await service.sendMessage(other._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'in second',
        });

        expect(a.seq).toBe(1);
        expect(b.seq).toBe(1);
      });
    });

    describe('clientMessageId idempotency', () => {
      it('returns the existing message when the same clientMessageId is resent', async () => {
        const cmid = 'cm-abc-123';
        const first = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hello',
          clientMessageId: cmid,
        });
        const second = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hello',
          clientMessageId: cmid,
        });

        expect(String(first._id)).toBe(String(second._id));
        expect(first.seq).toBe(second.seq);

        // Only one row was inserted
        const count = await service.messagesCollection.countDocuments({
          conversationId: conversation._id,
        });
        expect(count).toBe(1);
      });

      it('treats different senders as independent (same clientMessageId allowed)', async () => {
        const cmid = 'shared';
        const a = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'from alice',
          clientMessageId: cmid,
        });
        const b = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user2',
          senderName: 'Bob',
          content: 'from bob',
          clientMessageId: cmid,
        });
        expect(String(a._id)).not.toBe(String(b._id));
      });

      it('omitted clientMessageId never dedupes (each send inserts a row)', async () => {
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'a',
        });
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'a',
        });
        const count = await service.messagesCollection.countDocuments({
          conversationId: conversation._id,
        });
        expect(count).toBe(2);
      });
    });

    describe('deliveredTo + markAsDelivered', () => {
      it('populates deliveredTo with the sender on send', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        expect(Array.isArray(m.deliveredTo)).toBe(true);
        expect(m.deliveredTo.some(d => d.userId === 'user1')).toBe(true);
      });

      it('markAsDelivered adds a receipt for the recipient (but not the sender)', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        const res = await service.markAsDelivered(conversation._id.toString(), 'user2', [
          m._id.toString(),
        ]);
        expect(res.modifiedCount).toBe(1);

        const after = await service.messagesCollection.findOne({ _id: m._id });
        expect(after.deliveredTo.some(d => d.userId === 'user2')).toBe(true);
      });

      it('markAsDelivered is idempotent (second call does not re-push)', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        await service.markAsDelivered(conversation._id.toString(), 'user2', [m._id.toString()]);
        const second = await service.markAsDelivered(conversation._id.toString(), 'user2', [
          m._id.toString(),
        ]);
        expect(second.modifiedCount).toBe(0);

        const after = await service.messagesCollection.findOne({ _id: m._id });
        const receipts = after.deliveredTo.filter(d => d.userId === 'user2');
        expect(receipts).toHaveLength(1);
      });

      it('markAsDelivered never records the sender against their own message', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        const res = await service.markAsDelivered(conversation._id.toString(), 'user1', [
          m._id.toString(),
        ]);
        expect(res.modifiedCount).toBe(0);
      });

      it('markAsDelivered denies non-participants', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        await expect(
          service.markAsDelivered(conversation._id.toString(), 'user3', [m._id.toString()])
        ).rejects.toThrow(/not found|access denied/);
      });
    });

    describe('viewerStatus', () => {
      it('is "read" for the sender viewing their own message (self-read at send time)', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        // Sender's own message: status reflects recipient progress.
        // No recipient has delivered yet → 'sent'.
        const status = MessengerV4Service.computeViewerStatus(
          m,
          'user1',
          conversation.participants
        );
        expect(status).toBe('sent');
      });

      it("progresses sent → delivered → read from the sender's perspective", async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        expect(MessengerV4Service.computeViewerStatus(m, 'user1', conversation.participants)).toBe(
          'sent'
        );

        await service.markAsDelivered(conversation._id.toString(), 'user2', [m._id.toString()]);
        const afterDelivery = await service.messagesCollection.findOne({ _id: m._id });
        expect(
          MessengerV4Service.computeViewerStatus(afterDelivery, 'user1', conversation.participants)
        ).toBe('delivered');

        await service.markAsRead(conversation._id.toString(), 'user2');
        const afterRead = await service.messagesCollection.findOne({ _id: m._id });
        expect(
          MessengerV4Service.computeViewerStatus(afterRead, 'user1', conversation.participants)
        ).toBe('read');
      });

      it('reports "read" for the sender only when ALL recipients have read (group semantics)', async () => {
        // 'supplier_network' permits N participants and is not subject to the
        // direct-conversation 2-participant dedupe path.  True `group` type
        // ships in PR 3.
        const group = await service.createConversation({
          type: 'supplier_network',
          participants: [
            { userId: 'user1', displayName: 'Alice', role: 'customer' },
            { userId: 'user2', displayName: 'Bob', role: 'supplier' },
            { userId: 'user3', displayName: 'Charlie', role: 'customer' },
          ],
        });

        const m = await service.sendMessage(group._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'group hi',
        });

        // Only Bob read
        await service.markAsRead(group._id.toString(), 'user2');
        const mAfterPartialRead = await service.messagesCollection.findOne({ _id: m._id });
        expect(
          MessengerV4Service.computeViewerStatus(mAfterPartialRead, 'user1', group.participants)
        ).toBe('delivered');

        // Now Charlie also reads
        await service.markAsRead(group._id.toString(), 'user3');
        const mAllRead = await service.messagesCollection.findOne({ _id: m._id });
        expect(MessengerV4Service.computeViewerStatus(mAllRead, 'user1', group.participants)).toBe(
          'read'
        );
      });

      it('getMessages decorates each returned message with viewerStatus', async () => {
        const m = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hi',
        });
        const res = await service.getMessages(conversation._id.toString(), 'user2');
        const returned = res.messages.find(x => String(x._id) === String(m._id));
        expect(returned).toBeDefined();
        // As user2 has not read it yet, status is 'sent' (incoming, undelivered)
        expect(returned.viewerStatus).toBe('sent');
      });
    });

    describe('markAsRead with upToSeq', () => {
      it('only marks messages with seq <= upToSeq as read', async () => {
        const m1 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'one',
        });
        const m2 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'two',
        });
        const m3 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'three',
        });

        await service.markAsRead(conversation._id.toString(), 'user2', { upToSeq: m2.seq });

        const after1 = await service.messagesCollection.findOne({ _id: m1._id });
        const after2 = await service.messagesCollection.findOne({ _id: m2._id });
        const after3 = await service.messagesCollection.findOne({ _id: m3._id });
        expect(after1.readBy.some(r => r.userId === 'user2')).toBe(true);
        expect(after2.readBy.some(r => r.userId === 'user2')).toBe(true);
        expect(after3.readBy.some(r => r.userId === 'user2')).toBe(false);
      });

      it('bulk markAsRead (no upToSeq) still resets unreadCount to zero (backward compat)', async () => {
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'a',
        });
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'b',
        });
        await service.markAsRead(conversation._id.toString(), 'user2');
        const c = await service.getConversation(conversation._id.toString(), 'user2');
        const me = c.participants.find(p => p.userId === 'user2');
        expect(me.unreadCount).toBe(0);
      });
    });

    describe('sinceSeq catch-up', () => {
      it('returns messages forward in time with seq > sinceSeq', async () => {
        const m1 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'one',
        });
        const m2 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'two',
        });
        const m3 = await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'three',
        });

        const res = await service.getMessages(conversation._id.toString(), 'user2', {
          sinceSeq: m1.seq,
        });

        const ids = res.messages.map(x => String(x._id));
        expect(ids).toEqual([String(m2._id), String(m3._id)]);
        expect(res.nextSinceSeq).toBe(m3.seq);
        expect(res.hasMore).toBe(false);
      });

      it('with sinceSeq=0 returns all messages in ascending order', async () => {
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'one',
        });
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'two',
        });
        const res = await service.getMessages(conversation._id.toString(), 'user2', {
          sinceSeq: 0,
        });
        const seqs = res.messages.map(x => x.seq);
        expect(seqs).toEqual([1, 2]);
      });

      it('denies non-participants', async () => {
        await service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'secret',
        });
        await expect(
          service.getMessages(conversation._id.toString(), 'user3', { sinceSeq: 0 })
        ).rejects.toThrow(/not found|access denied/);
      });
    });
  });

  describe('blocking', () => {
    it('blockUser creates a block and is idempotent', async () => {
      const block = await service.blockUser('user1', 'user2', 'harassment');
      expect(block.userId).toBe('user1');
      expect(block.blockedUserId).toBe('user2');

      const again = await service.blockUser('user1', 'user2', 'harassment');
      expect(again.blockedUserId).toBe('user2');

      const all = await db.collection('blockedUsers').find({ userId: 'user1' }).toArray();
      expect(all).toHaveLength(1);
    });

    it('blockUser rejects blocking yourself', async () => {
      await expect(service.blockUser('user1', 'user1')).rejects.toThrow('Validation failed');
    });

    it('unblockUser removes a block and reports whether one existed', async () => {
      await service.blockUser('user1', 'user2');
      const removed = await service.unblockUser('user1', 'user2');
      expect(removed).toBe(true);

      const removedAgain = await service.unblockUser('user1', 'user2');
      expect(removedAgain).toBe(false);
    });

    it('getBlockedUsers returns hydrated display names', async () => {
      await service.blockUser('user1', 'user2', 'spam');
      const blocked = await service.getBlockedUsers('user1');
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toMatchObject({
        userId: 'user2',
        displayName: 'Bob Smith',
        reason: 'spam',
      });
    });

    it('isBlockedEitherWay is true regardless of which side blocked', async () => {
      await service.blockUser('user1', 'user2');
      expect(await service.isBlockedEitherWay('user1', 'user2')).toBe(true);
      expect(await service.isBlockedEitherWay('user2', 'user1')).toBe(true);
      expect(await service.isBlockedEitherWay('user1', 'user3')).toBe(false);
    });

    it('sendMessage rejects once the recipient has blocked the sender', async () => {
      const conversation = await service.createConversation({
        type: 'direct',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });
      await service.blockUser('user2', 'user1');

      await expect(
        service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hello?',
        })
      ).rejects.toThrow('block');
    });

    it('sendMessage rejects a blocked sender in a non-direct conversation too (regression: block bypass)', async () => {
      const conversation = await service.createConversation({
        type: 'marketplace',
        participants: [
          { userId: 'user1', displayName: 'Alice', role: 'customer' },
          { userId: 'user2', displayName: 'Bob', role: 'supplier' },
        ],
      });
      await service.blockUser('user2', 'user1');

      await expect(
        service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hello?',
        })
      ).rejects.toThrow('block');
    });

    it('createConversation rejects starting a new direct chat with a blocked user', async () => {
      await service.blockUser('user2', 'user1');

      await expect(
        service.createConversation({
          type: 'direct',
          creatorUserId: 'user1',
          participants: [
            { userId: 'user1', displayName: 'Alice', role: 'customer' },
            { userId: 'user2', displayName: 'Bob', role: 'supplier' },
          ],
        })
      ).rejects.toThrow('block');
    });

    it('createConversation rejects a non-direct conversation with a blocked user too (regression: block bypass)', async () => {
      await service.blockUser('user2', 'user1');

      await expect(
        service.createConversation({
          type: 'marketplace',
          creatorUserId: 'user1',
          participants: [
            { userId: 'user1', displayName: 'Alice', role: 'customer' },
            { userId: 'user2', displayName: 'Bob', role: 'supplier' },
          ],
        })
      ).rejects.toThrow('block');
    });
  });

  describe('hard-delete lockout (regression: message ops silently succeed then WS emit throws)', () => {
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

    async function hardDeleteFor(userId) {
      const idx = conversation.participants.findIndex(p => p.userId === userId);
      await db
        .collection('conversations_v4')
        .updateOne(
          { _id: conversation._id },
          { $set: { [`participants.${idx}.isDeleted`]: true } }
        );
    }

    it('sendMessage rejects once the sender has hard-deleted the conversation for themselves', async () => {
      await hardDeleteFor('user1');

      await expect(
        service.sendMessage(conversation._id.toString(), {
          senderId: 'user1',
          senderName: 'Alice',
          content: 'hello again?',
        })
      ).rejects.toThrow('not a participant');
    });

    it('editMessage rejects once the author has hard-deleted the conversation for themselves', async () => {
      await hardDeleteFor('user1');

      await expect(service.editMessage(message._id.toString(), 'user1', 'edited')).rejects.toThrow(
        'access denied'
      );
    });

    it('deleteMessage rejects once the author has hard-deleted the conversation for themselves', async () => {
      await hardDeleteFor('user1');

      await expect(service.deleteMessage(message._id.toString(), 'user1')).rejects.toThrow(
        'access denied'
      );
    });

    it('toggleReaction rejects once the reactor has hard-deleted the conversation for themselves', async () => {
      await hardDeleteFor('user2');

      await expect(
        service.toggleReaction(message._id.toString(), 'user2', 'Bob', '👍')
      ).rejects.toThrow('access denied');
    });

    it('notification fan-out excludes a recipient who hard-deleted the conversation', async () => {
      await hardDeleteFor('user2');

      const sent = await service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'are you still there?',
      });

      expect(sent.notificationFanout.recipientIds).not.toContain('user2');
    });
  });
});

const describeReplicaSet = process.env.MONGO_REPLICA_SET === 'true' ? describe : describe.skip;

describeReplicaSet('transaction rollback (replica-set mode)', () => {
  let mongoClient;
  let db;

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eventflow?replicaSet=rs0';
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    db = mongoClient.db(`eventflow_messenger_v4_txn_${process.pid}_${Date.now()}`);
    await db.dropDatabase();
  });

  afterEach(async () => {
    if (db) {
      await db.dropDatabase();
    }
  });

  afterAll(async () => {
    if (db) {
      await db.dropDatabase();
    }
    if (mongoClient) {
      await mongoClient.close();
    }
  });

  it('rolls back message insert when failure occurs after insert', async () => {
    const service = new MessengerV4Service(db, console);
    const conversation = await service.createConversation({
      type: 'direct',
      participants: [
        { userId: 'user1', displayName: 'Alice', role: 'customer' },
        { userId: 'user2', displayName: 'Bob', role: 'supplier' },
      ],
    });

    await expect(
      service.sendMessage(conversation._id.toString(), {
        senderId: 'user1',
        senderName: 'Alice',
        content: 'hello',
        __simulateFailureAfterInsert: true,
      })
    ).rejects.toThrow('Simulated failure after insert');

    const messages = await service.messagesCollection
      .find({ conversationId: conversation._id })
      .toArray();
    expect(messages).toHaveLength(0);

    const conversationAfterRollback = await service.conversationsCollection.findOne({
      _id: conversation._id,
    });
    expect(conversationAfterRollback.messageCount).toBe(0);
    expect(conversationAfterRollback.lastMessage).toBeNull();
  });
});

describe('Messenger v4 polish edge cases', () => {
  let db;
  let service;

  beforeEach(async () => {
    db = createInMemoryDb();
    service = new MessengerV4Service(db, console);
    await db.collection('users').insertMany([
      { id: 'free1', firstName: 'Free', subscriptionTier: 'free' },
      { id: 'free2', firstName: 'Recipient', subscriptionTier: 'free' },
      { id: 'free3', firstName: 'Third', subscriptionTier: 'free' },
      { id: 'pro1', firstName: 'Pro', subscriptionTier: 'pro' },
      { id: 'plus1', firstName: 'Plus', subscriptionTier: 'pro_plus' },
      { id: 'legacy1', firstName: 'Legacy', subscriptionTier: 'premium' },
    ]);
  });

  const participants = (a = 'free1', b = 'free2') => [
    { userId: a, displayName: a, role: 'customer' },
    { userId: b, displayName: b, role: 'customer' },
  ];

  it('normalises participant IDs and rejects duplicates after trim', async () => {
    await expect(
      service.createConversation({
        type: 'direct',
        creatorUserId: 'free1',
        participants: [
          { userId: 'free2', displayName: 'A', role: 'customer' },
          { userId: ' free2 ', displayName: 'A', role: 'customer' },
        ],
      })
    ).rejects.toThrow(/Duplicate participant IDs/);
  });

  it('rejects blank and self-only participants after normalisation', async () => {
    await expect(
      service.createConversation({
        type: 'direct',
        creatorUserId: 'free1',
        participants: [{ userId: ' ', displayName: 'Blank', role: 'customer' }],
      })
    ).rejects.toThrow(/Validation failed/);
    await expect(
      service.createConversation({
        type: 'direct',
        creatorUserId: 'free1',
        participants: [{ userId: ' free1 ', displayName: 'Self', role: 'customer' }],
      })
    ).rejects.toThrow(/at least one other participant/);
  });

  it('allows existing direct and context conversation reuse at the thread limit', async () => {
    const direct = await service.createConversation({
      type: 'direct',
      creatorUserId: 'free1',
      participants: participants(),
    });
    const context = await service.createConversation({
      type: 'marketplace',
      creatorUserId: 'free1',
      participants: participants('free1', 'free3'),
      context: { type: 'marketplace_listing', referenceId: 'listing-1' },
    });
    await service.createConversation({
      type: 'enquiry',
      creatorUserId: 'free1',
      participants: participants('free1', 'pro1'),
      context: { type: 'package', referenceId: 'pkg-1' },
    });

    await expect(
      service.createConversation({
        type: 'direct',
        creatorUserId: 'free1',
        participants: participants().reverse(),
      })
    ).resolves.toMatchObject({ _id: direct._id });
    await expect(
      service.createConversation({
        type: 'marketplace',
        creatorUserId: 'free1',
        participants: participants('free1', 'free3'),
        context: { type: 'marketplace_listing', referenceId: 'listing-1' },
      })
    ).resolves.toMatchObject({ _id: context._id });
  });

  it('blocks genuinely new conversations at the configured free-tier thread limit and counts only creator metadata', async () => {
    const previousFreeThreadLimit = process.env.MESSAGING_FREE_THREADS_PER_DAY;
    process.env.MESSAGING_FREE_THREADS_PER_DAY = '3';

    try {
      await service.createConversation({
        type: 'direct',
        creatorUserId: 'free2',
        participants: participants('free2', 'free1'),
      });
      expect((await service.checkThreadRateLimit('free1')).allowed).toBe(true);

      await service.createConversation({
        type: 'enquiry',
        creatorUserId: 'free1',
        participants: participants('free1', 'free2'),
        context: { type: 'package', referenceId: 'a' },
        metadata: { createdByUserId: 'free2' },
      });
      await service.createConversation({
        type: 'enquiry',
        creatorUserId: 'free1',
        participants: participants('free1', 'free3'),
        context: { type: 'package', referenceId: 'b' },
      });
      await service.createConversation({
        type: 'enquiry',
        creatorUserId: 'free1',
        participants: participants('free1', 'pro1'),
        context: { type: 'package', referenceId: 'c' },
      });
      const check = await service.checkThreadRateLimit('free1');
      expect(check.allowed).toBe(false);
      await expect(
        service.createConversation({
          type: 'enquiry',
          creatorUserId: 'free1',
          participants: participants('free1', 'plus1'),
          context: { type: 'package', referenceId: 'd' },
        })
      ).rejects.toMatchObject({ statusCode: 429, code: 'THREAD_LIMIT_EXCEEDED' });
    } finally {
      if (previousFreeThreadLimit === undefined) {
        delete process.env.MESSAGING_FREE_THREADS_PER_DAY;
      } else {
        process.env.MESSAGING_FREE_THREADS_PER_DAY = previousFreeThreadLimit;
      }
    }
  });

  it('markUnread is idempotent and markRead clears unreadCount', async () => {
    const conv = await service.createConversation({
      type: 'direct',
      creatorUserId: 'free1',
      participants: participants(),
    });
    await service.updateConversation(conv._id.toString(), 'free1', { markUnread: true });
    const twice = await service.updateConversation(conv._id.toString(), 'free1', {
      markUnread: true,
    });
    expect(twice.participants.find(p => p.userId === 'free1').unreadCount).toBe(1);
    const read = await service.updateConversation(conv._id.toString(), 'free1', { markRead: true });
    expect(read.participants.find(p => p.userId === 'free1').unreadCount).toBe(0);
  });

  it('enforces maxMessageLength by tier after sanitising content', async () => {
    const conv = await service.createConversation({
      type: 'direct',
      creatorUserId: 'free1',
      participants: participants('free1', 'pro1'),
    });
    await expect(
      service.sendMessage(conv._id.toString(), {
        senderId: 'free1',
        senderName: 'Free',
        content: 'x'.repeat(501),
      })
    ).rejects.toMatchObject({ statusCode: 413, code: 'MESSAGE_TOO_LONG' });
    await expect(
      service.sendMessage(conv._id.toString(), {
        senderId: 'pro1',
        senderName: 'Pro',
        content: 'x'.repeat(501),
      })
    ).resolves.toBeDefined();
    await expect(
      service.sendMessage(conv._id.toString(), {
        senderId: 'legacy1',
        senderName: 'Legacy',
        content: 'x'.repeat(501),
      })
    ).rejects.toThrow(/not a participant|not found/);
    const legacyConv = await service.createConversation({
      type: 'direct',
      creatorUserId: 'legacy1',
      participants: participants('legacy1', 'free2'),
    });
    await expect(
      service.sendMessage(legacyConv._id.toString(), {
        senderId: 'legacy1',
        senderName: 'Legacy',
        content: 'x'.repeat(501),
      })
    ).rejects.toMatchObject({ statusCode: 413 });
  });
});

const fs = require('fs');
const path = require('path');

describe('Messenger v4 frontend polish static assertions', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('keeps final-loaded polish CSS date separators compact and non-sticky', () => {
    const css = read('public/messenger/css/messenger-v4-polish.css');
    const dateSeparatorBlock = css.match(/\.messenger-v4__date-separator\s*{[^}]*}/s)?.[0] || '';
    expect(dateSeparatorBlock).toMatch(/margin:\s*10px 0;/);
    expect(dateSeparatorBlock).not.toMatch(/margin:\s*(2[0-9]|[3-9][0-9])px 0;/);
    expect(dateSeparatorBlock).not.toMatch(/position:\s*sticky/);
    expect(dateSeparatorBlock).not.toMatch(/top:\s*8px/);
  });

  it('renders the new conversation control as a labelled compose button', () => {
    const js = read('public/messenger/js/ConversationListV4.js');
    const css = read('public/messenger/css/messenger-v4-polish.css');
    expect(js).toContain('aria-label="New conversation"');
    expect(js).toContain('title="New conversation"');
    expect(js).toContain('focusable="false"');
    expect(js).toContain('M4 20h4.4L18.7 9.7');
    expect(css).toMatch(/\.messenger-v4__new-convo-btn svg\s*{[^}]*stroke-width:\s*2\.4;/s);
    expect(css).toMatch(
      /\.messenger-v4__new-convo-btn\.ef-cta\s*{[^}]*border-radius:\s*10px\s*!important;/s
    );
    expect(css).not.toMatch(
      /\.messenger-v4__action-button\.ef-cta,\s*\.messenger-v4__new-convo-btn\.ef-cta,/s
    );
  });

  it('has CSS selectors for ContextBannerV4 rendered classes', () => {
    const js = read('public/messenger/js/ContextBannerV4.js');
    const css = read('public/messenger/css/messenger-v4-polish.css');
    const classes = [
      'messenger-v4__context-banner',
      'messenger-v4__context-banner-icon',
      'messenger-v4__context-banner-title',
      'messenger-v4__context-banner-subtitle',
      'messenger-v4__context-banner-text',
      'messenger-v4__context-banner-link',
      'messenger-v4__context-banner-thumb',
    ];
    classes.forEach(cls => {
      expect(js).toContain(cls);
      expect(css).toContain(`.${cls}`);
    });
  });

  it('preserves MessengerAPI and route error metadata plus composer inline handling', () => {
    const api = read('public/messenger/js/MessengerAPI.js');
    const route = read('routes/messenger-v4.js');
    const composer = read('public/messenger/js/MessageComposerV4.js');
    expect(api).toContain('apiError.status = response.status');
    expect(api).toContain('apiError.retryAfter');
    expect(api).toContain('apiError.code');
    expect(route).toContain('code: error.code');
    expect(route).toContain('maxMessageLength: error.maxMessageLength');
    expect(composer).toContain('err?.status === 429');
    expect(composer).toContain('MESSAGE_TOO_LONG');
    expect(composer).toContain('Network error');
  });

  it('does not link chat headers to participant user ids as supplier ids', () => {
    const chatView = read('public/messenger/js/ChatViewV4.js');
    expect(chatView).not.toContain('encodeURIComponent(other.userId)');
    expect(chatView).not.toContain('/supplier?id=');
    expect(chatView).toContain("profileLink.removeAttribute('href')");
    expect(chatView).toContain("profileLink.setAttribute('aria-label', 'Conversation header')");
  });
});
