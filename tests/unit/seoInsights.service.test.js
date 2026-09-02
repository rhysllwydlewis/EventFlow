/**
 * Unit tests for the SEO Insights scoring logic — the pure functions
 * that decide what counts as a striking-distance keyword, a low-CTR
 * opportunity, and how the financial estimate is computed. No database.
 */

'use strict';

jest.mock('../../db-unified', () => ({
  find: jest.fn(),
}));

jest.mock('../../services/seoDataStore', () => ({
  listNoiseKeywords: jest.fn(async () => []),
  getSettings: jest.fn(async () => ({ id: 'default', valuePerClick: null })),
  getAllIngestionStatus: jest.fn(async () => []),
}));

const dbUnified = require('../../db-unified');
const seoDataStore = require('../../services/seoDataStore');
const seoInsights = require('../../services/seoInsights.service');
const {
  getExpectedCtr,
  computeOpportunityScore,
  isStrikingDistance,
  isLowCtrOpportunity,
  computeUpliftClicks,
  computeFinancialEstimate,
} = seoInsights;
const { COLLECTIONS, isBrandedQuery, normaliseKeyword } = require('../../models/SeoInsights');

describe('seoInsights.service — expected CTR benchmark', () => {
  it('returns the tabled value for known positions', () => {
    expect(getExpectedCtr(1)).toBe(0.28);
    expect(getExpectedCtr(10)).toBe(0.02);
  });

  it('rounds fractional positions to the nearest integer', () => {
    expect(getExpectedCtr(4.4)).toBe(getExpectedCtr(4));
    expect(getExpectedCtr(4.6)).toBe(getExpectedCtr(5));
  });

  it('falls back to the position-20 value for anything inside the table range but unlisted, and a lower value beyond it', () => {
    expect(getExpectedCtr(20)).toBe(0.005);
    expect(getExpectedCtr(45)).toBeLessThan(getExpectedCtr(20));
  });
});

describe('seoInsights.service — opportunity score', () => {
  it('is impressions weighted by the unclicked share', () => {
    expect(computeOpportunityScore({ impressions: 100, ctr: 0.1 })).toBe(90);
    expect(computeOpportunityScore({ impressions: 100, ctr: 0 })).toBe(100);
    expect(computeOpportunityScore({ impressions: 100, ctr: 1 })).toBe(0);
  });

  it('treats a missing ctr as zero rather than throwing', () => {
    expect(computeOpportunityScore({ impressions: 50 })).toBe(50);
  });
});

describe('seoInsights.service — striking distance', () => {
  it('flags rows in the position band with enough impressions', () => {
    expect(isStrikingDistance({ position: 10, impressions: 50 })).toBe(true);
    expect(isStrikingDistance({ position: 3, impressions: 500 })).toBe(false); // already page 1
    expect(isStrikingDistance({ position: 25, impressions: 500 })).toBe(false); // too far down
    expect(isStrikingDistance({ position: 10, impressions: 5 })).toBe(false); // not enough volume
  });

  it('respects custom thresholds', () => {
    expect(isStrikingDistance({ position: 25, impressions: 500 }, { positionMax: 30 })).toBe(true);
  });
});

describe('seoInsights.service — low CTR opportunity', () => {
  it('flags a good position getting far fewer clicks than the benchmark', () => {
    // position 3 benchmark is 0.11; half of that is 0.055
    expect(isLowCtrOpportunity({ position: 3, impressions: 100, ctr: 0.01 })).toBe(true);
    expect(isLowCtrOpportunity({ position: 3, impressions: 100, ctr: 0.1 })).toBe(false);
  });

  it('ignores rows outside the position window or below the impression floor', () => {
    expect(isLowCtrOpportunity({ position: 15, impressions: 1000, ctr: 0 })).toBe(false);
    expect(isLowCtrOpportunity({ position: 3, impressions: 1, ctr: 0 })).toBe(false);
  });
});

describe('seoInsights.service — uplift & financial estimate', () => {
  it('computes uplift clicks as the gap to the benchmark, floored at zero', () => {
    // position 5 benchmark 0.06 on 1000 impressions = 60 expected clicks
    expect(computeUpliftClicks({ position: 5, impressions: 1000, clicks: 10 })).toBe(50);
    // already beating the benchmark — never negative
    expect(computeUpliftClicks({ position: 5, impressions: 1000, clicks: 200 })).toBe(0);
  });

  it('refuses to guess a financial figure without a configured value-per-click', () => {
    const result = computeFinancialEstimate([{ position: 5, impressions: 1000, clicks: 10 }], null);
    expect(result.needsValuePerClick).toBe(true);
    expect(result.estimatedMonthlyValue).toBeNull();
  });

  it('multiplies total uplift clicks by the configured value-per-click', () => {
    const rows = [
      { position: 5, impressions: 1000, clicks: 10 }, // 50 uplift clicks
      { position: 5, impressions: 1000, clicks: 200 }, // 0 uplift clicks
    ];
    const result = computeFinancialEstimate(rows, 2);
    expect(result.needsValuePerClick).toBe(false);
    expect(result.totalUpliftClicks).toBe(50);
    expect(result.estimatedMonthlyValue).toBe(100);
  });
});

describe('models/SeoInsights — branded query detection', () => {
  it('flags queries containing the brand, case-insensitively', () => {
    expect(isBrandedQuery('Event Flow London')).toBe(true);
    expect(isBrandedQuery('eventflow reviews')).toBe(true);
    expect(isBrandedQuery('wedding photographer london')).toBe(false);
  });
});

describe('models/SeoInsights — keyword normalisation', () => {
  it('lowercases, trims, collapses whitespace and strips surrounding quotes', () => {
    expect(normaliseKeyword('  "Wedding   Venues"  ')).toBe('wedding venues');
  });

  it('handles empty/undefined input without throwing', () => {
    expect(normaliseKeyword(undefined)).toBe('');
    expect(normaliseKeyword('')).toBe('');
  });

  it('strips many repeated quote characters in linear time (no ReDoS)', () => {
    const adversarial = `${'"'.repeat(50000)}wedding venue${'"'.repeat(50000)}`;
    const start = Date.now();
    expect(normaliseKeyword(adversarial)).toBe('wedding venue');
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('seoInsights.service — getQueryTable (noise and brand filtering)', () => {
  const property = 'sc-domain:event-flow.co.uk';
  const baseRows = [
    {
      query: 'wedding venue',
      property,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      pulledAt: '2026-02-01T00:00:00.000Z',
      impressions: 100,
    },
    {
      query: 'event flow london',
      property,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      pulledAt: '2026-02-01T00:00:00.000Z',
      impressions: 50,
    },
    {
      query: 'venue flow systems',
      property,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      pulledAt: '2026-02-01T00:00:00.000Z',
      impressions: 200,
    },
  ];

  afterEach(() => jest.clearAllMocks());

  it('returns an empty result when no snapshot has ever been pulled', async () => {
    dbUnified.find.mockResolvedValue([]);
    const result = await seoInsights.getQueryTable({ property });
    expect(result).toEqual({ rows: [], periodStart: null, periodEnd: null });
  });

  it('excludes branded and noise-flagged queries by default', async () => {
    dbUnified.find.mockResolvedValue(baseRows);
    seoDataStore.listNoiseKeywords.mockResolvedValueOnce([{ id: 'venue flow systems' }]);

    const result = await seoInsights.getQueryTable({ property, includeBranded: false });

    expect(result.rows.map(r => r.query)).toEqual(['wedding venue']);
    expect(result.periodStart).toBe('2026-01-01');
  });

  it('keeps noise-flagged rows (annotated) when includeNoise is true', async () => {
    dbUnified.find.mockResolvedValue(baseRows);
    seoDataStore.listNoiseKeywords.mockResolvedValueOnce([{ id: 'venue flow systems' }]);

    const result = await seoInsights.getQueryTable({
      property,
      includeNoise: true,
      includeBranded: false,
    });

    const noiseRow = result.rows.find(r => r.query === 'venue flow systems');
    expect(noiseRow).toBeDefined();
    expect(noiseRow.isNoise).toBe(true);
  });
});

describe('seoInsights.service — striking-distance and low-CTR reports', () => {
  const property = 'sc-domain:event-flow.co.uk';

  afterEach(() => jest.clearAllMocks());

  it('striking-distance report scores and sorts flagged rows, excluding branded queries', async () => {
    dbUnified.find.mockResolvedValue([
      {
        query: 'event flow london',
        property,
        periodStart: 'p',
        periodEnd: 'p',
        pulledAt: 't',
        position: 6,
        impressions: 100,
        ctr: 0.01,
      },
      {
        query: 'low volume',
        property,
        periodStart: 'p',
        periodEnd: 'p',
        pulledAt: 't',
        position: 10,
        impressions: 200,
        ctr: 0.01,
      },
      {
        query: 'high volume',
        property,
        periodStart: 'p',
        periodEnd: 'p',
        pulledAt: 't',
        position: 10,
        impressions: 500,
        ctr: 0,
      },
    ]);

    const { rows } = await seoInsights.getStrikingDistanceReport({ property });

    expect(rows.map(r => r.query)).toEqual(['high volume', 'low volume']);
    expect(rows[0].opportunityScore).toBeGreaterThan(rows[1].opportunityScore);
  });

  it('low-CTR report attaches the expected-CTR benchmark to each flagged row', async () => {
    dbUnified.find.mockResolvedValue([
      {
        query: 'underperforming',
        property,
        periodStart: 'p',
        periodEnd: 'p',
        pulledAt: 't',
        position: 3,
        impressions: 100,
        ctr: 0.01,
      },
    ]);

    const { rows } = await seoInsights.getLowCtrReport({ property });

    expect(rows).toHaveLength(1);
    expect(rows[0].expectedCtr).toBe(getExpectedCtr(3));
  });
});

describe('seoInsights.service — content gaps', () => {
  const property = 'sc-domain:event-flow.co.uk';

  afterEach(() => jest.clearAllMocks());

  it('flags a keyword with real demand and no matching query presence', async () => {
    dbUnified.find.mockImplementation(async collection => {
      if (collection === COLLECTIONS.seoKeywordIdeas) {
        return [
          {
            keyword: 'balloon arch hire',
            avgMonthlySearches: 300,
            importedAt: '2026-02-01T00:00:00.000Z',
          },
        ];
      }
      return []; // no seo_query_snapshots at all
    });

    const { rows } = await seoInsights.getContentGapReport({ property });

    expect(rows).toHaveLength(1);
    expect(rows[0].keyword).toBe('balloon arch hire');
  });

  it('does not flag a keyword the site already gets meaningful impressions for', async () => {
    dbUnified.find.mockImplementation(async collection => {
      if (collection === COLLECTIONS.seoKeywordIdeas) {
        return [
          {
            keyword: 'wedding venue',
            avgMonthlySearches: 300,
            importedAt: '2026-02-01T00:00:00.000Z',
          },
        ];
      }
      return [
        {
          query: 'wedding venue',
          property,
          periodStart: 'p',
          periodEnd: 'p',
          pulledAt: 't',
          impressions: 500,
        },
      ];
    });

    const { rows } = await seoInsights.getContentGapReport({ property });
    expect(rows).toHaveLength(0);
  });

  it('prefers the most recently imported row when the same keyword has both sources', async () => {
    dbUnified.find.mockImplementation(async collection => {
      if (collection === COLLECTIONS.seoKeywordIdeas) {
        return [
          {
            keyword: 'balloon arch hire',
            avgMonthlySearches: 10,
            importedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            keyword: 'balloon arch hire',
            avgMonthlySearches: 900,
            importedAt: '2026-02-01T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const { rows } = await seoInsights.getContentGapReport({ property, minVolume: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0].avgMonthlySearches).toBe(900);
  });
});

describe('seoInsights.service — getFinancialEstimate (overlap dedup)', () => {
  const property = 'sc-domain:event-flow.co.uk';

  afterEach(() => jest.clearAllMocks());

  it('does not double-count a query that qualifies for both striking-distance and low-CTR', async () => {
    // position 5, well below its own CTR benchmark AND inside the 4-20 striking-distance band.
    dbUnified.find.mockResolvedValue([
      {
        query: 'overlapping query',
        property,
        periodStart: 'p',
        periodEnd: 'p',
        pulledAt: 't',
        position: 5,
        impressions: 1000,
        clicks: 1,
        ctr: 0.001,
      },
    ]);
    seoDataStore.getSettings.mockResolvedValueOnce({ id: 'default', valuePerClick: 2 });

    const result = await seoInsights.getFinancialEstimate({ property });

    const expectedUplift = computeUpliftClicks({ position: 5, impressions: 1000, clicks: 1 });
    expect(result.totalUpliftClicks).toBe(expectedUplift);
    expect(result.estimatedMonthlyValue).toBe(expectedUplift * 2);
  });

  it('reports needsValuePerClick when no value-per-click is configured', async () => {
    dbUnified.find.mockResolvedValue([]);
    const result = await seoInsights.getFinancialEstimate({ property });
    expect(result.needsValuePerClick).toBe(true);
  });
});

describe('seoInsights.service — getOverview', () => {
  const property = 'sc-domain:event-flow.co.uk';

  afterEach(() => jest.clearAllMocks());

  it('aggregates counts across all reports', async () => {
    dbUnified.find.mockImplementation(async collection => {
      if (collection === COLLECTIONS.seoKeywordIdeas) {
        return [];
      }
      return [
        {
          query: 'a',
          property,
          periodStart: 'p',
          periodEnd: 'p',
          pulledAt: 't',
          position: 6,
          impressions: 100,
          clicks: 10,
          ctr: 0.1,
        },
      ];
    });

    const overview = await seoInsights.getOverview({ property });

    expect(overview.totalNonBrandedQueries).toBe(1);
    expect(overview.totalImpressions).toBe(100);
    expect(overview.totalClicks).toBe(10);
    expect(seoDataStore.getAllIngestionStatus).toHaveBeenCalled();
  });
});
