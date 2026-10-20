'use strict';

/**
 * Names and pictures in the messenger inbox must belong to the right accounts.
 * GET /api/v4/messenger/conversations hydrates every participant from the live
 * user record (and, for suppliers, the business profile photo), not from the
 * snapshot taken when the conversation was created.
 */

jest.mock('../../services/queue', () => ({
  enqueueNotificationJob: jest.fn(),
  setQueueContext: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const MessengerV4Service = require('../../services/messenger-v4.service');

/**
 * Minimal Mongo-like database: collections hold rows and support find().toArray()
 * with an `$in` filter on one field.
 *
 * @param {Object} data - Rows by collection name
 * @param {Object} [options] - { failSuppliers }
 * @returns {Object} db double
 */
function makeDb(data, options = {}) {
  return {
    collection(name) {
      return {
        find(filter) {
          return {
            async toArray() {
              if (name === 'suppliers' && options.failSuppliers) {
                throw new Error('suppliers unavailable');
              }
              const [field, condition] = Object.entries(filter)[0] || [];
              const rows = data[name] || [];
              return condition && condition.$in
                ? rows.filter(row => condition.$in.includes(row[field]))
                : rows;
            },
          };
        },
      };
    },
  };
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const USERS = [
  {
    id: 'cust-1',
    role: 'customer',
    firstName: 'Alice',
    lastName: 'Customer',
    avatarUrl: '/u/alice.png',
  },
  {
    id: 'sup-user',
    role: 'supplier',
    firstName: 'Sam',
    lastName: 'Owner',
    avatarUrl: '/u/sam.png',
  },
  { id: 'sup-user-2', role: 'supplier', firstName: 'Pat', lastName: 'Photo' },
  { id: 'cust-2', role: 'customer', name: 'Bob' },
];

const SUPPLIERS = [
  {
    ownerUserId: 'sup-user',
    name: 'Moor Audio',
    profilePhotoUrl: 'https://img.example/moor-logo.png',
  },
  { ownerUserId: 'sup-user-2', name: 'Pat Photography', logo: 'https://img.example/pat-logo.png' },
];

/**
 * Build a conversation document.
 *
 * @param {Object[]} participants - Stored (possibly stale) participants
 * @param {Object} [extra] - Extra fields
 * @returns {Object} conversation
 */
function conversation(participants, extra = {}) {
  return { _id: 'c1', participants, status: 'active', messageCount: 1, ...extra };
}

describe('messenger participant identity', () => {
  it('shows each participant their own current name and picture, not a stored snapshot', async () => {
    const service = new MessengerV4Service(makeDb({ users: USERS, suppliers: SUPPLIERS }), logger);

    const result = await service._hydrateConversationParticipants(
      conversation([
        { userId: 'cust-1', displayName: 'old stale name', avatar: '/stale.png', role: 'customer' },
        { userId: 'cust-2', displayName: 'stale', avatar: null, role: 'customer' },
      ])
    );

    expect(result.participants[0]).toMatchObject({
      userId: 'cust-1',
      displayName: 'Alice Customer',
      avatar: '/u/alice.png',
    });
    expect(result.participants[1]).toMatchObject({
      userId: 'cust-2',
      displayName: 'Bob',
      avatar: null,
    });
  });

  it('never gives one participant another account name or picture', async () => {
    const service = new MessengerV4Service(makeDb({ users: USERS, suppliers: SUPPLIERS }), logger);

    const result = await service._hydrateConversationParticipants(
      conversation([
        { userId: 'sup-user', displayName: 'x', role: 'supplier' },
        { userId: 'cust-1', displayName: 'y', role: 'customer' },
      ])
    );

    const [supplier, customer] = result.participants;
    expect(supplier.displayName).toBe('Sam Owner');
    expect(customer.displayName).toBe('Alice Customer');
    expect(customer.avatar).toBe('/u/alice.png');
    expect(customer.avatar).not.toBe(supplier.avatar);
  });

  it("uses the supplier's business profile photo and exposes the trading name", async () => {
    const service = new MessengerV4Service(makeDb({ users: USERS, suppliers: SUPPLIERS }), logger);

    const result = await service._hydrateConversationParticipants(
      conversation([
        { userId: 'sup-user', role: 'supplier' },
        { userId: 'sup-user-2', role: 'supplier' },
        { userId: 'cust-1', role: 'customer' },
      ])
    );

    if (process.env.SUPPLIER_CONTRACT_DUMP_DIR) {
      fs.writeFileSync(
        path.join(
          process.env.SUPPLIER_CONTRACT_DUMP_DIR,
          'messenger-conversation-participants.json'
        ),
        `${JSON.stringify(result, null, 2)}\n`
      );
    }
    // Business photo wins over the personal account avatar...
    expect(result.participants[0]).toMatchObject({
      displayName: 'Sam Owner',
      businessName: 'Moor Audio',
      avatar: 'https://img.example/moor-logo.png',
    });
    // ...and a supplier with no account avatar still gets their logo, not a blank.
    expect(result.participants[1]).toMatchObject({
      businessName: 'Pat Photography',
      avatar: 'https://img.example/pat-logo.png',
    });
    // Customers get no business fields.
    expect(result.participants[2]).not.toHaveProperty('businessName');
  });

  it('falls back to the account avatar when the supplier lookup fails, without breaking the inbox', async () => {
    const service = new MessengerV4Service(
      makeDb({ users: USERS, suppliers: SUPPLIERS }, { failSuppliers: true }),
      logger
    );

    const result = await service._hydrateConversationParticipants(
      conversation([{ userId: 'sup-user', role: 'supplier' }])
    );

    expect(result.participants[0]).toMatchObject({
      displayName: 'Sam Owner',
      avatar: '/u/sam.png',
    });
  });

  it('keeps the stored values for an account that no longer exists rather than inventing one', async () => {
    const service = new MessengerV4Service(makeDb({ users: USERS, suppliers: SUPPLIERS }), logger);

    const result = await service._hydrateConversationParticipants(
      conversation([
        {
          userId: 'deleted-user',
          displayName: 'Former user',
          avatar: '/old.png',
          role: 'customer',
        },
      ])
    );

    expect(result.participants[0]).toMatchObject({
      displayName: 'Former user',
      avatar: '/old.png',
    });
  });

  it('shows the last message sender by their current name', async () => {
    const service = new MessengerV4Service(makeDb({ users: USERS, suppliers: SUPPLIERS }), logger);

    const result = await service._hydrateConversationParticipants(
      conversation(
        [
          { userId: 'cust-1', role: 'customer' },
          { userId: 'sup-user', role: 'supplier' },
        ],
        { lastMessage: { content: 'hi', senderId: 'cust-1', senderName: 'old name', sentAt: 'x' } }
      )
    );

    expect(result.lastMessage).toMatchObject({ content: 'hi', senderName: 'Alice Customer' });
  });

  it('leaves unread counts and per-person flags untouched', async () => {
    const service = new MessengerV4Service(makeDb({ users: USERS, suppliers: SUPPLIERS }), logger);

    const result = await service._hydrateConversationParticipants(
      conversation([{ userId: 'sup-user', role: 'supplier', unreadCount: 3, isMuted: true }])
    );

    expect(result.participants[0]).toMatchObject({ unreadCount: 3, isMuted: true });
  });
});
