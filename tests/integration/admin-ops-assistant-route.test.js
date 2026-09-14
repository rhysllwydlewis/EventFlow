'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    if (req.headers['x-test-user-role'] === 'none') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    req.user = { id: 'admin-1', role: req.headers['x-test-user-role'] || 'admin' };
    next();
  },
  roleRequired: role => (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));

const adminOpsAssistantRouter = require('../../routes/admin-ops-assistant');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/ops-assistant', adminOpsAssistantRouter);
  return app;
}

describe('Admin Ops Assistant routes', () => {
  const originalEnabled = process.env.OPS_ASSISTANT_ENABLED;
  const originalSecret = process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.OPS_ASSISTANT_ENABLED;
    } else {
      process.env.OPS_ASSISTANT_ENABLED = originalEnabled;
    }
    if (originalSecret === undefined) {
      delete process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
    } else {
      process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = originalSecret;
    }
  });

  it('rejects non-admin users', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/v1/admin/ops-assistant')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('reports disabled status with no secret configured', async () => {
    delete process.env.OPS_ASSISTANT_ENABLED;
    delete process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET;
    const app = createApp();

    const res = await request(app).get('/api/v1/admin/ops-assistant');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, enabled: false, secretConfigured: false });
  });

  it('reports enabled status once configured', async () => {
    process.env.OPS_ASSISTANT_ENABLED = 'true';
    process.env.EVENTFLOW_OPS_BOT_HMAC_SECRET = 'a'.repeat(48);
    const app = createApp();

    const res = await request(app).get('/api/v1/admin/ops-assistant');

    expect(res.body).toEqual({ ok: true, enabled: true, secretConfigured: true });
  });

  it('generates a new secret each time, never persisting it', async () => {
    const app = createApp();

    const first = await request(app).post('/api/v1/admin/ops-assistant/generate-secret');
    const second = await request(app).post('/api/v1/admin/ops-assistant/generate-secret');

    expect(first.status).toBe(200);
    expect(first.body.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(second.body.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(first.body.secret).not.toEqual(second.body.secret);
  });
});
