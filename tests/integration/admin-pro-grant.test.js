/**
 * POST /api/admin/suppliers/:id/pro (routes/admin.js)
 *
 * Regression test for the field-set consistency fix: this endpoint used to
 * only ever write isPro/proExpiresAt, silently discarding a requested
 * pro_plus tier and leaving supplier.subscription.tier out of sync with
 * what utils/tierPriority.js resolveSupplierTierFromRecord actually reads.
 * It now shares utils/supplierProGrant.js with the other two admin
 * comp-grant endpoints (routes/supplier-admin.js and
 * routes/admin-user-management.js).
 */
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn().mockResolvedValue(undefined),
  auditMiddleware: () => (_req, _res, next) => next(),
  AUDIT_ACTIONS: {},
}));

let mockSuppliers = [];
const calls = [];

jest.mock('../../db-unified', () => ({
  count: jest.fn(async () => 0),
  read: jest.fn(async collection => {
    if (collection === 'suppliers') {
      return mockSuppliers;
    }
    return [];
  }),
  write: jest.fn(async () => undefined),
  findWithOptions: jest.fn(async () => []),
  getDatabaseType: jest.fn(() => 'local'),
  findOne: jest.fn(async () => null),
  updateOne: jest.fn(async (...args) => {
    calls.push(args);
    return true;
  }),
}));

const adminRoutes = require('../../routes/admin');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('POST /api/admin/suppliers/:id/pro', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    mockSuppliers = [{ id: 'sup-1', ownerUserId: 'user-1', name: 'Test Supplier' }];
    calls.length = 0;
  });

  it('grants pro_plus (not just a generic "pro") when a tier is specified', async () => {
    const res = await request(app)
      .post('/api/admin/suppliers/sup-1/pro')
      .send({ mode: 'duration', duration: '1m', tier: 'pro_plus' });

    expect(res.status).toBe(200);
    const supplierUpdateCall = calls.find(c => c[0] === 'suppliers');
    expect(supplierUpdateCall[2].$set.subscription.tier).toBe('pro_plus');
    expect(supplierUpdateCall[2].$set.proPlan).toBe('Pro+');
  });

  it('mirrors isPro to the owning user record', async () => {
    await request(app)
      .post('/api/admin/suppliers/sup-1/pro')
      .send({ mode: 'duration', duration: '7d' });

    const userUpdateCall = calls.find(c => c[0] === 'users');
    expect(userUpdateCall).toBeDefined();
    expect(userUpdateCall[1]).toEqual({ id: 'user-1' });
    expect(userUpdateCall[2].$set.isPro).toBe(true);
  });

  it('cancel mode clears subscription.tier back to free, not just isPro', async () => {
    mockSuppliers = [{ id: 'sup-1', ownerUserId: 'user-1', name: 'Test Supplier', isPro: true }];

    await request(app).post('/api/admin/suppliers/sup-1/pro').send({ mode: 'cancel' });

    const supplierUpdateCall = calls.find(c => c[0] === 'suppliers');
    expect(supplierUpdateCall[2].$set.subscription).toMatchObject({
      tier: 'free',
      status: 'cancelled',
    });
    expect(supplierUpdateCall[2].$set.proPlan).toBeNull();
  });
});
