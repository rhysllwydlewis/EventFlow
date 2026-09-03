/**
 * A/B Testing Middleware (P3-30: A/B Testing Framework)
 * Provides simple A/B testing functionality for experiments
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { csrfProtection } = require('./csrf');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const crypto = require('crypto');

const router = express.Router();

/**
 * Define active experiments
 * Each experiment has variants with different configurations
 */
const experiments = {
  'homepage-hero-cta': {
    name: 'Homepage Hero CTA Text',
    description: 'Test different CTA button text on homepage',
    variants: {
      control: 'Start Planning',
      variantA: 'Plan Your Event',
      variantB: 'Get Started Free',
    },
    active: true,
  },
  'supplier-card-layout': {
    name: 'Supplier Card Layout',
    description: 'Test different supplier card designs',
    variants: {
      control: 'standard',
      variantA: 'compact',
      variantB: 'expanded',
    },
    active: true,
  },
  'pricing-page-layout': {
    name: 'Pricing Page Layout',
    description: 'Test different pricing page layouts',
    variants: {
      control: 'horizontal',
      variantA: 'vertical',
      variantB: 'comparison-table',
    },
    active: true,
  },
};

/**
 * Hash function to consistently assign users to variants
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Assign a user to a variant based on their ID
 * Uses consistent hashing so the same user always gets the same variant
 */
function assignVariant(userId, experimentName) {
  const experiment = experiments[experimentName];

  if (!experiment || !experiment.active) {
    return 'control';
  }

  const variants = Object.keys(experiment.variants);
  const hash = hashCode(userId + experimentName);
  const variantIndex = hash % variants.length;

  return variants[variantIndex];
}

/**
 * GET /api/experiments
 * Get list of active experiments
 */
router.get('/', (req, res) => {
  try {
    const activeExperiments = Object.entries(experiments)
      .filter(([_, exp]) => exp.active)
      .map(([key, exp]) => ({
        id: key,
        name: exp.name,
        description: exp.description,
        variantCount: Object.keys(exp.variants).length,
      }));

    res.json({
      success: true,
      experiments: activeExperiments,
    });
  } catch (error) {
    logger.error('Error fetching experiments:', error);
    res.status(500).json({ error: 'Failed to fetch experiments' });
  }
});

/**
 * GET /api/experiments/:name/variant
 * Get the assigned variant for a user in an experiment
 */
router.get('/:name/variant', (req, res) => {
  try {
    const experimentName = req.params.name;

    // Check if experiment exists
    if (!experiments[experimentName]) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    // Get user ID (from auth or session)
    const userId = req.user?.id || req.sessionID || crypto.randomBytes(16).toString('hex');

    // Assign variant
    const variant = assignVariant(userId, experimentName);
    const variantValue = experiments[experimentName].variants[variant];

    res.json({
      success: true,
      experiment: experimentName,
      variant,
      value: variantValue,
    });
  } catch (error) {
    logger.error('Error getting variant:', error);
    res.status(500).json({ error: 'Failed to get variant' });
  }
});

/**
 * POST /api/experiments/:name/convert
 * Track a conversion for an experiment variant
 */
router.post('/:name/convert', csrfProtection, async (req, res) => {
  try {
    const experimentName = req.params.name;
    const { variant, metadata } = req.body;

    // Validate experiment
    if (!experiments[experimentName]) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    // Validate variant
    if (!experiments[experimentName].variants[variant]) {
      return res.status(400).json({ error: 'Invalid variant' });
    }

    // Get user ID
    const userId = req.user?.id || req.sessionID || 'anonymous';

    // Store conversion
    const conversions = await dbUnified.read('ab_conversions');
    const conversion = {
      id: uid('conv'),
      experimentName,
      variant,
      userId,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    };

    conversions.push(conversion);
    await dbUnified.write('ab_conversions', conversions);

    res.json({ success: true, message: 'Conversion tracked' });
  } catch (error) {
    logger.error('Error tracking conversion:', error);
    // Fail silently for analytics
    res.json({ success: true, message: 'Conversion received' });
  }
});

/**
 * POST /api/experiments/:name/view
 * Track a view/impression for an experiment variant
 */
router.post('/:name/view', csrfProtection, async (req, res) => {
  try {
    const experimentName = req.params.name;
    const { variant } = req.body;

    // Validate experiment
    if (!experiments[experimentName]) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    // Validate variant
    if (!experiments[experimentName].variants[variant]) {
      return res.status(400).json({ error: 'Invalid variant' });
    }

    // Get user ID
    const userId = req.user?.id || req.sessionID || 'anonymous';

    // Store view
    const views = await dbUnified.read('ab_views');
    const view = {
      id: uid('view'),
      experimentName,
      variant,
      userId,
      timestamp: new Date().toISOString(),
    };

    views.push(view);

    // Keep only recent views (prevent unbounded growth) - use slice for efficiency
    if (views.length > 10000) {
      const trimmedViews = views.slice(-10000);
      await dbUnified.write('ab_views', trimmedViews);
    } else {
      await dbUnified.write('ab_views', views);
    }

    res.json({ success: true, message: 'View tracked' });
  } catch (error) {
    logger.error('Error tracking view:', error);
    // Fail silently for analytics
    res.json({ success: true, message: 'View received' });
  }
});

/**
 * GET /api/experiments/:name/results
 * Get experiment results (admin only)
 */
router.get('/:name/results', async (req, res) => {
  try {
    // Check admin access
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const experimentName = req.params.name;

    // Validate experiment
    if (!experiments[experimentName]) {
      return res.status(404).json({ error: 'Experiment not found' });
    }

    // Get views and conversions
    const views = await dbUnified.read('ab_views');
    const conversions = await dbUnified.read('ab_conversions');

    // Filter by experiment
    const experimentViews = views.filter(v => v.experimentName === experimentName);
    const experimentConversions = conversions.filter(c => c.experimentName === experimentName);

    // Calculate stats by variant
    const variants = Object.keys(experiments[experimentName].variants);
    const results = variants.map(variant => {
      const variantViews = experimentViews.filter(v => v.variant === variant);
      const variantConversions = experimentConversions.filter(c => c.variant === variant);

      const viewCount = variantViews.length;
      const conversionCount = variantConversions.length;
      const conversionRate = viewCount > 0 ? (conversionCount / viewCount) * 100 : 0;

      return {
        variant,
        value: experiments[experimentName].variants[variant],
        views: viewCount,
        conversions: conversionCount,
        conversionRate: `${conversionRate.toFixed(2)}%`,
      };
    });

    res.json({
      success: true,
      experiment: experimentName,
      totalViews: experimentViews.length,
      totalConversions: experimentConversions.length,
      results,
    });
  } catch (error) {
    logger.error('Error fetching experiment results:', error);
    res.status(500).json({ error: 'Failed to fetch experiment results' });
  }
});

module.exports = router;
