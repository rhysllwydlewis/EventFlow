/**
 * Deleting an account must cancel any live Stripe subscription first —
 * otherwise a paying supplier who deletes their account keeps being billed
 * indefinitely with no dashboard or Billing Portal link left to stop it.
 */
'use strict';

const express = require('express');
const request = require('supertest');

function buildApp({ user, cancelSubscriptionForAccountDeletion }) {
  jest.resetModules();

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
  jest.doMock('../../services/subscriptionService', () => ({
    cancelSubscriptionForAccountDeletion,
  }));
  jest.doMock('../../services/partnerService', () => ({
    softDeletePartnerByUserId: jest.fn(async () => true),
  }));
  jest.doMock('../../services/catalogCache', () => ({
    invalidate: jest.fn(async () => undefined),
  }));
  jest.doMock('../../middleware/searchCache', () => ({
    clearSearchCache: jest.fn(async () => undefined),
  }));

  const dbUnified = require('../../db-unified');
  jest.spyOn(dbUnified, 'findOne').mockImplementation(async (collection, query) => {
    if (collection === 'users' && query.id === user.id) {
      return user;
    }
    return null;
  });
  jest.spyOn(dbUnified, 'find').mockImplementation(async () => []);
  jest.spyOn(dbUnified, 'deleteOne').mockImplementation(async () => true);

  const profileRoutes = require('../../routes/profile');
  const app = express();
  app.use(express.json());
  app.use('/api/profile', profileRoutes);
  return app;
}

describe('DELETE /api/profile — Stripe cancellation on account deletion', () => {
  test('cancels the Stripe subscription before deleting the user record', async () => {
    const cancelSubscriptionForAccountDeletion = jest.fn(async () => {});
    const user = { id: 'user_1', email: 'supplier@example.com', role: 'supplier' };
    const app = buildApp({ user, cancelSubscriptionForAccountDeletion });

    await request(app).delete('/api/profile').send({ email: user.email }).expect(200);

    expect(cancelSubscriptionForAccountDeletion).toHaveBeenCalledWith('user_1');
  });

  test('still deletes the account even if Stripe cancellation fails', async () => {
    const cancelSubscriptionForAccountDeletion = jest.fn(async () => {
      throw new Error('Stripe unreachable');
    });
    const user = { id: 'user_1', email: 'supplier@example.com', role: 'supplier' };
    const app = buildApp({ user, cancelSubscriptionForAccountDeletion });

    const res = await request(app).delete('/api/profile').send({ email: user.email }).expect(200);

    expect(res.body.ok).toBe(true);
    expect(cancelSubscriptionForAccountDeletion).toHaveBeenCalledWith('user_1');
  });
});
