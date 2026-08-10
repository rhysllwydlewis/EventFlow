/**
 * Regression test for POST /api/me/subscription/upgrade.
 *
 * This endpoint used to unconditionally set isPro=true / subscriptionTier='pro'
 * on the caller's user and supplier records with no payment verification at
 * all — any authenticated supplier could call it directly (it is also fired
 * automatically by the dashboard whenever ?billing=success appears in the
 * URL) and grant themselves Pro for free. It must now only ever mirror
 * whatever subscriptionService says is actually true for the caller.
 *
 * @jest-environment node
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/catalogCache', () => ({
  invalidate: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/subscriptionService', () => ({
  refreshUserEntitlements: jest.fn(),
}));

function createApp(userId) {
  jest.resetModules();
  const router = require('../../routes/supplier-management');
  const subscriptionService = require('../../services/subscriptionService');
  const dbUnified = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    updateOne: jest.fn(async () => true),
  };
  const pass = (_req, _res, next) => next();
  const authRequired = (req, _res, next) => {
    req.user = { id: userId, role: 'supplier' };
    next();
  };
  router.initializeDependencies({
    dbUnified,
    authRequired,
    roleRequired: () => pass,
    requireVerifiedUser: pass,
    csrfProtection: pass,
    writeLimiter: pass,
    uid: prefix => `${prefix}_test`,
    geocoding: { isValidUKPostcode: () => true, geocodePostcode: async () => null },
    supplierAnalytics: { getSupplierAnalytics: jest.fn() },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/me', router);
  return { app, dbUnified, subscriptionService };
}

describe('POST /api/me/subscription/upgrade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('never writes isPro/subscriptionTier directly — delegates to subscriptionService', async () => {
    const { app, dbUnified, subscriptionService } = createApp('user_1');
    subscriptionService.refreshUserEntitlements.mockResolvedValue('free');

    const response = await request(app).post('/api/me/subscription/upgrade').send({}).expect(200);

    expect(subscriptionService.refreshUserEntitlements).toHaveBeenCalledWith('user_1');
    expect(response.body).toEqual({ ok: true, tier: 'free' });
    // The route itself must not mutate any collection directly — the old,
    // vulnerable implementation called dbUnified.updateOne here to force
    // isPro=true regardless of whether a subscription existed.
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
    expect(dbUnified.find).not.toHaveBeenCalled();
  });

  test('a user with no live paid subscription cannot self-grant Pro', async () => {
    // Simulate the real behaviour of refreshUserEntitlements for a caller
    // with no subscription record: it reports 'free' rather than granting one.
    const { app, subscriptionService } = createApp('user_no_sub');
    subscriptionService.refreshUserEntitlements.mockResolvedValue('free');

    const response = await request(app).post('/api/me/subscription/upgrade').send({}).expect(200);

    expect(response.body.tier).toBe('free');
  });

  test('reflects a genuinely live paid subscription', async () => {
    const { app, subscriptionService } = createApp('user_paid');
    subscriptionService.refreshUserEntitlements.mockResolvedValue('pro_plus');

    const response = await request(app).post('/api/me/subscription/upgrade').send({}).expect(200);

    expect(response.body.tier).toBe('pro_plus');
  });
});
