'use strict';

const fs = require('fs');
const path = require('path');
const behaviourAnalyticsRoutes = require('../../routes/behaviour-analytics');
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
      event: 'enquiry_started',
      sessionIdHash: 'session-c',
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
    expect(result.byType.find(row => row.event === 'registration_completed').label).toBe(
      'Registrations completed'
    );
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

  test('uses completed lead sessions rather than starts to produce bounded marketplace rates', () => {
    const result = buildEntityPerformance(events);
    expect(result.suppliers[0]).toEqual(
      expect.objectContaining({
        id: 'supplier-1',
        views: 2,
        leads: 2,
        enquiries: 2,
        sessions: 3,
        leadSessions: 2,
        leadSessionRate: 66.7,
        enquiryRate: 66.7,
      })
    );
    expect(result.packages[0]).toEqual(
      expect.objectContaining({
        id: 'package-1',
        views: 1,
        saves: 1,
        leads: 1,
        sessions: 1,
        leadSessionRate: 100,
      })
    );
  });

  test('returns definitions that prevent misleading interpretation', () => {
    const result = buildDecisionSummary(events, baseSummary);
    expect(result.definitions.conversions).toMatch(/not unique people/i);
    expect(result.definitions.sessions).toMatch(/browser-tab session/i);
    expect(result.definitions.consent).toMatch(/consent/i);
    expect(result.definitions.marketplace).toMatch(/starts and repeated page views do not inflate/i);
  });

  test('creates adjacent, non-overlapping current and previous reporting windows', () => {
    const { reportingWindow } = behaviourAnalyticsRoutes._private;
    const now = new Date('2026-07-14T12:00:00.000Z');
    const current = reportingWindow(30, 0, now);
    const previous = reportingWindow(30, 30, now);

    expect(current.end.toISOString()).toBe('2026-07-14T12:00:00.000Z');
    expect(previous.end.toISOString()).toBe(current.start.toISOString());
    expect(previous.start.toISOString()).toBe('2026-05-15T12:00:00.000Z');
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
    expect(decisionScript).toContain('retentionDays >= days * 2');
    expect(initScript).toContain('Stripe Revenue (Latest Charges)');
    expect(initScript).toContain('latest 100 charges');
  });
});
