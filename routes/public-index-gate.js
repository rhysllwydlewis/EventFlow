/**
 * Empty/invalid-inventory SEO index gating for pages served as static HTML
 * shells (audit finding SEO-005): `/suppliers` with a filter combination
 * that returns nothing, and the `/public-calendar` hub when the calendar
 * currently holds no indexable events.
 *
 * Both pages already carry a static, query-independent
 * `<link rel="canonical">` back to their own bare URL (public/suppliers.html
 * and public/public-calendar.html), so an empty/invalid filtered URL is
 * already consolidated to the right parent by construction — the piece that
 * was missing is the `noindex` signal itself. This sets it via the
 * X-Robots-Tag response header (equivalent to a meta robots tag, and read
 * the same way by crawlers) before handing off to templateMiddleware, which
 * serves the actual shell unchanged. The underlying category/filter
 * architecture is not touched — only its indexability.
 */

'use strict';

const express = require('express');
const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { publicReadLimiter } = require('../middleware/rateLimits');
const emptyStateIndexGate = require('../services/emptyStateIndexGate.service');

/** Query keys that turn a bare /suppliers request into a specific filter combination. */
const SUPPLIER_FILTER_KEYS = [
  'q',
  'category',
  'eventType',
  'location',
  'postcode',
  'maxDistance',
  'minPrice',
  'maxPrice',
  // The browser persists the price selector as `priceLevel` (see
  // public/assets/js/utils/url-state.js), not `minPrice`/`maxPrice` — a
  // filtered URL like /suppliers?priceLevel=4 must count as a filter here
  // too, or it skips the empty-result check entirely.
  'priceLevel',
  'minRating',
  'amenities',
  'minGuests',
  'proOnly',
  'featuredOnly',
  'verifiedOnly',
];

function hasSupplierFilters(query) {
  return SUPPLIER_FILTER_KEYS.some(key => {
    const value = query[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

/**
 * Translate the public `priceLevel` query param into the `minPrice`/
 * `maxPrice` pair the search service actually understands — mirrors
 * suppliers-init.js's own translation when it calls the search API, so this
 * gate evaluates the same result set the visitor's browser would see.
 * @param {Object} query Raw request query.
 * @returns {Object} Query with priceLevel expanded, if present.
 */
function withPriceLevelExpanded(query) {
  if (query.priceLevel === undefined || query.priceLevel === null || query.priceLevel === '') {
    return query;
  }
  return { ...query, minPrice: query.priceLevel, maxPrice: query.priceLevel };
}

router.get('/suppliers', publicReadLimiter, async (req, res, next) => {
  try {
    if (hasSupplierFilters(req.query)) {
      // Lazily required: rankedSupplierSearch pulls in the full search/ranking
      // stack, which several unit tests stub out independently of this route.
      const rankedSupplierSearch = require('../services/rankedSupplierSearch.service');
      const result = await rankedSupplierSearch.searchSuppliers(withPriceLevelExpanded(req.query));
      const total = result?.pagination?.total ?? 0;
      if (!emptyStateIndexGate.supplierFilterResultsAreIndexable(total)) {
        res.setHeader('X-Robots-Tag', 'noindex, follow');
      }
    }
  } catch (error) {
    // Never let an index-gating failure take the supplier listing page down —
    // worst case it stays indexable, which templateMiddleware's own gate
    // still governs for the base page.
    logger.error('public-index-gate: could not evaluate supplier filter results', {
      error: error.message,
    });
  }
  return next();
});

router.get('/public-calendar', publicReadLimiter, async (req, res, next) => {
  try {
    const events = await dbUnified.read('public_calendar_events');
    const indexableCount = emptyStateIndexGate.countIndexableEvents(events);
    if (!emptyStateIndexGate.calendarIsIndexable(indexableCount)) {
      res.setHeader('X-Robots-Tag', 'noindex, follow');
    }
  } catch (error) {
    logger.error('public-index-gate: could not evaluate calendar inventory', {
      error: error.message,
    });
  }
  return next();
});

module.exports = router;
module.exports.__internal = { hasSupplierFilters, SUPPLIER_FILTER_KEYS };
