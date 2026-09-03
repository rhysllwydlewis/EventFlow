/**
 * Packages Routes
 * CRUD operations for event packages
 */

'use strict';

const express = require('express');
const { PLACEHOLDER_PACKAGE_IMAGE, isPlaceholderImage } = require('../utils/packageImageUtils');
const suppliersRouter = require('./suppliers');
const router = express.Router();

/**
 * Canonical set of allowed event type values.
 * Add new types here — the client-side form and display code read this via
 * GET /api/v1/me/packages/event-types so there is only one source of truth.
 */
const VALID_EVENT_TYPES = new Set([
  'wedding',
  'birthday',
  'corporate',
  'anniversary',
  'christening',
  'graduation',
  'engagement',
  'other',
]);

/** Human-readable labels for each event type, used in API responses. */
const EVENT_TYPE_LABELS = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  corporate: 'Corporate',
  anniversary: 'Anniversary',
  christening: 'Christening',
  graduation: 'Graduation',
  engagement: 'Engagement',
  other: 'Other',
};

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let requireVerifiedUser;
let requireApprovedSupplier;
let csrfProtection;
let featureRequired;
let writeLimiter;
let photoUpload;
let uploadValidation;
let logger;
let uid;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Packages routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'requireVerifiedUser',
    'requireApprovedSupplier',
    'csrfProtection',
    'featureRequired',
    'writeLimiter',
    'photoUpload',
    'uploadValidation',
    'logger',
    'uid',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Packages routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  requireVerifiedUser = deps.requireVerifiedUser;
  requireApprovedSupplier = deps.requireApprovedSupplier;
  csrfProtection = deps.csrfProtection;
  featureRequired = deps.featureRequired;
  writeLimiter = deps.writeLimiter;
  photoUpload = deps.photoUpload;
  uploadValidation = deps.uploadValidation;
  logger = deps.logger;
  uid = deps.uid;
}

/**
 * Generate a URL-safe slug from a title
 * @param {string} title - The title to convert to a slug
 * @returns {string} URL-safe slug
 */
function generateSlug(title) {
  if (!title) {
    return '';
  }
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function applyFeatureRequired(feature) {
  return (req, res, next) => {
    if (!featureRequired) {
      return res.status(503).json({ error: 'Feature service not initialized' });
    }
    return featureRequired(feature)(req, res, next);
  };
}

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

function applyRequireVerifiedUser(req, res, next) {
  if (!requireVerifiedUser) {
    return res.status(503).json({ error: 'Verification service not initialized' });
  }
  return requireVerifiedUser(req, res, next);
}

function applyRequireApprovedSupplier(req, res, next) {
  if (!requireApprovedSupplier) {
    return res.status(503).json({ error: 'Approval service not initialized' });
  }
  return requireApprovedSupplier(req, res, next);
}

function applyPhotoUploadSingle(fieldName) {
  return (req, res, next) => {
    if (!photoUpload) {
      return res.status(503).json({ error: 'Photo upload service not initialized' });
    }
    return photoUpload.upload.single(fieldName)(req, res, next);
  };
}

/**
 * Save a base64-encoded image to MongoDB via photo upload pipeline.
 * Derives the correct file extension from the data URI MIME type.
 * @param {string} base64 - Base64 data URI (data:image/...;base64,...)
 * @param {string} namePrefix - Filename prefix (e.g. "package_id_1234")
 * @returns {Promise<string>} Stored photo URL in /api/photos/{id} format
 * @throws {Error} If the base64 data is invalid or storage fails
 */
async function saveImageBase64(base64, namePrefix) {
  const match = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    const err = new Error('Invalid base64 image format');
    err.name = 'InvalidImageError';
    throw err;
  }
  const mimeSubtype = match[1].split('/')[1] || 'jpg';
  const ext = mimeSubtype === 'jpeg' ? 'jpg' : mimeSubtype;
  const filename = `${namePrefix}.${ext}`;
  const buffer = Buffer.from(match[2], 'base64');
  const results = await photoUpload.processAndSaveImage(buffer, filename, 'supplier');
  if (!results || !results.original) {
    const err = new Error('Image processing returned no URL');
    err.name = 'ImageProcessingError';
    throw err;
  }
  return results.original;
}

/**
 * GET /api/me/packages/event-types
 * Returns the canonical list of allowed event types with their labels.
 * Public data (fully static, non-sensitive) used by the supplier dashboard
 * form to populate checkboxes dynamically. No auth required.
 */
router.get('/me/packages/event-types', (req, res) => {
  const types = [...VALID_EVENT_TYPES].map(value => ({
    value,
    label: EVENT_TYPE_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1),
  }));
  res.json({ eventTypes: types });
});

/**
 * GET /api/me/packages
 * List supplier's packages
 */
router.get(
  '/me/packages',
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireApprovedSupplier,
  async (req, res) => {
    try {
      // Use the approved supplier profile resolved by requireApprovedSupplier where available.
      const supplierIds = req.supplierProfile?.id
        ? [req.supplierProfile.id]
        : (await dbUnified.find('suppliers', { ownerUserId: req.user.id })).map(s => s.id);
      const items =
        supplierIds.length > 0
          ? await dbUnified.find('packages', { supplierId: { $in: supplierIds } })
          : [];
      res.json({ items });
    } catch (error) {
      logger.error('Error reading supplier packages:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/me/packages
 * Create a new package
 */
router.post(
  '/me/packages',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    let { supplierId } = req.body || {};
    const { title, description, price, image, primaryCategoryKey, eventTypes } = req.body || {};
    if (!title) {
      return res.status(400).json({ error: 'Missing required field: title' });
    }

    // Price is required — suppliers must provide a specific figure
    if (!price || !String(price).trim()) {
      return res
        .status(400)
        .json({ error: 'A price is required. Please enter a specific price for this package.' });
    }

    // Validate new required fields for wizard compatibility
    if (!primaryCategoryKey) {
      return res.status(400).json({ error: 'Primary category is required' });
    }

    if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      return res.status(400).json({ error: 'At least one event type is required' });
    }

    // Validate event types against the canonical allowed set
    const validEventTypes = eventTypes.filter(t => VALID_EVENT_TYPES.has(t));
    if (validEventTypes.length === 0) {
      return res.status(400).json({
        error: `Invalid event type(s). Allowed values: ${[...VALID_EVENT_TYPES].join(', ')}`,
      });
    }

    const ownedSuppliers = req.supplierProfile
      ? [req.supplierProfile]
      : await dbUnified.find('suppliers', { ownerUserId: req.user.id });

    if (!supplierId && ownedSuppliers.length === 1) {
      supplierId = ownedSuppliers[0].id;
      logger.warn(
        'Package create defaulted missing supplierId to the only owned supplier profile',
        {
          userId: req.user.id,
          supplierId,
        }
      );
    }

    if (!supplierId) {
      return res.status(400).json({
        error: 'Missing required field: supplierId',
        code: 'SUPPLIER_ID_REQUIRED',
      });
    }

    const own = ownedSuppliers.find(s => s && s.id === supplierId);
    if (!own) {
      return res.status(403).json({
        error: 'Supplier profile ownership failed',
        code: 'SUPPLIER_PROFILE_OWNERSHIP_FAILED',
        message: 'Packages can only be created for a supplier profile owned by your account.',
      });
    }

    if (own.approved !== true) {
      return res.status(403).json({
        error: 'Supplier not approved',
        code: 'SUPPLIER_NOT_APPROVED',
        message:
          'Your supplier profile is pending admin approval. You will be notified once your account has been reviewed.',
      });
    }

    // Check subscription and get package limit
    const subscriptionService = require('../services/subscriptionService');
    const features = await subscriptionService.getUserFeatures(req.user.id);
    const packageLimit = features.features.maxPackages;

    // Count existing ACTIVE packages for this supplier (paused !== true)
    const existingForSupplier = await dbUnified.find('packages', { supplierId });
    const activeCount = existingForSupplier.filter(p => p.paused !== true).length;

    // Check if active limit is reached (packageLimit = -1 means unlimited)
    if (packageLimit !== -1 && activeCount >= packageLimit) {
      return res.status(403).json({
        error: `Your ${features.name} plan allows up to ${packageLimit} active packages. Upgrade your plan to create more.`,
        activeCount,
        limit: packageLimit,
        upgradeUrl: '/supplier/subscription',
      });
    }

    const pkgId = uid('pkg');
    const baseSlug = generateSlug(title);
    const slug = baseSlug ? `${baseSlug}-${pkgId.slice(-6)}` : pkgId;

    // Process image: if a base64 data URL was submitted through the form, convert it
    // to a stored file URL via the image pipeline. Add it to the gallery so that the
    // detail page and mini-card carousels always have a consistent source of truth.
    let resolvedImage = '';
    const gallery = [];
    if (image && typeof image === 'string' && image.startsWith('data:')) {
      try {
        const rand = Math.random().toString(36).slice(2, 8);
        resolvedImage = await saveImageBase64(image, `package_${pkgId}_${Date.now()}_${rand}`);
        gallery.push({ url: resolvedImage, approved: true, uploadedAt: Date.now() });
      } catch (e) {
        logger.warn('Package create: image processing failed, storing without image:', e.message);
      }
    } else if (image && typeof image === 'string' && image.trim()) {
      resolvedImage = image.trim();
      gallery.push({ url: resolvedImage, approved: true, uploadedAt: Date.now() });
    }

    const pkg = {
      id: pkgId,
      supplierId,
      title: String(title).slice(0, 120),
      description: String(description || '').slice(0, 1500),
      price: String(price).trim().slice(0, 60),
      image: resolvedImage,
      gallery,
      slug,
      primaryCategoryKey: String(primaryCategoryKey),
      eventTypes: validEventTypes,
      approved: true,
      featured: false,
      createdAt: new Date().toISOString(),
    };

    // Check if admin has enabled "Require Package Approval" — if so, new packages need manual review
    try {
      const settings = (await dbUnified.read('settings')) || {};
      const features = settings.features || {};
      if (features.requirePackageApproval === true) {
        pkg.approved = false;
      }
    } catch (_e) {
      // If settings read fails, default to auto-approved
    }
    const savedPkg = await dbUnified.insertOne('packages', pkg);
    if (!savedPkg) {
      logger.error('[PACKAGES] insertOne failed', { packageId: pkg.id });
      return res.status(500).json({ error: 'Failed to save package. Please try again.' });
    }
    suppliersRouter.invalidatePackageCaches();

    // Award partner package bonus if this is the supplier's first package
    // (non-blocking — must not affect the primary create flow)
    try {
      const partnerService = require('../services/partnerService');
      const existingAfterInsert = await dbUnified.find('packages', { supplierId });
      if (existingAfterInsert.length === 1) {
        // This was the first package for this supplier
        await partnerService.awardPackageBonus(req.user.id);
      }
    } catch (_pe) {
      logger.warn('Partner package bonus award failed (non-blocking):', _pe.message);
    }

    res.json({ ok: true, package: pkg });
  }
);

/**
 * Fetch a package by ID and verify the authenticated user owns it via their supplier profile.
 * Returns { pkg, own } on success, or sends an error response and returns null.
 * @param {string} id - Package ID
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @returns {Promise<{pkg: Object, own: Object}|null>}
 */
async function resolveOwnedPackage(id, req, res) {
  const pkg = await dbUnified.findOne('packages', { id });
  if (!pkg) {
    res.status(404).json({ error: 'Package not found' });
    return null;
  }

  const own = await dbUnified.findOne('suppliers', {
    id: pkg.supplierId,
    ownerUserId: req.user.id,
  });
  if (!own) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return { pkg, own };
}

/**
 * GET /api/me/packages/:id
 * Get a single package belonging to the authenticated supplier
 */
router.get(
  '/me/packages/:id',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  async (req, res) => {
    try {
      const result = await resolveOwnedPackage(req.params.id, req, res);
      if (!result) {
        return;
      }
      res.json(result.pkg);
    } catch (error) {
      logger.error('Error fetching supplier package:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PUT /api/me/packages/:id
 * Update a package belonging to the authenticated supplier
 */
router.put(
  '/me/packages/:id',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const result = await resolveOwnedPackage(req.params.id, req, res);
      if (!result) {
        return;
      }
      const { pkg } = result;

      const pkgUpdates = {};
      if (req.body.title !== undefined) {
        pkgUpdates.title = String(req.body.title).slice(0, 120);
      }
      if (req.body.description !== undefined) {
        pkgUpdates.description = String(req.body.description).slice(0, 1500);
      }
      if (req.body.price !== undefined) {
        pkgUpdates.price = String(req.body.price).slice(0, 60);
      }
      if (req.body.image !== undefined) {
        const newImage = req.body.image;
        if (newImage && typeof newImage === 'string' && newImage.startsWith('data:')) {
          // Process base64 image through the storage pipeline so we store a file URL,
          // not raw base64, which keeps the DB lean and consistent with gallery items.
          try {
            const storedUrl = await saveImageBase64(newImage, `package_${pkg.id}_${Date.now()}`);
            pkgUpdates.image = storedUrl;
            // Also add to gallery if not already present so detail view stays in sync
            const existingGallery = pkg.gallery || [];
            const alreadyInGallery = existingGallery.some(item => {
              const u = typeof item === 'string' ? item : item.url || '';
              return u === storedUrl;
            });
            if (!alreadyInGallery) {
              pkgUpdates.gallery = [
                { url: storedUrl, approved: true, uploadedAt: Date.now() },
                ...existingGallery,
              ];
            }
          } catch (e) {
            logger.warn(
              'Package update: image processing failed, keeping existing image:',
              e.message
            );
          }
        } else if (
          newImage &&
          typeof newImage === 'string' &&
          newImage.trim() &&
          newImage !== PLACEHOLDER_PACKAGE_IMAGE
        ) {
          // Plain URL provided (e.g. admin set it directly)
          pkgUpdates.image = newImage.trim();
          const existingGallery = pkg.gallery || [];
          const alreadyInGallery = existingGallery.some(item => {
            const u = typeof item === 'string' ? item : item.url || '';
            return u === pkgUpdates.image;
          });
          if (!alreadyInGallery) {
            pkgUpdates.gallery = [
              { url: pkgUpdates.image, approved: true, uploadedAt: Date.now() },
              ...existingGallery,
            ];
          }
        } else {
          pkgUpdates.image = newImage || '';
        }
      }
      if (req.body.primaryCategoryKey !== undefined) {
        pkgUpdates.primaryCategoryKey = String(req.body.primaryCategoryKey);
      }
      if (req.body.eventTypes !== undefined && Array.isArray(req.body.eventTypes)) {
        const validEventTypes = req.body.eventTypes.filter(t => VALID_EVENT_TYPES.has(t));
        if (validEventTypes.length > 0) {
          pkgUpdates.eventTypes = validEventTypes;
        }
      }
      pkgUpdates.updatedAt = new Date().toISOString();

      await dbUnified.updateOne('packages', { id: pkg.id }, { $set: pkgUpdates });
      suppliersRouter.invalidatePackageCaches();

      res.json({ ok: true, package: { ...pkg, ...pkgUpdates } });
    } catch (error) {
      logger.error('Error updating supplier package:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/me/packages/:id
 * Delete a package belonging to the authenticated supplier
 */
router.delete(
  '/me/packages/:id',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const result = await resolveOwnedPackage(req.params.id, req, res);
      if (!result) {
        return;
      }

      await dbUnified.deleteOne('packages', {
        id: req.params.id,
        supplierId: result.pkg.supplierId,
      });
      res.json({ ok: true, message: 'Package deleted successfully' });
    } catch (error) {
      logger.error('Error deleting supplier package:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PUT /api/me/packages/:id/pause
 * Pause a package belonging to the authenticated supplier
 */
router.put(
  '/me/packages/:id/pause',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const result = await resolveOwnedPackage(req.params.id, req, res);
      if (!result) {
        return;
      }
      const { pkg } = result;
      const updatedAt = Date.now();
      await dbUnified.updateOne('packages', { id: pkg.id }, { $set: { paused: true, updatedAt } });
      suppliersRouter.invalidatePackageCaches();
      res.json({ ok: true, package: { ...pkg, paused: true, updatedAt } });
    } catch (error) {
      logger.error('Error pausing supplier package:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PUT /api/me/packages/:id/unpause
 * Unpause a package belonging to the authenticated supplier
 */
router.put(
  '/me/packages/:id/unpause',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const result = await resolveOwnedPackage(req.params.id, req, res);
      if (!result) {
        return;
      }
      const { pkg } = result;

      // Enforce active package limit before unpausing
      const subscriptionService = require('../services/subscriptionService');
      const features = await subscriptionService.getUserFeatures(req.user.id);
      const packageLimit = features.features.maxPackages;

      if (packageLimit !== -1) {
        // Count currently active packages for this supplier (excluding the one being unpaused)
        const supplierPkgs = await dbUnified.find('packages', { supplierId: pkg.supplierId });
        const activeCount = supplierPkgs.filter(p => p.paused !== true && p.id !== pkg.id).length;

        if (activeCount >= packageLimit) {
          const planName = features.name || 'current';
          return res.status(403).json({
            error: `Your ${planName} plan allows up to ${packageLimit} active packages. Pause another package to activate this one, or upgrade your plan.`,
            limit: packageLimit,
            activeCount,
            upgradeUrl: '/supplier/subscription',
          });
        }
      }

      const updatedAt = Date.now();
      await dbUnified.updateOne('packages', { id: pkg.id }, { $set: { paused: false, updatedAt } });
      suppliersRouter.invalidatePackageCaches();
      res.json({ ok: true, package: { ...pkg, paused: false, updatedAt } });
    } catch (error) {
      logger.error('Error unpausing supplier package:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /api/me/packages/:id/photos
 * Upload package photo (base64)
 */
router.post(
  '/me/packages/:id/photos',
  applyFeatureRequired('photoUploads'),
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }
    const p = await dbUnified.findOne('packages', { id: req.params.id });
    if (!p) {
      return res.status(404).json({ error: 'Not found' });
    }
    const own = await dbUnified.findOne('suppliers', { id: p.supplierId, ownerUserId: req.userId });
    if (!own) {
      return res.status(403).json({ error: 'Not owner' });
    }
    let url;
    try {
      url = await saveImageBase64(image, `package_${req.params.id}_${Date.now()}`);
    } catch (e) {
      logger.error('Package photo upload failed:', e.message);
      if (e.name === 'InvalidImageError' || e.name === 'ValidationError') {
        return res.status(400).json({ error: 'Invalid image', details: e.message });
      }
      return res.status(503).json({ error: 'Photo storage unavailable', details: e.message });
    }
    if (!p.gallery) {
      p.gallery = [];
    }
    p.gallery.push({ url, approved: true, uploadedAt: Date.now() });
    const updateFields = { gallery: p.gallery };
    if (!p.image || p.image === PLACEHOLDER_PACKAGE_IMAGE || p.image === '') {
      updateFields.image = url;
    }
    await dbUnified.updateOne('packages', { id: req.params.id }, { $set: updateFields });
    suppliersRouter.invalidatePackageCaches();
    res.json({ ok: true, url });
  }
);

/**
 * DELETE /api/me/packages/:id/photos
 * Remove a photo from a package gallery by URL
 */
router.delete(
  '/me/packages/:id/photos',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Missing url' });
    }
    const p = await dbUnified.findOne('packages', { id: req.params.id });
    if (!p) {
      return res.status(404).json({ error: 'Not found' });
    }
    const own = await dbUnified.findOne('suppliers', { id: p.supplierId, ownerUserId: req.userId });
    if (!own) {
      return res.status(403).json({ error: 'Not owner' });
    }
    const gallery = p.gallery || [];
    const newGallery = gallery.filter(item => {
      const itemUrl = typeof item === 'string' ? item : item.url || '';
      return itemUrl !== url;
    });
    const updateFields = { gallery: newGallery };
    if (p.image === url) {
      const nextPhoto = newGallery.find(item => {
        const itemUrl = typeof item === 'string' ? item : item.url || '';
        return !!itemUrl;
      });
      updateFields.image = nextPhoto
        ? typeof nextPhoto === 'string'
          ? nextPhoto
          : nextPhoto.url
        : PLACEHOLDER_PACKAGE_IMAGE || '';
    }
    await dbUnified.updateOne('packages', { id: req.params.id }, { $set: updateFields });
    suppliersRouter.invalidatePackageCaches();
    res.json({
      ok: true,
      gallery: newGallery,
      image: updateFields.image !== undefined ? updateFields.image : p.image,
    });
  }
);

/**
 * PUT /api/me/packages/:id/gallery/order
 * Reorder the photos in a package gallery.
 * Body: { urls: [string, ...] }  — full ordered list of gallery photo URLs.
 * The first URL becomes pkg.image (the card thumbnail shown everywhere).
 */
router.put(
  '/me/packages/:id/gallery/order',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  async (req, res) => {
    const { urls } = req.body || {};
    if (!Array.isArray(urls)) {
      return res.status(400).json({ error: 'urls must be an array' });
    }

    const p = await dbUnified.findOne('packages', { id: req.params.id });
    if (!p) {
      return res.status(404).json({ error: 'Not found' });
    }

    const own = await dbUnified.findOne('suppliers', { id: p.supplierId, ownerUserId: req.userId });
    if (!own) {
      return res.status(403).json({ error: 'Not owner' });
    }

    // Build an ordered gallery by matching incoming URL order against existing gallery objects
    // so that metadata (thumbnail, uploadedAt, etc.) is preserved.
    const existingByUrl = new Map();
    (p.gallery || []).forEach(item => {
      const itemUrl = typeof item === 'string' ? item : item.url || '';
      if (itemUrl) {
        existingByUrl.set(itemUrl, item);
      }
    });

    // Only accept URLs that are actually in the existing gallery (no injection)
    const orderedGallery = urls
      .filter(u => typeof u === 'string' && existingByUrl.has(u))
      .map(u => existingByUrl.get(u));

    const updateFields = { gallery: orderedGallery };

    // Sync pkg.image to the first gallery item so card thumbnails update immediately
    if (orderedGallery.length > 0) {
      const first = orderedGallery[0];
      updateFields.image =
        typeof first === 'string' ? first : first.url || PLACEHOLDER_PACKAGE_IMAGE;
    } else {
      updateFields.image = PLACEHOLDER_PACKAGE_IMAGE;
    }

    await dbUnified.updateOne('packages', { id: req.params.id }, { $set: updateFields });
    suppliersRouter.invalidatePackageCaches();

    res.json({
      ok: true,
      gallery: orderedGallery,
      image: updateFields.image,
    });
  }
);

/**
 * GET /api/admin/packages
 * List all packages (admin only)
 */
router.get('/admin/packages', applyAuthRequired, applyRoleRequired('admin'), async (_req, res) => {
  try {
    res.json({ items: await dbUnified.read('packages') });
  } catch (error) {
    logger.error('Error reading packages for admin:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/admin/packages/:id/approve
 * Approve or unapprove a package
 */
router.post(
  '/admin/packages/:id/approve',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const pkg = await dbUnified.findOne('packages', { id: req.params.id });
    if (!pkg) {
      return res.status(404).json({ error: 'Not found' });
    }
    await dbUnified.updateOne(
      'packages',
      { id: req.params.id },
      {
        $set: { approved: !!(req.body && req.body.approved) },
      }
    );
    suppliersRouter.invalidatePackageCaches();
    res.json({ ok: true, package: { ...pkg, approved: !!(req.body && req.body.approved) } });
  }
);

/**
 * POST /api/admin/packages/:id/feature
 * Feature or unfeature a package
 */
router.post(
  '/admin/packages/:id/feature',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const pkg = await dbUnified.findOne('packages', { id: req.params.id });
    if (!pkg) {
      return res.status(404).json({ error: 'Not found' });
    }
    await dbUnified.updateOne(
      'packages',
      { id: req.params.id },
      {
        $set: { featured: !!(req.body && req.body.featured) },
      }
    );
    suppliersRouter.invalidatePackageCaches();
    res.json({ ok: true, package: { ...pkg, featured: !!(req.body && req.body.featured) } });
  }
);

/**
 * PUT /api/admin/packages/:id
 * Update package details
 */
router.put(
  '/admin/packages/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const pkg = await dbUnified.findOne('packages', { id });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const now = new Date().toISOString();
    const pkgUpdates = {};

    // Update allowed fields
    if (req.body.title) {
      pkgUpdates.title = req.body.title;
    }
    if (req.body.description) {
      pkgUpdates.description = req.body.description;
    }
    if (req.body.price_display) {
      pkgUpdates.price_display = req.body.price_display;
    }
    if (req.body.image) {
      const newImage = req.body.image;
      pkgUpdates.image = newImage;
      // Sync to gallery so the detail view resolvedGallery reflects the new image
      if (!isPlaceholderImage(newImage)) {
        const existingGallery = pkg.gallery || [];
        const alreadyInGallery = existingGallery.some(item => {
          const u = typeof item === 'string' ? item : item.url || '';
          return u === newImage;
        });
        if (!alreadyInGallery) {
          pkgUpdates.gallery = [
            { url: newImage, approved: true, uploadedAt: Date.now() },
            ...existingGallery,
          ];
        }
      }
    }
    if (typeof req.body.approved === 'boolean') {
      pkgUpdates.approved = req.body.approved;
    }
    if (typeof req.body.featured === 'boolean') {
      pkgUpdates.featured = req.body.featured;
    }
    pkgUpdates.updatedAt = now;

    await dbUnified.updateOne('packages', { id }, { $set: pkgUpdates });
    suppliersRouter.invalidatePackageCaches();

    res.json({ ok: true, package: { ...pkg, ...pkgUpdates } });
  }
);

/**
 * DELETE /api/admin/packages/:id
 * Delete a package
 */
router.delete(
  '/admin/packages/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    const { id } = req.params;
    const pkg = await dbUnified.findOne('packages', { id });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    await dbUnified.deleteOne('packages', id);
    suppliersRouter.invalidatePackageCaches();
    res.json({ ok: true, message: 'Package deleted successfully' });
  }
);

/**
 * POST /api/admin/packages/:id/image
 * Admin: Upload package image
 */
router.post(
  '/admin/packages/:id/image',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  applyPhotoUploadSingle('image'),
  async (req, res) => {
    try {
      const packageId = req.params.id;
      const pkgForUpload = await dbUnified.findOne('packages', { id: packageId });

      if (!pkgForUpload) {
        return res.status(404).json({ error: 'Package not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      logger.info(`Processing package image upload for package ${packageId}`, {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      });

      // Process and save the image
      const imageData = await photoUpload.processAndSaveImage(
        req.file.buffer,
        req.file.originalname,
        'supplier'
      );

      const pkg = pkgForUpload;
      const uploadedUrl = imageData.optimized || imageData.large;

      // Build update: always set pkg.image; also prepend to gallery so the
      // detail-view resolvedGallery reflects the newly uploaded image.
      const existingGallery = pkg.gallery || [];
      const alreadyInGallery = existingGallery.some(item => {
        const u = typeof item === 'string' ? item : item.url || '';
        return u === uploadedUrl;
      });
      const updatedGallery = alreadyInGallery
        ? existingGallery
        : [{ url: uploadedUrl, approved: true, uploadedAt: Date.now() }, ...existingGallery];

      // Update package with new image URL
      const imageUpdates = {
        image: uploadedUrl,
        gallery: updatedGallery,
        updatedAt: new Date().toISOString(),
      };
      await dbUnified.updateOne('packages', { id: packageId }, { $set: imageUpdates });
      suppliersRouter.invalidatePackageCaches();

      logger.info(`Package image uploaded successfully for package ${packageId}`);

      res.json({
        ok: true,
        package: { ...pkgForUpload, ...imageUpdates },
        imageUrl: imageUpdates.image,
      });
    } catch (error) {
      logger.error('Error uploading package image:', {
        error: error.message,
        name: error.name,
        details: error.details,
        ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
      });

      // Handle validation errors with appropriate status codes and detailed feedback
      if (error.name === 'ValidationError') {
        const errorResponse = uploadValidation.formatValidationErrorResponse(error);

        // Guard against null response (should not happen but defensive coding)
        if (!errorResponse) {
          return res.status(400).json({
            error: error.message,
            details: error.details || {},
          });
        }

        // Log debug info for troubleshooting
        if (errorResponse.magicBytes) {
          logger.warn('File type validation failed - magic bytes:', {
            magicBytes: errorResponse.magicBytes,
            detectedType: errorResponse.details.detectedType,
          });
        }

        return res.status(400).json({
          error: errorResponse.error,
          details: errorResponse.details,
        });
      }

      // Handle Sharp processing errors
      if (error.name === 'SharpProcessingError') {
        return res.status(500).json({
          error: 'Failed to process image',
          details: 'Image processing library error. Please try a different image format or file.',
        });
      }

      // Handle MongoDB/storage errors
      if (error.name === 'MongoDBStorageError' || error.name === 'FilesystemError') {
        return res.status(500).json({
          error: 'Failed to save image',
          details: 'Storage system error. Please try again later.',
        });
      }

      // Generic error fallback
      res.status(500).json({
        error: 'Failed to upload image',
        details:
          process.env.NODE_ENV !== 'production'
            ? error.message || 'An unexpected error occurred'
            : undefined,
      });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
