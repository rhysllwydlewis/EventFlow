/**
 * Marketplace Routes
 * Marketplace listing endpoints for buying/selling event items
 */

'use strict';

const express = require('express');
const router = express.Router();
const photoUpload = require('../photo-upload');

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let csrfProtection;
let writeLimiter;
let uid;
let logger;
let sentry;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Marketplace routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'csrfProtection',
    'writeLimiter',
    'uid',
    'logger',
    'sentry',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Marketplace routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  csrfProtection = deps.csrfProtection;
  writeLimiter = deps.writeLimiter;
  uid = deps.uid;
  logger = deps.logger;
  sentry = deps.sentry;
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

function applyWriteLimiter(req, res, next) {
  if (!writeLimiter) {
    return res.status(503).json({ error: 'Rate limiter not initialized' });
  }
  return writeLimiter(req, res, next);
}

function resolveListingSellerUserId(listing) {
  if (!listing || typeof listing !== 'object') {
    return null;
  }

  const candidate = listing.userId || listing.ownerUserId || listing.sellerUserId || null;
  if (candidate) {
    return String(candidate);
  }

  // Legacy fallback: some records used createdBy for user IDs.
  // Ignore obvious email values as they cannot be matched to ownerUserId.
  if (listing.createdBy && !String(listing.createdBy).includes('@')) {
    return String(listing.createdBy);
  }

  return null;
}

async function attachSellerSupplierIds(listings) {
  const suppliers = await dbUnified.read('suppliers');
  const supplierByOwner = new Map(
    suppliers.filter(s => s && s.ownerUserId && s.approved).map(s => [s.ownerUserId, s.id])
  );

  return listings.map(listing => {
    const sellerUserId = resolveListingSellerUserId(listing);
    return {
      ...listing,
      sellerUserId,
      sellerSupplierId: sellerUserId ? supplierByOwner.get(sellerUserId) || null : null,
    };
  });
}

// ---------- Marketplace Listings ----------

// Get all marketplace listings (public)
router.get('/listings', async (req, res) => {
  try {
    const { category, condition, minPrice, maxPrice, search, sort, limit } = req.query;

    // Build MongoDB-style filter
    const filter = { approved: true, status: 'active' };

    // Apply category filter
    if (category) {
      filter.category = category;
    }

    // Apply condition filter
    if (condition) {
      filter.condition = condition;
    }

    // Apply price filters
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) {
        filter.price.$gte = parseFloat(minPrice);
      }
      if (maxPrice) {
        filter.price.$lte = parseFloat(maxPrice);
      }
    }

    // Determine sort order
    let sortOption = { createdAt: -1 }; // Default: most recent
    if (sort === 'price-low') {
      sortOption = { price: 1 };
    } else if (sort === 'price-high') {
      sortOption = { price: -1 };
    }

    // Apply limit parameter (default 500, cap at 500 — client paginates with Load More)
    let resultLimit = 500;
    if (limit) {
      const parsedLimit = parseInt(limit, 10);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        resultLimit = Math.min(parsedLimit, 500);
      }
    }

    const dbType = dbUnified.getDatabaseType();
    let listings;

    if (dbType === 'mongodb' && !search) {
      // For MongoDB without search, use efficient findWithOptions
      // Note: When search is present, we fall back to loading all data because:
      // 1. MongoDB text search requires text indexes which may not be configured
      // 2. The current implementation uses case-insensitive substring matching (not full-text search)
      // 3. This ensures consistent behavior across MongoDB and local storage
      listings = await dbUnified.findWithOptions('marketplace_listings', filter, {
        limit: resultLimit,
        sort: sortOption,
      });
    } else {
      // For local storage or when search is needed, load and filter
      let allListings = await dbUnified.read('marketplace_listings');

      // Apply filters
      allListings = allListings.filter(l => l.approved && l.status === 'active');

      if (category) {
        allListings = allListings.filter(l => l.category === category);
      }
      if (condition) {
        allListings = allListings.filter(l => l.condition === condition);
      }
      if (minPrice) {
        allListings = allListings.filter(l => l.price >= parseFloat(minPrice));
      }
      if (maxPrice) {
        allListings = allListings.filter(l => l.price <= parseFloat(maxPrice));
      }
      if (search) {
        const searchLower = search.toLowerCase();
        allListings = allListings.filter(
          l =>
            l.title.toLowerCase().includes(searchLower) ||
            l.description.toLowerCase().includes(searchLower)
        );
      }

      // Sort listings
      if (sort === 'price-low') {
        allListings.sort((a, b) => a.price - b.price);
      } else if (sort === 'price-high') {
        allListings.sort((a, b) => b.price - a.price);
      } else {
        // Default: most recent
        allListings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      }

      // Apply limit
      listings = allListings.slice(0, resultLimit);
    }

    listings = await attachSellerSupplierIds(listings);

    logger.info('Marketplace listings fetched', {
      count: listings.length,
      filters: { category, condition, minPrice, maxPrice, search, sort, limit: resultLimit },
      usedOptimizedQuery: dbType === 'mongodb' && !search,
    });

    res.json({ listings });
  } catch (error) {
    logger.error('Error fetching marketplace listings:', error);
    sentry.captureException(error);
    res.status(500).json({
      error: 'Failed to fetch marketplace listings',
      message: 'Unable to load listings at this time. Please try again later.',
    });
  }
});

// Get single marketplace listing (public)
router.get('/listings/:id', async (req, res) => {
  try {
    const listings = await dbUnified.read('marketplace_listings');
    const listing = listings.find(l => l.id === req.params.id);

    if (!listing) {
      logger.warn('Marketplace listing not found', { listingId: req.params.id });
      return res.status(404).json({
        error: 'Listing not found',
        message: 'This listing does not exist or has been removed.',
      });
    }

    if (!listing.approved || listing.status !== 'active') {
      logger.warn('Marketplace listing not available', {
        listingId: req.params.id,
        approved: listing.approved,
        status: listing.status,
      });
      return res.status(404).json({
        error: 'Listing not available',
        message: 'This listing is not currently available for viewing.',
      });
    }

    const [listingWithSellerInfo] = await attachSellerSupplierIds([listing]);

    logger.info('Marketplace listing fetched', { listingId: req.params.id });
    res.json({ listing: listingWithSellerInfo });
  } catch (error) {
    logger.error('Error fetching marketplace listing:', error);
    sentry.captureException(error);
    res.status(500).json({
      error: 'Failed to fetch listing',
      message: 'Unable to load this listing. Please try again later.',
    });
  }
});

/**
 * GET /api/marketplace/my-listings/:id
 * Get a single listing owned by the authenticated user (including pending/unapproved)
 */
router.get('/my-listings/:id', applyAuthRequired, async (req, res) => {
  try {
    const listings = await dbUnified.read('marketplace_listings');
    const listing = listings.find(l => l.id === req.params.id);

    if (!listing) {
      logger.warn('Marketplace listing not found', { listingId: req.params.id });
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Must be owner or admin
    if (listing.userId !== req.user.id && req.user.role !== 'admin') {
      logger.warn('Unauthorized access to listing', {
        listingId: req.params.id,
        userId: req.user.id,
        ownerId: listing.userId,
      });
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Return regardless of approval/status
    logger.info('Marketplace listing fetched for edit', {
      listingId: req.params.id,
      userId: req.user.id,
    });
    res.json({ listing });
  } catch (error) {
    logger.error('Error fetching user listing:', error);
    sentry.captureException(error);
    res.status(500).json({ error: 'Failed to fetch listing' });
  }
});

// Create marketplace listing (auth required)
router.post(
  '/listings',
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { title, description, price, category, condition, location, images } = req.body || {};

      // Validation with detailed messages - check for undefined, null, or empty string (allow 0)
      if (
        !title ||
        !description ||
        price === undefined ||
        price === null ||
        price === '' ||
        !category ||
        !condition
      ) {
        logger.warn('Marketplace listing creation failed - missing fields', {
          userId: req.user.id,
          provided: {
            title: !!title,
            description: !!description,
            price: price !== undefined && price !== null && price !== '',
            category: !!category,
            condition: !!condition,
          },
        });
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'Please provide title, description, price, category, and condition.',
        });
      }

      if (title.length > 100) {
        return res.status(400).json({
          error: 'Title too long',
          message: 'Title must be 100 characters or less.',
        });
      }

      if (description.length > 1000) {
        return res.status(400).json({
          error: 'Description too long',
          message: 'Description must be 1000 characters or less.',
        });
      }

      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          error: 'Invalid price',
          message: 'Please enter a valid price (must be a positive number).',
        });
      }

      const validCategories = [
        'attire',
        'decor',
        'av-equipment',
        'photography',
        'party-supplies',
        'florals',
      ];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          error: 'Invalid category',
          message: 'Please select a valid category from the list.',
        });
      }

      const validConditions = ['new', 'like-new', 'good', 'fair'];
      if (!validConditions.includes(condition)) {
        return res.status(400).json({
          error: 'Invalid condition',
          message: 'Please select a valid condition from the list.',
        });
      }

      const listing = {
        id: uid('mkt'),
        userId: req.user.id,
        title: String(title).slice(0, 100),
        description: String(description).slice(0, 1000),
        price: priceNum,
        category,
        condition,
        location: location ? String(location).slice(0, 100) : '',
        images: Array.isArray(images) ? images.slice(0, 5) : [],
        approved: true, // Auto-approve new listings
        status: 'active', // New listings start as active; status can be: active, sold, removed, or pending (for admin-moderated listings)
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await dbUnified.insertOne('marketplace_listings', listing);

      logger.info('Marketplace listing created', {
        listingId: listing.id,
        userId: req.user.id,
        category: listing.category,
      });

      res.json({
        ok: true,
        listing,
        message: 'Listing created successfully! It is now visible to all users.',
      });
    } catch (error) {
      logger.error('Error creating marketplace listing:', error);
      sentry.captureException(error);
      res.status(500).json({
        error: 'Failed to create listing',
        message: 'Unable to create your listing at this time. Please try again later.',
      });
    }
  }
);

// Get user's own marketplace listings
router.get('/my-listings', applyAuthRequired, async (req, res) => {
  try {
    logger.info('Fetching marketplace listings', {
      userId: req.user.id,
      userRole: req.user.role,
      endpoint: '/api/marketplace/my-listings',
    });

    const listings = await dbUnified.read('marketplace_listings');
    const myListings = listings.filter(l => l.userId === req.user.id);

    logger.info('Marketplace listings retrieved', {
      userId: req.user.id,
      count: myListings.length,
    });

    res.json({ listings: myListings });
  } catch (error) {
    logger.error('Error fetching user listings', {
      userId: req.user ? req.user.id : 'unknown',
      error: error.message,
      stack: error.stack,
    });
    sentry.captureException(error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// Get authenticated user's saved marketplace items
router.get('/saved', applyAuthRequired, async (req, res) => {
  try {
    const [savedItems, listings] = await Promise.all([
      dbUnified.read('marketplace_saved_items'),
      dbUnified.read('marketplace_listings'),
    ]);

    const userSaved = savedItems
      .filter(item => item.userId === req.user.id)
      .map(item => {
        const listing = listings.find(l => l.id === item.listingId);
        return {
          id: item.listingId,
          savedAt: item.savedAt,
          listing: listing || null,
        };
      })
      .filter(item => item.listing);

    res.json({ savedItems: userSaved });
  } catch (error) {
    logger.error('Error fetching saved marketplace items:', error);
    sentry.captureException(error);
    res.status(500).json({ error: 'Failed to fetch saved items' });
  }
});

// Save a marketplace listing for authenticated user
router.post(
  '/saved/:listingId?',
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const listingId = req.params.listingId || req.body?.listingId;

      if (!listingId) {
        return res.status(400).json({ error: 'listingId is required' });
      }

      const [savedItems, listings] = await Promise.all([
        dbUnified.read('marketplace_saved_items'),
        dbUnified.read('marketplace_listings'),
      ]);

      const listing = listings.find(l => l.id === listingId);
      if (!listing || !listing.approved || listing.status !== 'active') {
        return res.status(404).json({ error: 'Listing not available' });
      }

      if (listing.userId === req.user.id) {
        return res.status(400).json({ error: 'You cannot save your own listing' });
      }

      const alreadySaved = savedItems.some(
        item => item.userId === req.user.id && item.listingId === listingId
      );
      if (alreadySaved) {
        return res.status(200).json({ ok: true, message: 'Listing already saved' });
      }

      await dbUnified.insertOne('marketplace_saved_items', {
        id: uid('mkt_saved'),
        userId: req.user.id,
        listingId,
        savedAt: new Date().toISOString(),
      });

      res.status(201).json({ ok: true, message: 'Listing saved' });
    } catch (error) {
      logger.error('Error saving marketplace listing:', error);
      sentry.captureException(error);
      res.status(500).json({ error: 'Failed to save listing' });
    }
  }
);

// Unsave a marketplace listing for authenticated user
router.delete(
  '/saved/:listingId',
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { listingId } = req.params;
      const savedItems = await dbUnified.read('marketplace_saved_items');

      const savedItem = savedItems.find(
        item => item.userId === req.user.id && item.listingId === listingId
      );

      if (!savedItem) {
        return res.status(404).json({ error: 'Saved listing not found' });
      }

      await dbUnified.deleteOne('marketplace_saved_items', savedItem.id);
      res.json({ ok: true, message: 'Listing unsaved' });
    } catch (error) {
      logger.error('Error removing saved marketplace listing:', error);
      sentry.captureException(error);
      res.status(500).json({ error: 'Failed to unsave listing' });
    }
  }
);

// Update marketplace listing (owner only)
router.put(
  '/listings/:id',
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const listings = await dbUnified.read('marketplace_listings');
      const listing = listings.find(l => l.id === req.params.id);

      if (!listing) {
        return res.status(404).json({ error: 'Listing not found' });
      }

      if (listing.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const { title, description, price, category, condition, location, status } = req.body || {};

      if (title) {
        listing.title = String(title).slice(0, 100);
      }
      if (description) {
        listing.description = String(description).slice(0, 1000);
      }
      if (price !== undefined) {
        const priceNum = parseFloat(price);
        if (!isNaN(priceNum) && priceNum >= 0) {
          listing.price = priceNum;
        }
      }
      if (category) {
        const validCategories = [
          'attire',
          'decor',
          'av-equipment',
          'photography',
          'party-supplies',
          'florals',
        ];
        if (!validCategories.includes(category)) {
          return res.status(400).json({ error: 'Invalid category' });
        }
        listing.category = category;
      }

      if (condition) {
        const validConditions = ['new', 'like-new', 'good', 'fair'];
        if (!validConditions.includes(condition)) {
          return res.status(400).json({ error: 'Invalid condition' });
        }
        listing.condition = condition;
      }
      if (location) {
        listing.location = String(location).slice(0, 100);
      }
      if (status && ['active', 'sold', 'removed'].includes(status)) {
        listing.status = status;
      }

      listing.updatedAt = new Date().toISOString();

      await dbUnified.updateOne(
        'marketplace_listings',
        { id: listing.id },
        {
          $set: {
            title: listing.title,
            description: listing.description,
            price: listing.price,
            category: listing.category,
            condition: listing.condition,
            location: listing.location,
            status: listing.status,
            updatedAt: listing.updatedAt,
          },
        }
      );
      res.json({ ok: true, listing });
    } catch (error) {
      logger.error('Error updating marketplace listing:', error);
      sentry.captureException(error);
      res.status(500).json({ error: 'Failed to update listing' });
    }
  }
);

// Delete marketplace listing (owner only)
router.delete(
  '/listings/:id',
  applyWriteLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const listings = await dbUnified.read('marketplace_listings');
      const listing = listings.find(l => l.id === req.params.id);

      if (!listing) {
        return res.status(404).json({ error: 'Listing not found' });
      }

      if (listing.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      // Delete associated marketplace images from database
      const deletedImageCount = await photoUpload.deleteMarketplaceImages(req.params.id);

      logger.info('Marketplace listing deleted with images', {
        listingId: req.params.id,
        userId: req.user.id,
        deletedImageCount,
      });

      await dbUnified.deleteOne('marketplace_listings', req.params.id);

      res.json({ ok: true, deletedImageCount });
    } catch (error) {
      logger.error('Error deleting marketplace listing:', error);
      sentry.captureException(error);
      res.status(500).json({ error: 'Failed to delete listing' });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
