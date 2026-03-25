/**
 * Supplier Management Routes
 * Supplier owner management endpoints (create, update, analytics, badges)
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const catalogCache = require('../services/catalogCache');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let csrfProtection;
let writeLimiter;
let uid;
let geocoding;
let supplierAnalytics;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Supplier Management routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'csrfProtection',
    'writeLimiter',
    'uid',
    'geocoding',
    'supplierAnalytics',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Supplier Management routes: missing required dependencies: ${missing.join(', ')}`
    );
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  csrfProtection = deps.csrfProtection;
  writeLimiter = deps.writeLimiter;
  uid = deps.uid;
  geocoding = deps.geocoding;
  supplierAnalytics = deps.supplierAnalytics;
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

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

/**
 * GET /api/me/suppliers/:id/analytics
 * Get analytics for a specific supplier (owner only)
 */
router.get('/:id/analytics', applyAuthRequired, applyRoleRequired('supplier'), async (req, res) => {
  try {
    const supplierId = req.params.id;
    const period = parseInt(req.query.period) || 7; // Default 7 days

    // Verify ownership
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === supplierId && s.ownerUserId === req.user.id);
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Get analytics from the supplier analytics utility
    const analytics = await supplierAnalytics.getSupplierAnalytics(supplierId, period);

    // Format response to match expected structure
    const labels = analytics.dailyData.map(d => d.label);
    const views = analytics.dailyData.map(d => d.views);
    const enquiries = analytics.dailyData.map(d => d.enquiries);

    res.json({
      period: analytics.period,
      labels,
      views,
      enquiries,
      totalViews: analytics.totalViews,
      totalEnquiries: analytics.totalEnquiries,
      responseRate: analytics.responseRate,
      avgResponseTime: analytics.avgResponseTime,
    });
  } catch (error) {
    logger.error('Error fetching supplier analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * POST /api/me/suppliers/:id/badges/evaluate
 * Evaluate and award badges to a specific supplier
 */
router.post(
  '/:id/badges/evaluate',
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const supplierId = req.params.id;

      // Verify ownership
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === supplierId && s.ownerUserId === req.user.id);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const badgeManagement = require('../utils/badgeManagement');
      const results = await badgeManagement.evaluateSupplierBadges(supplierId);

      res.json({
        success: true,
        message: 'Badge evaluation completed',
        results,
      });
    } catch (error) {
      logger.error('Error evaluating supplier badges:', error);
      res.status(500).json({ error: 'Failed to evaluate badges' });
    }
  }
);

/**
 * POST /api/me/suppliers
 * Create a new supplier
 */
router.post(
  '/',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.category) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    // For Venues category, validate and require venuePostcode
    if (b.category === 'Venues') {
      if (!b.venuePostcode) {
        return res.status(400).json({
          error: 'Venue postcode is required for suppliers in the Venues category',
        });
      }
      if (!geocoding.isValidUKPostcode(b.venuePostcode)) {
        return res.status(400).json({
          error: 'Invalid UK postcode format',
        });
      }
    }

    const amenities = (b.amenities ? String(b.amenities).split(',') : [])
      .map(x => x.trim())
      .filter(Boolean);

    const s = {
      id: uid('sup'),
      ownerUserId: req.user.id,
      name: String(b.name).slice(0, 120),
      category: b.category,
      location: String(b.location || '').slice(0, 120),
      price_display: String(b.price_display || '').slice(0, 60),
      website: String(b.website || '').slice(0, 200),
      license: String(b.license || '').slice(0, 120),
      amenities,
      maxGuests: parseInt(b.maxGuests || 0, 10),
      description_short: String(b.description_short || '').slice(0, 220),
      description_long: String(b.description_long || '').slice(0, 2000),
      photosGallery: [],
      email: ((await dbUnified.read('users')).find(u => u.id === req.user.id) || {}).email || '',
      approved: false,
    };

    // Add venue-specific fields if category is Venues
    if (b.category === 'Venues' && b.venuePostcode) {
      s.venuePostcode = String(b.venuePostcode).trim().toUpperCase();

      // Geocode the postcode to get coordinates
      try {
        const coords = await geocoding.geocodePostcode(s.venuePostcode);
        if (coords) {
          s.latitude = coords.latitude;
          s.longitude = coords.longitude;
          s.venuePostcode = coords.postcode; // Use normalized postcode from API
          logger.info(`✅ Geocoded venue ${s.name}: ${coords.latitude}, ${coords.longitude}`);
        } else {
          logger.warn(`⚠️ Could not geocode postcode ${s.venuePostcode} for venue ${s.name}`);
        }
      } catch (error) {
        logger.error('Geocoding error:', error);
        // Continue without coordinates - validation already passed
      }
    }

    await dbUnified.insertOne('suppliers', s);
    res.json({ ok: true, supplier: s });
  }
);

/**
 * PATCH /api/me/suppliers/:id
 * Update supplier (owner only)
 */
router.patch(
  '/:id',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    const all = await dbUnified.read('suppliers');
    const s = all.find(sup => sup.id === req.params.id && sup.ownerUserId === req.user.id);
    if (!s) {
      return res.status(404).json({ error: 'Not found' });
    }
    const b = req.body || {};
    const supplierPatch = {};

    // If updating a Venues category supplier with venuePostcode
    if (b.venuePostcode && s.category === 'Venues') {
      if (!geocoding.isValidUKPostcode(b.venuePostcode)) {
        return res.status(400).json({
          error: 'Invalid UK postcode format',
        });
      }

      // Update postcode and geocode
      supplierPatch.venuePostcode = String(b.venuePostcode).trim().toUpperCase();

      try {
        const coords = await geocoding.geocodePostcode(supplierPatch.venuePostcode);
        if (coords) {
          supplierPatch.latitude = coords.latitude;
          supplierPatch.longitude = coords.longitude;
          supplierPatch.venuePostcode = coords.postcode;
          logger.info(`✅ Geocoded venue ${s.name}: ${coords.latitude}, ${coords.longitude}`);
        } else {
          logger.warn(`⚠️ Could not geocode postcode ${supplierPatch.venuePostcode}`);
        }
      } catch (error) {
        logger.error('Geocoding error:', error);
      }
    }

    const fields = [
      'name',
      'category',
      'location',
      'price_display',
      'website',
      'license',
      'description_short',
      'description_long',
      'bannerUrl',
      'tagline',
    ];
    for (const k of fields) {
      if (typeof b[k] === 'string') {
        supplierPatch[k] = b[k];
      }
    }

    // Validate and set theme color (must be valid hex color)
    if (b.themeColor && typeof b.themeColor === 'string') {
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (hexColorRegex.test(b.themeColor.trim())) {
        supplierPatch.themeColor = b.themeColor.trim();
      }
    }

    // Handle array fields
    if (b.amenities) {
      supplierPatch.amenities = String(b.amenities)
        .split(',')
        .map(x => x.trim())
        .filter(Boolean);
    }

    if (b.highlights && Array.isArray(b.highlights)) {
      supplierPatch.highlights = b.highlights
        .map(x => String(x).trim())
        .filter(Boolean)
        .slice(0, 5); // Limit to 5 highlights
    }

    if (b.featuredServices && Array.isArray(b.featuredServices)) {
      supplierPatch.featuredServices = b.featuredServices
        .map(x => String(x).trim())
        .filter(Boolean)
        .slice(0, 10); // Limit to 10 services
    }

    // Handle social links with validation
    if (b.socialLinks && typeof b.socialLinks === 'object') {
      supplierPatch.socialLinks = {};
      const allowedPlatforms = [
        'facebook',
        'instagram',
        'twitter',
        'linkedin',
        'youtube',
        'tiktok',
      ];
      for (const platform of allowedPlatforms) {
        if (b.socialLinks[platform] && typeof b.socialLinks[platform] === 'string') {
          const url = b.socialLinks[platform].trim();
          // Robust URL validation using URL constructor
          try {
            const parsedUrl = new URL(url);
            // Only allow http and https protocols
            if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
              // Use the parsed URL to prevent XSS
              supplierPatch.socialLinks[platform] = parsedUrl.href;
            }
          } catch (err) {
            // Invalid URL, skip it
            logger.warn(`Invalid social link URL for ${platform}: ${url}`);
          }
        }
      }
    }

    // eslint-disable-next-line eqeqeq
    if (b.maxGuests != null) {
      supplierPatch.maxGuests = parseInt(b.maxGuests, 10) || 0;
    }
    supplierPatch.approved = false;
    await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: supplierPatch });

    // Bust catalog cache — profile edit means the supplier data may have changed
    catalogCache
      .invalidate()
      .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

    res.json({ ok: true, supplier: { ...s, ...supplierPatch } });
  }
);

/**
 * POST /api/me/subscription/upgrade
 * Mark all suppliers owned by the current user as Pro
 */
router.post(
  '/subscription/upgrade',
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    const suppliers = await dbUnified.read('suppliers');
    let changed = 0;
    const proUpdatePromises = [];
    suppliers.forEach(s => {
      if (s.ownerUserId === req.user.id) {
        if (!s.isPro) {
          proUpdatePromises.push(
            dbUnified.updateOne('suppliers', { id: s.id }, { $set: { isPro: true } })
          );
          changed += 1;
        }
      }
    });
    await Promise.all(proUpdatePromises);

    // Optionally also mirror this onto the user record if present
    try {
      await dbUnified.updateOne(
        'users',
        { id: req.user.id },
        { $set: { isPro: true, subscriptionTier: 'pro' } }
      );
    } catch (_e) {
      // ignore if users store is not present
    }

    res.json({ ok: true, updatedSuppliers: changed });
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
