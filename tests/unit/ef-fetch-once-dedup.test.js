/**
 * Unit tests for the window._efFetchOnceJSON request-deduplication helper
 * (defined in public/assets/js/app.js).
 *
 * The helper is designed to eliminate the paired Stripe 400 errors visible in
 * Stripe Workbench that occur because two concurrent page-load functions
 * (loadSuppliers in app.js and displaySubscriptionStatus in dashboard-supplier-module.js)
 * both call GET /api/v2/subscriptions/me independently, each triggering a
 * stripe.customers.retrieve call on the server.
 *
 * Tests are written as pure-JS in-process simulations of the helper's logic,
 * using Jest's fake timers / async utilities — no DOM or browser required.
 */

'use strict';

// ---------------------------------------------------------------------------
// Inline replica of the helper (mirrors app.js verbatim so tests stay coupled)
// ---------------------------------------------------------------------------

function makeHelper() {
  // Simulated window object
  const _window = {};

  _window._efFetchOnceJSON = function _efFetchOnceJSON(url, opts) {
    const cache = (_window._efFetchOnceCache = _window._efFetchOnceCache || {});
    if (!cache[url]) {
      cache[url] = fetch(url, opts || {})
        .then(r => {
          return r.ok ? r.json() : null;
        })
        .catch(() => {
          return null;
        })
        .finally(() => {
          delete cache[url];
        });
    }
    return cache[url];
  };

  return _window;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_efFetchOnceJSON — request deduplication', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('makes exactly one fetch call when called concurrently with the same URL', async () => {
    const w = makeHelper();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'free', subscription: null }),
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);

    // Two concurrent callers (mirroring loadSuppliers + displaySubscriptionStatus)
    const [r1, r2] = await Promise.all([
      w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' }),
      w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ plan: 'free', subscription: null });
    expect(r2).toEqual({ plan: 'free', subscription: null });
  });

  it('both callers receive the same resolved value', async () => {
    const w = makeHelper();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'pro', subscription: { id: 'sub_abc' } }),
    });

    const [r1, r2] = await Promise.all([
      w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' }),
      w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' }),
    ]);

    expect(r1).toEqual(r2);
    expect(r1.plan).toBe('pro');
  });

  it('cache entry is cleared after the promise settles (allows fresh calls later)', async () => {
    const w = makeHelper();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'free' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'pro' }) });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);

    const first = await w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' });
    // After settlement, cache should be cleared, so a second call makes a new request
    const second = await w._efFetchOnceJSON('/api/v2/subscriptions/me', {
      credentials: 'include',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.plan).toBe('free');
    expect(second.plan).toBe('pro');
  });

  it('returns null (not throw) when the response is not ok', async () => {
    const w = makeHelper();
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false });

    const result = await w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' });

    expect(result).toBeNull();
  });

  it('returns null (not throw) when fetch itself rejects', async () => {
    const w = makeHelper();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' });

    expect(result).toBeNull();
  });

  it('does not share cache entries between different URLs', async () => {
    const w = makeHelper();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ source: 'url-a' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ source: 'url-b' }) });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);

    const [a, b] = await Promise.all([
      w._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' }),
      w._efFetchOnceJSON('/api/v2/subscriptions/other', { credentials: 'include' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a.source).toBe('url-a');
    expect(b.source).toBe('url-b');
  });
});

// ---------------------------------------------------------------------------
// Source-code structural tests: verify both callers use _efFetchOnceJSON
// ---------------------------------------------------------------------------

describe('_efFetchOnceJSON — usage in source files', () => {
  const fs = require('fs');
  const path = require('path');

  const appJsSrc = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');
  const dashboardModuleSrc = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/dashboard-supplier-module.js'),
    'utf8'
  );

  it('app.js defines window._efFetchOnceJSON', () => {
    expect(appJsSrc).toContain('window._efFetchOnceJSON');
  });

  it('app.js loadSuppliers fallback uses _efFetchOnceJSON for subscriptions/me', () => {
    expect(appJsSrc).toContain("_efFetchOnceJSON('/api/v2/subscriptions/me'");
  });

  it('dashboard-supplier-module.js displaySubscriptionStatus uses _efFetchOnceJSON for subscriptions/me', () => {
    expect(dashboardModuleSrc).toContain("_efFetchOnceJSON('/api/v2/subscriptions/me'");
  });

  it('dashboard-supplier-module.js has a fallback for when _efFetchOnceJSON is not yet defined', () => {
    // The module should guard against _efFetchOnceJSON being absent (e.g., loaded without app.js)
    expect(dashboardModuleSrc).toContain('window._efFetchOnceJSON');
    // Fallback to direct fetch must still be present
    expect(dashboardModuleSrc).toContain("fetch('/api/v2/subscriptions/me'");
  });
});

// ---------------------------------------------------------------------------
// Runtime test: fallback executes correctly when _efFetchOnceJSON is absent
// ---------------------------------------------------------------------------

describe('_efFetchOnceJSON — fallback when helper is absent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('falls back to direct fetch and returns parsed JSON when window._efFetchOnceJSON is undefined', async () => {
    // Simulate environment where app.js has not run (no window._efFetchOnceJSON defined)
    const fakeWindow = {};

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ subscription: { id: 'sub_fallback' }, paymentMethodBrand: 'visa' }),
    });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock);

    // Replicate the fallback branch from dashboard-supplier-module.js
    const subJson = fakeWindow._efFetchOnceJSON
      ? await fakeWindow._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' })
      : await fetch('/api/v2/subscriptions/me', { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(subJson).not.toBeNull();
    expect(subJson.paymentMethodBrand).toBe('visa');
  });

  it('falls back gracefully to null when direct fetch fails and _efFetchOnceJSON is absent', async () => {
    const fakeWindow = {};
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

    const subJson = fakeWindow._efFetchOnceJSON
      ? await fakeWindow._efFetchOnceJSON('/api/v2/subscriptions/me', { credentials: 'include' })
      : await fetch('/api/v2/subscriptions/me', { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .catch(() => null);

    expect(subJson).toBeNull();
  });
});
