'use strict';

/**
 * The supplier avatar diagnostic is an admin tool. It used to rely on "is this production" to
 * keep other people out, so on a test or preview server any logged-in customer or supplier could
 * use it. It must refuse everyone except an admin, on every server.
 */

const express = require('express');
const request = require('supertest');

function buildApp({ user, withAuth = true } = {}) {
  jest.resetModules();
  const router = require('../../routes/public-supplier-avatar');
  const dbUnified = {
    findOne: jest.fn().mockResolvedValue({ id: 'sup-1', name: 'Supplier One' }),
  };
  router.initializeDependencies({
    dbUnified,
    logger: { error: jest.fn() },
    authRequired: withAuth
      ? (req, res, next) => {
          if (!user) {
            return res.status(401).json({ error: 'Unauthenticated' });
          }
          req.user = user;
          return next();
        }
      : undefined,
  });
  const app = express();
  app.use('/api', router);
  return app;
}

describe('GET /api/admin/suppliers/:id/public-avatar-diagnostic', () => {
  const url = '/api/admin/suppliers/sup-1/public-avatar-diagnostic';
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test.each(['test', 'development', 'production'])(
    'refuses a logged-out visitor when NODE_ENV is %s',
    async env => {
      process.env.NODE_ENV = env;
      const res = await request(buildApp({ user: null })).get(url);
      expect(res.status).toBe(401);
    }
  );

  test.each(['test', 'development', 'production'])(
    'refuses a customer and a supplier when NODE_ENV is %s',
    async env => {
      process.env.NODE_ENV = env;
      for (const role of ['customer', 'supplier']) {
        const res = await request(buildApp({ user: { id: 'u1', role } })).get(url);
        expect(res.status).toBe(403);
      }
    }
  );

  test('answers an admin', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(buildApp({ user: { id: 'a1', role: 'admin' } })).get(url);
    expect(res.status).toBe(200);
    expect(res.body.supplierId).toBe('sup-1');
  });

  test('fails closed if the login check was never wired in', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(buildApp({ withAuth: false })).get(url);
    expect(res.status).toBe(401);
  });
});
