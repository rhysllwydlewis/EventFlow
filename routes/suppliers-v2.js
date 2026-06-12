/**
 * Suppliers V2 Routes
 * Enhanced supplier management with photo gallery endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const catalogCache = require('../services/catalogCache');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let requireVerifiedUser;
let csrfProtection;
let featureRequired;
let photoUpload;
let writeLimiter;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Suppliers V2 routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'requireVerifiedUser',
    'csrfProtection',
    'featureRequired',
    'photoUpload',
    'writeLimiter',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Suppliers V2 routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  requireVerifiedUser = deps.requireVerifiedUser;
  csrfProtection = deps.csrfProtection;
  featureRequired = deps.featureRequired;
  photoUpload = deps.photoUpload;
  writeLimiter = deps.writeLimiter;
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

function applyRequireVerifiedUser(req, res, next) {
  if (!requireVerifiedUser) {
    return res.status(503).json({ error: 'Verification service not initialized' });
  }
  return requireVerifiedUser(req, res, next);
}

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

/**
 * Save a base64-encoded image to MongoDB via photo upload pipeline.
 * Derives the correct file extension from the data URI MIME type.
 * @param {string} base64 - Base64 data URI (data:image/...;base64,...)
 * @param {string} namePrefix - Filename prefix (e.g. "supplier_id_1234")
 * @returns {Promise<{url:string, thumbnail:string, large:string, original:string}>}
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
  // Return all size variants so callers can store the full photo record.
  // url = optimized (1200px) — best general-purpose display size.
  return {
    url:      results.optimized || results.original,
    thumbnail: results.thumbnail || results.optimized || results.original,
    large:    results.large     || results.original,
    original: results.original,
  };
}

/**
 * GET /api/me/suppliers/:id/photos
 * List all photos for a supplier
 */
// Rate-limited via applyWriteLimiter (deferred wrapper around express-rate-limit writeLimiter)
router.get('/:id/photos', applyWriteLimiter, applyAuthRequired, async (req, res) => {
  // lgtm[js/missing-rate-limiting]
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === id);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Check ownership or admin
    if (supplier.ownerUserId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const photos = supplier.photosGallery || [];

    res.json({
      success: true,
      count: photos.length,
      photos: photos.map((p, index) => ({
        id: p.id || `photo_${index}`,
        url: p.url,
        thumbnail: p.thumbnail || p.url,
        approved: p.approved !== false,
        uploadedAt: p.uploadedAt || supplier.createdAt,
      })),
    });
  } catch (error) {
    logger.error('List photos error:', error);
    res.status(500).json({
      error: 'Failed to list photos',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/me/suppliers/:id/photos
 * Upload a photo to supplier gallery (base64)
 */
router.post(
  '/:id/photos',
  applyWriteLimiter,
  applyFeatureRequired('photoUploads'),
  applyAuthRequired,
  applyRequireVerifiedUser,
  applyCsrfProtection,
  async (req, res) => {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }
    const suppliers = await dbUnified.read('suppliers');
    const s = suppliers.find(x => x.id === req.params.id && x.ownerUserId === req.user.id);
    if (!s) {
      return res.status(403).json({ error: 'Not owner' });
    }
    let imageVariants;
    try {
      imageVariants = await saveImageBase64(image, `supplier_${req.params.id}_${Date.now()}`);
    } catch (e) {
      logger.error('Supplier photo upload failed:', e.message);
      if (e.name === 'InvalidImageError' || e.name === 'ValidationError') {
        return res.status(400).json({ error: 'Invalid image', details: e.message });
      }
      return res.status(503).json({ error: 'Photo storage unavailable', details: e.message });
    }
    const photosGallery = s.photosGallery || [];
    const photoRecord = {
      url:       imageVariants.url,
      thumbnail: imageVariants.thumbnail,
      large:     imageVariants.large,
      original:  imageVariants.original,
      approved:  true,
      uploadedAt: new Date().toISOString(),
    };
    photosGallery.push(photoRecord);
    await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: { photosGallery } });
    res.json({ ok: true, url: photoRecord.url, photo: photoRecord });
  }
);

/**
 * DELETE /api/me/suppliers/:id/photos/:photoId
 * Delete a specific photo from supplier gallery
 */
router.delete(
  '/:id/photos/:photoId',
  applyWriteLimiter,
  applyAuthRequired,
  applyRequireVerifiedUser,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { id, photoId } = req.params;
      const userId = req.user.id;

      // Get supplier and verify ownership
      const suppliers = await dbUnified.read('suppliers');
      const supplierIndex = suppliers.findIndex(s => s.id === id);

      if (supplierIndex === -1) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const supplier = suppliers[supplierIndex];

      // Check ownership
      if (supplier.ownerUserId !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Find and remove photo from gallery
      if (!supplier.photosGallery || !Array.isArray(supplier.photosGallery)) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      const photoIndex = supplier.photosGallery.findIndex(
        p => p.id === photoId || p.url === photoId
      );

      if (photoIndex === -1) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      // Remove photo
      const removedPhoto = supplier.photosGallery.splice(photoIndex, 1)[0];
      await dbUnified.updateOne(
        'suppliers',
        { id },
        {
          $set: { photosGallery: supplier.photosGallery, updatedAt: new Date().toISOString() },
        }
      );

      // Delete the photo from MongoDB (for /api/photos/ URLs) or skip gracefully for legacy /uploads/ paths
      if (removedPhoto.url) {
        if (removedPhoto.url.startsWith('/api/photos/')) {
          await photoUpload.deleteImage(removedPhoto.url);
        }
        // Legacy /uploads/ URLs: the file may not exist on disk; just remove the reference (already done above)
      }

      res.json({
        success: true,
        message: 'Photo deleted successfully',
        remainingPhotos: supplier.photosGallery.length,
      });
    } catch (error) {
      logger.error('Delete photo error:', error);
      res.status(500).json({
        error: 'Failed to delete photo',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * PATCH /api/me/suppliers/:id/photos/order
 * Reorder photos in a supplier's gallery.
 * Body: { photoIds: [string, ...] }  — full ordered list of photo IDs or URLs.
 * Validates ownership, CSRF, rate limit, and that provided IDs belong to this supplier.
 */
// Rate-limited via applyWriteLimiter (deferred wrapper around express-rate-limit writeLimiter)
router.patch(
  '/:id/photos/order', // lgtm[js/missing-rate-limiting]
  applyWriteLimiter,
  applyAuthRequired,
  applyRequireVerifiedUser,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { photoIds } = req.body || {};

      if (!Array.isArray(photoIds)) {
        return res.status(400).json({ error: 'photoIds must be an array' });
      }

      if (photoIds.length > 10) {
        return res.status(400).json({ error: 'Cannot have more than 10 photos' });
      }

      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === id);

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Check ownership
      if (supplier.ownerUserId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const existingGallery = supplier.photosGallery || [];

      // Validate that all provided IDs exist in this supplier's gallery
      const existingIds = new Set(existingGallery.map((p, i) => p.id || p.url || `photo_${i}`));
      const invalidIds = photoIds.filter(pid => !existingIds.has(pid));
      if (invalidIds.length > 0) {
        return res.status(400).json({
          error: 'Some photo IDs do not belong to this supplier',
          invalidIds,
        });
      }

      // Build the new ordered gallery, preserving all photo metadata
      const galleryByKey = {};
      existingGallery.forEach((p, i) => {
        const key = p.id || p.url || `photo_${i}`;
        galleryByKey[key] = p;
      });

      const reorderedGallery = photoIds.map(pid => galleryByKey[pid]).filter(Boolean);

      // Append any photos not included in the new order (keep them at the end)
      existingGallery.forEach((p, i) => {
        const key = p.id || p.url || `photo_${i}`;
        if (!photoIds.includes(key)) {
          reorderedGallery.push(p);
        }
      });

      await dbUnified.updateOne(
        'suppliers',
        { id },
        { $set: { photosGallery: reorderedGallery, updatedAt: new Date().toISOString() } }
      );

      // Bust catalog cache — photo order affects public listing
      catalogCache
        .invalidate()
        .catch(e => logger.warn('[catalogCache] invalidate error:', e.message));

      res.json({
        success: true,
        message: 'Photo order saved',
        photosGallery: reorderedGallery,
      });
    } catch (error) {
      logger.error('Photo reorder error:', error);
      res.status(500).json({
        error: 'Failed to save photo order',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
