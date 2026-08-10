/**
 * POST /api/admin/suppliers/:id/pro (routes/supplier-admin.js)
 *
 * Regression test for the field-set consistency fix: this endpoint used to
 * only ever write isPro/proExpiresAt, silently discarding a requested
 * pro_plus tier and leaving supplier.subscription.tier out of sync with
 * what utils/tierPriority.js resolveSupplierTierFromRecord actually reads.
 * It now shares utils/supplierProGrant.js with the other two admin
 * comp-grant endpoints.
 */
'use strict';

const express = require('express');
const request = require('supertest');

function buildApp(supplier, { updateOne } = {}) {
  const router = require('../../routes/supplier-admin');

  router.initializeDependencies({
    dbUnified: {
      read: async collection => {
        if (collection === 'suppliers') {
          return [supplier];
        }
        return [];
      },
      updateOne: updateOne || (async () => true),
    },
    authRequired: (req, res, next) => {
      req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
      next();
    },
    roleRequired: () => (req, res, next) => next(),
    csrfProtection: (req, res, next) => next(),
    supplierIsProActive: async s => Boolean(s.isPro),
    AI_ENABLED: false,
  });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return app;
}

const BASE_SUPPLIER = {
  id: 'sup-1',
  ownerUserId: 'user-1',
  name: 'Test Supplier',
};

describe('POST /api/admin/suppliers/:id/pro', () => {
  it('grants pro_plus (not just a generic "pro") when a tier is specified', async () => {
    const calls = [];
    const app = buildApp(
      { ...BASE_SUPPLIER },
      { updateOne: async (...args) => (calls.push(args), true) }
    );

    const res = await request(app)
      .post('/api/admin/suppliers/sup-1/pro')
      .send({ mode: 'duration', duration: '1m', tier: 'pro_plus' });

    expect(res.status).toBe(200);
    const supplierUpdateCall = calls.find(c => c[0] === 'suppliers');
    expect(supplierUpdateCall[2].$set.subscription.tier).toBe('pro_plus');
    expect(supplierUpdateCall[2].$set.proPlan).toBe('Pro+');
  });

  it('mirrors isPro to the owning user record', async () => {
    const calls = [];
    const app = buildApp(
      { ...BASE_SUPPLIER },
      { updateOne: async (...args) => (calls.push(args), true) }
    );

    await request(app)
      .post('/api/admin/suppliers/sup-1/pro')
      .send({ mode: 'duration', duration: '7d' });

    const userUpdateCall = calls.find(c => c[0] === 'users');
    expect(userUpdateCall).toBeDefined();
    expect(userUpdateCall[1]).toEqual({ id: 'user-1' });
    expect(userUpdateCall[2].$set.isPro).toBe(true);
  });

  it('cancel mode clears subscription.tier back to free, not just isPro', async () => {
    const calls = [];
    const app = buildApp(
      { ...BASE_SUPPLIER, isPro: true },
      { updateOne: async (...args) => (calls.push(args), true) }
    );

    await request(app).post('/api/admin/suppliers/sup-1/pro').send({ mode: 'cancel' });

    const supplierUpdateCall = calls.find(c => c[0] === 'suppliers');
    expect(supplierUpdateCall[2].$set.subscription).toMatchObject({
      tier: 'free',
      status: 'cancelled',
    });
    expect(supplierUpdateCall[2].$set.proPlan).toBeNull();
  });
});
