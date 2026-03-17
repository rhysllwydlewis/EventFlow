/**
 * Admin Configuration Routes
 * Badge and category management for administrators
 */

'use strict';

const express = require('express');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let csrfProtection;
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
    throw new Error('Admin config routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'csrfProtection',
    'photoUpload',
    'uploadValidation',
    'logger',
    'uid',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Admin config routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  csrfProtection = deps.csrfProtection;
  photoUpload = deps.photoUpload;
  uploadValidation = deps.uploadValidation;
  logger = deps.logger;
  uid = deps.uid;
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

function applyPhotoUploadSingle(fieldName) {
  return (req, res, next) => {
    if (!photoUpload) {
      return res.status(503).json({ error: 'Photo upload service not initialized' });
    }
    return photoUpload.upload.single(fieldName)(req, res, next);
  };
}

// ---------- Badge Management ----------

/**
 * GET /api/admin/badges
 * Get all badges
 */
router.get('/badges', applyAuthRequired, applyRoleRequired('admin'), async (req, res) => {
  try {
    const badges = await dbUnified.read('badges');
    res.json({ badges });
  } catch (error) {
    logger.error('Error fetching badges:', error);
    res.status(500).json({ error: 'Failed to fetch badges' });
  }
});

/**
 * POST /api/admin/badges
 * Create a new badge
 */
router.post(
  '/badges',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { name, type, description, icon, color, autoAssign, autoAssignCriteria } = req.body;

      if (!name || !type) {
        return res.status(400).json({ error: 'Name and type are required' });
      }

      const now = new Date().toISOString();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      const newBadge = {
        id: uid('bdg'),
        name,
        slug,
        type,
        description: description || '',
        icon: icon || '🏅',
        color: color || '#13B6A2',
        autoAssign: autoAssign || false,
        autoAssignCriteria: autoAssignCriteria || null,
        displayOrder: 100,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      await dbUnified.insertOne('badges', newBadge);

      res.status(201).json({ badge: newBadge });
    } catch (error) {
      logger.error('Error creating badge:', error);
      res.status(500).json({ error: 'Failed to create badge' });
    }
  }
);

/**
 * PUT /api/admin/badges/:id
 * Update a badge
 */
router.put(
  '/badges/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        name,
        type,
        description,
        icon,
        color,
        autoAssign,
        autoAssignCriteria,
        displayOrder,
        active,
      } = req.body;

      // Validate allowed fields
      const allowedUpdates = {
        name,
        type,
        description,
        icon,
        color,
        autoAssign,
        autoAssignCriteria,
        displayOrder,
        active,
      };
      const updates = {};

      // Only include defined fields
      Object.keys(allowedUpdates).forEach(key => {
        if (allowedUpdates[key] !== undefined) {
          updates[key] = allowedUpdates[key];
        }
      });

      // Validate required fields if provided
      if (updates.name !== undefined && (!updates.name || typeof updates.name !== 'string')) {
        return res.status(400).json({ error: 'Invalid name field' });
      }

      if (updates.type !== undefined) {
        const validTypes = ['founder', 'pro', 'pro-plus', 'verified', 'featured', 'custom'];
        if (!validTypes.includes(updates.type)) {
          return res.status(400).json({ error: 'Invalid badge type' });
        }
      }

      const badges = await dbUnified.read('badges');
      const badgeIndex = badges.findIndex(b => b.id === id);

      if (badgeIndex === -1) {
        return res.status(404).json({ error: 'Badge not found' });
      }

      const updatedBadge = {
        ...badges[badgeIndex],
        ...updates,
        id, // Preserve ID
        updatedAt: new Date().toISOString(),
      };

      await dbUnified.updateOne(
        'badges',
        { id },
        { $set: { ...updates, updatedAt: updatedBadge.updatedAt } }
      );
      res.json({ badge: updatedBadge });
    } catch (error) {
      logger.error('Error updating badge:', error);
      res.status(500).json({ error: 'Failed to update badge' });
    }
  }
);

/**
 * DELETE /api/admin/badges/:id
 * Delete a badge
 */
router.delete(
  '/badges/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const badges = await dbUnified.read('badges');
      const badgeExists = badges.some(b => b.id === id);

      if (!badgeExists) {
        return res.status(404).json({ error: 'Badge not found' });
      }

      await dbUnified.deleteOne('badges', id);
      res.json({ success: true });
    } catch (error) {
      logger.error('Error deleting badge:', error);
      res.status(500).json({ error: 'Failed to delete badge' });
    }
  }
);

/**
 * POST /api/admin/users/:userId/badges/:badgeId
 * Award a badge to a user
 */
router.post(
  '/users/:userId/badges/:badgeId',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { userId, badgeId } = req.params;

      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const badges = user.badges || [];
      if (!badges.includes(badgeId)) {
        badges.push(badgeId);
        await dbUnified.updateOne('users', { id: userId }, { $set: { badges } });
      }

      res.json({ success: true, user: { ...user, badges } });
    } catch (error) {
      logger.error('Error awarding badge:', error);
      res.status(500).json({ error: 'Failed to award badge' });
    }
  }
);

/**
 * DELETE /api/admin/users/:userId/badges/:badgeId
 * Remove a badge from a user
 */
router.delete(
  '/users/:userId/badges/:badgeId',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { userId, badgeId } = req.params;

      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const badges = (user.badges || []).filter(b => b !== badgeId);
      await dbUnified.updateOne('users', { id: userId }, { $set: { badges } });

      res.json({ success: true, user: { ...user, badges } });
    } catch (error) {
      logger.error('Error removing badge:', error);
      res.status(500).json({ error: 'Failed to remove badge' });
    }
  }
);

// ---------- Category Management ----------

/**
 * POST /api/admin/categories/:id/hero-image
 * Update category hero image
 */
router.post(
  '/categories/:id/hero-image',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  applyPhotoUploadSingle('image'),
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const categories = await dbUnified.read('categories');
      const categoryIndex = categories.findIndex(c => c.id === categoryId);

      if (categoryIndex === -1) {
        return res.status(404).json({ error: 'Category not found' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image file provided' });
      }

      logger.info(`Processing category hero image upload for category ${categoryId}`, {
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

      // Update category with new hero image URL
      categories[categoryIndex].heroImage = imageData.optimized || imageData.large;

      await dbUnified.updateOne(
        'categories',
        { id: categoryId },
        { $set: { heroImage: categories[categoryIndex].heroImage } }
      );

      logger.info(`Category hero image uploaded successfully for category ${categoryId}`);

      res.json({
        ok: true,
        category: categories[categoryIndex],
        imageUrl: categories[categoryIndex].heroImage,
      });
    } catch (error) {
      logger.error('Error uploading category hero image:', {
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

/**
 * DELETE /api/admin/categories/:id/hero-image
 * Remove category hero image
 */
router.delete(
  '/categories/:id/hero-image',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const categories = await dbUnified.read('categories');
      const categoryIndex = categories.findIndex(c => c.id === categoryId);

      if (categoryIndex === -1) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const oldImageUrl = categories[categoryIndex].heroImage;

      // Remove the hero image URL
      delete categories[categoryIndex].heroImage;

      await dbUnified.updateOne('categories', { id: categoryId }, { $unset: { heroImage: '' } });

      // Optionally delete the old image file if it exists
      if (oldImageUrl && typeof oldImageUrl === 'string' && oldImageUrl.trim() !== '') {
        try {
          await photoUpload.deleteImage(oldImageUrl);
        } catch (deleteErr) {
          // Ignore delete errors - the URL is already removed from the category
          logger.warn('Failed to delete old image file:', deleteErr);
        }
      }

      res.json({
        ok: true,
        category: categories[categoryIndex],
      });
    } catch (error) {
      logger.error('Error removing category hero image:', error);
      res
        .status(500)
        .json({
          error: 'Failed to remove image',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * POST /api/admin/categories
 * Create a new category
 */
router.post(
  '/categories',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { name, slug, description, icon, heroImage, pexelsAttribution, visible } = req.body;

      if (!name || !slug) {
        return res.status(400).json({ error: 'Name and slug are required' });
      }

      const categories = await dbUnified.read('categories');

      // Check if slug already exists
      if (categories.find(c => c.slug === slug)) {
        return res.status(400).json({ error: 'Category with this slug already exists' });
      }

      // Generate unique ID
      const newCategory = {
        id: uid('cat'),
        name,
        slug,
        description: description || '',
        icon: icon || '📁',
        heroImage: heroImage || '',
        pexelsAttribution: pexelsAttribution || '',
        order: categories.length + 1,
        visible: visible !== false,
      };

      await dbUnified.insertOne('categories', newCategory);

      res.json({
        ok: true,
        category: newCategory,
      });
    } catch (error) {
      logger.error('Error creating category:', error);
      res
        .status(500)
        .json({
          error: 'Failed to create category',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * PUT /api/admin/categories/reorder
 * Reorder categories
 * Note: Must be defined before /categories/:id to prevent route conflicts
 */
router.put(
  '/categories/reorder',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { orderedIds } = req.body;

      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'orderedIds must be an array' });
      }

      const categories = await dbUnified.read('categories');

      // Build a map of id -> new order for efficient lookup
      const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));

      // Assign order to orphaned categories (not in orderedIds)
      const orphanStart = orderedIds.length + 1;
      let orphanOffset = 0;
      categories.forEach(c => {
        if (!orderMap.has(c.id)) {
          orderMap.set(c.id, orphanStart + orphanOffset++);
        }
      });

      // Persist order for each category atomically
      await Promise.all(
        categories.map(c => {
          const newOrder = orderMap.get(c.id);
          if (newOrder !== undefined && newOrder !== c.order) {
            return dbUnified.updateOne('categories', { id: c.id }, { $set: { order: newOrder } });
          }
          return Promise.resolve();
        })
      );

      // Return sorted list for the response
      const sorted = categories
        .map(c => ({ ...c, order: orderMap.get(c.id) ?? c.order }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));

      res.json({
        ok: true,
        categories: sorted,
      });
    } catch (error) {
      logger.error('Error reordering categories:', error);
      res
        .status(500)
        .json({
          error: 'Failed to reorder categories',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * PUT /api/admin/categories/:id
 * Update a category
 */
router.put(
  '/categories/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const { name, slug, description, icon, heroImage, pexelsAttribution, visible } = req.body;

      const categories = await dbUnified.read('categories');
      const categoryIndex = categories.findIndex(c => c.id === categoryId);

      if (categoryIndex === -1) {
        return res.status(404).json({ error: 'Category not found' });
      }

      // Check if slug already exists for another category
      if (slug && slug !== categories[categoryIndex].slug) {
        if (categories.find((c, idx) => c.slug === slug && idx !== categoryIndex)) {
          return res.status(400).json({ error: 'Category with this slug already exists' });
        }
      }

      // Build update fields
      const catUpdates = {};
      if (name !== undefined) {
        catUpdates.name = name;
      }
      if (slug !== undefined) {
        catUpdates.slug = slug;
      }
      if (description !== undefined) {
        catUpdates.description = description;
      }
      if (icon !== undefined) {
        catUpdates.icon = icon;
      }
      if (heroImage !== undefined) {
        catUpdates.heroImage = heroImage;
      }
      if (pexelsAttribution !== undefined) {
        catUpdates.pexelsAttribution = pexelsAttribution;
      }
      if (visible !== undefined) {
        catUpdates.visible = visible;
      }

      await dbUnified.updateOne('categories', { id: categoryId }, { $set: catUpdates });

      const updatedCategory = { ...categories[categoryIndex], ...catUpdates };
      res.json({
        ok: true,
        category: updatedCategory,
      });
    } catch (error) {
      logger.error('Error updating category:', error);
      res
        .status(500)
        .json({
          error: 'Failed to update category',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * DELETE /api/admin/categories/:id
 * Delete a category
 */
router.delete(
  '/categories/:id',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const categories = await dbUnified.read('categories');
      const categoryIndex = categories.findIndex(c => c.id === categoryId);

      if (categoryIndex === -1) {
        return res.status(404).json({ error: 'Category not found' });
      }

      const deletedCategory = categories[categoryIndex];

      await dbUnified.deleteOne('categories', categoryId);

      res.json({
        ok: true,
        category: deletedCategory,
      });
    } catch (error) {
      logger.error('Error deleting category:', error);
      res
        .status(500)
        .json({
          error: 'Failed to delete category',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * PUT /api/admin/categories/:id/visibility
 * Toggle category visibility
 */
router.put(
  '/categories/:id/visibility',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const categoryId = req.params.id;
      const { visible } = req.body;

      if (typeof visible !== 'boolean') {
        return res.status(400).json({ error: 'visible must be a boolean' });
      }

      const categories = await dbUnified.read('categories');
      const categoryIndex = categories.findIndex(c => c.id === categoryId);

      if (categoryIndex === -1) {
        return res.status(404).json({ error: 'Category not found' });
      }

      await dbUnified.updateOne('categories', { id: categoryId }, { $set: { visible } });

      res.json({
        ok: true,
        category: { ...categories[categoryIndex], visible },
      });
    } catch (error) {
      logger.error('Error toggling category visibility:', error);
      res
        .status(500)
        .json({
          error: 'Failed to toggle visibility',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
