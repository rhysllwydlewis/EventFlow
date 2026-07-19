/**
 * Search Routes
 * Search suppliers, history, categories, and amenities
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { searchLimiter } = require('../middleware/rateLimits');
const { buildPublicSupplierSlug } = require('../services/publicSupplierSeo.service');
const router = express.Router();

// These will be injected by server.js during route mounting
let authRequired;
let searchSystem;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Search routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = ['authRequired', 'searchSystem'];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Search routes: missing required dependencies: ${missing.join(', ')}`);
  }

  authRequired = deps.authRequired;
  searchSystem = deps.searchSystem;
}

/**
 * Deferred middleware wrapper
 * Safe to reference in route definitions at require() time
 * because it defers the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function addPublicProfilePath(supplier) {
  if (!supplier || typeof supplier !== 'object') {
    return supplier;
  }

  const supplierName = supplier.name || supplier.businessName || supplier.company;
  if (!supplier.id || !supplierName) {
    return supplier;
  }

  const slug = buildPublicSupplierSlug({ ...supplier, name: supplierName });
  if (!slug) {
    return supplier;
  }

  return {
    ...supplier,
    publicProfilePath: `/supplier/${slug}`,
  };
}

function addPublicProfilePaths(searchResults) {
  const output = { ...(searchResults || {}) };

  if (Array.isArray(output.results)) {
    output.results = output.results.map(addPublicProfilePath);
  }

  if (output.fallback && Array.isArray(output.fallback.suggestions)) {
    output.fallback = {
      ...output.fallback,
      suggestions: output.fallback.suggestions.map(addPublicProfilePath),
    };
  }

  return output;
}

// ---------- Search Routes ----------

router.get('/suppliers', searchLimiter, async (req, res) => {
  try {
    const rawResults = await searchSystem.searchSuppliers(req.query);
    const results = addPublicProfilePaths(rawResults);

    // Save to search history if user is authenticated
    if (req.user && req.query.q) {
      await searchSystem.saveSearchHistory(req.user.id, req.query);
    }

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get user's search history
 * GET /api/search/history
 */
router.get('/history', searchLimiter, applyAuthRequired, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const history = await searchSystem.getUserSearchHistory(req.user.id, limit);

    res.json({
      success: true,
      count: history.length,
      history,
    });
  } catch (error) {
    logger.error('Get search history error:', error);
    res.status(500).json({
      error: 'Failed to get search history',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get all categories
 * GET /api/search/categories
 */
router.get('/categories', async (req, res) => {
  try {
    const categories = await searchSystem.getCategories();

    res.json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (error) {
    logger.error('Get categories error:', error);
    res.status(500).json({
      error: 'Failed to get categories',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get all amenities
 * GET /api/search/amenities
 */
router.get('/amenities', async (req, res) => {
  try {
    const amenities = await searchSystem.getAmenities();

    res.json({
      success: true,
      count: amenities.length,
      amenities,
    });
  } catch (error) {
    logger.error('Get amenities error:', error);
    res.status(500).json({
      error: 'Failed to get amenities',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
module.exports.addPublicProfilePath = addPublicProfilePath;
module.exports.addPublicProfilePaths = addPublicProfilePaths;
