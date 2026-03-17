/**
 * Discovery Routes
 * Trending suppliers, new arrivals, popular packages, and recommendations
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { searchLimiter } = require('../middleware/rateLimits');
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
    throw new Error('Discovery routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = ['authRequired', 'searchSystem'];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Discovery routes: missing required dependencies: ${missing.join(', ')}`);
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

// ---------- Discovery Routes ----------

/**
 * Get trending suppliers
 * GET /api/discovery/trending
 *
 * @swagger
 * /api/v1/discovery/trending:
 *   get:
 *     summary: Get trending suppliers
 *     description: Retrieve list of trending event service suppliers
 *     tags:
 *       - Discovery
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of suppliers to return
 *     responses:
 *       200:
 *         description: Trending suppliers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 10
 *                 suppliers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Supplier'
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.get('/trending', searchLimiter, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const trending = await searchSystem.getTrendingSuppliers(limit);

    res.json({
      success: true,
      count: trending.length,
      suppliers: trending,
    });
  } catch (error) {
    logger.error('Get trending error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get trending suppliers',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * Get new arrivals
 * GET /api/discovery/new
 *
 * @swagger
 * /api/v1/discovery/new:
 *   get:
 *     summary: Get new suppliers
 *     description: Retrieve recently added event service suppliers
 *     tags:
 *       - Discovery
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of suppliers to return
 *     responses:
 *       200:
 *         description: New suppliers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 10
 *                 suppliers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Supplier'
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.get('/new', searchLimiter, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const newSuppliers = await searchSystem.getNewArrivals(limit);

    res.json({
      success: true,
      count: newSuppliers.length,
      suppliers: newSuppliers,
    });
  } catch (error) {
    logger.error('Get new arrivals error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get new suppliers',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * Get popular packages
 * GET /api/discovery/popular-packages
 *
 * @swagger
 * /api/v1/discovery/popular-packages:
 *   get:
 *     summary: Get popular packages
 *     description: Retrieve most popular event packages
 *     tags:
 *       - Discovery
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of packages to return
 *     responses:
 *       200:
 *         description: Popular packages retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 10
 *                 packages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Package'
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.get('/popular-packages', searchLimiter, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const packages = await searchSystem.getPopularPackages(limit);

    res.json({
      success: true,
      count: packages.length,
      packages,
    });
  } catch (error) {
    logger.error('Get popular packages error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get popular packages',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * Get personalized recommendations
 * GET /api/discovery/recommendations
 */
router.get('/recommendations', searchLimiter, applyAuthRequired, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const recommendations = await searchSystem.getRecommendations(req.user.id, limit);

    res.json({
      success: true,
      count: recommendations.length,
      suppliers: recommendations,
    });
  } catch (error) {
    logger.error('Get recommendations error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get recommendations',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
