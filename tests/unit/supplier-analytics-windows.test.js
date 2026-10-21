'use strict';

/**
 * The three supplier analytics endpoints (dashboard summary, /api/supplier/analytics
 * and /api/me/suppliers/:id/analytics) share one rule for "how many days": the
 * request is bounded and then limited to the plan's analytics entitlement
 * (Starter 7 days). These tests pin that rule, plus the honest-null behaviour of
 * the figures that used to default to 100% / 0 hours.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    req.user = JSON.parse(req.headers['x-test-user']);
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');
const {
  parseDaysParam,
  resolveAnalyticsWindow,
  getWindowBounds,
  MAX_REQUEST_DAYS,
} = require('../../utils/analyticsWindow');
const supplierAnalytics = require('../../utils/supplierAnalytics');

const NOW = new Date('2026-07-16T12:00:00.000Z');
const USER = { id: 'user-1', role: 'supplier' };
const PRO_SUBSCRIPTION = {
  id: 's',
  userId: 'user-1',
  plan: 'pro',
  status: 'active',
  stripeSubscriptionId: 'sub_x',
  currentPeriodEnd: '2999-01-01T00:00:00.000Z',
};

describe('parseDaysParam', () => {
  it.each([
    [undefined, { provided: false, valid: true, value: null }],
    ['', { provided: false, valid: true, value: null }],
    ['7', { provided: true, valid: true, value: 7 }],
    [' 30 ', { provided: true, valid: true, value: 30 }],
    ['0', { provided: true, valid: true, value: 0 }],
    ['-1', { provided: true, valid: false, value: null }],
    ['7.5', { provided: true, valid: false, value: null }],
    ['1e9', { provided: true, valid: false, value: null }],
    ['abc', { provided: true, valid: false, value: null }],
    ['9999999999', { provided: true, valid: false, value: null }],
    [['7', '30'], { provided: true, valid: false, value: null }],
    [{ $gt: '' }, { provided: true, valid: false, value: null }],
  ])('parses %j', (raw, expected) => {
    expect(parseDaysParam(raw)).toEqual(expected);
  });
});

describe('resolveAnalyticsWindow', () => {
  it('serves what was asked when the plan allows it', () => {
    expect(resolveAnalyticsWindow({ requested: 30, defaultDays: 30, planWindowDays: 90 })).toEqual({
      days: 30,
      maxDays: 90,
      requestedDays: 30,
    });
  });

  it('limits a Starter plan to 7 days and reports the request', () => {
    expect(resolveAnalyticsWindow({ requested: 30, defaultDays: 30, planWindowDays: 7 })).toEqual({
      days: 7,
      maxDays: 7,
      requestedDays: 30,
    });
  });

  it('caps the request at 90 days whatever the plan', () => {
    expect(
      resolveAnalyticsWindow({ requested: 500, defaultDays: 30, planWindowDays: 365 })
    ).toEqual({
      days: 90,
      maxDays: 90,
      requestedDays: 90,
    });
  });

  it('lets a caller raise the cap explicitly (365 for the long-standing analytics route)', () => {
    expect(
      resolveAnalyticsWindow({
        requested: 365,
        defaultDays: 7,
        planWindowDays: 365,
        requestCap: 365,
      })
    ).toEqual({ days: 365, maxDays: 365, requestedDays: 365 });
  });

  it('uses the default when nothing was asked, and clamps 0 up to 1 day', () => {
    expect(
      resolveAnalyticsWindow({ requested: null, defaultDays: 30, planWindowDays: 90 }).days
    ).toBe(30);
    expect(resolveAnalyticsWindow({ requested: 0, defaultDays: 30, planWindowDays: 90 }).days).toBe(
      1
    );
  });

  it('falls back to the Starter window when the plan matrix has no value', () => {
    expect(resolveAnalyticsWindow({ requested: 30, defaultDays: 30 }).maxDays).toBe(7);
  });

  it('treats a negative (unlimited) plan window as the request cap', () => {
    expect(
      resolveAnalyticsWindow({ requested: 80, defaultDays: 30, planWindowDays: -1 }).days
    ).toBe(80);
  });

  it('exports the 90 day request cap', () => {
    expect(MAX_REQUEST_DAYS).toBe(90);
  });
});

describe('getWindowBounds', () => {
  const now = Date.parse('2026-07-16T12:00:00.000Z');

  it('starts at 00:00 UTC, days-1 days before today', () => {
    expect(getWindowBounds(now, 7)).toEqual({
      startMs: Date.parse('2026-07-10T00:00:00.000Z'),
      previousStartMs: Date.parse('2026-07-03T00:00:00.000Z'),
      endMs: now,
    });
  });

  it('is a single UTC day for a 1 day window', () => {
    expect(getWindowBounds(now, 1).startMs).toBe(Date.parse('2026-07-16T00:00:00.000Z'));
  });
});

describe('getSupplierAnalytics', () => {
  beforeEach(() => {
    fakeDb.__reset({});
  });

  it('never builds more than a year of buckets, however large the request', async () => {
    const result = await supplierAnalytics.getSupplierAnalytics('sup-1', 1000000000);

    expect(result.period).toBe(365);
    expect(result.dailyData).toHaveLength(365);
  });

  it('clamps nonsense to at least one day', async () => {
    expect((await supplierAnalytics.getSupplierAnalytics('sup-1', -4)).dailyData).toHaveLength(1);
    expect((await supplierAnalytics.getSupplierAnalytics('sup-1', 'x')).dailyData).toHaveLength(1);
  });

  it('has no reply figures without an owner to derive them from, rather than 100% / 0h', async () => {
    const result = await supplierAnalytics.getSupplierAnalytics('sup-1', 7);

    expect(result.responseRate).toBeNull();
    expect(result.avgResponseTime).toBeNull();
  });

  it('reports enquiries as unknown (not 0) when the real enquiry figures were asked for and failed', async () => {
    fakeDb.__reset({ suppliers: [] });
    fakeDb.__failOn('conversations_v4');
    require('../../services/supplierEngagementMetrics').clearEngagementCache();

    const result = await supplierAnalytics.getSupplierAnalytics('sup-1', 7, {
      ownerUserId: 'user-1',
      now: NOW,
    });

    expect(result.totalViews).toBe(0);
    expect(result.totalEnquiries).toBeNull();
    expect(result.dailyData.every(day => day.enquiries === null)).toBe(true);
  });

  it('builds daily buckets that add up to the totals', async () => {
    fakeDb.__reset({
      events: [
        {
          id: 'a',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2026-07-10T00:10:00.000Z',
          date: '2026-07-10',
        },
        {
          id: 'b',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2026-07-16T01:00:00.000Z',
          date: '2026-07-16',
        },
        {
          id: 'c',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2026-07-09T23:00:00.000Z',
          date: '2026-07-09',
        },
      ],
    });

    const result = await supplierAnalytics.getSupplierAnalytics('sup-1', 7, { now: NOW });

    expect(result.totalViews).toBe(2);
    expect(result.dailyData.reduce((sum, day) => sum + day.views, 0)).toBe(2);
    expect(result.dailyData[0].date).toBe('2026-07-10');
  });

  it('reports a read failure as missing data, not as zeros', async () => {
    fakeDb.find.mockImplementationOnce(async () => {
      throw new Error('db down');
    });

    const result = await supplierAnalytics.getSupplierAnalytics('sup-1', 7);

    expect(result.totalViews).toBeNull();
    expect(result.totalEnquiries).toBeNull();
    expect(result.responseRate).toBeNull();
    expect(result.dailyData).toEqual([]);
  });

  it('reads only this supplier events inside the window (no whole-collection scan)', async () => {
    fakeDb.__reset({
      events: [
        {
          id: 'a',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: NOW.toISOString(),
          date: NOW.toISOString().slice(0, 10),
        },
        {
          id: 'b',
          type: 'profile_view',
          supplierId: 'sup-2',
          timestamp: NOW.toISOString(),
          date: NOW.toISOString().slice(0, 10),
        },
        {
          id: 'c',
          type: 'profile_view',
          supplierId: 'sup-1',
          timestamp: '2020-01-01T00:00:00.000Z',
          date: '2020-01-01',
        },
      ],
    });
    fakeDb.read.mockClear();

    const result = await supplierAnalytics.getSupplierAnalytics('sup-1', 7, { now: NOW });

    expect(result.totalViews).toBe(1);
    expect(fakeDb.read).not.toHaveBeenCalled();
  });

  it('tracking an event no longer reads the whole events collection first', async () => {
    fakeDb.read.mockClear();

    await supplierAnalytics.trackProfileView('sup-1', 'user-9');

    expect(fakeDb.read).not.toHaveBeenCalled();
    expect(fakeDb.__store().events).toHaveLength(1);
  });
});

describe('GET /api/supplier/analytics', () => {
  /**
   * Request the route as the supplier.
   *
   * @param {string} query - Query string including "?"
   * @returns {Promise<Object>} supertest response
   */
  function fetchAnalytics(query = '') {
    const router = require('../../routes/supplier');
    const app = express();
    app.use('/api/supplier', router);
    return request(app)
      .get(`/api/supplier/analytics${query}`)
      .set('x-test-user', JSON.stringify(USER));
  }

  beforeEach(() => {
    fakeDb.__reset({
      users: [{ id: 'user-1', verified: true }],
      suppliers: [{ id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true }],
    });
  });

  it('caps a Starter supplier at 7 days and reports the window', async () => {
    const res = await fetchAnalytics('?days=30');

    expect(res.status).toBe(200);
    expect(res.body.window).toEqual({ days: 7, maxDays: 7, requestedDays: 30 });
    expect(res.body.analytics.period).toBe(7);
    expect(res.body.analytics.dailyData).toHaveLength(7);
  });

  it('lets a Professional supplier look back 90 days', async () => {
    fakeDb.__store().subscriptions = [
      {
        id: 's',
        userId: 'user-1',
        plan: 'pro',
        status: 'active',
        stripeSubscriptionId: 'sub_x',
        currentPeriodEnd: '2999-01-01T00:00:00.000Z',
      },
    ];

    const res = await fetchAnalytics('?days=90');

    expect(res.body.window).toEqual({ days: 90, maxDays: 90, requestedDays: 90 });
  });

  it('survives hostile input without looping for a billion days', async () => {
    const res = await fetchAnalytics('?days=1000000000');

    expect(res.status).toBe(200);
    expect(res.body.analytics.dailyData.length).toBeLessThanOrEqual(365);
    expect(res.body.window.days).toBe(7);
  });

  it('reports no reply figures instead of 100% when the supplier has no conversations', async () => {
    const res = await fetchAnalytics();

    expect(res.body.analytics.responseRate).toBeNull();
    expect(res.body.analytics.avgResponseTime).toBeNull();
    expect(res.body.analytics.totalEnquiries).toBe(0);
  });
});

describe('GET /api/me/suppliers/:id/analytics', () => {
  /**
   * Mount the supplier-management router with injected dependencies.
   *
   * @returns {Object} Express app
   */
  function buildApp() {
    const router = require('../../routes/supplier-management');
    const passThrough = (req, res, next) => next();
    router.initializeDependencies({
      dbUnified: require('../../db-unified'),
      authRequired: (req, res, next) => {
        req.user = JSON.parse(req.headers['x-test-user']);
        next();
      },
      roleRequired: () => passThrough,
      requireVerifiedUser: passThrough,
      csrfProtection: passThrough,
      writeLimiter: passThrough,
      uid: () => 'id',
      geocoding: {},
      supplierAnalytics,
    });
    const app = express();
    app.use('/api/me/suppliers', router);
    return app;
  }

  /**
   * Request the route as the supplier.
   *
   * @param {string} query - Query string including "?"
   * @param {Object} [user] - Authenticated user
   * @returns {Promise<Object>} supertest response
   */
  function fetchPeriod(query, user = USER) {
    return request(buildApp())
      .get(`/api/me/suppliers/sup-1/analytics${query}`)
      .set('x-test-user', JSON.stringify(user));
  }

  beforeEach(() => {
    fakeDb.__reset({
      users: [{ id: 'user-1', verified: true }],
      suppliers: [
        { id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true },
        { id: 'sup-2', ownerUserId: 'user-2', name: 'Other', approved: true },
      ],
    });
  });

  it('defaults to 7 days', async () => {
    const res = await fetchPeriod('');

    expect(res.status).toBe(200);
    expect(res.body.period).toBe(7);
    expect(res.body.window).toEqual({ days: 7, maxDays: 7, requestedDays: 7 });
  });

  it.each(['abc', '7.5', '-3', '1e9', '99999999999'])(
    'rejects period=%s with a 400',
    async value => {
      const res = await fetchPeriod(`?period=${value}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/whole number/);
    }
  );

  it('rejects a repeated period parameter', async () => {
    const res = await fetchPeriod('?period=7&period=30');

    expect(res.status).toBe(400);
  });

  it('applies the Starter 7 day entitlement here as well', async () => {
    const res = await fetchPeriod('?period=90');

    expect(res.status).toBe(200);
    expect(res.body.window).toEqual({ days: 7, maxDays: 7, requestedDays: 90 });
    expect(res.body.labels).toHaveLength(7);
  });

  it('allows 90 days on the Professional plan and never more', async () => {
    fakeDb.__store().subscriptions = [PRO_SUBSCRIPTION];

    const ninety = await fetchPeriod('?period=90');
    const huge = await fetchPeriod('?period=100000');

    expect(ninety.body.window.days).toBe(90);
    expect(huge.body.window).toEqual({ days: 90, maxDays: 90, requestedDays: 365 });
    expect(huge.body.labels).toHaveLength(90);
  });

  it('serves the full year Professional Plus is sold on, and no more', async () => {
    fakeDb.__store().subscriptions = [{ ...PRO_SUBSCRIPTION, plan: 'pro_plus' }];

    const year = await fetchPeriod('?period=365');
    const huge = await fetchPeriod('?period=100000');

    expect(year.body.window).toEqual({ days: 365, maxDays: 365, requestedDays: 365 });
    expect(year.body.labels).toHaveLength(365);
    expect(huge.body.window.days).toBe(365);
  });

  it('clamps period=0 up to a single day', async () => {
    const res = await fetchPeriod('?period=0');

    expect(res.body.window.days).toBe(1);
  });

  it('still refuses another supplier owner', async () => {
    const res = await fetchPeriod('?period=7', { id: 'user-2', role: 'supplier' });

    expect(res.status).toBe(404);
  });

  it('returns null reply figures rather than 100% when there is no data', async () => {
    const res = await fetchPeriod('?period=7');

    expect(res.body.responseRate).toBeNull();
    expect(res.body.avgResponseTime).toBeNull();
  });
});

describe('GET /api/supplier/analytics/legacy', () => {
  /**
   * Request the legacy route as the supplier.
   *
   * @param {string} query - Query string including "?"
   * @returns {Promise<Object>} supertest response
   */
  function fetchLegacy(query = '') {
    const router = require('../../routes/supplier');
    const app = express();
    app.use('/api/supplier', router);
    return request(app)
      .get(`/api/supplier/analytics/legacy${query}`)
      .set('x-test-user', JSON.stringify(USER));
  }

  beforeEach(() => {
    fakeDb.__reset({
      suppliers: [{ id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio' }],
    });
  });

  it('applies the Starter 7 day entitlement like every other analytics route', async () => {
    const res = await fetchLegacy('?days=90');

    expect(res.status).toBe(200);
    expect(res.body.analytics.chartData).toHaveLength(7);
  });

  it('lets a Professional supplier look back 90 days', async () => {
    fakeDb.__store().subscriptions = [PRO_SUBSCRIPTION];

    const res = await fetchLegacy('?days=90');

    expect(res.body.analytics.chartData).toHaveLength(90);
  });

  it('survives garbage input', async () => {
    const res = await fetchLegacy('?days=abc');

    expect(res.status).toBe(200);
    expect(res.body.analytics.chartData).toHaveLength(7);
  });
});
