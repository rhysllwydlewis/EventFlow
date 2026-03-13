/**
 * Suppliers V2 Routes
 * Enhanced supplier management with photo gallery endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let csrfProtection;
let featureRequired;
let photoUpload;

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
    'csrfProtection',
    'featureRequired',
    'photoUpload',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Suppliers V2 routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  csrfProtection = deps.csrfProtection;
  featureRequired = deps.featureRequired;
  photoUpload = deps.photoUpload;
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

/**
 * Save a base64-encoded image to MongoDB via photo upload pipeline.
 * Derives the correct file extension from the data URI MIME type.
 * @param {string} base64 - Base64 data URI (data:image/...;base64,...)
 * @param {string} namePrefix - Filename prefix (e.g. "supplier_id_1234")
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
 * GET /api/me/suppliers/:id/photos
 * List all photos for a supplier
 */
router.get('/:id/photos', applyAuthRequired, async (req, res) => {
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
    res.status(500).json({ error: 'Failed to list photos', details: error.message });
  }
});

/**
 * POST /api/me/suppliers/:id/photos
 * Upload a photo to supplier gallery (base64)
 */
router.post(
  '/:id/photos',
  applyFeatureRequired('photoUploads'),
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }
    const suppliers = await dbUnified.read('suppliers');
    const s = suppliers.find(x => x.id === req.params.id && x.ownerUserId === req.userId);
    if (!s) {
      return res.status(403).json({ error: 'Not owner' });
    }
    let url;
    try {
      url = await saveImageBase64(image, `supplier_${req.params.id}_${Date.now()}`);
    } catch (e) {
      logger.error('Supplier photo upload failed:', e.message);
      if (e.name === 'InvalidImageError' || e.name === 'ValidationError') {
        return res.status(400).json({ error: 'Invalid image', details: e.message });
      }
      return res.status(503).json({ error: 'Photo storage unavailable', details: e.message });
    }
    const photosGallery = s.photosGallery || [];
    photosGallery.push({ url, approved: true, uploadedAt: new Date().toISOString() });
    await dbUnified.updateOne('suppliers', { id: req.params.id }, { $set: { photosGallery } });
    res.json({ ok: true, url });
  }
);

/**
 * DELETE /api/me/suppliers/:id/photos/:photoId
 * Delete a specific photo from supplier gallery
 */
router.delete('/:id/photos/:photoId', applyAuthRequired, applyCsrfProtection, async (req, res) => {
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

    const photoIndex = supplier.photosGallery.findIndex(p => p.id === photoId || p.url === photoId);

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
    res.status(500).json({ error: 'Failed to delete photo', details: error.message });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
