'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const {
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

  test('accepts a secure link, records the open and sets an HttpOnly attribution cookie', async () => {
    const db = createMemoryDb({
      reviewRequests: [
        {
          id: 'request-1',
          supplierId: 'supplier-1',
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
    expect(response.headers.location).toBe('/supplier?id=supplier-1&reviewRequest=ready#reviews');
    expect(response.headers['set-cookie'][0]).toContain(`ef_review_request=${rawToken}`);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(db.collections.reviewRequests[0].status).toBe('opened');
  });

  test('binds completion to the invited email and records the created review', async () => {
    const db = createMemoryDb({
      users: [{ id: 'customer-user', email: 'customer@example.com' }],
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
});
