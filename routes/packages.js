/**
 * Packages Routes
 * CRUD operations for event packages
 */

'use strict';

const express = require('express');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let csrfProtection;
let featureRequired;
let writeLimiter;
let photoUpload;
let uploadValidation;
let logger;
let uid;
let path;
let fs;
let DATA_DIR;

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
    'csrfProtection',
    'featureRequired',
    'writeLimiter',
    'photoUpload',
    'uploadValidation',
    'logger',
    'uid',
    'path',
    'fs',
    'DATA_DIR',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Packages routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  csrfProtection = deps.csrfProtection;
  featureRequired = deps.featureRequired;
  writeLimiter = deps.writeLimiter;
  photoUpload = deps.photoUpload;
  uploadValidation = deps.uploadValidation;
  logger = deps.logger;
  uid = deps.uid;
  path = deps.path;
  fs = deps.fs;
  DATA_DIR = deps.DATA_DIR;
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

function applyPhotoUploadSingle(fieldName) {
  return (req, res, next) => {
    if (!photoUpload) {
      return res.status(503).json({ error: 'Photo upload service not initialized' });
    }
    return photoUpload.upload.single(fieldName)(req, res, next);
  };
}

/**
 * Helper function to save base64 image
 */
function saveImageBase64(base64, ownerType, ownerId) {
  try {
    const match = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return null;
    }
    const ext = match[1].split('/')[1];
    const buffer = Buffer.from(match[2], 'base64');
    const UP_ROOT = path.join(DATA_DIR, 'uploads');
    const folder = path.join(UP_ROOT, ownerType, ownerId);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = path.join(folder, filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${ownerType}/${ownerId}/${filename}`;
  } catch (e) {
    return null;
  }
}

/**
 * GET /api/me/packages
 * List supplier's packages
 */
router.get('/me/packages', applyAuthRequired, applyRoleRequired('supplier'), async (req, res) => {
  try {
    const mine = (await dbUnified.read('suppliers'))
      .filter(s => s.ownerUserId === req.user.id)
      .map(s => s.id);
    const items = (await dbUnified.read('packages')).filter(p => mine.includes(p.supplierId));
    res.json({ items });
  } catch (error) {
    logger.error('Error reading supplier packages:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/me/packages
 * Create a new package
 */
router.post(
  '/me/packages',
  applyWriteLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    const { supplierId, title, description, price, image, primaryCategoryKey, eventTypes } =
      req.body || {};
    if (!supplierId || !title) {
      return res.status(400).json({ error: 'Missing required fields: supplierId and title' });
    }

    // Validate new required fields for wizard compatibility
    if (!primaryCategoryKey) {
      return res.status(400).json({ error: 'Primary category is required' });
    }

    if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      return res
        .status(400)
        .json({ error: 'At least one event type is required (wedding or other)' });
    }

    // Validate event types
    const validEventTypes = eventTypes.filter(t => t === 'wedding' || t === 'other');
    if (validEventTypes.length === 0) {
      return res.status(400).json({ error: 'Event types must be "wedding" or "other"' });
    }

    const own = (await dbUnified.read('suppliers')).find(
      s => s.id === supplierId && s.ownerUserId === req.user.id
    );
    if (!own) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check subscription and get package limit
    const subscriptionService = require('../services/subscriptionService');
    const subscription = await subscriptionService.getSubscriptionByUserId(req.user.id);
    const features = await subscriptionService.getUserFeatures(req.user.id);
    const packageLimit = features.features.maxPackages;

    // Count existing packages for this supplier
    const allPkgs = await dbUnified.read('packages');
    const existingForSupplier = allPkgs.filter(p => p.supplierId === supplierId);
    const existingCount = existingForSupplier.length;

    // Check if limit is reached (packageLimit = -1 means unlimited)
    if (packageLimit !== -1 && existingCount >= packageLimit) {
      return res.status(403).json({
        error: `Your ${subscription?.plan || 'free'} plan allows up to ${packageLimit} packages. Upgrade to create more.`,
        currentCount: existingCount,
        limit: packageLimit,
        upgradeUrl: '/supplier/subscription.html',
      });
    }

    const pkg = {
      id: uid('pkg'),
      supplierId,
      title: String(title).slice(0, 120),
      description: String(description || '').slice(0, 1500),
      price: String(price || '').slice(0, 60),
      image: image || '',
      primaryCategoryKey: String(primaryCategoryKey),
      eventTypes: validEventTypes,
      approved: false,
      featured: false,
      createdAt: new Date().toISOString(),
    };
    await dbUnified.insertOne('packages', pkg);
    res.json({ ok: true, package: pkg });
  }
);

/**
 * POST /api/me/packages/:id/photos
 * Upload package photo (base64)
 */
router.post(
  '/me/packages/:id/photos',
  applyFeatureRequired('photoUploads'),
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }
    const pkgs = await dbUnified.read('packages');
    const p = pkgs.find(x => x.id === req.params.id);
    if (!p) {
      return res.status(404).json({ error: 'Not found' });
    }
    const suppliers = await dbUnified.read('suppliers');
    const own = suppliers.find(x => x.id === p.supplierId && x.ownerUserId === req.userId);
    if (!own) {
      return res.status(403).json({ error: 'Not owner' });
    }
    const url = saveImageBase64(image, 'packages', req.params.id);
    if (!url) {
      return res.status(400).json({ error: 'Invalid image' });
    }
    if (!p.gallery) {
      p.gallery = [];
    }
    p.gallery.push({ url, approved: true, uploadedAt: Date.now() });
    await dbUnified.updateOne('packages', { id: req.params.id }, { $set: { gallery: p.gallery } });
    res.json({ ok: true, url });
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
    const all = await dbUnified.read('packages');
    const pkg = all.find(p => p.id === req.params.id);
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
    const all = await dbUnified.read('packages');
    const pkg = all.find(p => p.id === req.params.id);
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
    const packages = await dbUnified.read('packages');
    const pkg = packages.find(p => p.id === id);

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
      pkgUpdates.image = req.body.image;
    }
    if (typeof req.body.approved === 'boolean') {
      pkgUpdates.approved = req.body.approved;
    }
    if (typeof req.body.featured === 'boolean') {
      pkgUpdates.featured = req.body.featured;
    }
    pkgUpdates.updatedAt = now;

    await dbUnified.updateOne('packages', { id }, { $set: pkgUpdates });

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
    const packages = await dbUnified.read('packages');
    const pkg = packages.find(p => p.id === id);

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    await dbUnified.deleteOne('packages', id);
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
      const packages = await dbUnified.read('packages');
      const packageIndex = packages.findIndex(p => p.id === packageId);

      if (packageIndex === -1) {
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

      // Update package with new image URL
      const imageUpdates = {
        image: imageData.optimized || imageData.large,
        updatedAt: new Date().toISOString(),
      };
      await dbUnified.updateOne('packages', { id: packageId }, { $set: imageUpdates });

      logger.info(`Package image uploaded successfully for package ${packageId}`);

      res.json({
        ok: true,
        package: { ...packages[packageIndex], ...imageUpdates },
        imageUrl: packages[packageIndex].image,
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
        details: error.message || 'An unexpected error occurred',
      });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
