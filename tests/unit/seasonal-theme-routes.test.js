'use strict';

/**
 * Exercises the real handlers end-to-end: the public endpoint the header script
 * calls, and the admin read/save behind the Settings card. The scheduling rule
 * itself is covered in seasonal-theme-service.test.js; here we check the wiring
 * (caching, validation, persistence, audit trail, failure behaviour).
 */

const mockRoleRequired = jest.fn(() => (req, res, next) => next());
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    return next();
  },
  roleRequired: (...args) => mockRoleRequired(...args),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => {
  const passthrough = (_req, _res, next) => next();
  return new Proxy({}, { get: () => passthrough });
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
}));

const express = require('express');
const request = require('supertest');
const dbUnified = require('../../db-unified');

const FAKE_TIMERS = {
  // Only the clock is faked, so supertest's sockets and timers keep working.
  doNotFake: [
    'nextTick',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
    'queueMicrotask',
    'performance',
    'hrtime',
  ],
};
const setClock = iso => jest.useFakeTimers({ ...FAKE_TIMERS, now: new Date(iso) });

function publicApp() {
  const app = express();
  app.use('/api/public', require('../../routes/public'));
  return app;
}

function adminApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/settings/seasonal-theme', require('../../routes/admin-seasonal-theme'));
  return app;
}

const ADMIN_URL = '/api/admin/settings/seasonal-theme';

beforeEach(() => {
  jest.clearAllMocks();
  mockStoredSettings = {};
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GET /api/public/seasonal-theme', () => {
  it('answers "no theme" until an admin has opted in', async () => {
    setClock('2026-10-23T12:00:00Z');

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ theme: null });
  });

  it('answers with the theme the automatic schedule picks for today', async () => {
    setClock('2026-10-23T12:00:00Z');
    mockStoredSettings = { seasonalTheme: { auto: true } };

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(res.body).toEqual({ theme: 'halloween' });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
  });

  it('answers with a manually chosen theme', async () => {
    setClock('2026-08-15T12:00:00Z');
    mockStoredSettings = { seasonalTheme: { auto: false, manualTheme: 'easter' } };

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(res.body).toEqual({ theme: 'easter' });
  });

  it('never lets the cache outlive the next UK midnight', async () => {
    // 23:58:30 UK time (GMT in December) leaves 90 seconds.
    setClock('2026-12-10T23:58:30Z');
    mockStoredSettings = { seasonalTheme: { auto: true } };

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(res.headers['cache-control']).toBe('public, max-age=90');
  });

  it('exposes nothing but the theme key', async () => {
    setClock('2026-10-23T12:00:00Z');
    mockStoredSettings = {
      seasonalTheme: { auto: true, updatedBy: 'admin@example.com', excluded: ['easter'] },
      stripe: { secret: 'sk_live_nope' },
    };

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(Object.keys(res.body)).toEqual(['theme']);
    expect(JSON.stringify(res.body)).not.toContain('admin@example.com');
  });

  it('leaves the header plain, and does not cache the failure, when storage is down', async () => {
    setClock('2026-10-23T12:00:00Z');
    dbUnified.read.mockRejectedValueOnce(new Error('mongo exploded'));

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ theme: null });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('mongo exploded');
  });
});

describe('GET /api/admin/settings/seasonal-theme', () => {
  it('is restricted to admins', () => {
    adminApp();
    expect(mockRoleRequired).toHaveBeenCalledWith('admin');
  });

  it('reports a quiet default when nothing has been saved', async () => {
    setClock('2026-10-23T12:00:00Z');

    const res = await request(adminApp()).get(ADMIN_URL);

    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      auto: false,
      manualTheme: null,
      returnToAutoOn: null,
      excluded: [],
    });
    expect(res.body.resolved).toEqual({ theme: null, source: 'manual' });
    expect(res.body.next).toBeNull();
    expect(res.body.ukDate).toBe('2026-10-23');
    expect(res.headers['cache-control']).toBe('no-store, private');
  });

  it('describes the live state, the next changeover and every occasion', async () => {
    setClock('2026-10-23T12:00:00Z');
    mockStoredSettings = { seasonalTheme: { auto: true, excluded: ['easter'] } };

    const res = await request(adminApp()).get(ADMIN_URL);

    expect(res.body.resolved).toEqual({ theme: 'halloween', source: 'auto' });
    expect(res.body.next).toEqual({ date: '2026-11-02', theme: 'bonfire' });
    expect(res.body.settings.excluded).toEqual(['easter']);
    expect(res.body.occasions).toHaveLength(10);
    expect(res.body.occasions[0]).toMatchObject({
      key: 'halloween',
      start: '2026-10-20',
      end: '2026-11-01',
    });
    expect(res.body.chineseNewYearTableEndsIn).toBe(2035);
  });

  it('reports a 500 rather than leaking the underlying storage error', async () => {
    dbUnified.read.mockRejectedValueOnce(new Error('mongo exploded'));

    const res = await request(adminApp()).get(ADMIN_URL);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to read settings' });
    expect(JSON.stringify(res.body)).not.toContain('mongo exploded');
  });
});

describe('PUT /api/admin/settings/seasonal-theme', () => {
  it('saves the automatic schedule, leaves other settings alone, and records who and when', async () => {
    setClock('2026-10-23T12:00:00Z');
    mockStoredSettings = { features: { reviews: true }, signupPopup: { mode: 'banner' } };

    const res = await request(adminApp())
      .put(ADMIN_URL)
      .send({ auto: true, excluded: ['fathers-day'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resolved).toEqual({ theme: 'halloween', source: 'auto' });
    expect(mockStoredSettings.features).toEqual({ reviews: true });
    expect(mockStoredSettings.signupPopup).toEqual({ mode: 'banner' });
    expect(mockStoredSettings.seasonalTheme).toMatchObject({
      auto: true,
      manualTheme: null,
      returnToAutoOn: null,
      excluded: ['fathers-day'],
      updatedBy: 'admin@example.com',
    });
    expect(typeof mockStoredSettings.seasonalTheme.updatedAt).toBe('string');
  });

  it('saves a manual theme with a return date', async () => {
    setClock('2026-12-01T12:00:00Z');

    const res = await request(adminApp())
      .put(ADMIN_URL)
      .send({ auto: false, manualTheme: 'halloween', returnToAutoOn: '2026-12-05' });

    expect(res.status).toBe(200);
    expect(res.body.resolved).toEqual({ theme: 'halloween', source: 'manual' });
    expect(res.body.next).toEqual({ date: '2026-12-05', theme: 'christmas' });
    expect(mockStoredSettings.seasonalTheme).toMatchObject({
      auto: false,
      manualTheme: 'halloween',
      returnToAutoOn: '2026-12-05',
    });
  });

  it('writes an audit entry with the before and after', async () => {
    setClock('2026-10-23T12:00:00Z');
    mockStoredSettings = { seasonalTheme: { auto: false, manualTheme: 'easter' } };

    await request(adminApp()).put(ADMIN_URL).send({ auto: true });

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        adminEmail: 'admin@example.com',
        action: 'SEASONAL_THEME_UPDATED',
        targetType: 'seasonalTheme',
        details: {
          before: { auto: false, manualTheme: 'easter', returnToAutoOn: null, excluded: [] },
          after: { auto: true, manualTheme: null, returnToAutoOn: null, excluded: [] },
        },
      })
    );
  });

  it.each([
    [{}, /auto must be/],
    [{ auto: 'yes' }, /auto must be/],
    [{ auto: false, manualTheme: 'diwali' }, /manualTheme/],
    [{ auto: false, returnToAutoOn: '2026-02-31' }, /returnToAutoOn/],
    [{ auto: true, excluded: ['christmas', 'diwali'] }, /excluded/],
  ])('rejects %j without saving or auditing', async (body, message) => {
    const res = await request(adminApp()).put(ADMIN_URL).send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(dbUnified.writeAndVerify).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('reports a 500 rather than leaking the underlying storage error', async () => {
    dbUnified.writeAndVerify.mockRejectedValueOnce(new Error('mongo exploded'));

    const res = await request(adminApp()).put(ADMIN_URL).send({ auto: true });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update settings' });
    expect(JSON.stringify(res.body)).not.toContain('mongo exploded');
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('a saved setting is what the public endpoint then serves', async () => {
    setClock('2026-12-10T12:00:00Z');
    await request(adminApp()).put(ADMIN_URL).send({ auto: true });

    const res = await request(publicApp()).get('/api/public/seasonal-theme');

    expect(res.body).toEqual({ theme: 'christmas' });
  });
});
