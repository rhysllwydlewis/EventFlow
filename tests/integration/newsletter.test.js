/**
 * Integration tests for the newsletter subscribe/confirm/unsubscribe flow.
 * routes/newsletter.js previously had zero automated coverage despite
 * handling public, unauthenticated input and a double opt-in flow — mirrors
 * the depth of tests/integration/email-verification.test.js.
 */

'use strict';

const request = require('supertest');
const express = require('express');

let mockCollections;

jest.mock('../../db-unified', () => ({
  read: jest.fn(async name => [...(mockCollections[name] || [])]),
  insertOne: jest.fn(async (name, doc) => {
    mockCollections[name] = mockCollections[name] || [];
    mockCollections[name].push(doc);
    return doc;
  }),
  updateOne: jest.fn(async (name, filter, updates) => {
    const rows = mockCollections[name] || [];
    const key = typeof filter === 'string' ? 'id' : Object.keys(filter)[0];
    const value = typeof filter === 'string' ? filter : filter[key];
    const row = rows.find(item => item[key] === value);
    if (!row) {
      return false;
    }
    Object.assign(row, updates.$set || updates);
    return true;
  }),
}));

jest.mock('../../utils/postmark', () => ({
  sendMail: jest.fn().mockResolvedValue({ MessageID: 'test-message-id' }),
  FROM_INFO: 'info@event-flow.co.uk',
}));

// The route's own 5-requests-per-hour limiter is exercised separately below;
// mocking it out here keeps every other test's request count independent of
// how many /subscribe calls preceded it in the file.
jest.mock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()));

describe('Newsletter Integration Tests', () => {
  let app;
  let postmark;

  beforeAll(() => {
    process.env.APP_BASE_URL = 'http://localhost:3000';
    app = express();
    app.use(express.json());
    app.use('/api/newsletter', require('../../routes/newsletter'));
    postmark = require('../../utils/postmark');
  });

  afterAll(() => {
    delete process.env.APP_BASE_URL;
  });

  beforeEach(() => {
    mockCollections = { newsletterSubscribers: [], users: [] };
    jest.clearAllMocks();
    postmark.sendMail.mockResolvedValue({ MessageID: 'test-message-id' });
  });

  describe('POST /subscribe', () => {
    it('rejects an invalid email address', async () => {
      const res = await request(app)
        .post('/api/newsletter/subscribe')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid email/i);
      expect(postmark.sendMail).not.toHaveBeenCalled();
    });

    it('creates a pending-confirmation subscriber and sends the confirmation email', async () => {
      const res = await request(app)
        .post('/api/newsletter/subscribe')
        .send({ email: 'new@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockCollections.newsletterSubscribers).toHaveLength(1);
      expect(mockCollections.newsletterSubscribers[0]).toMatchObject({
        email: 'new@example.com',
        status: 'pending-confirmation',
      });
      expect(postmark.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@example.com',
          template: 'newsletter-confirm',
        })
      );
    });

    it('double-subscribing the same pending email updates the one record instead of creating a duplicate', async () => {
      await request(app).post('/api/newsletter/subscribe').send({ email: 'twice@example.com' });
      const firstToken = mockCollections.newsletterSubscribers[0].confirmToken;

      await request(app).post('/api/newsletter/subscribe').send({ email: 'twice@example.com' });

      expect(mockCollections.newsletterSubscribers).toHaveLength(1);
      expect(mockCollections.newsletterSubscribers[0].confirmToken).not.toBe(firstToken);
      expect(postmark.sendMail).toHaveBeenCalledTimes(2);
    });

    it('an already-active subscriber gets a friendly message and no re-send', async () => {
      mockCollections.newsletterSubscribers.push({
        id: 'sub-1',
        email: 'active@example.com',
        status: 'active',
      });

      const res = await request(app)
        .post('/api/newsletter/subscribe')
        .send({ email: 'active@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already subscribed/i);
      expect(postmark.sendMail).not.toHaveBeenCalled();
    });

    it('returns 500 without leaving a false "success" when the confirmation email fails to send', async () => {
      postmark.sendMail.mockRejectedValueOnce(new Error('Postmark down'));

      const res = await request(app)
        .post('/api/newsletter/subscribe')
        .send({ email: 'fails@example.com' });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/failed to send/i);
    });
  });

  describe('GET /confirm', () => {
    async function seedPending(email = 'confirm-me@example.com') {
      const res = await request(app).post('/api/newsletter/subscribe').send({ email });
      void res;
      return mockCollections.newsletterSubscribers[0];
    }

    it('activates the subscription for a valid token and sends a welcome email', async () => {
      const subscriber = await seedPending();

      const res = await request(app).get(
        `/api/newsletter/confirm?token=${subscriber.confirmToken}`
      );

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/newsletter/confirmed');
      expect(mockCollections.newsletterSubscribers[0].status).toBe('active');
      expect(mockCollections.newsletterSubscribers[0].confirmToken).toBeNull();
      expect(postmark.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'newsletter-welcome' })
      );
    });

    it('redirects to expired for a missing token', async () => {
      const res = await request(app).get('/api/newsletter/confirm');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/newsletter/expired');
    });

    it('redirects to expired for an unknown token', async () => {
      const res = await request(app).get('/api/newsletter/confirm?token=does-not-exist');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/newsletter/expired');
    });

    it('redirects to expired once the token has passed its 24h expiry', async () => {
      const subscriber = await seedPending('expired@example.com');
      mockCollections.newsletterSubscribers[0].confirmTokenExpiry = new Date(
        Date.now() - 1000
      ).toISOString();

      const res = await request(app).get(
        `/api/newsletter/confirm?token=${subscriber.confirmToken}`
      );

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/newsletter/expired');
    });

    it('confirming an already-active subscription redirects to confirmed without a duplicate welcome email', async () => {
      const subscriber = await seedPending('already-active@example.com');
      await request(app).get(`/api/newsletter/confirm?token=${subscriber.confirmToken}`);
      jest.clearAllMocks();

      // Re-confirming with the (now cleared) token no longer matches any
      // subscriber, so simulate the already-active branch directly via the
      // record's current state instead — same as hitting the link twice
      // before the token is cleared client-side.
      mockCollections.newsletterSubscribers[0].confirmToken = 'reused-token';
      mockCollections.newsletterSubscribers[0].confirmTokenExpiry = new Date(
        Date.now() + 60_000
      ).toISOString();
      const res = await request(app).get('/api/newsletter/confirm?token=reused-token');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/newsletter/confirmed');
      expect(postmark.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('POST /unsubscribe', () => {
    it('rejects an invalid email address', async () => {
      const res = await request(app)
        .post('/api/newsletter/unsubscribe')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    it('marks a known subscriber unsubscribed and syncs account-level marketing consent', async () => {
      mockCollections.newsletterSubscribers.push({
        id: 'sub-2',
        email: 'bye@example.com',
        status: 'active',
      });
      mockCollections.users.push({
        id: 'user-1',
        email: 'bye@example.com',
        notify_marketing: true,
        marketingOptIn: true,
      });

      const res = await request(app)
        .post('/api/newsletter/unsubscribe')
        .send({ email: 'bye@example.com' });

      expect(res.status).toBe(200);
      expect(mockCollections.newsletterSubscribers[0].status).toBe('unsubscribed');
      expect(mockCollections.users[0].notify_marketing).toBe(false);
      expect(mockCollections.users[0].marketingOptIn).toBe(false);
    });

    it('an unknown email is treated as a harmless no-op', async () => {
      const res = await request(app)
        .post('/api/newsletter/unsubscribe')
        .send({ email: 'unknown@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

describe('Newsletter subscribe rate limiting (real express-rate-limit)', () => {
  it('blocks the 6th subscribe attempt from the same IP within the hour', async () => {
    let rateLimitedApp;
    jest.isolateModules(() => {
      jest.doMock('../../db-unified', () => ({
        read: jest.fn(async () => []),
        insertOne: jest.fn(async (_name, doc) => doc),
        updateOne: jest.fn(async () => true),
      }));
      jest.doMock('../../utils/postmark', () => ({
        sendMail: jest.fn().mockResolvedValue({ MessageID: 'test-message-id' }),
        FROM_INFO: 'info@event-flow.co.uk',
      }));
      jest.dontMock('express-rate-limit');
      rateLimitedApp = express();
      rateLimitedApp.use(express.json());
      rateLimitedApp.use('/api/newsletter', require('../../routes/newsletter'));
    });

    for (let i = 0; i < 5; i++) {
      const res = await request(rateLimitedApp)
        .post('/api/newsletter/subscribe')
        .send({ email: `limit-${i}@example.com` });
      expect(res.status).toBe(200);
    }

    const blocked = await request(rateLimitedApp)
      .post('/api/newsletter/subscribe')
      .send({ email: 'limit-6@example.com' });

    expect(blocked.status).toBe(429);
  });
});
