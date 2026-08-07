'use strict';

/**
 * Exercises the real /api/admin/settings/signup-popup handlers end-to-end
 * (rather than asserting on route source text), so the validation rules and
 * the read-modify-write against the shared `settings` singleton are covered.
 */

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    return next();
  },
  roleRequired: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (_req, _res, next) => next();
  return new Proxy(
    {},
    {
      get: () => passthrough,
    }
  );
});

const mockAuditLog = jest.fn();
jest.mock('../../middleware/audit', () => ({
  auditLog: (...args) => mockAuditLog(...args),
  AUDIT_ACTIONS: {},
}));

let mockStoredSettings = {};

jest.mock('../../db-unified', () => ({
  read: jest.fn(async collection => (collection === 'settings' ? mockStoredSettings : {})),
  writeAndVerify: jest.fn(async (collection, data) => {
    if (collection === 'settings') {
      mockStoredSettings = data;
    }
    return { success: true, verified: true, data };
  }),
  write: jest.fn(async () => true),
  find: jest.fn(async () => []),
  updateOne: jest.fn(async () => true),
  getDatabaseStatus: jest.fn(() => ({ state: 'completed', type: 'local', connected: true })),
  getQueryMetrics: jest.fn(() => ({ totalQueries: 0, avgQueryTime: 0, slowQueries: 0 })),
}));

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');

function buildApp() {
  const adminRoutes = require('../../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('GET /api/admin/settings/signup-popup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSettings = {};
  });

  it('returns the disabled default when nothing has been saved yet', async () => {
    const res = await request(buildApp()).get('/api/admin/settings/signup-popup');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, delaySeconds: 5 });
  });

  it('returns the stored settings once saved', async () => {
    mockStoredSettings = { signupPopup: { enabled: true, delaySeconds: 12 } };

    const res = await request(buildApp()).get('/api/admin/settings/signup-popup');

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.delaySeconds).toBe(12);
  });

  it('reports a 500 rather than leaking the underlying storage error', async () => {
    dbUnified.read.mockRejectedValueOnce(new Error('mongo exploded'));

    const res = await request(buildApp()).get('/api/admin/settings/signup-popup');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to read settings' });
    expect(JSON.stringify(res.body)).not.toContain('mongo exploded');
  });
});

describe('PUT /api/admin/settings/signup-popup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSettings = {};
  });

  it('persists the toggle and delay', async () => {
    const res = await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: true, delaySeconds: 8 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockStoredSettings.signupPopup.enabled).toBe(true);
    expect(mockStoredSettings.signupPopup.delaySeconds).toBe(8);
    expect(mockStoredSettings.signupPopup.updatedBy).toBe('admin@example.com');
  });

  it('records an audit entry', async () => {
    await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: true, delaySeconds: 5 });

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SIGNUP_POPUP_UPDATED' })
    );
  });

  it('coerces a truthy non-boolean to a strict false rather than enabling the popup', async () => {
    await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: 'yes', delaySeconds: 5 });

    expect(mockStoredSettings.signupPopup.enabled).toBe(false);
  });

  it('accepts a zero-second delay', async () => {
    const res = await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: true, delaySeconds: 0 });

    expect(res.status).toBe(200);
    expect(mockStoredSettings.signupPopup.delaySeconds).toBe(0);
  });

  it.each([
    ['a fractional delay', 2.5],
    ['a negative delay', -1],
    ['a delay beyond the 300s cap', 301],
    ['a non-numeric delay', 'soon'],
    ['a missing delay', undefined],
  ])('rejects %s with a 400 and leaves the stored settings untouched', async (_label, value) => {
    const res = await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: true, delaySeconds: value });

    expect(res.status).toBe(400);
    expect(mockStoredSettings.signupPopup).toBeUndefined();
  });

  it('reports a 500 rather than leaking the underlying storage error', async () => {
    dbUnified.writeAndVerify.mockRejectedValueOnce(new Error('disk full'));

    const res = await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: true, delaySeconds: 5 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update settings' });
    expect(JSON.stringify(res.body)).not.toContain('disk full');
  });

  it('leaves unrelated settings keys intact (read-modify-write on the shared singleton)', async () => {
    mockStoredSettings = {
      maintenance: { enabled: true, message: 'Back soon' },
      features: { registration: false },
    };

    await request(buildApp())
      .put('/api/admin/settings/signup-popup')
      .send({ enabled: true, delaySeconds: 5 });

    expect(mockStoredSettings.maintenance).toEqual({ enabled: true, message: 'Back soon' });
    expect(mockStoredSettings.features).toEqual({ registration: false });
  });
});
