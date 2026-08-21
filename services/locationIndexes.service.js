/**
 * EventFlow UK locations — index bootstrap
 *
 * Idempotent index creation for the location page records and for the supplier
 * geography fields the matcher reads. Every index is named explicitly so a
 * repeated deploy reconciles rather than duplicating, and the whole routine is
 * safe to run on every boot.
 */

'use strict';

const logger = require('../utils/logger');
const { COLLECTIONS } = require('../models/LocationContent');

let ensurePromise = null;

/**
 * Create every location index on the supplied database handle.
 * @param {Object} db MongoDB database handle.
 * @returns {Promise<void>} Resolves when all indexes exist.
 */
async function createIndexes(db) {
  const pages = db.collection(COLLECTIONS.locationPages);
  await pages.createIndex({ locationSlug: 1 }, { name: 'uniq_location_page_slug', unique: true });
  await pages.createIndex(
    { status: 1, indexingRequested: 1 },
    { name: 'location_page_publication' }
  );
  await pages.createIndex({ lastReviewedAt: 1 }, { name: 'location_page_review_age' });

  const categoryPages = db.collection(COLLECTIONS.locationCategoryPages);
  await categoryPages.createIndex(
    { locationSlug: 1, categorySlug: 1 },
    { name: 'uniq_location_category_page', unique: true }
  );
  await categoryPages.createIndex(
    { status: 1, indexingRequested: 1 },
    { name: 'location_category_page_publication' }
  );
  await categoryPages.createIndex(
    { lastReviewedAt: 1 },
    { name: 'location_category_page_review_age' }
  );

  const suppliers = db.collection('suppliers');
  // The city page's first question is always "who is based here?".
  await suppliers.createIndex(
    { 'baseLocation.citySlug': 1, approved: 1 },
    { name: 'supplier_base_city' }
  );
  // Explicit service areas are a multikey lookup on the same question.
  await suppliers.createIndex(
    { 'serviceAreas.slug': 1, approved: 1 },
    { name: 'supplier_service_area_slug' }
  );
  // Radius matching is a geospatial query against the supplier's base point.
  await suppliers.createIndex(
    { 'baseLocation.coordinates': '2dsphere' },
    { name: 'supplier_base_coordinates' }
  );
}

/**
 * Ensure all location indexes exist. Safe to call repeatedly; the work runs at
 * most once per process unless it fails.
 * @returns {Promise<boolean>} True once indexes are in place.
 */
function ensureIndexes() {
  if (ensurePromise) {
    return ensurePromise;
  }
  ensurePromise = (async () => {
    const { getDb } = require('../db');
    const db = await getDb();
    await createIndexes(db);
    logger.info('[LOCATIONS] Location indexes ensured');
    return true;
  })().catch(error => {
    ensurePromise = null;
    logger.warn('[LOCATIONS] Location index initialisation failed', { error: error.message });
    throw error;
  });
  return ensurePromise;
}

/** Reset memoised state between tests. */
function resetForTests() {
  ensurePromise = null;
}

module.exports = {
  ensureIndexes,
  _test: { createIndexes, resetForTests },
};
