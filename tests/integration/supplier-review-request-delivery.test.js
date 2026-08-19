'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { addPublicProfilePath } = require('../../utils/publicSupplierProfilePath');
const {
  createActiveRequestId,
  createReviewRequestRouter,
  hashToken,
  normalizeDisplayName,
} = require('../../routes/review-requests');

function createMemoryDb(seed = {}) {
  const collections = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))])
  );

  function rows(name) {
    if (!collections[name]) {
      collections[name] = [];
    }
    return collections[name];
  }

  function matches(row, query) {
    return Object.entries(query).every(([key, value]) => row[key] === value);
  }

  return {
    collections,
    async find(name, query) {
      return rows(name).filter(row => matches(row, query));
    },
    async findOne(name, query) {
      return rows(name).find(row => matches(row, query)) || null;
    },
    async insertOne(name, document) {
      if (document.id && rows(name).some(row => row.id === document.id)) {
        return null;
      }
      rows(name).push({ ...document });
      return document;
    },
    async updateOne(name, query, update) {
      const row = rows(name).find(item => matches(item, query));
      if (row && update.$set) {
        Object.assign(row, update.$set);
      }
      return { matchedCount: row ? 1 : 0, modifiedCount: row ? 1 : 0 };
    },
  };
}

function noOpMiddleware(req, res, next) {
  next();
}

function buildApp({ db, sendMail, user, now, createToken }) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    createReviewRequestRouter({
      db,
      sendMail,
      now,
      createToken,
      getBaseUrl: () => 'https://event-flow.co.uk',
      authRequired(req, res, next) {
        req.user = typeof user === 'function' ? user(req) : user;
        next();
      },
      csrfProtection: noOpMiddleware,
      writeLimiter: noOpMiddleware,
      fromAddress: 'hello@event-flow.co.uk',
    })
  );
  return app;
}

describe('supplier review-request delivery', () => {
  const fixedNow = new Date('2026-07-16T09:00:00.000Z');
  const rawToken = 'a'.repeat(64);

  test('sanitizes supplier names before using them in email headers', () => {
    expect(normalizeDisplayName('  Moor Audio\r\nBcc: attacker@example.com  ')).toBe(
      'Moor Audio Bcc: attacker@example.com'
    );
  });

  test('sends a real templated email and stores only the token hash', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [],
    });
    const sendMail = jest.fn().mockResolvedValue({
      provider: 'postmark',
      PostmarkMessageID: 'pm-123',
      emailLogId: 'elog-1',
      sentAt: fixedNow.toISOString(),
    });
    const app = buildApp({
      db,
      sendMail,
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
      createToken: () => rawToken,
    });

    const response = await request(app)
      .post('/api/v1/supplier/request-review')
      .send({ customerEmail: 'Customer@Example.com', customerName: 'Alex' });

    expect(response.status).toBe(200);
    expect(response.body.request.status).toBe('sent');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        template: 'review-request',
        criticalDelivery: true,
        messageStream: 'outbound',
        templateData: expect.objectContaining({
          supplierName: 'Moor Audio',
          reviewLink: `https://event-flow.co.uk/review-request?token=${rawToken}`,
        }),
      })
    );

    const stored = db.collections.reviewRequests[0];
    expect(stored.tokenHash).toBe(hashToken(rawToken));
    expect(JSON.stringify(stored)).not.toContain(rawToken);
    expect(stored.status).toBe('sent');
    expect(stored.id).toBe(createActiveRequestId('supplier-1', 'customer@example.com'));
    expect(stored.providerMessageId).toBe('pm-123');
  });

  test('returns a truthful failure and records failed delivery when Postmark rejects', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [],
    });
    const app = buildApp({
      db,
      sendMail: jest.fn().mockRejectedValue(new Error('Postmark unavailable')),
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
      createToken: () => rawToken,
    });

    const response = await request(app)
      .post('/api/v1/supplier/request-review')
      .send({ customerEmail: 'customer@example.com' });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/could not be delivered/i);
    expect(db.collections.reviewRequests[0].status).toBe('failed');
    expect(db.collections.reviewRequests[0].id).not.toMatch(/^rreq_active_/);
    expect(db.collections.reviewRequests[0].lastError).toContain('Postmark unavailable');
  });

  test('blocks a duplicate active request', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [
        {
          id: 'existing',
          supplierId: 'supplier-1',
          customerEmail: 'customer@example.com',
          status: 'sent',
          createdAt: fixedNow.toISOString(),
          expiresAt: '2026-07-20T09:00:00.000Z',
        },
      ],
    });
    const sendMail = jest.fn();
    const app = buildApp({
      db,
      sendMail,
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
      createToken: () => rawToken,
    });

    const response = await request(app)
      .post('/api/v1/supplier/request-review')
      .send({ customerEmail: 'customer@example.com' });

    expect(response.status).toBe(409);
    expect(response.body.status).toBe('sent');
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('atomically reserves concurrent invitations so only one email is sent', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [],
    });
    const originalFind = db.find.bind(db);
    let lookupCount = 0;
    let releaseLookups;
    const bothLookupsStarted = new Promise(resolve => {
      releaseLookups = resolve;
    });
    db.find = async (name, query) => {
      if (name === 'reviewRequests' && query.customerEmail === 'customer@example.com') {
        lookupCount += 1;
        if (lookupCount === 2) {
          releaseLookups();
        }
        await bothLookupsStarted;
      }
      return originalFind(name, query);
    };

    const sendMail = jest.fn().mockResolvedValue({
      provider: 'postmark',
      PostmarkMessageID: 'pm-concurrent',
      sentAt: fixedNow.toISOString(),
    });
    const app = buildApp({
      db,
      sendMail,
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
      createToken: () => rawToken,
    });

    const responses = await Promise.all([
      request(app)
        .post('/api/v1/supplier/request-review')
        .send({ customerEmail: 'customer@example.com' }),
      request(app)
        .post('/api/v1/supplier/request-review')
        .send({ customerEmail: 'customer@example.com' }),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(db.collections.reviewRequests).toHaveLength(1);
    expect(db.collections.reviewRequests[0].status).toBe('sent');
  });

  test('blocks another invitation during the existing 30-day review cooldown', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [
        {
          id: 'completed-recently',
          supplierId: 'supplier-1',
          customerEmail: 'customer@example.com',
          status: 'completed',
          createdAt: '2026-07-01T09:00:00.000Z',
          completedAt: '2026-07-01T09:30:00.000Z',
        },
      ],
    });
    const sendMail = jest.fn();
    const app = buildApp({
      db,
      sendMail,
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
      createToken: () => rawToken,
    });

    const response = await request(app)
      .post('/api/v1/supplier/request-review')
      .send({ customerEmail: 'customer@example.com' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/last 30 days/i);
    expect(response.body.retryAt).toBe('2026-07-31T09:30:00.000Z');
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('allows a new invitation after the 30-day review cooldown', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [
        {
          id: 'completed-long-ago',
          supplierId: 'supplier-1',
          customerEmail: 'customer@example.com',
          status: 'completed',
          createdAt: '2026-05-01T09:00:00.000Z',
          completedAt: '2026-05-01T09:30:00.000Z',
        },
      ],
    });
    const sendMail = jest.fn().mockResolvedValue({
      provider: 'postmark',
      PostmarkMessageID: 'pm-older-customer',
      sentAt: fixedNow.toISOString(),
    });
    const app = buildApp({
      db,
      sendMail,
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
      createToken: () => rawToken,
    });

    const response = await request(app)
      .post('/api/v1/supplier/request-review')
      .send({ customerEmail: 'customer@example.com' });

    expect(response.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(db.collections.reviewRequests).toHaveLength(2);
    expect(db.collections.reviewRequests[1].status).toBe('sent');
  });

  test('accepts a secure link, records the open and sets an HttpOnly attribution cookie', async () => {
    const db = createMemoryDb({
      reviewRequests: [
        {
          id: createActiveRequestId('supplier-1', 'customer@example.com'),
          supplierId: 'supplier-1',
          supplierName: 'Moor Audio',
          customerEmail: 'customer@example.com',
          tokenHash: hashToken(rawToken),
          status: 'sent',
          createdAt: fixedNow.toISOString(),
          expiresAt: '2026-07-20T09:00:00.000Z',
        },
      ],
    });
    const app = buildApp({ db, sendMail: jest.fn(), user: null, now: () => fixedNow });

    const response = await request(app).get(`/review-request?token=${rawToken}`);

    expect(response.status).toBe(302);
    const publicProfilePath = addPublicProfilePath({
      id: 'supplier-1',
      name: 'Moor Audio',
    }).publicProfilePath;
    expect(response.headers.location).toBe(
      `${publicProfilePath}?reviewRequest=ready#sp-section-reviews`
    );
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['set-cookie'][0]).toContain(`ef_review_request=${rawToken}`);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(db.collections.reviewRequests[0].status).toBe('opened');
    expect(db.collections.reviewRequests[0].id).toMatch(/^rreq_active_/);
  });

  test.each([
    ['completed', 'completed'],
    ['failed', 'unavailable'],
    ['expired', 'expired'],
    ['cancelled', 'unavailable'],
  ])('redirects a request in %s state to its canonical supplier outcome', async (status, outcome) => {
    const db = createMemoryDb({
      reviewRequests: [
        {
          id: 'request-outcome',
          supplierId: 'supplier-1',
          supplierName: 'Moor Audio',
          customerEmail: 'customer@example.com',
          tokenHash: hashToken(rawToken),
          status,
          createdAt: fixedNow.toISOString(),
          expiresAt: '2026-07-20T09:00:00.000Z',
        },
      ],
    });
    const app = buildApp({ db, sendMail: jest.fn(), user: null, now: () => fixedNow });

    const response = await request(app).get(`/review-request?token=${rawToken}`);
    const publicProfilePath = addPublicProfilePath({
      id: 'supplier-1',
      name: 'Moor Audio',
    }).publicProfilePath;

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      `${publicProfilePath}?reviewRequest=${outcome}#sp-section-reviews`
    );
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('binds completion to the invited email and records the created review', async () => {
    const db = createMemoryDb({
      users: [{ id: 'customer-user', email: 'customer@example.com' }],
      reviewRequests: [
        {
          id: createActiveRequestId('supplier-1', 'customer@example.com'),
          supplierId: 'supplier-1',
          customerEmail: 'customer@example.com',
          tokenHash: hashToken(rawToken),
          status: 'opened',
          createdAt: fixedNow.toISOString(),
          expiresAt: '2026-07-20T09:00:00.000Z',
        },
      ],
    });
    const app = buildApp({
      db,
      sendMail: jest.fn(),
      user: { id: 'customer-user', role: 'customer' },
      now: () => fixedNow,
    });
    app.post('/api/v1/suppliers/:supplierId/reviews', (req, res) => {
      res.json({ success: true, review: { id: 'review-123' } });
    });

    const response = await request(app)
      .post('/api/v1/suppliers/supplier-1/reviews')
      .set('Cookie', `ef_review_request=${rawToken}`)
      .send({ rating: 5, comment: 'Excellent service and communication.' });

    expect(response.status).toBe(200);
    await new Promise(resolve => setImmediate(resolve));
    expect(db.collections.reviewRequests[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        completedByUserId: 'customer-user',
        reviewId: 'review-123',
        id: expect.not.stringMatching(/^rreq_active_/),
      })
    );
    expect(response.headers['set-cookie'][0]).toContain('ef_review_request=;');
  });

  test('refuses attribution when signed in with a different email address', async () => {
    const db = createMemoryDb({
      users: [{ id: 'other-user', email: 'other@example.com' }],
      reviewRequests: [
        {
          id: 'request-1',
          supplierId: 'supplier-1',
          customerEmail: 'customer@example.com',
          tokenHash: hashToken(rawToken),
          status: 'opened',
          createdAt: fixedNow.toISOString(),
          expiresAt: '2026-07-20T09:00:00.000Z',
        },
      ],
    });
    const app = buildApp({
      db,
      sendMail: jest.fn(),
      user: { id: 'other-user', role: 'customer' },
      now: () => fixedNow,
    });
    app.post('/api/v1/suppliers/:supplierId/reviews', (req, res) => {
      res.json({ success: true, review: { id: 'should-not-run' } });
    });

    const response = await request(app)
      .post('/api/v1/suppliers/supplier-1/reviews')
      .set('Cookie', `ef_review_request=${rawToken}`)
      .send({ rating: 5, comment: 'Excellent service and communication.' });

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/email address that received/i);
    expect(db.collections.reviewRequests[0].status).toBe('opened');
  });

  test('returns supplier-safe review request history with effective expiry and retry state', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [
        {
          id: 'active-request',
          supplierId: 'supplier-1',
          customerEmail: 'active@example.com',
          customerName: 'Active Customer',
          tokenHash: 'secret-token-hash',
          providerMessageId: 'provider-secret',
          emailLogId: 'email-log-secret',
          status: 'sent',
          deliveryStatus: 'delivered',
          createdAt: '2026-07-15T09:00:00.000Z',
          expiresAt: '2026-07-20T09:00:00.000Z',
        },
        {
          id: 'expired-request',
          supplierId: 'supplier-1',
          customerEmail: 'expired@example.com',
          status: 'sent',
          createdAt: '2026-06-01T09:00:00.000Z',
          expiresAt: '2026-06-15T09:00:00.000Z',
        },
        {
          id: 'other-supplier-request',
          supplierId: 'supplier-2',
          customerEmail: 'other@example.com',
          status: 'failed',
          createdAt: '2026-07-16T08:00:00.000Z',
        },
      ],
    });
    const app = buildApp({
      db,
      sendMail: jest.fn(),
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
    });

    const response = await request(app).get('/api/v1/supplier/review-requests?limit=50');

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual(
      expect.objectContaining({ total: 2, active: 1, expired: 1, deliveryIssues: 1 })
    );
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        customerEmail: 'active@example.com',
        status: 'sent',
        retryable: false,
      })
    );
    expect(response.body.items[1]).toEqual(
      expect.objectContaining({
        customerEmail: 'expired@example.com',
        status: 'expired',
        retryable: true,
      })
    );
    expect(JSON.stringify(response.body)).not.toContain('secret-token-hash');
    expect(JSON.stringify(response.body)).not.toContain('provider-secret');
    expect(JSON.stringify(response.body)).not.toContain('email-log-secret');
    expect(JSON.stringify(response.body)).not.toContain('other@example.com');
  });

  test('redacts provider delivery errors from supplier history', async () => {
    const db = createMemoryDb({
      suppliers: [{ id: 'supplier-1', ownerUserId: 'supplier-user', name: 'Moor Audio' }],
      reviewRequests: [
        {
          id: 'failed-request',
          supplierId: 'supplier-1',
          customerEmail: 'customer@example.com',
          status: 'failed',
          lastError: 'Postmark server token rejected: internal diagnostic',
          createdAt: fixedNow.toISOString(),
        },
      ],
    });
    const app = buildApp({
      db,
      sendMail: jest.fn(),
      user: { id: 'supplier-user', role: 'supplier' },
      now: () => fixedNow,
    });

    const response = await request(app).get('/api/v1/supplier/review-requests');

    expect(response.status).toBe(200);
    expect(response.body.items[0].lastError).toMatch(/safely retry/i);
    expect(JSON.stringify(response.body)).not.toContain('internal diagnostic');
  });
});
