/**
 * Public Routes
 * Public-facing endpoints that don't require authentication
 * Includes homepage settings, public stats, and other publicly accessible data
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const crypto = require('crypto');
const dbUnified = require('../db-unified');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter, apiLimiter } = require('../middleware/rateLimits');

function isCollageDebugEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.DEBUG_COLLAGE === 'true';
}

const ALLOWED_PEXELS_KEYS = ['intervalSeconds', 'queries', 'perPage', 'orientation', 'tags'];

const DEFAULT_PEXELS_SETTINGS = {
  intervalSeconds: 2.5,
  queries: {
    venues: 'wedding venue elegant ballroom',
    catering: 'wedding catering food elegant',
    entertainment: 'live band wedding party',
    photography: 'wedding photography professional',
  },
};

function sanitizePexelsSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return DEFAULT_PEXELS_SETTINGS;
  }
  const sanitized = {};
  ALLOWED_PEXELS_KEYS.forEach(key => {
    if (settings[key] !== undefined) {
      sanitized[key] = settings[key];
    }
  });
  if (sanitized.intervalSeconds !== undefined) {
    const interval = Number(sanitized.intervalSeconds);
    if (isNaN(interval) || interval < 1 || interval > 60) {
      sanitized.intervalSeconds = DEFAULT_PEXELS_SETTINGS.intervalSeconds;
    } else {
      sanitized.intervalSeconds = interval;
    }
  } else {
    sanitized.intervalSeconds = DEFAULT_PEXELS_SETTINGS.intervalSeconds;
  }
  if (!sanitized.queries || typeof sanitized.queries !== 'object') {
    sanitized.queries = DEFAULT_PEXELS_SETTINGS.queries;
  }
  if (settings.interval && !sanitized.intervalSeconds) {
    const interval = Number(settings.interval);
    if (!isNaN(interval) && interval >= 1 && interval <= 60) {
      sanitized.intervalSeconds = interval;
    }
  }
  return sanitized;
}

router.get('/homepage-settings', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private');
    const settings = (await dbUnified.read('settings')) || {};
    const features = settings.features || {};
    const collageWidget = settings.collageWidget || {};
    const legacyPexelsEnabled = features.pexelsCollage === true;
    const collageEnabled =
      collageWidget.enabled !== undefined ? collageWidget.enabled : legacyPexelsEnabled;
    const pexelsCollageSettings = sanitizePexelsSettings(settings.pexelsCollageSettings);
    const collageWidgetResponse = {
      enabled: collageEnabled,
      source: collageWidget.source || 'pexels',
      mediaTypes: collageWidget.mediaTypes || { photos: true, videos: true },
      intervalSeconds: collageWidget.intervalSeconds || pexelsCollageSettings.intervalSeconds,
      pexelsQueries: collageWidget.pexelsQueries || pexelsCollageSettings.queries,
      pexelsVideoQueries: collageWidget.pexelsVideoQueries || {
        venues: 'wedding venue video aerial',
        catering: 'catering food preparation video',
        entertainment: 'live band music performance video',
        photography: 'wedding videography cinematic',
      },
      uploadGallery: collageWidget.uploadGallery || [],
      fallbackToPexels:
        collageWidget.fallbackToPexels !== undefined ? collageWidget.fallbackToPexels : true,
    };
    if (isCollageDebugEnabled()) {
      logger.info('[Homepage Settings] Returning collage config:', {
        collageEnabled,
        collageWidgetEnabled: collageWidget.enabled,
        legacyPexelsEnabled,
        source: collageWidgetResponse.source,
        hasQueries: !!collageWidgetResponse.pexelsQueries,
        uploadGalleryCount: collageWidgetResponse.uploadGallery.length,
      });
    }
    res.json({
      collageWidget: collageWidgetResponse,
      pexelsCollageEnabled: legacyPexelsEnabled,
      pexelsCollageSettings,
    });
  } catch (error) {
    if (!res.headersSent) {
      logger.error('[ERROR] Failed to read homepage settings:', error.message);
      res.status(500).json({ error: 'Failed to read homepage settings' });
    }
  }
});

let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_DURATION = 5 * 60 * 1000;

/**
 * GET /api/v1/public/features
 * Returns the subset of feature flags that are safe to expose publicly.
 * Used by the auth page to pre-check registration availability before submit,
 * and to hide the Supplier role option when supplierApplications is disabled.
 */
router.get('/features', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, private');
    const settings = (await dbUnified.read('settings')) || {};
    const features = settings.features || {};
    res.json({
      registration: features.registration !== false,
      supplierApplications: features.supplierApplications !== false,
    });
  } catch (error) {
    logger.error('[ERROR] Failed to read feature flags:', error.message);
    // Default to enabled so a DB hiccup doesn't silently block sign-ups
    res.status(500).json({ registration: true, supplierApplications: true });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const now = Date.now();
    if (statsCache && now - statsCacheTime < STATS_CACHE_DURATION) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(statsCache);
    }
    const suppliers = (await dbUnified.read('suppliers')) || [];
    const packages = (await dbUnified.read('packages')) || [];
    const marketplaceListings = (await dbUnified.read('marketplace_listings')) || [];
    const reviews = (await dbUnified.read('reviews')) || [];

    // Public homepage stats must reflect data visitors can actually discover.
    // Count approved suppliers as the public-facing supplier network, while still
    // accepting legacy records that only have verified=true.
    const stats = {
      suppliersVerified: suppliers.filter(s => s.approved === true || s.verified === true).length,
      packagesApproved: packages.filter(p => p.approved === true).length,
      marketplaceListingsActive: marketplaceListings.filter(
        m => m.approved === true && m.status === 'active'
      ).length,
      reviewsApproved: reviews.filter(r => r.approved === true).length,
    };
    statsCache = stats;
    statsCacheTime = now;
    res.set('Cache-Control', 'public, max-age=300');
    res.json(stats);
  } catch (error) {
    logger.error('[ERROR] Failed to read public stats:', error.message);
    res.status(500).json({
      error: 'Failed to read public stats',
      suppliersVerified: 0,
      packagesApproved: 0,
      marketplaceListingsActive: 0,
      reviewsApproved: 0,
    });
  }
});

/**
 * POST /api/public/faq/vote
 * Vote on FAQ helpfulness
 * CSRF protected to prevent unauthorized votes
 * Duplicate votes prevented by session/IP tracking
 */
router.post('/faq/vote', writeLimiter, csrfProtection, async (req, res) => {
  try {
    const { faqId, helpful } = req.body;

    if (!faqId || typeof helpful !== 'boolean') {
      return res.status(400).json({ error: 'Missing or invalid faqId or helpful flag' });
    }

    // Generate visitor ID from session or IP (hashed for privacy)
    // Reject vote if neither session ID nor IP is available to prevent shared anonymous votes
    const visitorIdentifier = req.sessionID || req.ip;
    if (!visitorIdentifier) {
      return res.status(400).json({
        error:
          'Unable to identify visitor. Please enable cookies or check your network connection.',
      });
    }

    const visitorId = crypto
      .createHash('sha256')
      .update(visitorIdentifier + (process.env.JWT_SECRET || 'salt'))
      .digest('hex')
      .substring(0, 16);

    // Read existing votes
    let faqVotes = [];
    try {
      faqVotes = await dbUnified.read('faqVotes');
    } catch (e) {
      // Collection doesn't exist yet, will be created on first vote
      logger.debug('faqVotes collection not yet initialised:', e.message);
    }

    // Check for existing vote from this visitor on this FAQ
    const existingVoteIndex = faqVotes.findIndex(
      v => v.faqId === faqId && v.visitorId === visitorId
    );

    if (existingVoteIndex !== -1) {
      // Update existing vote instead of creating duplicate
      faqVotes[existingVoteIndex].helpful = helpful;
      faqVotes[existingVoteIndex].updatedAt = new Date().toISOString();
      await dbUnified.updateOne(
        'faqVotes',
        { id: faqVotes[existingVoteIndex].id },
        { $set: { helpful, updatedAt: faqVotes[existingVoteIndex].updatedAt } }
      );
      return res.json({ success: true, message: 'Thank you for your feedback!' });
    }

    // Create vote record with visitor tracking
    const { uid } = require('../store');
    const vote = {
      id: uid('faqvote'),
      faqId,
      helpful,
      visitorId,
      createdAt: new Date().toISOString(),
      ipAddress: req.ip || req.headers['x-forwarded-for'] || 'unknown',
    };

    await dbUnified.insertOne('faqVotes', vote);

    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (error) {
    logger.error('Error recording FAQ vote:', error);
    res.status(500).json({
      error: 'Failed to record vote',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * GET /api/public/recommendations
 * Get recommended suppliers based on user preferences
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { category, location, budget } = req.query;

    const suppliers = await dbUnified.read('suppliers');
    let recommendations = suppliers.filter(s => s.approved);

    if (category) {
      recommendations = recommendations.filter(s => s.category === category);
    }

    if (location) {
      const loc = location.toLowerCase();
      recommendations = recommendations.filter(s => s.location?.toLowerCase().includes(loc));
    }

    // Sort by rating/featured
    recommendations.sort((a, b) => {
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return (b.rating || 0) - (a.rating || 0);
    });

    res.json({ recommendations: recommendations.slice(0, 6) });
  } catch (error) {
    logger.error('[ERROR] Failed to get recommendations:', error.message);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

module.exports = router;
