/**
 * Reviews Routes
 * Review submission, voting, supplier responses, and moderation endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let roleRequired;
let featureRequired;
let csrfProtection;
let reviewsSystem;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Reviews routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'featureRequired',
    'csrfProtection',
    'reviewsSystem',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Reviews routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  featureRequired = deps.featureRequired;
  csrfProtection = deps.csrfProtection;
  reviewsSystem = deps.reviewsSystem;
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

function applyFeatureRequired(feature) {
  return (req, res, next) => {
    if (!featureRequired) {
      return res.status(503).json({ error: 'Feature service not initialized' });
    }
    return featureRequired(feature)(req, res, next);
  };
}

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

// ---------- Review Submission Routes ----------

/**
 * Submit a review for a supplier
 * POST /api/suppliers/:supplierId/reviews
 * Body: { rating, title, comment, recommend, eventType, eventDate, photos }
 */
router.post(
  '/suppliers/:supplierId/reviews',
  applyFeatureRequired('reviews'),
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { supplierId } = req.params;
      const { rating, title, comment, recommend, eventType, eventDate, photos } = req.body;

      // Check if supplier exists
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === supplierId);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Get user info
      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === req.user.id);

      // Create review with full validation and anti-abuse checks
      const review = await reviewsSystem.createReview(
        {
          supplierId,
          userId: req.user.id,
          userName: user?.name || user?.firstName || 'Anonymous',
          rating: Number(rating),
          title: title || '',
          comment: comment || '',
          recommend: recommend === true || recommend === 'true',
          eventType: eventType || '',
          eventDate: eventDate || '',
          photos: photos || [],
        },
        {
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('user-agent'),
        }
      );

      // Determine message based on review status
      let message = 'Review submitted successfully!';
      if (review.flagged) {
        message = 'Review submitted and is pending moderation.';
      } else if (!review.verified) {
        message =
          'Review submitted successfully! Note: Verified badge requires message history with supplier.';
      }

      res.json({
        success: true,
        review,
        message,
      });
    } catch (error) {
      logger.error('Create review error:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * Create a review for a supplier (Legacy endpoint)
 * POST /api/reviews
 * Body: { supplierId, rating, comment, eventType, eventDate }
 */
router.post(
  '/reviews',
  applyFeatureRequired('reviews'),
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { supplierId, rating, comment, eventType, eventDate } = req.body;

      // Validate input
      if (!supplierId || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid input. Rating must be between 1 and 5.' });
      }

      // Check if supplier exists
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.id === supplierId);
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Get user info
      const users = await dbUnified.read('users');
      const user = users.find(u => u.id === req.user.id);

      // Create review using enhanced system
      const review = await reviewsSystem.createReview(
        {
          supplierId,
          userId: req.user.id,
          userName: user?.name || user?.firstName || 'Anonymous',
          rating: Number(rating),
          comment: comment || '',
          eventType: eventType || '',
          eventDate: eventDate || '',
        },
        {
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.get('user-agent'),
        }
      );

      res.json({
        success: true,
        review,
        message: review.flagged
          ? 'Review submitted and is pending moderation.'
          : 'Review submitted successfully.',
      });
    } catch (error) {
      logger.error('Create review error:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// ---------- Review Retrieval Routes ----------

/**
 * Get reviews for a supplier with pagination and filtering
 * GET /api/suppliers/:supplierId/reviews
 * Query: ?page=1&perPage=10&minRating=4&sortBy=date|rating|helpful&verifiedOnly=false
 */
router.get('/suppliers/:supplierId/reviews', async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { page, perPage, minRating, sortBy, verifiedOnly } = req.query;

    const result = await reviewsSystem.getSupplierReviews(supplierId, {
      page: page ? parseInt(page, 10) : 1,
      perPage: perPage ? parseInt(perPage, 10) : 10,
      minRating: minRating ? parseInt(minRating, 10) : undefined,
      sortBy: sortBy || 'date',
      approvedOnly: true,
      verifiedOnly: verifiedOnly === 'true',
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('Get reviews error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get reviews',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * Get reviews for a supplier (Legacy endpoint)
 * GET /api/reviews/supplier/:supplierId
 */
router.get('/reviews/supplier/:supplierId', async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { minRating, sortBy } = req.query;

    const result = await reviewsSystem.getSupplierReviews(supplierId, {
      approvedOnly: true,
      minRating: minRating ? Number(minRating) : undefined,
      sortBy: sortBy || 'date',
    });

    res.json({
      success: true,
      count: result.reviews.length,
      reviews: result.reviews,
    });
  } catch (error) {
    logger.error('Get reviews error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get reviews',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * Get rating distribution for a supplier
 * GET /api/reviews/supplier/:supplierId/distribution
 */
router.get('/reviews/supplier/:supplierId/distribution', async (req, res) => {
  try {
    const { supplierId } = req.params;
    const distribution = await reviewsSystem.getRatingDistribution(supplierId);

    res.json({
      success: true,
      ...distribution,
    });
  } catch (error) {
    logger.error('Get rating distribution error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get rating distribution',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

// ---------- Review Voting Routes ----------

/**
 * Vote on a review (helpful/unhelpful)
 * POST /api/reviews/:reviewId/vote
 * Body: { voteType: 'helpful' | 'unhelpful' }
 */
router.post('/reviews/:reviewId/vote', applyCsrfProtection, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { voteType } = req.body;
    const userId = req.user?.id || null; // Optional: allow anonymous voting

    if (!['helpful', 'unhelpful'].includes(voteType)) {
      return res.status(400).json({ error: 'voteType must be "helpful" or "unhelpful"' });
    }

    const review = await reviewsSystem.voteOnReview(
      reviewId,
      voteType,
      userId,
      req.ip || req.connection?.remoteAddress
    );

    res.json({
      success: true,
      review,
      message: `Marked as ${voteType}. Thank you for your feedback!`,
    });
  } catch (error) {
    logger.error('Vote on review error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Mark review as helpful (Legacy endpoint)
 * POST /api/reviews/:reviewId/helpful
 */
router.post('/reviews/:reviewId/helpful', applyCsrfProtection, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = req.user?.id || null;

    const review = await reviewsSystem.voteOnReview(
      reviewId,
      'helpful',
      userId,
      req.ip || req.connection?.remoteAddress
    );

    res.json({
      success: true,
      review,
      message: 'Thank you for your feedback!',
    });
  } catch (error) {
    logger.error('Mark helpful error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ---------- Supplier Response Routes ----------

/**
 * Supplier responds to a review
 * POST /api/reviews/:reviewId/respond
 * Body: { response: string }
 */
router.post(
  '/reviews/:reviewId/respond',
  applyAuthRequired,
  applyRoleRequired('supplier'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { response } = req.body;

      if (!response || response.trim().length === 0) {
        return res.status(400).json({ error: 'Response text is required' });
      }

      // Get supplier ID from user's supplier profile
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.ownerUserId === req.user.id);

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const review = await reviewsSystem.addSupplierResponse(
        reviewId,
        supplier.id,
        response.trim(),
        req.user.id
      );

      res.json({
        success: true,
        review,
        message: 'Response posted successfully',
      });
    } catch (error) {
      logger.error('Add supplier response error:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

// ---------- Supplier Dashboard Routes ----------

/**
 * Get reviews for supplier dashboard
 * GET /api/supplier/dashboard/reviews
 */
router.get(
  '/supplier/dashboard/reviews',
  applyAuthRequired,
  applyRoleRequired('supplier'),
  async (req, res) => {
    try {
      // Get supplier ID from user's supplier profile
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.ownerUserId === req.user.id);

      if (!supplier) {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const dashboard = await reviewsSystem.getSupplierDashboardReviews(supplier.id);

      res.json({
        success: true,
        ...dashboard,
      });
    } catch (error) {
      logger.error('Get supplier dashboard reviews error:', error);
      res
        .status(500)
        .json({
          error: 'Failed to get dashboard data',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

// ---------- Admin Review Management Routes ----------

/**
 * Get reviews for a specific supplier (admin view - includes all statuses)
 * GET /api/admin/reviews
 */
router.get('/admin/reviews', applyAuthRequired, applyRoleRequired('admin'), async (req, res) => {
  try {
    const { supplierId } = req.query;

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId query parameter is required' });
    }

    // Get all reviews for the supplier (not just approved ones)
    const result = await reviewsSystem.getSupplierReviews(supplierId, {
      approvedOnly: false, // Admin sees all reviews
    });

    res.json({
      success: true,
      count: result.reviews.length,
      reviews: result.reviews,
    });
  } catch (error) {
    logger.error('Get admin reviews error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to get reviews',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
  }
});

/**
 * Get flagged reviews for moderation (admin only)
 * GET /api/admin/reviews/flagged
 */
router.get(
  '/admin/reviews/flagged',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      const flagged = await reviewsSystem.getFlaggedReviews();

      res.json({
        success: true,
        count: flagged.length,
        reviews: flagged,
      });
    } catch (error) {
      logger.error('Get flagged reviews error:', error);
      res
        .status(500)
        .json({
          error: 'Failed to get flagged reviews',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * Get pending reviews (admin only) - deprecated, use /flagged
 * GET /api/admin/reviews/pending
 */
router.get(
  '/admin/reviews/pending',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      const flagged = await reviewsSystem.getFlaggedReviews();

      res.json({
        success: true,
        count: flagged.length,
        reviews: flagged,
      });
    } catch (error) {
      logger.error('Get pending reviews error:', error);
      res
        .status(500)
        .json({
          error: 'Failed to get pending reviews',
          details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        });
    }
  }
);

/**
 * Moderate a review (admin only) - approve or reject
 * POST /api/admin/reviews/:reviewId/moderate
 * Body: { action: 'approve' | 'reject', reason?: string }
 */
router.post(
  '/admin/reviews/:reviewId/moderate',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { action, reason } = req.body;

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
      }

      const review = await reviewsSystem.moderateReview(
        reviewId,
        action,
        req.user.id,
        reason || ''
      );

      res.json({
        success: true,
        review,
        message: action === 'approve' ? 'Review approved' : 'Review rejected',
      });
    } catch (error) {
      logger.error('Moderate review error:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * Approve or reject a review (admin only) - Legacy endpoint
 * POST /api/admin/reviews/:reviewId/approve
 * Body: { approved: boolean }
 */
router.post(
  '/admin/reviews/:reviewId/approve',
  applyAuthRequired,
  applyRoleRequired('admin'),
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { approved } = req.body;

      if (typeof approved !== 'boolean') {
        return res.status(400).json({ error: 'Invalid input' });
      }

      const action = approved ? 'approve' : 'reject';
      const review = await reviewsSystem.moderateReview(reviewId, action, req.user.id, '');

      res.json({
        success: true,
        review,
        message: approved ? 'Review approved' : 'Review rejected',
      });
    } catch (error) {
      logger.error('Approve review error:', error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * Delete a review
 * DELETE /api/reviews/:reviewId
 */
router.delete('/reviews/:reviewId', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const isAdmin = req.user.role === 'admin';

    await reviewsSystem.deleteReview(reviewId, req.user.id, isAdmin);

    res.json({
      success: true,
      message: 'Review deleted successfully',
    });
  } catch (error) {
    logger.error('Delete review error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
