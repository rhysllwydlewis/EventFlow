/**
 * Saved Items Routes
 * Handles user saved items (suppliers and packages)
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired, requireVerifiedUser } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { stripPublicSupplierPrivateFields } = require('../utils/supplierPublicProfile');

const router = express.Router();

/**
 * GET /api/me/saved
 * Get all saved items for the current user
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userSavedItems = await dbUnified.find('savedItems', { userId: userId });

    // Populate item details
    const suppliers = await dbUnified.read('suppliers');
    const packages = await dbUnified.read('packages');

    const populatedItems = userSavedItems.map(item => {
      let details = null;
      if (item.itemType === 'supplier') {
        details = stripPublicSupplierPrivateFields(suppliers.find(s => s.id === item.itemId));
      } else if (item.itemType === 'package') {
        details = packages.find(p => p.id === item.itemId);
      }

      return {
        id: item.id,
        itemType: item.itemType,
        itemId: item.itemId,
        savedAt: item.savedAt,
        details,
      };
    });

    res.json({
      success: true,
      savedItems: populatedItems,
      count: populatedItems.length,
    });
  } catch (error) {
    logger.error('Error fetching saved items:', error);
    res.status(500).json({
      error: 'Failed to fetch saved items',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/me/saved
 * Add an item to saved
 * Body: { itemType: 'supplier' | 'package', itemId }
 */
router.post(
  '/',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { itemType, itemId } = req.body;

      if (!itemType || !['supplier', 'package'].includes(itemType)) {
        return res
          .status(400)
          .json({ error: 'Invalid item type. Must be "supplier" or "package"' });
      }

      if (!itemId) {
        return res.status(400).json({ error: 'Item ID is required' });
      }

      // Verify item exists
      if (itemType === 'supplier') {
        if (!(await dbUnified.findOne('suppliers', { id: itemId }))) {
          return res.status(404).json({ error: 'Supplier not found' });
        }
      } else if (itemType === 'package') {
        if (!(await dbUnified.findOne('packages', { id: itemId }))) {
          return res.status(404).json({ error: 'Package not found' });
        }
      }

      // Check if already saved
      const existing = await dbUnified.findOne('savedItems', { userId, itemType, itemId });

      if (existing) {
        return res.status(400).json({ error: 'Item already saved' });
      }

      const now = new Date().toISOString();
      const newSavedItem = {
        id: uid('saved'),
        userId,
        itemType,
        itemId,
        savedAt: now,
      };

      const savedItemResult = await dbUnified.insertOne('savedItems', newSavedItem);
      if (!savedItemResult) {
        logger.error('[SAVED] insertOne failed');
        return res.status(500).json({ error: 'Failed to save item. Please try again.' });
      }

      res.status(201).json({
        success: true,
        savedItem: newSavedItem,
      });
    } catch (error) {
      logger.error('Error saving item:', error);
      res.status(500).json({
        error: 'Failed to save item',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * DELETE /api/me/saved/by-item
 * Remove a saved item by its type and itemId (convenience endpoint)
 * This allows frontend to unsave without first fetching all saved items
 * Query params: itemType (supplier|package), itemId
 */
router.delete(
  '/by-item',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { itemType, itemId } = req.query;

      // Validate required parameters
      if (!itemType || !itemId) {
        return res.status(400).json({
          error: 'itemType and itemId query parameters are required',
          example: 'DELETE /api/me/saved/by-item?itemType=supplier&itemId=sup_123',
        });
      }

      // Validate itemType
      if (!['supplier', 'package'].includes(itemType)) {
        return res.status(400).json({
          error: 'itemType must be "supplier" or "package"',
        });
      }

      const itemToRemove = await dbUnified.findOne('savedItems', { userId, itemType, itemId });

      if (!itemToRemove) {
        return res.status(404).json({ error: 'Saved item not found' });
      }

      // Remove the item
      await dbUnified.deleteOne('savedItems', { id: itemToRemove.id });

      res.json({
        success: true,
        message: 'Item removed from saved',
        removedItem: {
          itemType: itemToRemove.itemType,
          itemId: itemToRemove.itemId,
        },
      });
    } catch (error) {
      logger.error('Error removing saved item by item:', error);
      res.status(500).json({
        error: 'Failed to remove saved item',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * DELETE /api/me/saved/:id
 * Remove an item from saved (by internal saved item ID)
 */
router.delete(
  '/:id',
  writeLimiter,
  authRequired,
  requireVerifiedUser,
  csrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const removedById = await dbUnified.findOne('savedItems', { id, userId });

      if (!removedById) {
        return res.status(404).json({ error: 'Saved item not found' });
      }

      await dbUnified.deleteOne('savedItems', { id: removedById.id });

      res.json({
        success: true,
        message: 'Item removed from saved',
      });
    } catch (error) {
      logger.error('Error removing saved item:', error);
      res.status(500).json({
        error: 'Failed to remove saved item',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

module.exports = router;
