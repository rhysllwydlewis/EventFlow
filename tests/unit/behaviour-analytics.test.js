'use strict';

const {
  sanitizeEvent,
  sanitizeProperties,
  normalizePagePath,
  normalizeDomain,
  hashIdentifier,
  buildSummary,
} = require('../../utils/behaviourAnalytics');

const NOW = new Date('2026-07-13T18:00:00.000Z');
const SALT = 'unit-test-analytics-salt';

function event(overrides = {}) {
  return sanitizeEvent(
    {
      event: 'page_view',
      sessionId: 'session-one',
      pagePath: '/suppliers?email=visitor@example.com&utm_source=test',
      pageType: 'suppliers',
      referrerDomain: 'https://www.google.com/search?q=private',
      deviceType: 'mobile',
      timestamp: '2026-07-13T17:55:00.000Z',
      properties: {},
      ...overrides,
    },
    { now: NOW, hashSalt: SALT, userId: 'usr_private', userRole: 'customer' }
  );
}

describe('behaviour analytics privacy controls', () => {
  test('removes query strings and stores hashed identifiers only', () => {
    const result = event();

    expect(result.pagePath).toBe('/suppliers');
    expect(result.referrerDomain).toBe('google.com');
    expect(result.sessionIdHash).toBe(hashIdentifier('session-one', SALT));
    expect(result.userIdHash).toBe(hashIdentifier('usr_private', SALT));
    expect(JSON.stringify(result)).not.toContain('visitor@example.com');
    expect(JSON.stringify(result)).not.toContain('usr_private');
    expect(result).not.toHaveProperty('ip');
    expect(result).not.toHaveProperty('userAgent');
  });

  test('normalises the bare domains sent by the browser collector', () => {
    expect(normalizeDomain('www.google.com')).toBe('google.com');
    expect(normalizeDomain('internal')).toBe('internal');
    expect(normalizeDomain('direct')).toBe('direct');
    expect(normalizeDomain('not a valid domain')).toBe('direct');
  });

  test('drops unapproved and sensitive properties while preserving safe metrics', () => {
    const result = sanitizeProperties({
      email: 'person@example.com',
      message: 'private conversation',
      query: 'wedding Cardiff',
      metricName: 'LCP',
      metricValue: 2140,
      activeSeconds: 19,
      supplierId: 'sup_123',
      arbitrary: 'not allowed',
    });

    expect(result).toEqual({
      metricName: 'LCP',
      metricValue: 2140,
      activeSeconds: 19,
      supplierId: 'sup_123',
    });
  });

  test('rejects unknown events, missing sessions and bounds untrusted timestamps', () => {
    expect(event({ event: 'capture_everything' })).toBeNull();
    expect(event({ sessionId: '' })).toBeNull();

    const future = event({ timestamp: '2030-01-01T00:00:00.000Z' });
    expect(new Date(future.timestamp).getTime()).toBeLessThanOrEqual(NOW.getTime() + 5 * 60 * 1000);
  });

  test('normalises malformed paths without retaining fragments', () => {
    expect(normalizePagePath('supplier?id=abc#reviews')).toBe('/supplier');
    expect(normalizePagePath('https://event-flow.co.uk/package/test?token=secret')).toBe(
      '/package/test'
    );
  });
});

describe('behaviour analytics admin summary', () => {
  test('calculates active engagement, page metrics and marketplace funnel', () => {
    const rows = [
      event({
        event: 'page_view',
        sessionId: 's1',
        pagePath: '/',
        pageType: 'home',
      }),
      event({
        event: 'page_engagement',
        sessionId: 's1',
        pagePath: '/',
        pageType: 'home',
        properties: { activeSeconds: 18 },
      }),
      event({
        event: 'search_performed',
        sessionId: 's1',
        pagePath: '/suppliers',
      }),
      event({
        event: 'supplier_profile_view',
        sessionId: 's1',
        pagePath: '/supplier/demo',
      }),
      event({
        event: 'package_view',
        sessionId: 's1',
        pagePath: '/package/demo',
      }),
      event({
        event: 'package_add_to_plan',
        sessionId: 's1',
        pagePath: '/package/demo',
      }),
      event({
        event: 'enquiry_submitted',
        sessionId: 's1',
        pagePath: '/supplier/demo',
      }),
      event({
        event: 'page_view',
        sessionId: 's2',
        pagePath: '/pricing',
        pageType: 'pricing',
      }),
      event({
        event: 'page_engagement',
        sessionId: 's2',
        pagePath: '/pricing',
        pageType: 'pricing',
        properties: { activeSeconds: 4 },
      }),
    ];

    const summary = buildSummary(rows, 30, NOW);

    expect(summary.totals.pageViews).toBe(2);
    expect(summary.totals.sessions).toBe(2);
    expect(summary.totals.activeSeconds).toBe(22);
    expect(summary.totals.engagedSessions).toBe(1);
    expect(summary.totals.conversions).toBe(1);
    expect(summary.pages.find(page => page.pagePath === '/').avgActiveSeconds).toBe(18);
    expect(summary.funnel.map(stage => stage.sessions)).toEqual([1, 1, 1, 1, 1]);
  });

  test('calculates engagement independently for each page', () => {
    const rows = [
      event({
        event: 'page_view',
        sessionId: 's1',
        pagePath: '/home',
        pageType: 'home',
      }),
      event({
        event: 'page_view',
        sessionId: 's1',
        pagePath: '/pricing',
        pageType: 'pricing',
      }),
      event({
        event: 'page_engagement',
        sessionId: 's1',
        pagePath: '/pricing',
        pageType: 'pricing',
        properties: { activeSeconds: 20 },
      }),
    ];

    const summary = buildSummary(rows, 30, NOW);
    expect(summary.pages.find(page => page.pagePath === '/home').engagedRate).toBe(0);
    expect(summary.pages.find(page => page.pagePath === '/pricing').engagedRate).toBe(100);
  });

  test('keeps search-funnel rates bounded and excludes unrelated direct journeys', () => {
    const rows = [
      event({
        event: 'search_performed',
        sessionId: 'search-session',
        pagePath: '/suppliers',
      }),
      event({
        event: 'supplier_profile_view',
        sessionId: 'search-session',
        pagePath: '/supplier/one',
      }),
      event({
        event: 'search_performed',
        sessionId: 'skipped-supplier-session',
        pagePath: '/suppliers',
      }),
      event({
        event: 'package_view',
        sessionId: 'skipped-supplier-session',
        pagePath: '/package/skipped',
      }),
      event({
        event: 'supplier_profile_view',
        sessionId: 'direct-session',
        pagePath: '/supplier/two',
      }),
      event({
        event: 'package_view',
        sessionId: 'direct-session',
        pagePath: '/package/two',
      }),
    ];

    const summary = buildSummary(rows, 30, NOW);
    expect(summary.funnel.map(stage => stage.sessions)).toEqual([2, 1, 0, 0, 0]);
    expect(summary.funnel.every(stage => stage.rateFromSearch <= 100)).toBe(true);
  });

  test('counts successful package creation as a completed key action', () => {
    const summary = buildSummary(
      [event({ event: 'package_created', sessionId: 'supplier-session' })],
      30,
      NOW
    );
    expect(summary.totals.conversions).toBe(1);
  });

  test('produces improvement signals for low-engagement exit pages', () => {
    const rows = [];
    for (let index = 0; index < 5; index += 1) {
      rows.push(
        event({
          event: 'page_view',
          sessionId: `short-${index}`,
          pagePath: '/weak-page',
          pageType: 'other',
        })
      );
      rows.push(
        event({
          event: 'page_engagement',
          sessionId: `short-${index}`,
          pagePath: '/weak-page',
          pageType: 'other',
          properties: { activeSeconds: 3 },
        })
      );
    }

    const summary = buildSummary(rows, 30, NOW);
    expect(summary.recommendations.some(item => item.title.includes('/weak-page'))).toBe(true);
  });
});
