/**
 * PUT /api/profile, as the settings page uses it: the phone number rule, and the fact that this
 * route does not change an email address (so the page shows the address read-only).
 */

'use strict';

const express = require('express');
const request = require('supertest');

function buildApp(user) {
  jest.resetModules();
  const db = {
    users: [user],
    findOne: jest.fn(async (_collection, filter) => (filter.id === user.id ? { ...user } : null)),
    updateOne: jest.fn(async () => true),
  };
  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
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
  jest.doMock('../../services/catalogCache', () => ({ invalidate: jest.fn(async () => {}) }));
  jest.doMock('../../middleware/searchCache', () => ({
    clearSearchCache: jest.fn(async () => {}),
  }));
  jest.doMock('../../db-unified', () => db);
  const app = express();
  app.use(express.json());
  app.use('/api/profile', require('../../routes/profile'));
  return { app, db };
}

const customer = { id: 'user_1', email: 'sam@example.com', role: 'customer', firstName: 'Sam' };

describe('the phone number', () => {
  test.each([
    ['07700 900123', '07700900123'],
    ['+44 7700 900123', '+447700900123'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['+44-7700-900123', '+447700900123'],
    ['07700900123', '07700900123'],
  ])('%s is accepted, and kept as %s', async (typed, kept) => {
    const { app, db } = buildApp(customer);
    await request(app).put('/api/profile').send({ phone: typed }).expect(200);
    const [, , update] = db.updateOne.mock.calls[0];
    expect(update.$set.phone).toBe(kept);
  });

  test.each(['abc', '12', '++447700900123'])('%s is refused', async typed => {
    const { app, db } = buildApp(customer);
    const res = await request(app).put('/api/profile').send({ phone: typed }).expect(400);
    expect(res.body.error).toBe('Invalid phone number format');
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  test('an empty number clears it', async () => {
    const { app, db } = buildApp(customer);
    await request(app).put('/api/profile').send({ phone: '  ' }).expect(200);
    expect(db.updateOne.mock.calls[0][2].$set.phone).toBeNull();
  });
});

describe('the email address', () => {
  test('is not something this route changes: a posted email is ignored', async () => {
    const { app, db } = buildApp(customer);
    const res = await request(app)
      .put('/api/profile')
      .send({ firstName: 'Samuel', email: 'someone-else@example.com' })
      .expect(200);
    expect(db.updateOne.mock.calls[0][2].$set).not.toHaveProperty('email');
    expect(res.body.profile.email).toBe('sam@example.com');
  });
});
