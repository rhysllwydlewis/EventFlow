/**
 * Cache Routes
 * Cache management and database metrics endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let roleRequired;
let csrfProtection;
let cache;
let sentry;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Cache routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'csrfProtection',
    'cache',
    'sentry',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Cache routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  csrfProtection = deps.csrfProtection;
  cache = deps.cache;
  sentry = deps.sentry;
}

/**
 * Deferred middleware wrappers
 * These are safe to reference in route definitions at require() time
 * because they defer the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

// ---------- Cache Routes ----------

router.get('/stats', applyAuthRequired, applyRoleRequired('admin'), (_req, res) => {
  try {
    const cacheStats = cache.getStats();
    res.json({
      cache: cacheStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    sentry.captureException(error);
    res.status(500).json({ error: 'Failed to get cache statistics' });
  }
});

// Query performance metrics endpoint (admin only)
router.get('/database/metrics', applyAuthRequired, applyRoleRequired('admin'), (_req, res) => {
  try {
    const queryMetrics = dbUnified.getQueryMetrics ? dbUnified.getQueryMetrics() : {};
    res.json({
      metrics: queryMetrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error getting query metrics:', error);
    sentry.captureException(error);
    res.status(500).json({ error: 'Failed to get database metrics' });
  }
});

// Cache clear endpoint (admin only)
router.post(
  '/clear',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (_req, res) => {
    try {
      await cache.clear();
      res.json({
        success: true,
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Error clearing cache:', error);
      sentry.captureException(error);
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
