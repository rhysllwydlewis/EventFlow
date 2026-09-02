/**
 * Scoring and reporting for the SEO Insights dashboard. Pure scoring
 * functions are exported separately from the data-fetching functions so
 * the scoring logic (opportunity score, expected-CTR benchmark, noise
 * filter) can be unit tested without touching the database.
 */

'use strict';

const dbUnified = require('../db-unified');
const seoDataStore = require('./seoDataStore');
const { COLLECTIONS, isBrandedQuery } = require('../models/SeoInsights');

// Rough organic CTR-by-position benchmark, blended desktop+mobile, used only
// to prioritise which pages are underperforming for their rank — not a
// precise prediction. Position beyond the table uses the last value.
const EXPECTED_CTR_BY_POSITION = {
  1: 0.28,
  2: 0.15,
  3: 0.11,
  4: 0.08,
  5: 0.06,
  6: 0.05,
  7: 0.04,
  8: 0.03,
  9: 0.03,
  10: 0.02,
  11: 0.015,
  12: 0.013,
  13: 0.011,
  14: 0.01,
  15: 0.009,
  16: 0.008,
  17: 0.007,
  18: 0.006,
  19: 0.006,
  20: 0.005,
};

function getExpectedCtr(position) {
  const rounded = Math.max(1, Math.round(position));
  if (EXPECTED_CTR_BY_POSITION[rounded] !== undefined) {
    return EXPECTED_CTR_BY_POSITION[rounded];
  }
  return rounded > 20 ? 0.003 : EXPECTED_CTR_BY_POSITION[20];
}

/** Rewrite-candidate score: impressions being wasted on a poor CTR. Higher = bigger opportunity. */
function computeOpportunityScore(row) {
  const impressions = Number(row.impressions) || 0;
  const ctr = Number(row.ctr) || 0;
  return Math.round(impressions * (1 - ctr));
}

function isStrikingDistance(row, { positionMin = 4, positionMax = 20, minImpressions = 20 } = {}) {
  const position = Number(row.position);
  const impressions = Number(row.impressions) || 0;
  return position >= positionMin && position <= positionMax && impressions >= minImpressions;
}

/** True when actual CTR is well below the position-appropriate benchmark. */
function isLowCtrOpportunity(
  row,
  { positionMax = 10, minImpressions = 20, ctrRatioThreshold = 0.5 } = {}
) {
  const position = Number(row.position);
  const impressions = Number(row.impressions) || 0;
  const ctr = Number(row.ctr) || 0;
  if (position > positionMax || impressions < minImpressions) {
    return false;
  }
  const expected = getExpectedCtr(position);
  return ctr < expected * ctrRatioThreshold;
}

/** Extra clicks a row would gain if it reached its position-appropriate CTR benchmark. */
function computeUpliftClicks(row) {
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  const expected = getExpectedCtr(Number(row.position));
  const expectedClicks = impressions * expected;
  return Math.max(0, Math.round(expectedClicks - clicks));
}

function computeFinancialEstimate(rows, valuePerClick) {
  if (!valuePerClick || valuePerClick <= 0) {
    return { estimatedMonthlyValue: null, needsValuePerClick: true, totalUpliftClicks: 0 };
  }
  const totalUpliftClicks = rows.reduce((sum, row) => sum + computeUpliftClicks(row), 0);
  return {
    estimatedMonthlyValue: Math.round(totalUpliftClicks * valuePerClick * 100) / 100,
    needsValuePerClick: false,
    totalUpliftClicks,
  };
}

// ---------------------------------------------------------------------------
// Data-fetching (touches the database)
// ---------------------------------------------------------------------------

async function getLatestPeriod(property) {
  const rows = await dbUnified.find(COLLECTIONS.seoQuerySnapshots, { property });
  if (!rows.length) {
    return null;
  }
  return rows.reduce(
    (latest, row) => (!latest || row.pulledAt > latest.pulledAt ? row : latest),
    null
  );
}

function getSnapshotRows(property, { periodStart, periodEnd } = {}) {
  const filter = { property };
  if (periodStart) {
    filter.periodStart = periodStart;
  }
  if (periodEnd) {
    filter.periodEnd = periodEnd;
  }
  return dbUnified.find(COLLECTIONS.seoQuerySnapshots, filter);
}

async function annotateNoise(rows) {
  const noiseKeywords = await seoDataStore.listNoiseKeywords();
  const noiseSet = new Set(noiseKeywords.map(n => n.id));
  return rows.map(row => ({ ...row, isNoise: noiseSet.has(row.query) }));
}

async function getQueryTable({ property, includeNoise = false, includeBranded = true } = {}) {
  const latest = await getLatestPeriod(property);
  if (!latest) {
    return { rows: [], periodStart: null, periodEnd: null };
  }

  let rows = await getSnapshotRows(property, {
    periodStart: latest.periodStart,
    periodEnd: latest.periodEnd,
  });
  rows = await annotateNoise(rows);

  if (!includeNoise) {
    rows = rows.filter(r => !r.isNoise);
  }
  if (!includeBranded) {
    rows = rows.filter(r => !isBrandedQuery(r.query));
  }

  return { rows, periodStart: latest.periodStart, periodEnd: latest.periodEnd };
}

async function getStrikingDistanceReport({
  property,
  positionMin,
  positionMax,
  minImpressions,
} = {}) {
  const { rows, periodStart, periodEnd } = await getQueryTable({ property, includeBranded: false });
  const flagged = rows
    .filter(row => isStrikingDistance(row, { positionMin, positionMax, minImpressions }))
    .map(row => ({ ...row, opportunityScore: computeOpportunityScore(row) }))
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
  return { rows: flagged, periodStart, periodEnd };
}

async function getLowCtrReport({ property, positionMax, minImpressions, ctrRatioThreshold } = {}) {
  const { rows, periodStart, periodEnd } = await getQueryTable({ property, includeBranded: false });
  const flagged = rows
    .filter(row => isLowCtrOpportunity(row, { positionMax, minImpressions, ctrRatioThreshold }))
    .map(row => ({
      ...row,
      expectedCtr: getExpectedCtr(row.position),
      opportunityScore: computeOpportunityScore(row),
    }))
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
  return { rows: flagged, periodStart, periodEnd };
}

/**
 * Content-gap report: keyword-idea rows (whichever source is newest per
 * keyword) with real demand but little-to-no matching GSC presence. Match
 * is a normalised exact/substring check — fuzzy matching is out of scope
 * for phase 1.
 */
async function getContentGapReport({ property, minVolume = 50, maxMatchingImpressions = 5 } = {}) {
  const allIdeas = await dbUnified.find(COLLECTIONS.seoKeywordIdeas, {});
  const latestByKeyword = new Map();
  for (const idea of allIdeas) {
    const existing = latestByKeyword.get(idea.keyword);
    if (!existing || idea.importedAt > existing.importedAt) {
      latestByKeyword.set(idea.keyword, idea);
    }
  }

  const { rows: queryRows } = await getQueryTable({
    property,
    includeBranded: true,
    includeNoise: false,
  });

  const gaps = [];
  for (const idea of latestByKeyword.values()) {
    if (!idea.avgMonthlySearches || idea.avgMonthlySearches < minVolume) {
      continue;
    }
    const matchingImpressions = queryRows
      .filter(row => row.query.includes(idea.keyword) || idea.keyword.includes(row.query))
      .reduce((sum, row) => sum + (Number(row.impressions) || 0), 0);
    if (matchingImpressions <= maxMatchingImpressions) {
      gaps.push({ ...idea, matchingImpressions });
    }
  }

  gaps.sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches);
  return { rows: gaps };
}

async function getFinancialEstimate({ property } = {}) {
  const settings = await seoDataStore.getSettings();
  const { rows: strikingDistance } = await getStrikingDistanceReport({ property });
  const { rows: lowCtr } = await getLowCtrReport({ property });

  // A query at position 4-10 can satisfy both reports; dedupe by query
  // before valuing it, or its uplift clicks get counted twice.
  const byQuery = new Map();
  for (const row of [...strikingDistance, ...lowCtr]) {
    byQuery.set(row.query, row);
  }

  return computeFinancialEstimate(Array.from(byQuery.values()), settings.valuePerClick);
}

async function getOverview({ property } = {}) {
  const { rows, periodStart, periodEnd } = await getQueryTable({ property, includeBranded: false });
  const strikingDistance = rows.filter(row => isStrikingDistance(row, {}));
  const lowCtr = rows.filter(row => isLowCtrOpportunity(row, {}));
  const { rows: contentGaps } = await getContentGapReport({ property });
  const ingestionStatus = await seoDataStore.getAllIngestionStatus();

  return {
    periodStart,
    periodEnd,
    totalNonBrandedQueries: rows.length,
    totalImpressions: rows.reduce((sum, r) => sum + (Number(r.impressions) || 0), 0),
    totalClicks: rows.reduce((sum, r) => sum + (Number(r.clicks) || 0), 0),
    strikingDistanceCount: strikingDistance.length,
    lowCtrCount: lowCtr.length,
    contentGapCount: contentGaps.length,
    ingestionStatus,
  };
}

module.exports = {
  // pure, unit-tested
  EXPECTED_CTR_BY_POSITION,
  getExpectedCtr,
  computeOpportunityScore,
  isStrikingDistance,
  isLowCtrOpportunity,
  computeUpliftClicks,
  computeFinancialEstimate,
  // data-fetching
  getLatestPeriod,
  getQueryTable,
  getStrikingDistanceReport,
  getLowCtrReport,
  getContentGapReport,
  getFinancialEstimate,
  getOverview,
};
