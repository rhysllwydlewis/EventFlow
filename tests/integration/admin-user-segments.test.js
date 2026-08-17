/**
 * Integration tests for GET /api/admin/users/segments
 *
 * Regression coverage for a bug where the "Active Suppliers" and "At-Risk
 * Suppliers" segments matched messages against `supplier.userId`, a field
 * that doesn't exist on the supplier schema (the real field is
 * `ownerUserId`). That made "Active Suppliers" always empty and
 * "At-Risk Suppliers" always contain every supplier, regardless of
 * actual message activity.
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
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => key }),
}));

jest.mock('../../middleware/domain-admin', () => ({
  isOwnerEmail: () => false,
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  write: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  insertOne: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const adminUserManagementRoutes = require('../../routes/admin-user-management');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminUserManagementRoutes);
  return app;
}

describe('GET /api/admin/users/segments', () => {
  let app;

  beforeEach(() => {
    app = createApp();

    const now = Date.now();
    const users = [{ id: 'owner-1', role: 'supplier' }];
    const suppliers = [
      { id: 'sup-active', ownerUserId: 'owner-1', name: 'Active Supplier' },
      { id: 'sup-quiet', ownerUserId: 'owner-2', name: 'Quiet Supplier' },
    ];
    const plans = [];
    const messages = [
      // Sent 5 days ago by the owner of sup-active — should count toward
      // both "active" (30d window) and NOT toward "at-risk" (60d window).
      {
        senderId: 'owner-1',
        createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    dbUnified.read.mockImplementation(async collection => {
      if (collection === 'users') {
        return users;
      }
      if (collection === 'suppliers') {
        return suppliers;
      }
      if (collection === 'plans') {
        return plans;
      }
      if (collection === 'messages') {
        return messages;
      }
      return [];
    });
  });

  it('counts a supplier with a recent message as active, by ownerUserId', async () => {
    const res = await request(app).get('/api/admin/users/segments');

    expect(res.status).toBe(200);
    expect(res.body.segments.activeSuppliers.count).toBe(1);
    expect(res.body.segments.activeSuppliers.suppliers.map(s => s.id)).toEqual(['sup-active']);
  });

  it('does not count the recently-messaging supplier as at-risk', async () => {
    const res = await request(app).get('/api/admin/users/segments');

    expect(res.status).toBe(200);
    const atRiskIds = res.body.segments.atRiskSuppliers.suppliers.map(s => s.id);
    expect(atRiskIds).not.toContain('sup-active');
    expect(atRiskIds).toContain('sup-quiet');
  });
});
