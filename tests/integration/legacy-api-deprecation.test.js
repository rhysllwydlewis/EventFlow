/**
 * Contract tests for the legacy /api → /api/v1 deprecation middleware.
 *
 * Effort 3.2 — Ensure unversioned API aliases emit Deprecation / Sunset /
 * Link headers pointing at the v1 replacement, and that the once-per-route
 * log firing mechanism works.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const {
  legacyApiDeprecation,
  SUNSET_DATE,
  DEPRECATION_VERSION,
  _resetLoggedRoutesForTests,
} = require('../../middleware/legacyApiDeprecation');

describe('legacyApiDeprecation middleware', () => {
  let app;
  let warnSpy;

  beforeEach(() => {
    // Mimic the real mount order in routes/index.js: `/api/v1` first, then
    // `/api` with the deprecation middleware. Express matches both for a
    // request to `/api/v1/foo`, so the middleware MUST detect the versioned
    // path and bail out — this is the regression this suite pins down.
    app = express();
    app.use('/api/v1', (req, res) => res.json({ ok: true, via: 'v1' }));
    app.use('/api', legacyApiDeprecation('/api', '/api/v1'), (req, res) =>
      res.json({ ok: true, via: 'legacy' })
    );

    _resetLoggedRoutesForTests();
    warnSpy = jest.spyOn(require('../../utils/logger'), 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('v1 mount does NOT emit Deprecation/Sunset headers', async () => {
    const res = await request(app).get('/api/v1/anything');
    expect(res.status).toBe(200);
    expect(res.body.via).toBe('v1');
    expect(res.headers.deprecation).toBeUndefined();
    expect(res.headers.sunset).toBeUndefined();
  });

  it('v1 mount does NOT log a deprecation warning (even though /api middleware sees the request)', async () => {
    // Regression: Express prefix-matches `/api` to `/api/v1/...`, so the
    // deprecation middleware runs for v1 requests too. The middleware must
    // detect the `/vN/` remainder and bail out before headers or logs.
    await request(app).get('/api/v1/anything');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('versioned paths with higher version numbers are also exempt', async () => {
    // Add a hypothetical v2 mount to prove the /vN/ regex isn't hard-coded to v1
    const multiApp = express();
    multiApp.use('/api/v2', (req, res) => res.json({ ok: true, via: 'v2' }));
    multiApp.use('/api', legacyApiDeprecation('/api', '/api/v1'), (req, res) =>
      res.json({ ok: true, via: 'legacy' })
    );
    const res = await request(multiApp).get('/api/v2/anything');
    expect(res.status).toBe(200);
    expect(res.headers.deprecation).toBeUndefined();
  });

  it('unversioned /api mount emits Deprecation: true', async () => {
    const res = await request(app).get('/api/anything');
    expect(res.status).toBe(200);
    expect(res.body.via).toBe('legacy');
    expect(res.headers.deprecation).toBe('true');
  });

  it('unversioned /api mount emits Sunset as an HTTP-date', async () => {
    const res = await request(app).get('/api/anything');
    expect(res.headers.sunset).toBe(SUNSET_DATE.toUTCString());
  });

  it('unversioned /api mount emits Link with rel="successor-version"', async () => {
    const res = await request(app).get('/api/anything');
    expect(res.headers.link).toContain('rel="successor-version"');
    expect(res.headers.link).toContain('/api/v1');
  });

  it('logs a deprecation warning exactly once per route across many requests', async () => {
    await request(app).get('/api/anything');
    await request(app).get('/api/anything');
    await request(app).get('/api/something-else');

    // Same oldPath → still only one log entry
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[deprecation]');
    expect(warnSpy.mock.calls[0][0]).toContain('/api/v1');
    expect(warnSpy.mock.calls[0][0]).toContain(DEPRECATION_VERSION);
  });

  it('does not break downstream handlers (body still returned)', async () => {
    const res = await request(app).get('/api/anything');
    expect(res.body).toEqual({ ok: true, via: 'legacy' });
  });
});

describe('legacy API coverage for server.js-style mounts', () => {
  let app;

  beforeEach(() => {
    app = express();

    // Canonical v1 mounts
    app.use('/api/v1/public', (_req, res) =>
      res.status(200).json({ ok: true, route: 'public-v1' })
    );
    app.use('/api/v1/me/settings', (_req, res) =>
      res.status(200).json({ ok: true, route: 'settings-v1' })
    );
    app.use('/api/v1/admin', (_req, res) => res.status(200).json({ ok: true, route: 'admin-v1' }));
    app.use('/api/v1/payments', (_req, res) =>
      res.status(200).json({ ok: true, route: 'payments-v1' })
    );
    app.use('/api/v1/tickets', (_req, res) =>
      res.status(200).json({ ok: true, route: 'tickets-v1' })
    );

    // Legacy mounts with middleware
    app.use('/api/public', legacyApiDeprecation('/api/public', '/api/v1/public'), (_req, res) =>
      res.status(200).json({ ok: true, route: 'public-legacy' })
    );
    app.use(
      '/api/me/settings',
      legacyApiDeprecation('/api/me/settings', '/api/v1/me/settings'),
      (_req, res) => res.status(200).json({ ok: true, route: 'settings-legacy' })
    );
    app.use('/api/admin', legacyApiDeprecation('/api/admin', '/api/v1/admin'), (_req, res) =>
      res.status(200).json({ ok: true, route: 'admin-legacy' })
    );
    app.use(
      '/api/payments',
      legacyApiDeprecation('/api/payments', '/api/v1/payments'),
      (_req, res) => res.status(200).json({ ok: true, route: 'payments-legacy' })
    );
    app.use('/api/tickets', legacyApiDeprecation('/api/tickets', '/api/v1/tickets'), (_req, res) =>
      res.status(200).json({ ok: true, route: 'tickets-legacy' })
    );

    app.get('/api/v1/auth/me', (_req, res) => res.status(200).json({ ok: true, route: 'auth-v1' }));
    app.get('/api/auth/me', legacyApiDeprecation('/api/auth/me', '/api/v1/auth/me'), (_req, res) =>
      res.status(200).json({ ok: true, route: 'auth-legacy' })
    );

    // v2 mounts are canonical and should never receive deprecation headers.
    app.use('/api/v2/subscriptions', (_req, res) =>
      res.status(200).json({ ok: true, route: 'subs-v2' })
    );
    app.use('/api/v2/admin', (_req, res) => res.status(200).json({ ok: true, route: 'admin-v2' }));
    app.use('/api/v2/reviews', (_req, res) =>
      res.status(200).json({ ok: true, route: 'reviews-v2' })
    );
    app.use('/api', legacyApiDeprecation('/api', '/api/v1'), (_req, res) =>
      res.status(200).json({ ok: true, route: 'api-root-legacy' })
    );
  });

  it.each([
    ['/api/auth/me', 'auth-legacy'],
    ['/api/public/example', 'public-legacy'],
    ['/api/me/settings', 'settings-legacy'],
    ['/api/admin/audit-logs', 'admin-legacy'],
    ['/api/payments/config', 'payments-legacy'],
    ['/api/tickets', 'tickets-legacy'],
  ])('emits Deprecation headers for legacy endpoint %s', async (url, route) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(200);
    expect(res.body.route).toBe(route);
    expect(res.headers.deprecation).toBe('true');
    expect(res.headers.sunset).toBe(SUNSET_DATE.toUTCString());
  });

  it.each(['/api/v2/subscriptions', '/api/v2/admin', '/api/v2/reviews'])(
    'does NOT emit Deprecation headers for versioned v2 mount %s',
    async url => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers.deprecation).toBeUndefined();
      expect(res.headers.sunset).toBeUndefined();
      expect(res.headers.link).toBeUndefined();
    }
  );
});
