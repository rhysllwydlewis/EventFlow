/**
 * Regression tests for the createConversation block-bypass fix in
 * services/messenger-v4-lifecycle-patch.js.
 *
 * This file's patched createConversation() fully replaces the base
 * MessengerV4Service.prototype.createConversation (it is required, and its
 * patch applied, before routes/messenger-v4 is mounted — see
 * routes/index.js) so it is the version that actually runs in production.
 * Before this fix it never checked isBlockedEitherWay() for any
 * conversation type, letting a blocked user create (and, via sendMessage,
 * message into) a 'marketplace'/'enquiry'/'supplier_network'/'support'
 * conversation with the person who blocked them.
 */

'use strict';

const { ObjectId } = require('mongodb');

// Minimal in-memory Mongo-compatible double. Only supports what
// createConversation's block check and (for the "not blocked" path) its
// dedupe lookup actually need: plain equality, $or/$and/$nor. The dedupe
// lookup's $elemMatch/$expr clauses are exercised elsewhere (messenger-v4
// unit tests use a fuller double); here every test starts from an empty
// conversations_v4 collection, so an imprecise dedupe match still correctly
// returns "no existing conversation" and falls through to insertOne().
function createMinimalDb() {
  const store = {};

  function getCol(name) {
    if (!store[name]) {
      store[name] = [];
    }
    return store[name];
  }

  function matches(doc, query) {
    if (!query) {
      return true;
    }
    return Object.entries(query).every(([key, value]) => {
      if (key === '$or') {
        return value.some(q => matches(doc, q));
      }
      if (key === '$and') {
        return value.every(q => matches(doc, q));
      }
      if (key === '$nor') {
        return !value.some(q => matches(doc, q));
      }
      return doc[key] === value;
    });
  }

  function collection(name) {
    return {
      async findOne(query) {
        return getCol(name).find(doc => matches(doc, query)) || null;
      },
      async insertOne(doc) {
        const newDoc = { _id: doc._id || new ObjectId(), ...doc };
        getCol(name).push(newDoc);
        return { insertedId: newDoc._id, acknowledged: true };
      },
      find() {
        return { toArray: async () => [] };
      },
      async countDocuments(query) {
        return getCol(name).filter(doc => matches(doc, query || {})).length;
      },
    };
  }

  return { collection };
}

describe('messenger-v4-lifecycle-patch: createConversation block check (block-bypass regression)', () => {
  let MessengerV4Service;
  let service;
  let db;

  beforeAll(() => {
    // Apply the patch once for this isolated test file's module registry.
    require('../../services/messenger-v4-lifecycle-patch');
    MessengerV4Service = require('../../services/messenger-v4.service');
  });

  beforeEach(() => {
    db = createMinimalDb();
    service = new MessengerV4Service(db, { info: () => {}, warn: () => {}, error: () => {} });
  });

  it('rejects creating a marketplace conversation between blocked users (block bypass)', async () => {
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

  it('rejects creating an enquiry/supplier_network/support conversation between blocked users', async () => {
    await service.blockUser('user1', 'user2');

    for (const type of ['enquiry', 'supplier_network', 'support']) {
      await expect(
        service.createConversation({
          type,
          creatorUserId: 'user2',
          participants: [
            { userId: 'user2', displayName: 'Bob', role: 'supplier' },
            { userId: 'user1', displayName: 'Alice', role: 'customer' },
          ],
        })
      ).rejects.toThrow('block');
    }
  });

  it('still rejects a direct conversation between blocked users', async () => {
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

  it('allows creating a non-direct conversation when neither user has blocked the other', async () => {
    const conversation = await service.createConversation({
      type: 'marketplace',
      creatorUserId: 'user1',
      participants: [
        { userId: 'user1', displayName: 'Alice', role: 'customer' },
        { userId: 'user2', displayName: 'Bob', role: 'supplier' },
      ],
    });

    expect(conversation).toBeTruthy();
    expect(conversation.type).toBe('marketplace');
    expect(conversation.participants.map(p => p.userId).sort()).toEqual(['user1', 'user2']);
  });
});
