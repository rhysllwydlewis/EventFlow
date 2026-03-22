/**
 * Integration tests for admin system-checks endpoints
 *
 * GET  /api/admin/system-checks
 * POST /api/admin/system-checks/run
 */
'use strict';

const request = require('supertest');
const express = require('express');

// ── Mock middleware ────────────────────────────────────────────────────────────

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    // Attach the user that was set by the test helper below
    if (!req._testUser) {
      return _res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = req._testUser;
    next();
  },
  roleRequired: role => (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
  writeLimiter: (_req, _res, next) => next(),
}));

// ── Mock service ───────────────────────────────────────────────────────────────

const mockRun = {
  startedAt: new Date('2024-01-15T03:00:00Z'),
  finishedAt: new Date('2024-01-15T03:00:05Z'),
  durationMs: 5000,
  status: 'pass',
  environment: 'test',
  baseUrl: 'http://localhost:3000',
  checks: [
    {
      name: 'health-api',
      type: 'api',
      target: 'http://localhost:3000/api/health',
      ok: true,
      statusCode: 200,
      durationMs: 120,
      error: null,
      details: { status: 'ok' },
    },
    {
      name: 'ready-api',
      type: 'api',
      target: 'http://localhost:3000/api/ready',
      ok: true,
      statusCode: 200,
      durationMs: 98,
      error: null,
      details: {},
    },
  ],
};

jest.mock('../../services/systemCheckService', () => ({
  runSystemChecks: jest.fn().mockResolvedValue(mockRun),
  getRecentRuns: jest.fn().mockResolvedValue([mockRun]),
}));

const systemCheckService = require('../../services/systemCheckService');

// ── App factory ────────────────────────────────────────────────────────────────

function createApp(userOverride) {
  const app = express();
  app.use(express.json());

  // Middleware that lets each request inject a test user
  app.use((req, _res, next) => {
    req._testUser = userOverride || null;
    next();
  });

  const router = require('../../routes/system-checks-admin');
  app.use('/api/admin', router);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/system-checks', () => {
  beforeEach(() => {
    systemCheckService.getRecentRuns.mockClear();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(null);
    const res = await request(app).get('/api/admin/system-checks');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const app = createApp({ id: 'u1', role: 'customer' });
    const res = await request(app).get('/api/admin/system-checks');
    expect(res.status).toBe(403);
  });

  it('returns 200 and run array for admin', async () => {
    const app = createApp({ id: 'admin-1', role: 'admin' });
    const res = await request(app).get('/api/admin/system-checks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(typeof res.body.count).toBe('number');
  });

  it('respects ?limit query parameter (clamped to 100)', async () => {
    const app = createApp({ id: 'admin-1', role: 'admin' });
    await request(app).get('/api/admin/system-checks?limit=5');
    expect(systemCheckService.getRecentRuns).toHaveBeenCalledWith(5);
  });

  it('uses default limit of 30 for invalid limit param', async () => {
    const app = createApp({ id: 'admin-1', role: 'admin' });
    await request(app).get('/api/admin/system-checks?limit=abc');
    expect(systemCheckService.getRecentRuns).toHaveBeenCalledWith(30);
  });

  it('clamps limit to 100 maximum', async () => {
    const app = createApp({ id: 'admin-1', role: 'admin' });
    await request(app).get('/api/admin/system-checks?limit=999');
    expect(systemCheckService.getRecentRuns).toHaveBeenCalledWith(100);
  });

  it('returns 500 when service throws', async () => {
    systemCheckService.getRecentRuns.mockRejectedValueOnce(new Error('DB error'));
    const app = createApp({ id: 'admin-1', role: 'admin' });
    const res = await request(app).get('/api/admin/system-checks');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/system-checks/run', () => {
  beforeEach(() => {
    systemCheckService.runSystemChecks.mockClear();
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createApp(null);
    const res = await request(app).post('/api/admin/system-checks/run');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin user', async () => {
    const app = createApp({ id: 'u1', role: 'supplier' });
    const res = await request(app).post('/api/admin/system-checks/run');
    expect(res.status).toBe(403);
  });

  it('returns 201 and run doc for admin', async () => {
    const app = createApp({ id: 'admin-1', role: 'admin' });
    const res = await request(app).post('/api/admin/system-checks/run');
    expect(res.status).toBe(201);
    expect(res.body.run).toBeDefined();
    expect(res.body.run.status).toBe('pass');
  });

  it('returns 409 when a run is already in progress (null returned)', async () => {
    systemCheckService.runSystemChecks.mockResolvedValueOnce(null);
    const app = createApp({ id: 'admin-1', role: 'admin' });
    const res = await request(app).post('/api/admin/system-checks/run');
    expect(res.status).toBe(409);
  });

  it('returns 500 when service throws', async () => {
    systemCheckService.runSystemChecks.mockRejectedValueOnce(new Error('Unexpected'));
    const app = createApp({ id: 'admin-1', role: 'admin' });
    const res = await request(app).post('/api/admin/system-checks/run');
    expect(res.status).toBe(500);
  });
});
