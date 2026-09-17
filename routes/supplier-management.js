/**
 * Supplier Management Routes
 * Supplier owner management endpoints (create, update, analytics, badges)
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const catalogCache = require('../services/catalogCache');
const { supplierApprovalDefaults } = require('../services/supplierProfileProvisioning.service');
const { buildSupplierThemeMutation } = require('../utils/supplierTheme');
const photoUpload = require('../photo-upload');
const supplierLocation = require('../services/supplierLocation.service');
const { MAPPING_SOURCES } = require('../models/LocationContent');
const { VALID_CATEGORIES } = require('../models/Supplier');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const subscriptionService = require('../services/subscriptionService');
const router = express.Router();

/**
 * Maximum character lengths enforced when a supplier PATCHes their profile.
 * Values are intentionally more generous than the CREATE limits to allow
 * suppliers to enrich their profile over time.
 */
const PATCH_FIELD_MAX_LENGTHS = {
  name: 120,
  category: 80,
  location: 200,
  price_display: 60,
  website: 200,
  license: 120,
  description_short: 300,
  description_long: 5000,
  bannerUrl: 500,
  tagline: 200,
  phone: 30,
};

const BANNER_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/]+={0,2})$/i;
const MAX_BANNER_BYTES = 5 * 1024 * 1024;

const decodeBannerDataUrl = value => {
  const match = BANNER_DATA_URL_RE.exec(String(value || '').trim());
  if (!match) {
    const error = new Error('Banner image data is not a supported image');
    error.name = 'ValidationError';
    throw error;
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    const error = new Error('Banner image is empty');
    error.name = 'ValidationError';
    throw error;
  }
  if (buffer.length > MAX_BANNER_BYTES) {
    const error = new Error('Banner image is too large (maximum 5 MB)');
    error.name = 'ValidationError';
    throw error;
  }

  const subtype = match[1].toLowerCase();
  const ext = subtype === 'jpeg' || subtype === 'jpg' ? 'jpg' : subtype;
  return { buffer, filename: `supplier-banner.${ext}` };
};

const normaliseStoredBannerUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^\/(api\/photos\/|uploads\/)/i.test(raw)) {
    return raw.slice(0, 500);
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href.slice(0, 500);
    }
  } catch {
    // handled below
  }
  const error = new Error('Banner must be an uploaded image or a valid http/https image URL');
  error.name = 'ValidationError';
  throw error;
};

/**
 * Normalise a supplier website URL: empty clears the field, a scheme-less
 * domain is promoted to HTTPS, and only http/https survive. Anything else
 * (javascript:, data:, malformed input) is rejected rather than silently
 * truncated, so a save cannot report success while storing an unusable value.
 * @param {string} rawValue Raw website input.
 * @returns {string} Normalised URL, or '' to clear the field.
 */
const normaliseWebsiteUrl = rawValue => {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return '';
  }
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const href = (() => {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('unsupported protocol');
      }
      return parsed.href;
    } catch {
      const error = new Error('Website must be a valid http or https URL');
      error.name = 'ValidationError';
      throw error;
    }
  })();
  if (href.length > 200) {
    const error = new Error('Website URL must be 200 characters or fewer');
    error.name = 'ValidationError';
    throw error;
  }
  return href;
};

const buildBannerPatch = async rawValue => {
  const raw = String(rawValue || '').trim();
  if (!raw) {
    return { bannerUrl: '', coverImage: '' };
  }

  if (/^data:image\//i.test(raw)) {
    const { buffer, filename } = decodeBannerDataUrl(raw);
    const images = await photoUpload.processAndSaveImage(buffer, filename, 'supplier');
    const persistedUrl = images.optimized || images.large || images.original;
    if (!persistedUrl) {
      const error = new Error('Banner image could not be persisted');
      error.name = 'ImageProcessingError';
      throw error;
    }
    return { bannerUrl: persistedUrl, coverImage: persistedUrl };
  }

  const persistedUrl = normaliseStoredBannerUrl(raw);
  return { bannerUrl: persistedUrl, coverImage: persistedUrl };
};

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let requireVerifiedUser;
let csrfProtection;
let writeLimiter;
let uid;
let geocoding;
let supplierAnalytics;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Supplier Management routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'requireVerifiedUser',
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
  requireVerifiedUser = deps.requireVerifiedUser;
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
// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function applyRequireVerifiedUser(req, res, next) {
  if (!requireVerifiedUser) {
    return res.status(503).json({ error: 'Verification service not initialized' });
  }
  return requireVerifiedUser(req, res, next);
}

/** Fields that change where a supplier is, and so force a re-derivation. */
const LOCATION_INPUT_FIELDS = [
  'location',
  'basePostcode',
  'venuePostcode',
  'latitude',
  'longitude',
];

/**
 * Normalise location inputs for movement detection without changing what is stored.
 * @param {string} field Location field name.
 * @param {*} value Current or proposed value.
 * @returns {string|number} Comparable value.
 */
function comparableLocationInput(field, value) {
  if (field === 'latitude' || field === 'longitude') {
    const number = Number(value);
    return Number.isFinite(number) ? number : '';
  }

  const text = value === null || value === undefined ? '' : String(value).trim();
  if (field === 'basePostcode' || field === 'venuePostcode') {
    return text.replace(/\s+/g, '').toUpperCase();
  }
  return text.toLocaleLowerCase('en-GB');
}

/**
 * Check whether a patch actually moves a supplier rather than merely repeating
 * the full form's existing location values.
 * @param {Object} current Stored supplier.
 * @param {Object} patch Sanitised supplier patch.
 * @returns {boolean} Whether structured geography must be re-derived.
 */
function hasLocationInputChanged(current, patch) {
  return LOCATION_INPUT_FIELDS.some(
    field =>
      Object.prototype.hasOwnProperty.call(patch, field) &&
      comparableLocationInput(field, patch[field]) !==
        comparableLocationInput(field, current[field])
  );
}

/**
 * Validate and geocode a venue postcode, writing the normalized postcode and
 * coordinates onto `supplierPatch`. Shared by the "entering Venues" and
 * "remaining a Venue with a changed postcode" PATCH branches so postcode
 * handling (normalization, geocoder failure logging) can't drift between them.
 *
 * A geocoder miss or error is not fatal: the caller has already validated the
 * postcode's *format*, so the patch still proceeds with the uppercased,
 * trimmed postcode and no coordinates rather than blocking the save.
 * @param {string} postcode Already format-validated venue postcode.
 * @param {Object} supplierPatch Patch object to write venuePostcode/lat/long onto.
 * @param {string} supplierId Supplier ID, for log correlation only.
 * @returns {Promise<void>} Resolves once the patch has been updated.
 */
async function geocodeVenuePostcode(postcode, supplierPatch, supplierId) {
  supplierPatch.venuePostcode = postcode;
  try {
    const coords = await geocoding.geocodePostcode(supplierPatch.venuePostcode);
    if (coords) {
      supplierPatch.latitude = coords.latitude;
      supplierPatch.longitude = coords.longitude;
      supplierPatch.venuePostcode = coords.postcode;
      logger.info('✅ Geocoded venue', {
        supplierId,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
    } else {
      logger.warn('⚠️ Could not geocode postcode for venue', { supplierId });
    }
  } catch (error) {
    logger.error('Geocoding error:', error);
  }
}

/**
 * Resolve a supplier record onto the UK city registry and record the outcome.
 *
 * Runs on create and on every edit that moves the supplier, so a profile's
 * structured geography is maintained by the platform rather than by a one-off
 * backfill. When nothing maps confidently the supplier is flagged for review
 * instead of guessed at — an unmapped supplier is missing from a city page,
 * which is recoverable; a wrongly placed one is not.
 * @param {Object} supplier Supplier record, or the merged result of a patch.
 * @returns {Promise<Object>} `{baseLocation, locationMappingReviewRequired}`.
 */
async function deriveSupplierGeography(supplier) {
  // An admin has already made a decision about this record by hand; a profile
  // edit must not quietly undo it.
  if (supplier.baseLocation && supplier.baseLocation.source === MAPPING_SOURCES.adminVerified) {
    return {
      baseLocation: supplier.baseLocation,
      locationMappingReviewRequired: false,
    };
  }

  try {
    const derived = await supplierLocation.deriveBaseLocation(supplier, {
      geocodePostcode: geocoding.geocodePostcode,
      isValidUKPostcode: geocoding.isValidUKPostcode,
    });
    if (derived) {
      return { baseLocation: derived.baseLocation, locationMappingReviewRequired: false };
    }
  } catch (error) {
    // Postcodes.io being unavailable must never block a profile save.
    logger.warn('Could not derive a supplier base location', {
      supplierId: supplier.id,
      error: error.message,
    });
    return { baseLocation: supplier.baseLocation || null, locationMappingReviewRequired: true };
  }

  return { baseLocation: null, locationMappingReviewRequired: true };
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
    const supplier = await dbUnified.findOne('suppliers', {
      id: supplierId,
      ownerUserId: req.user.id,
    });
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
      const supplier = await dbUnified.findOne('suppliers', {
        id: supplierId,
        ownerUserId: req.user.id,
      });
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
 * Create a new supplier profile (strictly 1:1 with user account)
 */
router.post(
  '/',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyCsrfProtection,
  // skipcq: JS-R1005 -- Existing create-route orchestration is regression-covered; decomposition is a separate refactor.
  async (req, res) => {
    const b = req.body || {};
    const trimmedName = typeof b.name === 'string' ? b.name.trim() : '';
    if (!trimmedName || !b.category) {
      return res.status(400).json({ error: 'Missing fields' });
    }
    if (!VALID_CATEGORIES.includes(b.category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    let websiteUrl = '';
    if (typeof b.website === 'string' && b.website.trim()) {
      try {
        websiteUrl = normaliseWebsiteUrl(b.website);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    // Enforce 1:1 relationship: one supplier profile per user account.
    // Keep legacy/demo suppliers with ownerUserId null untouched; linked users are checked by ownerUserId.
    // Uniqueness is enforced by DB query (ownerUserId === req.user.id) rather than an in-memory scan.
    const [existing, ownerUser] = await Promise.all([
      dbUnified.findOne('suppliers', { ownerUserId: req.user.id }),
      dbUnified.findOne('users', { id: req.user.id }),
    ]);
    if (existing) {
      logger.warn('Duplicate supplier profile creation prevented', {
        userId: req.user.id,
        existingSupplierId: existing.id,
      });
      return res.status(409).json({
        error: 'Supplier profile already exists',
        code: 'SUPPLIER_PROFILE_EXISTS',
        supplierId: existing.id,
        message:
          'You already have a supplier profile. Each account can only have one supplier profile.',
      });
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

    // Suppliers outside the Venues category have no postcode of their own, so
    // the location pages would otherwise only ever see their free text.
    let basePostcode = null;
    if (b.basePostcode) {
      basePostcode = String(b.basePostcode).trim().toUpperCase();
      if (!geocoding.isValidUKPostcode(basePostcode)) {
        return res.status(400).json({ error: 'Invalid UK postcode format' });
      }
    }

    const amenities = (b.amenities ? String(b.amenities).split(',') : [])
      .map(x => x.trim())
      .filter(Boolean);
    const nowIso = new Date().toISOString();

    // Approval defaults come from the shared provisioning service which reads
    // the autoApproveSupplierVerification feature flag. When ON, the service
    // returns { approved: true, approvedAt, approvedBy: 'system', ... }.
    // When OFF it returns { approved: false, verified: false, ... }.
    // We spread these onto s so the flag is always set explicitly.
    const approvalDefaults = await supplierApprovalDefaults(nowIso);
    // approvalDefaults.approved is either true (auto-approve ON) or false (manual approval needed).
    // s.approved = true  → set by service when autoApproveSupplierVerification === true
    // s.approvedAt / s.approvedBy = 'system' → set by service on auto-approval
    // approved: false, → default when auto-approve is OFF (manual admin review required)

    const s = {
      id: uid('sup'),
      ownerUserId: req.user.id,
      name: trimmedName.slice(0, 120),
      category: b.category,
      location: String(b.location || '').slice(0, 120),
      price_display: String(b.price_display || '').slice(0, 60),
      website: websiteUrl,
      license: String(b.license || '').slice(0, 120),
      amenities,
      maxGuests: parseInt(b.maxGuests || 0, 10),
      description_short: String(b.description_short || '').slice(0, 220),
      description_long: String(b.description_long || '').slice(0, 2000),
      photosGallery: [],
      email: ownerUser?.email || req.user.email || '',
      profileComplete: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...approvalDefaults,
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
          logger.info('✅ Geocoded venue', {
            supplierId: s.id,
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
        } else {
          logger.warn('⚠️ Could not geocode postcode for venue', { supplierId: s.id });
        }
      } catch (error) {
        logger.error('Geocoding error:', error);
        // Continue without coordinates - validation already passed
      }
    }

    if (basePostcode) {
      s.basePostcode = basePostcode;
    }
    const serviceAreas = supplierLocation.sanitiseServiceAreas(b.serviceAreas);
    if (serviceAreas.length) {
      s.serviceAreas = serviceAreas;
    }
    Object.assign(s, await deriveSupplierGeography(s));

    const suppInserted = await dbUnified.insertOne('suppliers', s);
    if (!suppInserted) {
      const racedExisting = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });
      if (racedExisting) {
        logger.warn('Duplicate supplier profile creation prevented after insert race', {
          userId: req.user.id,
          existingSupplierId: racedExisting.id,
        });
        return res.status(409).json({
          error: 'Supplier profile already exists',
          code: 'SUPPLIER_PROFILE_EXISTS',
          supplierId: racedExisting.id,
          message:
            'You already have a supplier profile. Each account can only have one supplier profile.',
        });
      }
      logger.error('[SUPP-MGMT] insertOne failed', { supplierId: s.id });
      return res
        .status(500)
        .json({ error: 'Failed to create supplier profile. Please try again.' });
    }

    // Auto-approved profiles previously skipped the verification audit trail,
    // leaving admins with an approved record and no corresponding approval event.
    if (s.approved === true && s.approvedBy === 'system') {
      try {
        const auditEntry = await auditLog({
          adminId: 'system',
          adminEmail: 'system',
          action: AUDIT_ACTIONS.SUPPLIER_APPROVED,
          targetType: 'supplier',
          targetId: s.id,
          details: {
            name: s.name,
            source: 'autoApproveSupplierVerification',
            ownerUserId: s.ownerUserId,
          },
        });
        if (!auditEntry) {
          // Creation remains non-blocking by design, but do not silently treat an
          // audit storage outage as a successfully recorded approval event.
          logger.warn('Automatic supplier approval audit could not be persisted', {
            supplierId: s.id,
          });
        }
      } catch (auditError) {
        // Profile creation must not fail solely because audit persistence is unavailable.
        logger.warn('Failed to record automatic supplier approval audit event', {
          supplierId: s.id,
          error: auditError.message,
        });
      }
    }

    logger.info('Supplier profile created', {
      supplierId: s.id,
      userId: req.user.id,
      approved: s.approved,
    });
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
  applyRequireVerifiedUser,
  applyCsrfProtection,
  // skipcq: JS-R1005 -- Existing update-route orchestration is regression-covered; decomposition is a separate refactor.
  async (req, res) => {
    const s = await dbUnified.findOne('suppliers', { id: req.params.id, ownerUserId: req.user.id });
    if (!s) {
      return res.status(404).json({ error: 'Not found' });
    }
    const b = req.body || {};
    const supplierPatch = {};
    const supplierUnset = {};

    // Required-field validation: an explicitly supplied name or category must
    // not be allowed to trim to an empty string, and a category must be one
    // of the platform's canonical values.
    if (typeof b.name === 'string') {
      const requestedName = b.name.trim();
      if (!requestedName) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
    }
    const requestedCategory = typeof b.category === 'string' ? b.category.trim() : undefined;
    if (requestedCategory !== undefined) {
      if (!requestedCategory) {
        return res.status(400).json({ error: 'Category cannot be empty' });
      }
      if (!VALID_CATEGORIES.includes(requestedCategory)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
    }

    // Compute the intended next category *before* validating/geocoding the
    // venue postcode, so a category change and a postcode change submitted in
    // the same request are validated against where the supplier is heading,
    // not where it currently is.
    const nextCategory = requestedCategory !== undefined ? requestedCategory : s.category;
    const enteringVenues = nextCategory === 'Venues' && s.category !== 'Venues';
    const remainingVenues = nextCategory === 'Venues' && s.category === 'Venues';
    const leavingVenues = nextCategory !== 'Venues' && s.category === 'Venues';

    const requestedVenuePostcode =
      typeof b.venuePostcode === 'string' ? b.venuePostcode.trim().toUpperCase() : '';

    if (enteringVenues) {
      if (!requestedVenuePostcode) {
        return res.status(400).json({
          error: 'Venue postcode is required for suppliers in the Venues category',
        });
      }
      if (!geocoding.isValidUKPostcode(requestedVenuePostcode)) {
        return res.status(400).json({
          error: 'Invalid UK postcode format',
        });
      }
      await geocodeVenuePostcode(requestedVenuePostcode, supplierPatch, s.id);
    } else if (remainingVenues) {
      const venuePostcodeChanged =
        requestedVenuePostcode &&
        comparableLocationInput('venuePostcode', requestedVenuePostcode) !==
          comparableLocationInput('venuePostcode', s.venuePostcode);
      if (venuePostcodeChanged) {
        if (!geocoding.isValidUKPostcode(requestedVenuePostcode)) {
          return res.status(400).json({
            error: 'Invalid UK postcode format',
          });
        }
        await geocodeVenuePostcode(requestedVenuePostcode, supplierPatch, s.id);
      }
    } else if (leavingVenues) {
      // Stale venue-only location data must not survive a category change
      // away from Venues.
      supplierUnset.venuePostcode = 1;
      supplierUnset.latitude = 1;
      supplierUnset.longitude = 1;
    }

    // Banner uploads from the profile customiser arrive as data URLs. Persist
    // those through the same validated MongoDB image pipeline used elsewhere,
    // then store only the stable /api/photos/... URL on the supplier record.
    // This fixes the previous behaviour where the data URL was truncated to 500
    // characters and then intentionally rejected by the public profile serializer.
    if (typeof b.bannerUrl === 'string') {
      try {
        Object.assign(supplierPatch, await buildBannerPatch(b.bannerUrl));
      } catch (error) {
        const status = error.name === 'ValidationError' ? 400 : 500;
        logger.warn('Supplier banner update failed', {
          supplierId: s.id,
          name: error.name,
          error: error.message,
        });
        return res.status(status).json({
          error:
            error.name === 'ValidationError' ? error.message : 'Failed to process banner image',
        });
      }
    }

    // Website URLs are truncated then rejected by the public serializer if
    // they use an unsupported scheme, so a save could previously report
    // success while the value silently disappeared after reload.
    if (typeof b.website === 'string') {
      if (!b.website.trim()) {
        supplierPatch.website = '';
      } else {
        try {
          supplierPatch.website = normaliseWebsiteUrl(b.website);
        } catch (error) {
          return res.status(400).json({ error: error.message });
        }
      }
    }

    for (const [k, maxLen] of Object.entries(PATCH_FIELD_MAX_LENGTHS)) {
      if (k === 'bannerUrl' || k === 'website') {
        continue;
      }
      if (typeof b[k] === 'string') {
        supplierPatch[k] = b[k].trim().substring(0, maxLen);
      }
    }

    const themeMutation = buildSupplierThemeMutation(b, s);
    if (themeMutation.error) {
      return res.status(400).json({ error: themeMutation.error });
    }
    // Custom theme colours are the Professional Plus "custom branding"
    // entitlement (models/Subscription.js customBranding: true only on
    // pro_plus) — only gate a fresh request to *set* custom mode; an
    // existing custom theme already on the record is left alone by
    // buildSupplierThemeMutation whenever the request doesn't touch theme
    // fields, so this never strips branding a supplier already has.
    if (themeMutation.set.themeMode === 'custom') {
      const hasCustomBranding = await subscriptionService.checkFeatureAccess(
        req.user.id,
        'customBranding'
      );
      if (!hasCustomBranding) {
        return res.status(403).json({
          error: 'Custom theme colours require a Professional Plus subscription.',
          code: 'FEATURE_REQUIRES_UPGRADE',
          feature: 'customBranding',
          upgradeUrl: '/supplier/subscription',
        });
      }
    }
    Object.assign(supplierPatch, themeMutation.set);

    // Handle array fields. Presence, not truthiness, decides whether amenities
    // are touched: an explicitly cleared (empty-string) field must write an
    // empty array rather than leaving the previous amenities in place.
    if (b.amenities !== undefined) {
      supplierPatch.amenities = String(b.amenities || '')
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

    if (typeof b.basePostcode === 'string') {
      const basePostcode = b.basePostcode.trim().toUpperCase();
      if (basePostcode && !geocoding.isValidUKPostcode(basePostcode)) {
        return res.status(400).json({ error: 'Invalid UK postcode format' });
      }
      supplierPatch.basePostcode = basePostcode || null;
    }
    if (b.serviceAreas !== undefined) {
      // The supplier dashboard can edit radius/nationwide coverage, but it has
      // no controls for explicit city assignments. Retain those assignments so
      // an ordinary profile save cannot remove an admin/API coverage decision.
      const retainedCityAreas = supplierLocation
        .sanitiseServiceAreas(s.serviceAreas)
        .filter(area => area.type === 'city');
      const requestedAreas = supplierLocation.sanitiseServiceAreas(b.serviceAreas);
      const requestedCityAreas = requestedAreas.filter(area => area.type === 'city');
      const requestedTravelAreas = requestedAreas.filter(area => area.type !== 'city');
      supplierPatch.serviceAreas = supplierLocation.sanitiseServiceAreas([
        ...(requestedCityAreas.length ? requestedCityAreas : retainedCityAreas),
        ...requestedTravelAreas,
      ]);
    }

    // Re-derive only when the supplier actually moved: a banner change should
    // not cost a geocoder call, and should not disturb an existing mapping.
    // Leaving Venues always counts as a move, even though the unset venue
    // fields live in supplierUnset rather than supplierPatch.
    if (leavingVenues || hasLocationInputChanged(s, supplierPatch)) {
      const supplierForDerivation = { ...s, ...supplierPatch };
      for (const key of Object.keys(supplierUnset)) {
        delete supplierForDerivation[key];
      }
      Object.assign(supplierPatch, await deriveSupplierGeography(supplierForDerivation));
    }
    // NOTE: do NOT touch approved here — supplier edits must never revoke approval.
    supplierPatch.updatedAt = new Date().toISOString();
    const combinedUnset = { ...themeMutation.unset, ...supplierUnset };
    const update = { $set: supplierPatch };
    if (Object.keys(combinedUnset).length > 0) {
      update.$unset = combinedUnset;
    }
    const persisted = await dbUnified.updateOne('suppliers', { id: req.params.id }, update);
    if (!persisted) {
      logger.error('Supplier profile update was not persisted', {
        supplierId: s.id,
        ownerUserId: req.user.id,
      });
      return res
        .status(500)
        .json({ error: 'Failed to update supplier profile. Please try again.' });
    }

    // Bust catalog cache — profile edit means the supplier data may have changed
    catalogCache
      .invalidate()
      .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

    const updatedSupplier = { ...s, ...supplierPatch };
    Object.keys(combinedUnset).forEach(key => delete updatedSupplier[key]);
    res.json({ ok: true, supplier: updatedSupplier });
  }
);

/**
 * POST /api/me/subscription/upgrade
 *
 * Re-sync the caller's Pro status (and every supplier they own) from their
 * actual subscription record. The dashboard calls this right after a
 * successful Stripe checkout redirect so the UI can reflect Pro immediately
 * rather than waiting on the webhook — but it never grants a tier itself.
 * subscriptionService.refreshUserEntitlements only ever mirrors what the
 * `subscriptions` collection already says is true (previously this endpoint
 * unconditionally set isPro=true with no payment check at all, which let any
 * authenticated supplier grant themselves Pro for free).
 */
router.post(
  '/subscription/upgrade',
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    const tier = await subscriptionService.refreshUserEntitlements(req.user.id);
    res.json({ ok: true, tier });
  }
);

/**
 * POST /api/me/suppliers/verification-request
 * This endpoint has been removed. Supplier verification now uses the existing
 * state-machine-backed endpoint: POST /api/supplier/verification/submit
 */
router.post('/verification-request', (_req, res) => {
  res.status(410).json({
    error: 'This endpoint has been removed.',
    message: 'Use POST /api/supplier/verification/submit to submit for verification.',
    code: 'ENDPOINT_REMOVED',
  });
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
