/**
 * Pulls query-level performance from Google Search Console for the
 * configured property and stores one snapshot per ingestion run, so the
 * insights layer can compare "latest run" vs "previous run" for trends.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const googleSearchConsole = require('./googleSearchConsole.service');
const seoDataStore = require('./seoDataStore');
const {
  COLLECTIONS,
  INGESTION_SOURCES,
  INGESTION_STATUS,
  isBrandedQuery,
  normaliseKeyword,
} = require('../models/SeoInsights');

const DEFAULT_LOOKBACK_DAYS = 28;

function defaultDateRange() {
  const end = new Date();
  end.setDate(end.getDate() - 2); // GSC data lags; avoid the incomplete last 36-48h.
  const start = new Date(end);
  start.setDate(start.getDate() - DEFAULT_LOOKBACK_DAYS);
  const toIso = d => d.toISOString().slice(0, 10);
  return { startDate: toIso(start), endDate: toIso(end) };
}

/**
 * Runs a GSC pull and stores it as a new snapshot batch, tagged with the
 * period it covers and when it was pulled.
 */
async function runIngestion({ startDate, endDate, triggeredBy } = {}) {
  if (!googleSearchConsole.isConfigured()) {
    const message =
      'Google Search Console is not configured (missing GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL / _PRIVATE_KEY / _PROPERTY).';
    await seoDataStore.recordIngestionStatus(INGESTION_SOURCES.gsc, INGESTION_STATUS.error, {
      lastError: message,
      triggeredBy,
    });
    const error = new Error(message);
    error.code = 'GSC_NOT_CONFIGURED';
    throw error;
  }

  const range = startDate && endDate ? { startDate, endDate } : defaultDateRange();

  let rows;
  try {
    rows = await googleSearchConsole.fetchQueryPerformance(range);
  } catch (error) {
    await seoDataStore.recordIngestionStatus(INGESTION_SOURCES.gsc, INGESTION_STATUS.error, {
      lastError: error.message,
      triggeredBy,
    });
    throw error;
  }

  const pulledAt = new Date().toISOString();
  const property = process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY;

  // Replace this period's whole prior batch rather than upserting over it:
  // a query that drops out of this run (or a run that comes back empty)
  // would otherwise leave its stale row from the last pull in every report.
  await dbUnified.deleteMany(COLLECTIONS.seoQuerySnapshots, {
    property,
    periodStart: range.startDate,
    periodEnd: range.endDate,
  });

  let written = 0;

  for (const row of rows) {
    const query = normaliseKeyword(row.query);
    if (!query) {
      continue;
    }
    const docId = `${range.startDate}_${range.endDate}:${query}`;
    await seoDataStore.upsertById(COLLECTIONS.seoQuerySnapshots, docId, {
      property,
      query,
      periodStart: range.startDate,
      periodEnd: range.endDate,
      pulledAt,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      isBranded: isBrandedQuery(query),
    });
    written += 1;
  }

  await seoDataStore.recordIngestionStatus(INGESTION_SOURCES.gsc, INGESTION_STATUS.success, {
    lastError: null,
    rowsWritten: written,
    periodStart: range.startDate,
    periodEnd: range.endDate,
    triggeredBy,
  });

  logger.info(
    `SEO: GSC ingestion wrote ${written} query rows for ${range.startDate} to ${range.endDate}`
  );
  return { periodStart: range.startDate, periodEnd: range.endDate, rowsWritten: written };
}

module.exports = { runIngestion, defaultDateRange };
