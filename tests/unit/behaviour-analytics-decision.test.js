'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildDecisionSummary,
  buildHomepagePerformance,
  buildEntityPerformance,
  buildConversionBreakdown,
} = require('../../utils/behaviourAnalyticsDecision');

describe('behaviour analytics decision summary', () => {
  const baseSummary = {
    totals: { sessions: 10 },
    pages: [
      {
        pagePath: '/',
        pageType: 'home',
        views: 20,
        sessions: 10,
        totalActiveSeconds: 500,
        engagedRate: 60,
        exitRate: 40,
        bounceRate: 30,
      },
      {
        pagePath: '/home-v2-preview',
        pageType: 'home',
        views: 8,
        sessions: 5,
        totalActiveSeconds: 200,
        engagedRate: 80,
        exitRate: 25,
        bounceRate: 20,
      },
    ],
  };

  const events = [
    {
      event: 'registration_completed',
      sessionIdHash: 'session-a',
      userRole: 'customer',
      properties: {},
    },
    {
      event: 'enquiry_submitted',
      sessionIdHash: 'session-a',
      userRole: 'customer',
      properties: { supplierId: 'supplier-1', packageId: 'package-1' },
    },
    {
      event: 'enquiry_submitted',
      sessionIdHash: 'session-b',
      userRole: 'anonymous',
      properties: { supplierId: 'supplier-1' },
    },
    {
      event: 'supplier_profile_view',
      sessionIdHash: 'session-a',
      userRole: 'customer',
      properties: { supplierId: 'supplier-1' },
    },
    {
      event: 'supplier_profile_view',
      sessionIdHash: 'session-b',
      userRole: 'anonymous',
      properties: { supplierId: 'supplier-1' },
    },
    {
      event: 'package_view',
      sessionIdHash: 'session-a',
      userRole: 'customer',
      properties: { packageId: 'package-1' },
    },
    {
      event: 'package_add_to_plan',
      sessionIdHash: 'session-a',
      userRole: 'customer',
      properties: { packageId: 'package-1' },
    },
  ];

  test('separates conversion actions from unique converting sessions', () => {
    const result = buildConversionBreakdown(events, baseSummary);
    expect(result.actionCount).toBe(3);
    expect(result.uniqueSessions).toBe(2);
    expect(result.sessionRate).toBe(20);
    expect(result.byType.find(row => row.event === 'enquiry_submitted').count).toBe(2);
  });

  test('groups the live homepage separately from version preview paths', () => {
    const rows = buildHomepagePerformance(baseSummary);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'live', label: 'Live homepage', sessions: 10 }),
        expect.objectContaining({ key: 'v2-preview', label: 'Homepage 2 preview', sessions: 5 }),
      ])
    );
    expect(rows.find(row => row.key === 'live').isHistoricalVersionExact).toBe(false);
    expect(rows.find(row => row.key === 'v2-preview').isHistoricalVersionExact).toBe(true);
  });

  test('aggregates supplier and package performance only when IDs are present', () => {
    const result = buildEntityPerformance(events);
    expect(result.suppliers[0]).toEqual(
      expect.objectContaining({ id: 'supplier-1', views: 2, enquiries: 2, sessions: 2 })
    );
    expect(result.packages[0]).toEqual(
      expect.objectContaining({ id: 'package-1', views: 1, saves: 1, enquiries: 1 })
    );
  });

  test('returns definitions that prevent misleading interpretation', () => {
    const result = buildDecisionSummary(events, baseSummary);
    expect(result.definitions.conversions).toMatch(/not unique people/i);
    expect(result.definitions.sessions).toMatch(/browser-tab session/i);
    expect(result.definitions.consent).toMatch(/consent/i);
  });

  test('admin assets request a real previous-period window and correct the revenue label', () => {
    const root = path.join(__dirname, '..', '..');
    const decisionScript = fs.readFileSync(
      path.join(root, 'public/assets/js/pages/admin-analytics-decision.js'),
      'utf8'
    );
    const initScript = fs.readFileSync(
      path.join(root, 'public/assets/js/pages/admin-analytics-init.js'),
      'utf8'
    );
    expect(decisionScript).toContain('offsetDays=${encodeURIComponent(days)}');
    expect(initScript).toContain('Stripe Revenue (Latest Charges)');
    expect(initScript).toContain('latest 100 charges');
  });
});
