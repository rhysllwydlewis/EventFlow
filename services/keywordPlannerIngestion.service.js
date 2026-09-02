/**
 * Pulls keyword demand data (search volume) from the Google Ads API and
 * stores it alongside whatever the CSV fallback has imported, in the
 * same seo_keyword_ideas shape. See keywordCsvImport.service.js for the
 * no-API fallback path.
 */

'use strict';

const logger = require('../utils/logger');
const googleAdsClient = require('./googleAdsClient');
const seoDataStore = require('./seoDataStore');
const { VALID_CATEGORIES } = require('../models/Supplier');
const ukCities = require('../data/uk-cities.json');
const {
  COLLECTIONS,
  KEYWORD_SOURCES,
  INGESTION_SOURCES,
  INGESTION_STATUS,
  normaliseKeyword,
} = require('../models/SeoInsights');

// Google Ads caps keyword-idea seed lists; keep well under it and keep the
// list meaningful rather than exhaustive (every category × every city would
// be hundreds of calls). A handful of top cities plus category-only and
// generic "wedding X" phrasings covers the highest-intent terms.
const TOP_CITY_COUNT = 6;
const MAX_SEEDS_PER_CALL = 20;

function buildSeedKeywords() {
  const categories = VALID_CATEGORIES.map(c => c.toLowerCase());
  const topCities = ukCities.slice(0, TOP_CITY_COUNT).map(c => c.name);

  const seeds = new Set();
  for (const category of categories) {
    seeds.add(category);
    seeds.add(`wedding ${category}`);
    for (const city of topCities) {
      seeds.add(`${category} in ${city}`);
    }
  }

  return Array.from(seeds).slice(0, MAX_SEEDS_PER_CALL);
}

/**
 * Runs a Google Ads keyword-ideas pull and upserts results into
 * seo_keyword_ideas with source = 'google_ads_api'.
 */
async function runIngestion({ triggeredBy } = {}) {
  if (!googleAdsClient.isConfigured()) {
    const message = googleAdsClient.missingConfigMessage();
    await seoDataStore.recordIngestionStatus(
      INGESTION_SOURCES.keywordPlannerApi,
      INGESTION_STATUS.error,
      {
        lastError: message,
        triggeredBy,
      }
    );
    const error = new Error(message);
    error.code = 'GOOGLE_ADS_NOT_CONFIGURED';
    throw error;
  }

  const seeds = buildSeedKeywords();
  logger.info(`SEO: requesting keyword ideas for ${seeds.length} seed phrases`);

  let ideas;
  try {
    ideas = await googleAdsClient.generateKeywordIdeas(seeds);
  } catch (error) {
    await seoDataStore.recordIngestionStatus(
      INGESTION_SOURCES.keywordPlannerApi,
      INGESTION_STATUS.error,
      {
        lastError: error.message,
        triggeredBy,
      }
    );
    throw error;
  }

  const importedAt = new Date().toISOString();
  let written = 0;
  for (const idea of ideas) {
    const keyword = normaliseKeyword(idea.keyword);
    if (!keyword) {
      continue;
    }
    const docId = `${KEYWORD_SOURCES.googleAdsApi}:${keyword}`;
    await seoDataStore.upsertById(COLLECTIONS.seoKeywordIdeas, docId, {
      keyword,
      avgMonthlySearches: idea.avgMonthlySearches,
      volumeIsBucketed: false,
      competition: idea.competition,
      source: KEYWORD_SOURCES.googleAdsApi,
      importedAt,
      importedBy: triggeredBy || 'scheduled',
    });
    written += 1;
  }

  await seoDataStore.recordIngestionStatus(
    INGESTION_SOURCES.keywordPlannerApi,
    INGESTION_STATUS.success,
    {
      lastError: null,
      rowsWritten: written,
      triggeredBy,
    }
  );

  return { seedsUsed: seeds.length, ideasReturned: ideas.length, rowsWritten: written };
}

module.exports = { buildSeedKeywords, runIngestion };
