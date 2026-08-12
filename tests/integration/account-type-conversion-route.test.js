'use strict';

const express = require('express');
const request = require('supertest');

function mockLogger() {
  jest.doMock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }));
}

function matches(row, filter) {
  return Object.keys(filter).every(key => row[key] === filter[key]);
}

function makeDbUnified(seed = {}) {
  const data = { users: [], suppliers: [], audit_logs: [], ...seed };
  let idCounter = 0;
  return {
    data,
    uid: jest.fn(prefix => `${prefix}_${++idCounter}`),
    read: jest.fn(async collection => data[collection] || []),
    find: jest.fn(async (collection, filter = {}) =>
      (data[collection] || []).filter(row => matches(row, filter))
    ),
    findOne: jest.fn(
      async (collection, filter) =>
        (data[collection] || []).find(row => matches(row, filter)) || null
    ),
    insertOne: jest.fn(async (collection, doc) => {
      data[collection] = data[collection] || [];
      data[collection].push(doc);
      return doc;
    }),
    updateOne: jest.fn(async (collection, filter, update) => {
      const rows = data[collection] || [];
      const row = rows.find(item => matches(item, filter));
      if (!row) {
        return false;
      }
      Object.assign(row, update.$set || update);
      if (update.$unset) {
        for (const key of Object.keys(update.$unset)) {
          delete row[key];
        }
      }
      return true;
    }),
  };
}

describe('POST /api/v1/me/settings/account-type (self-service)', () => {
  let authState;

  beforeEach(() => {
    jest.resetModules();
    mockLogger();
    authState = { user: null };
    process.env.PARTNER_ABUSE_HASH_SECRET = 'account-type-route-test-secret';

    jest.doMock('../../middleware/auth', () => ({
      authRequired: (req, res, next) => {
        if (!authState.user) {
          return res.status(401).json({ error: 'Unauthenticated' });
        }
        req.user = authState.user;
        next();
      },
      setAuthCookie: jest.fn(),
      JWT_SECRET: 'test-secret-key-for-account-type-route-tests',
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
    jest.doMock('../../middleware/rateLimits', () => ({
      writeLimiter: (_req, _res, next) => next(),
    }));
  });

  function loadApp({ features = { supplierApplications: true }, dbSeed = {} } = {}) {
    const dbUnified = makeDbUnified(dbSeed);
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../middleware/features', () => ({
      getFeatureFlags: jest.fn(async () => features),
    }));
    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../services/subscriptionService', () => ({
      cancelSubscriptionForAccountDeletion: jest.fn(async () => undefined),
    }));

    const settingsRouter = require('../../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/me/settings', settingsRouter);
    return { app, dbUnified };
  }

  it('requires authentication', async () => {
    const { app } = loadApp();

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'supplier' });

    expect(res.status).toBe(401);
  });

  it('rejects an invalid targetRole', async () => {
    const { app } = loadApp({ dbSeed: { users: [{ id: 'usr_1', role: 'customer' }] } });
    authState.user = { id: 'usr_1', email: 'usr@example.com', role: 'customer' };

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'admin' });

    expect(res.status).toBe(400);
  });

  it('rejects targetRole=supplier when the supplierApplications feature flag is off', async () => {
    const { app } = loadApp({
      features: { supplierApplications: false },
      dbSeed: { users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }] },
    });
    authState.user = { id: 'usr_1', email: 'usr@example.com', role: 'customer' };

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'supplier', supplierInfo: { company: 'Acme' } });

    expect(res.status).toBe(503);
    expect(res.body.feature).toBe('supplierApplications');
  });

  it('converts a customer to supplier, reissues the auth cookie, and provisions a supplier profile', async () => {
    const { app, dbUnified } = loadApp({
      dbSeed: { users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }] },
    });
    authState.user = { id: 'usr_1', email: 'usr@example.com', role: 'customer' };
    const { setAuthCookie } = require('../../middleware/auth');

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({
        targetRole: 'supplier',
        supplierInfo: { company: 'Acme Events', category: 'Catering' },
      });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('supplier');
    expect(res.body.redirect).toBe('/dashboard/supplier');
    expect(dbUnified.data.users[0].role).toBe('supplier');
    expect(dbUnified.data.suppliers).toHaveLength(1);
    expect(setAuthCookie).toHaveBeenCalled();
  });

  it('reissues the cookie as session-only (remember:false), never silently escalating persistence', async () => {
    const { app } = loadApp({
      dbSeed: { users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }] },
    });
    authState.user = { id: 'usr_1', email: 'usr@example.com', role: 'customer' };
    const { setAuthCookie } = require('../../middleware/auth');

    await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'supplier', supplierInfo: { company: 'Acme Events' } });

    expect(setAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ remember: false })
    );
  });

  it('binds the risk-guard email to the authenticated user, ignoring a spoofed body email', async () => {
    const dbUnified = makeDbUnified({
      users: [{ id: 'usr_1', role: 'customer', email: 'real-owner@example.com' }],
    });
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../middleware/features', () => ({
      getFeatureFlags: jest.fn(async () => ({ supplierApplications: true })),
    }));
    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../services/subscriptionService', () => ({
      cancelSubscriptionForAccountDeletion: jest.fn(async () => undefined),
    }));

    let capturedEmail;
    jest.doMock('../../services/partnerRegistrationRiskService', () => ({
      registrationRiskGuard: () => (req, _res, next) => {
        capturedEmail = req.body.email;
        next();
      },
      completeRegistrationRisk: jest.fn(async () => null),
    }));

    const settingsRouter = require('../../routes/settings');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/me/settings', settingsRouter);

    authState.user = { id: 'usr_1', email: 'real-owner@example.com', role: 'customer' };

    await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({
        targetRole: 'supplier',
        supplierInfo: { company: 'Acme Events' },
        email: 'attacker-controlled@evil.example',
      });

    // Must reflect the authenticated session's email, not the submitted body value —
    // otherwise an attacker-controlled email would be what the anti-abuse risk
    // guard hashes and assesses instead of the account actually being upgraded.
    expect(capturedEmail).toBe('real-owner@example.com');
  });

  it('rejects a customer->supplier conversion without a company name', async () => {
    const { app } = loadApp({
      dbSeed: { users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com' }] },
    });
    authState.user = { id: 'usr_1', email: 'usr@example.com', role: 'customer' };

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'supplier', supplierInfo: {} });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('converts a supplier back to customer and suspends the linked supplier profile', async () => {
    const { app, dbUnified } = loadApp({
      dbSeed: {
        users: [{ id: 'usr_2', role: 'supplier', email: 'sup@example.com' }],
        suppliers: [{ id: 'sup_2', ownerUserId: 'usr_2', approved: true, status: 'published' }],
      },
    });
    authState.user = { id: 'usr_2', email: 'sup@example.com', role: 'supplier' };

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'customer' });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('customer');
    expect(res.body.redirect).toBe('/dashboard/customer');
    expect(dbUnified.data.suppliers[0]).toMatchObject({ approved: false, status: 'suspended' });
  });

  it('rejects converting an admin account', async () => {
    const { app } = loadApp({
      dbSeed: { users: [{ id: 'usr_admin', role: 'admin', email: 'admin@example.com' }] },
    });
    authState.user = { id: 'usr_admin', email: 'admin@example.com', role: 'admin' };

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'customer' });

    expect(res.status).toBe(403);
  });

  it('enforces the 30-day self-service cooldown', async () => {
    const recentChange = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { app } = loadApp({
      dbSeed: {
        users: [
          {
            id: 'usr_1',
            role: 'customer',
            email: 'usr@example.com',
            lastAccountTypeChangeAt: recentChange,
          },
        ],
      },
    });
    authState.user = { id: 'usr_1', email: 'usr@example.com', role: 'customer' };

    const res = await request(app)
      .post('/api/v1/me/settings/account-type')
      .send({ targetRole: 'supplier', supplierInfo: { company: 'Acme' } });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('COOLDOWN_ACTIVE');
    expect(res.body.retryAfterDays).toBeGreaterThan(0);
  });
});

describe('POST /api/admin/users/:id/account-type (admin-initiated)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockLogger();
    jest.doMock('../../middleware/auth', () => ({
      authRequired: (req, _res, next) => {
        req.user = { id: 'usr_admin', email: 'admin@example.com', role: 'admin' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  });

  function loadAdminApp(dbSeed = {}) {
    const dbUnified = makeDbUnified(dbSeed);
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../services/subscriptionService', () => ({
      cancelSubscriptionForAccountDeletion: jest.fn(async () => undefined),
    }));

    const adminRouter = require('../../routes/admin-user-management');
    const app = express();
    app.use(express.json());
    app.use('/api/admin', adminRouter);
    return { app, dbUnified };
  }

  it('converts customer -> supplier via the dedicated endpoint, bypassing the self-service cooldown', async () => {
    const recentChange = new Date().toISOString();
    const { app, dbUnified } = loadAdminApp({
      users: [
        {
          id: 'usr_1',
          role: 'customer',
          email: 'usr@example.com',
          lastAccountTypeChangeAt: recentChange,
        },
      ],
    });

    const res = await request(app)
      .post('/api/admin/users/usr_1/account-type')
      .send({ targetRole: 'supplier', supplierInfo: { company: 'Acme Events' } });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('supplier');
    expect(dbUnified.data.suppliers).toHaveLength(1);
  });

  it('converts supplier -> customer and suspends the linked listing', async () => {
    const { app, dbUnified } = loadAdminApp({
      users: [{ id: 'usr_2', role: 'supplier', email: 'sup@example.com' }],
      suppliers: [{ id: 'sup_2', ownerUserId: 'usr_2', approved: true, status: 'published' }],
    });

    const res = await request(app)
      .post('/api/admin/users/usr_2/account-type')
      .send({ targetRole: 'customer' });

    expect(res.status).toBe(200);
    expect(res.body.supplierSuspended).toBe(true);
    expect(dbUnified.data.suppliers[0]).toMatchObject({ approved: false, status: 'suspended' });
  });

  it('the generic PUT /users/:id endpoint no longer changes role', async () => {
    const { app, dbUnified } = loadAdminApp({
      users: [{ id: 'usr_1', role: 'customer', email: 'usr@example.com', name: 'Test' }],
    });

    const res = await request(app)
      .put('/api/admin/users/usr_1')
      .send({ name: 'Updated Name', role: 'supplier' });

    expect(res.status).toBe(200);
    expect(dbUnified.data.users[0].role).toBe('customer');
    expect(dbUnified.data.users[0].name).toBe('Updated Name');
    expect(dbUnified.data.suppliers).toHaveLength(0);
  });
});
