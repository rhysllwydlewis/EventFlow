/**
 * Self-service account deletion (DELETE /api/profile) must:
 *   - cancel any live Stripe subscription first — otherwise a paying
 *     supplier who deletes their account keeps being billed indefinitely
 *     with no dashboard or Billing Portal link left to stop it.
 *   - go through the same cascade the admin "delete user" flow uses, so it
 *     doesn't orphan supplier-owned data (packages, photos, reviews,
 *     threads, messages, listings) or leave a stale newsletter subscription
 *     / notifications behind — previously it only deleted the supplier row
 *     and the user record, leaving everything else dangling.
 */
'use strict';

const express = require('express');
const request = require('supertest');

function matches(row, filter = {}) {
  return Object.keys(filter).every(key => {
    if (key === '$or' && Array.isArray(filter.$or)) {
      return filter.$or.some(orFilter => matches(row, orFilter));
    }
    const expected = filter[key];
    const actual = row[key];
    if (expected && typeof expected === 'object' && Array.isArray(expected.$in)) {
      return expected.$in.includes(actual);
    }
    return actual === expected;
  });
}

function buildDb(seed = {}) {
  const data = {
    users: [],
    suppliers: [],
    packages: [],
    photos: [],
    supplierAnalytics: [],
    reviewRequests: [],
    public_calendar_events: [],
    marketplace_listings: [],
    savedItems: [],
    shortlists: [],
    quoteRequests: [],
    enquiries: [],
    threads: [],
    messages: [],
    bookings: [],
    reviews: [],
    plans: [],
    newsletterSubscribers: [],
    notifications: [],
    settings: {},
    ...seed,
  };
  return {
    data,
    read: jest.fn(async collection => data[collection] || []),
    find: jest.fn(async (collection, filter) =>
      (data[collection] || []).filter(row => matches(row, filter))
    ),
    findOne: jest.fn(
      async (collection, filter) =>
        (data[collection] || []).find(row => matches(row, filter)) || null
    ),
    deleteMany: jest.fn(async (collection, filter) => {
      const rows = data[collection] || [];
      const kept = rows.filter(row => !matches(row, filter));
      const removed = rows.length - kept.length;
      data[collection] = kept;
      return removed;
    }),
    updateMany: jest.fn(async (collection, filter, update) => {
      let changed = 0;
      for (const row of data[collection] || []) {
        if (matches(row, filter)) {
          Object.assign(row, update.$set || update);
          changed += 1;
        }
      }
      return changed;
    }),
    deleteOne: jest.fn(async (collection, filter) => {
      const rows = data[collection] || [];
      const realFilter = typeof filter === 'string' ? { id: filter } : filter;
      const index = rows.findIndex(row => matches(row, realFilter));
      if (index === -1) {
        return false;
      }
      rows.splice(index, 1);
      return true;
    }),
  };
}

function buildApp({ db, cancelSubscriptionForAccountDeletion }) {
  jest.resetModules();

  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
      const user = db.data.users[0];
      req.user = { id: user.id, email: user.email, role: user.role };
      next();
    },
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  jest.doMock('../../middleware/rateLimits', () => ({
    writeLimiter: (_req, _res, next) => next(),
    uploadLimiter: (_req, _res, next) => next(),
    apiLimiter: (_req, _res, next) => next(),
  }));
  jest.doMock('../../services/subscriptionService', () => ({
    cancelSubscriptionForAccountDeletion,
  }));
  jest.doMock('../../services/partnerService', () => ({
    softDeletePartnerByUserId: jest.fn(async () => true),
  }));
  jest.doMock('../../services/catalogCache', () => ({
    invalidate: jest.fn(async () => undefined),
  }));
  jest.doMock('../../cache', () => ({ delPattern: jest.fn(async () => undefined) }));
  jest.doMock('../../middleware/searchCache', () => ({
    clearSearchCache: jest.fn(async () => undefined),
  }));
  jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
  jest.doMock('../../db-unified', () => db);

  const profileRoutes = require('../../routes/profile');
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  return app;
}

describe('DELETE /api/profile — self-service account deletion', () => {
  test('cancels the Stripe subscription before deleting the user record', async () => {
    const cancelSubscriptionForAccountDeletion = jest.fn(async () => {});
    const db = buildDb({
      users: [{ id: 'user_1', email: 'supplier@example.com', role: 'supplier' }],
    });
    const app = buildApp({ db, cancelSubscriptionForAccountDeletion });

    await request(app).delete('/api/profile').send({ email: 'supplier@example.com' }).expect(200);

    expect(cancelSubscriptionForAccountDeletion).toHaveBeenCalledWith('user_1');
    expect(db.data.users).toHaveLength(0);
  });

  test('still deletes the account even if Stripe cancellation fails', async () => {
    const cancelSubscriptionForAccountDeletion = jest.fn(async () => {
      throw new Error('Stripe unreachable');
    });
    const db = buildDb({
      users: [{ id: 'user_1', email: 'supplier@example.com', role: 'supplier' }],
    });
    const app = buildApp({ db, cancelSubscriptionForAccountDeletion });

    const res = await request(app)
      .delete('/api/profile')
      .send({ email: 'supplier@example.com' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(db.data.users).toHaveLength(0);
  });

  test('cleans up supplier-owned data instead of orphaning it', async () => {
    const db = buildDb({
      users: [{ id: 'user_1', email: 'supplier@example.com', role: 'supplier' }],
      suppliers: [{ id: 'sup_1', ownerUserId: 'user_1', approved: true }],
      packages: [{ id: 'pkg_1', supplierId: 'sup_1' }],
      photos: [{ id: 'photo_1', supplierId: 'sup_1' }],
      marketplace_listings: [{ id: 'listing_1', supplierId: 'sup_1' }],
      reviews: [{ id: 'rev_1', supplierId: 'sup_1' }],
    });
    const app = buildApp({
      db,
      cancelSubscriptionForAccountDeletion: jest.fn(async () => {}),
    });

    await request(app).delete('/api/profile').send({ email: 'supplier@example.com' }).expect(200);

    expect(db.data.suppliers).toHaveLength(0);
    expect(db.data.packages).toHaveLength(0);
    expect(db.data.photos).toHaveLength(0);
    expect(db.data.marketplace_listings).toHaveLength(0);
    // Reviews are anonymised (supplierId cleared), not hard-deleted.
    expect(db.data.reviews[0]).toMatchObject({ supplierDeleted: true, supplierId: null });
  });

  test('removes the newsletter subscription and notifications for the deleted account', async () => {
    const db = buildDb({
      users: [{ id: 'user_1', email: 'customer@example.com', role: 'customer' }],
      newsletterSubscribers: [{ id: 'sub_1', email: 'customer@example.com', status: 'active' }],
      notifications: [{ id: 'notif_1', userId: 'user_1' }],
    });
    const app = buildApp({
      db,
      cancelSubscriptionForAccountDeletion: jest.fn(async () => {}),
    });

    await request(app).delete('/api/profile').send({ email: 'customer@example.com' }).expect(200);

    expect(db.data.newsletterSubscribers).toHaveLength(0);
    expect(db.data.notifications).toHaveLength(0);
  });

  test('anonymises the customer-owned records left under their own id, not just supplier-owned ones', async () => {
    const db = buildDb({
      users: [{ id: 'user_1', email: 'customer@example.com', role: 'customer' }],
      quoteRequests: [
        {
          id: 'qr_1',
          userId: 'user_1',
          name: 'Jane Doe',
          email: 'customer@example.com',
          phone: '01234567890',
          notes: 'Need a DJ',
        },
      ],
      enquiries: [
        {
          id: 'enq_1',
          supplierId: 'sup_other',
          senderName: 'Jane Doe',
          senderEmail: 'customer@example.com',
          message: 'Are you available?',
        },
      ],
      threads: [{ id: 'thr_1', customerId: 'user_1', recipientId: 'sup_other' }],
      messages: [
        { id: 'msg_1', threadId: 'thr_1', senderId: 'user_1', content: 'Hi there' },
        { id: 'msg_2', threadId: 'thr_1', fromUserId: 'user_1', text: 'Legacy field message' },
      ],
      bookings: [{ id: 'bk_1', customerId: 'user_1', supplierId: 'sup_other' }],
      reviews: [{ id: 'rev_1', authorId: 'user_1', supplierId: 'sup_other', text: 'Great!' }],
      plans: [{ id: 'pln_1', userId: 'user_1' }],
    });
    const app = buildApp({
      db,
      cancelSubscriptionForAccountDeletion: jest.fn(async () => {}),
    });

    await request(app).delete('/api/profile').send({ email: 'customer@example.com' }).expect(200);

    expect(db.data.quoteRequests[0]).toMatchObject({
      customerDeleted: true,
      userId: null,
      name: null,
      email: null,
      phone: null,
      notes: null,
    });
    expect(db.data.enquiries[0]).toMatchObject({
      customerDeleted: true,
      senderName: null,
      senderEmail: null,
      message: null,
    });
    expect(db.data.threads[0]).toMatchObject({ customerDeleted: true, customerId: null });
    expect(db.data.messages[0]).toMatchObject({
      customerDeleted: true,
      senderId: null,
      content: null,
    });
    expect(db.data.messages[1]).toMatchObject({
      customerDeleted: true,
      fromUserId: null,
      text: null,
    });
    expect(db.data.bookings[0]).toMatchObject({ customerDeleted: true, customerId: null });
    expect(db.data.reviews[0]).toMatchObject({ customerDeleted: true, authorId: null });
    // Plans are solely owned by the customer, so they're hard-deleted rather
    // than anonymised.
    expect(db.data.plans).toHaveLength(0);
  });

  test('matches enquiries by the same normalised email routes/contact.js stores, not a plain lowercase', async () => {
    // routes/contact.js stores senderEmail through validator.normalizeEmail(),
    // which rewrites Gmail dots/+subaddresses — a customer signed up with
    // "j.smith+wedding@gmail.com" but their contact-form enquiry is stored
    // as "jsmith@gmail.com". A plain lowercase/trim match would never find it.
    const db = buildDb({
      users: [{ id: 'user_1', email: 'j.smith+wedding@gmail.com', role: 'customer' }],
      enquiries: [
        {
          id: 'enq_1',
          supplierId: 'sup_other',
          senderName: 'J Smith',
          senderEmail: 'jsmith@gmail.com',
          message: 'Are you available?',
        },
      ],
    });
    const app = buildApp({
      db,
      cancelSubscriptionForAccountDeletion: jest.fn(async () => {}),
    });

    await request(app)
      .delete('/api/profile')
      .send({ email: 'j.smith+wedding@gmail.com' })
      .expect(200);

    expect(db.data.enquiries[0]).toMatchObject({
      customerDeleted: true,
      senderName: null,
      senderEmail: null,
      message: null,
    });
  });

  test('rejects deletion when the confirmation email does not match', async () => {
    const db = buildDb({
      users: [{ id: 'user_1', email: 'customer@example.com', role: 'customer' }],
    });
    const app = buildApp({
      db,
      cancelSubscriptionForAccountDeletion: jest.fn(async () => {}),
    });

    await request(app).delete('/api/profile').send({ email: 'wrong@example.com' }).expect(400);

    expect(db.data.users).toHaveLength(1);
  });
});
