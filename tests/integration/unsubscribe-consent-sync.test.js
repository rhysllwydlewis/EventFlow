/**
 * Regression coverage: unsubscribing via one consent store (account
 * marketing preference vs. newsletter subscription) must sync the matching
 * record in the other store for the same email address. Previously each
 * unsubscribe endpoint only touched its own collection, so a user could
 * believe they'd opted out while still being eligible for campaign sends
 * sourced from the other store.
 */

'use strict';

const express = require('express');
const request = require('supertest');

function noOp(_req, _res, next) {
  next();
}

describe('GET /api/auth/unsubscribe syncs the newsletter subscription', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../middleware/rateLimits', () => ({
      authLimiter: noOp,
      resendEmailLimiter: noOp,
      strictAuthLimiter: noOp,
      passwordResetLimiter: noOp,
      registrationLimiter: noOp,
      tokenLinkLimiter: noOp,
      writeLimiter: noOp,
    }));
    jest.doMock('../../middleware/features', () => ({
      featureRequired: () => noOp,
      getFeatureFlags: jest.fn(async () => ({})),
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: noOp }));
  });

  afterEach(() => {
    jest.dontMock('../../middleware/rateLimits');
    jest.dontMock('../../middleware/features');
    jest.dontMock('../../middleware/csrf');
    jest.dontMock('../../utils/postmark');
    jest.dontMock('../../db-unified');
  });

  it('flips the matching newsletterSubscribers row to unsubscribed', async () => {
    const updateCalls = [];
    jest.doMock('../../utils/postmark', () => ({
      verifyUnsubscribeToken: jest.fn(() => true),
    }));
    jest.doMock('../../db-unified', () => ({
      findOne: jest.fn(async (collection, query) => {
        if (collection === 'users' && query.email === 'dual@example.com') {
          return { id: 'u1', email: 'dual@example.com' };
        }
        return null;
      }),
      updateOne: jest.fn(async (collection, query, update) => {
        updateCalls.push({ collection, query, update });
        return true;
      }),
    }));

    const authRoutes = require('../../routes/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    await request(app)
      .get('/api/auth/unsubscribe')
      .query({ email: 'dual@example.com', token: 'valid-token' })
      .expect(200);

    const newsletterUpdate = updateCalls.find(c => c.collection === 'newsletterSubscribers');
    expect(newsletterUpdate).toBeDefined();
    expect(newsletterUpdate.query).toEqual({ email: 'dual@example.com' });
    expect(newsletterUpdate.update.$set.status).toBe('unsubscribed');

    const usersUpdate = updateCalls.find(c => c.collection === 'users');
    expect(usersUpdate.update.$set.notify_marketing).toBe(false);
  });

  it('still returns success even if the newsletter sync write fails', async () => {
    jest.doMock('../../utils/postmark', () => ({
      verifyUnsubscribeToken: jest.fn(() => true),
    }));
    jest.doMock('../../db-unified', () => ({
      findOne: jest.fn(async () => ({ id: 'u1', email: 'dual@example.com' })),
      updateOne: jest.fn(async collection => {
        if (collection === 'newsletterSubscribers') {
          throw new Error('db unavailable');
        }
        return true;
      }),
    }));

    const authRoutes = require('../../routes/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    const res = await request(app)
      .get('/api/auth/unsubscribe')
      .query({ email: 'dual@example.com', token: 'valid-token' })
      .expect(200);

    expect(res.body.ok).toBe(true);
  });

  it('POST (the RFC 8058 one-click List-Unsubscribe-Post target) performs the same unsubscribe with no CSRF token required', async () => {
    // Gmail/Yahoo's one-click unsubscribe button POSTs directly to the
    // List-Unsubscribe header's URL with no user interaction and no CSRF
    // token — this must work identically to the GET link, guarded only by
    // the token in the query string.
    const updateCalls = [];
    jest.doMock('../../utils/postmark', () => ({
      verifyUnsubscribeToken: jest.fn(() => true),
    }));
    jest.doMock('../../db-unified', () => ({
      findOne: jest.fn(async (collection, query) => {
        if (collection === 'users' && query.email === 'oneclick@example.com') {
          return { id: 'u2', email: 'oneclick@example.com' };
        }
        return null;
      }),
      updateOne: jest.fn(async (collection, query, update) => {
        updateCalls.push({ collection, query, update });
        return true;
      }),
    }));

    const authRoutes = require('../../routes/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    const res = await request(app)
      .post('/api/auth/unsubscribe')
      .query({ email: 'oneclick@example.com', token: 'valid-token' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const usersUpdate = updateCalls.find(c => c.collection === 'users');
    expect(usersUpdate.update.$set.notify_marketing).toBe(false);
  });
});

describe('POST /api/newsletter/unsubscribe syncs account marketing consent', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.resetModules();
  });

  it('flips the matching account to notify_marketing=false', async () => {
    jest.resetModules();
    const updateCalls = [];
    jest.doMock('../../db-unified', () => ({
      read: jest.fn(async collection => {
        if (collection === 'newsletterSubscribers') {
          return [{ id: 'sub1', email: 'dual@example.com', status: 'active' }];
        }
        return [];
      }),
      updateOne: jest.fn(async (collection, query, update) => {
        updateCalls.push({ collection, query, update });
        return true;
      }),
    }));

    const newsletterRoutes = require('../../routes/newsletter');
    const app = express();
    app.use(express.json());
    app.use('/api/newsletter', newsletterRoutes);

    await request(app)
      .post('/api/newsletter/unsubscribe')
      .send({ email: 'dual@example.com' })
      .expect(200);

    const usersUpdate = updateCalls.find(c => c.collection === 'users');
    expect(usersUpdate).toBeDefined();
    expect(usersUpdate.query).toEqual({ email: 'dual@example.com' });
    expect(usersUpdate.update.$set.notify_marketing).toBe(false);
    expect(usersUpdate.update.$set.marketingOptIn).toBe(false);
  });
});
