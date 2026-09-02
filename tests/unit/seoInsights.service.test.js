/**
 * Unit tests for the SEO Insights scoring logic — the pure functions
 * that decide what counts as a striking-distance keyword, a low-CTR
 * opportunity, and how the financial estimate is computed. No database.
 */

'use strict';

const {
  getExpectedCtr,
  computeOpportunityScore,
  isStrikingDistance,
  isLowCtrOpportunity,
  computeUpliftClicks,
  computeFinancialEstimate,
} = require('../../services/seoInsights.service');
const { isBrandedQuery, normaliseKeyword } = require('../../models/SeoInsights');

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
});
