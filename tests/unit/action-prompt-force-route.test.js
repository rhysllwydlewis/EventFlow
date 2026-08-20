'use strict';

/**
 * Exercises the real POST /api/admin/email-automation/action-prompts/run
 * and GET /api/admin/settings/email-automation handlers end-to-end
 * (rather than asserting on route source text), covering:
 *  - force must be a boolean
 *  - a forced non-dry run within the 24h cooldown is rejected with 429
 *  - a forced run outside the cooldown (or with no prior forced run) succeeds
 *    and forwards force through to runActionPrompts
 *  - GET returns lastForceRunAt from settings
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
  return new Proxy({}, { get: () => passthrough });
});

jest.mock('../../middleware/audit', () => ({
  auditLog: jest.fn(),
  AUDIT_ACTIONS: {},
}));

const mockRunActionPrompts = jest.fn(async () => ({
  scanned: 1,
  sent: 1,
  skippedCadence: 0,
  errors: 0,
}));
jest.mock('../../services/actionPromptScheduler', () => ({
  runActionPrompts: (...args) => mockRunActionPrompts(...args),
  notifyCronChanged: jest.fn(async () => {}),
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
}));

const express = require('express');
const request = require('supertest');

function buildApp() {
  const adminRoutes = require('../../routes/admin');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  return app;
}

describe('POST /api/admin/email-automation/action-prompts/run — force + cooldown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSettings = {};
    mockRunActionPrompts.mockClear();
  });

  it('rejects a non-boolean force value', async () => {
    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: true, force: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/force must be a boolean/i);
    expect(mockRunActionPrompts).not.toHaveBeenCalled();
  });

  it('runs a forced dry run without any cooldown check', async () => {
    mockStoredSettings = {
      emailAutomation: {
        actionPrompts: { lastForceRunAt: new Date().toISOString() },
      },
    };

    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: true, force: true });

    expect(res.status).toBe(200);
    expect(mockRunActionPrompts).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, force: true, trigger: 'manual' })
    );
  });

  it('rejects a forced non-dry run with 429 when the last forced run was under 24h ago', async () => {
    mockStoredSettings = {
      emailAutomation: {
        actionPrompts: { lastForceRunAt: new Date(Date.now() - 60 * 1000).toISOString() },
      },
    };

    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: false, confirm: true, force: true });

    expect(res.status).toBe(429);
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
    expect(mockRunActionPrompts).not.toHaveBeenCalled();
  });

  it('allows a forced non-dry run once the cooldown has elapsed', async () => {
    mockStoredSettings = {
      emailAutomation: {
        actionPrompts: {
          lastForceRunAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        },
      },
    };

    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: false, confirm: true, force: true });

    expect(res.status).toBe(200);
    expect(mockRunActionPrompts).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, force: true, trigger: 'manual' })
    );
  });

  it('allows a forced non-dry run when no forced run has ever happened', async () => {
    mockStoredSettings = {};

    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: false, confirm: true, force: true });

    expect(res.status).toBe(200);
    expect(mockRunActionPrompts).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, force: true, trigger: 'manual' })
    );
  });

  it('still requires confirm=true for a non-dry run regardless of force', async () => {
    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: false, force: true });

    expect(res.status).toBe(400);
    expect(mockRunActionPrompts).not.toHaveBeenCalled();
  });

  it('defaults force to false when omitted', async () => {
    const res = await request(buildApp())
      .post('/api/admin/email-automation/action-prompts/run')
      .send({ dryRun: true });

    expect(res.status).toBe(200);
    expect(mockRunActionPrompts).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, force: false })
    );
  });
});

describe('GET /api/admin/settings/email-automation — lastForceRunAt', () => {
  beforeEach(() => {
    mockStoredSettings = {};
  });

  it('returns null when no forced run has ever happened', async () => {
    const res = await request(buildApp()).get('/api/admin/settings/email-automation');

    expect(res.status).toBe(200);
    expect(res.body.lastForceRunAt).toBeNull();
  });

  it('returns the stored lastForceRunAt timestamp', async () => {
    const ts = new Date().toISOString();
    mockStoredSettings = { emailAutomation: { actionPrompts: { lastForceRunAt: ts } } };

    const res = await request(buildApp()).get('/api/admin/settings/email-automation');

    expect(res.status).toBe(200);
    expect(res.body.lastForceRunAt).toBe(ts);
  });
});
