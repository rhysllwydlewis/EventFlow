/**
 * EventFlow SEO Insights dashboard — shared model constants
 *
 * Two independent data sources feed the same `seo_keyword_ideas` shape:
 * the Google Ads API (source: 'google_ads_api') when it's configured, and
 * a manual Keyword Planner CSV export (source: 'csv_import') as a fallback
 * that needs no API approval. The insights layer always prefers the most
 * recent row for a given keyword regardless of which source produced it.
 */

'use strict';

const COLLECTIONS = {
  seoQuerySnapshots: 'seo_query_snapshots',
  seoKeywordIdeas: 'seo_keyword_ideas',
  seoNoiseKeywords: 'seo_noise_keywords',
  seoIngestionStatus: 'seo_ingestion_status',
  seoSettings: 'seo_settings',
};

const KEYWORD_SOURCES = {
  googleAdsApi: 'google_ads_api',
  csvImport: 'csv_import',
};

const INGESTION_SOURCES = {
  gsc: 'gsc',
  keywordPlannerApi: 'keyword_planner_api',
  keywordCsv: 'keyword_csv',
};

const INGESTION_STATUS = {
  success: 'success',
  error: 'error',
  running: 'running',
};

/** Brand terms used to split branded vs non-branded queries. Lowercase, no spaces-only tokens. */
const BRAND_TERMS = ['event flow', 'eventflow', 'event-flow'];

function isBrandedQuery(query) {
  const normalised = String(query || '').toLowerCase();
  return BRAND_TERMS.some(term => normalised.includes(term));
}

/** Strips leading/trailing quote characters with plain indexing — no regex backtracking on attacker-controlled input. */
function stripSurroundingQuotes(text) {
  let start = 0;
  let end = text.length;
  while (start < end && (text[start] === '"' || text[start] === "'")) {
    start += 1;
  }
  while (end > start && (text[end - 1] === '"' || text[end - 1] === "'")) {
    end -= 1;
  }
  return text.slice(start, end);
}

/** Normalises a query/keyword for matching and dedupe: lowercase, collapsed whitespace, no surrounding quotes. */
function normaliseKeyword(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return stripSurroundingQuotes(text).replace(/\s+/g, ' ');
}

const SEO_SETTINGS_DOC_ID = 'default';
const DEFAULT_SEO_SETTINGS = {
  id: SEO_SETTINGS_DOC_ID,
  valuePerClick: null, // GBP; admin-set, never assumed
};

module.exports = {
  COLLECTIONS,
  KEYWORD_SOURCES,
  INGESTION_SOURCES,
  INGESTION_STATUS,
  BRAND_TERMS,
  SEO_SETTINGS_DOC_ID,
  DEFAULT_SEO_SETTINGS,
  isBrandedQuery,
  normaliseKeyword,
};
