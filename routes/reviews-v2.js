/**
 * Reviews v2 API Routes
 *
 * Comprehensive review system with verification, moderation,
 * sentiment analysis, and analytics.
 *
 * All routes maintain backward compatibility with v1.
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const reviewService = require('../services/reviewService');
const { authRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const reviewModeration = require('../middleware/reviewModeration');

// Validation constants
const MIN_REASON_LENGTH = 10; // Minimum characters for moderation/rejection reasons
const MIN_DISPUTE_REASON_LENGTH = 20; // Minimum characters for dispute reasons

// ============================================================================
// Review Creation & Management
// ============================================================================

/**
 * Create verified review linked to booking
 * POST /api/v2/reviews/with-verification
 * Body: { supplierId, bookingId, rating, title, text, eventDetails }
 */
router.post('/with-verification', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const { supplierId, bookingId, rating, title, text, eventDetails } = req.body;

    // Validate required fields
    if (!supplierId || !rating) {
      return res.status(400).json({
        error: 'Missing required fields: supplierId and rating are required',
      });
    }

    const result = await reviewService.createReview(
      {
        supplierId,
        bookingId,
        rating,
        title,
        text,
        eventDetails,
      },
      req.user.id,
      {
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      }
    );

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Create review error:', error);
    res.status(400).json({
      error: error.message,
    });
  }
});

/**
 * Get supplier reviews with pagination
 * GET /api/v2/reviews/supplier/:id
 * Query: page, limit, sortBy (helpful, recent, rating), filter (verified, disputed)
 */
router.get('/supplier/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, sortBy, filter } = req.query;

    const result = await reviewService.getSupplierReviews(id, {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 10,
      sortBy: sortBy || 'recent',
      filter: filter || null,
      approvedOnly: true,
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get supplier reviews error:', error);
    res.status(500).json({
      error: 'Failed to get reviews',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Edit review (only by author before approval or within 7 days after)
 * PUT /api/v2/reviews/:id
 * Body: { title, text, rating }
 */
router.put('/:id', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, text, rating } = req.body;

    const dbUnified = require('../db-unified');
    const reviews = await dbUnified.read('reviews');
    const review = reviews.find(r => r._id === id);

    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Check edit permissions
    const editCheck = reviewModeration.canEdit(review, req.user.id);
    if (!editCheck.canEdit) {
      return res.status(403).json({ error: editCheck.reason });
    }

    // Build update
    const reviewUpdates = {};
    if (title !== undefined) {
      reviewUpdates.title = title;
    }
    if (text !== undefined) {
      reviewUpdates.text = text;
    }
    if (rating !== undefined) {
      reviewUpdates.rating = parseInt(rating, 10);
    }

    reviewUpdates.updatedAt = new Date().toISOString();

    await dbUnified.updateOne('reviews', { _id: id }, { $set: reviewUpdates });

    res.json({
      success: true,
      data: { ...review, ...reviewUpdates },
      message: 'Review updated successfully',
    });
  } catch (error) {
    logger.error('Update review error:', error);
    res.status(500).json({
      error: 'Failed to update review',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Delete review (author or admin)
 * DELETE /api/v2/reviews/:id
 */
router.delete('/:id', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const dbUnified = require('../db-unified');
    const reviews = await dbUnified.read('reviews');
    const review = reviews.find(r => r._id === id);

    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Check permissions
    if (review.authorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    await dbUnified.deleteOne('reviews', { _id: id });

    res.json({
      success: true,
      message: 'Review deleted successfully',
    });
  } catch (error) {
    logger.error('Delete review error:', error);
    res.status(500).json({
      error: 'Failed to delete review',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Mark review as helpful/unhelpful
 * POST /api/v2/reviews/:id/helpful
 * Body: { helpful: true/false }
 */
router.post('/:id/helpful', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { helpful } = req.body;

    if (typeof helpful !== 'boolean') {
      return res.status(400).json({ error: 'helpful must be a boolean value' });
    }

    const review = await reviewService.voteOnReview(id, req.user.id, helpful);

    res.json({
      success: true,
      data: {
        helpful: review.votes.helpful,
        unhelpful: review.votes.unhelpful,
      },
      message: 'Vote recorded successfully',
    });
  } catch (error) {
    logger.error('Vote on review error:', error);
    res.status(400).json({
      error: error.message,
    });
  }
});

// ============================================================================
// Review Responses
// ============================================================================

/**
 * Add supplier response to review
 * POST /api/v2/reviews/:id/response
 * Body: { text }
 */
router.post(
  '/:id/response',
  writeLimiter,
  authRequired,
  reviewModeration.canRespondToReview,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Response text is required' });
      }

      // Get supplier ID from user
      const dbUnified = require('../db-unified');
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.ownerUserId === req.user.id);

      if (!supplier && req.user.role !== 'admin') {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      const supplierId = supplier ? supplier.id : null;

      const review = await reviewService.addSupplierResponse(id, supplierId, text, req.user.id);

      res.json({
        success: true,
        data: review.response,
        message: 'Response posted successfully',
      });
    } catch (error) {
      logger.error('Add response error:', error);
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

/**
 * Update supplier response
 * PUT /api/v2/reviews/:id/response
 * Body: { text }
 */
router.put(
  '/:id/response',
  writeLimiter,
  authRequired,
  reviewModeration.canRespondToReview,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Response text is required' });
      }

      const dbUnified = require('../db-unified');
      const reviews = await dbUnified.read('reviews');
      const review = reviews.find(r => r._id === id);

      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      if (!review.response) {
        return res.status(404).json({ error: 'No response exists to update' });
      }

      // Get supplier ID
      const suppliers = await dbUnified.read('suppliers');
      const supplier = suppliers.find(s => s.ownerUserId === req.user.id);

      if (!supplier && req.user.role !== 'admin') {
        return res.status(404).json({ error: 'Supplier profile not found' });
      }

      // Check permission
      if (review.supplierId !== supplier?.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Permission denied' });
      }

      review.response.text = text;
      review.response.updatedAt = new Date().toISOString();
      const responseUpdatedAt = new Date().toISOString();

      await dbUnified.updateOne(
        'reviews',
        { _id: id },
        {
          $set: {
            response: { ...review.response, text, updatedAt: responseUpdatedAt },
            updatedAt: responseUpdatedAt,
          },
        }
      );

      res.json({
        success: true,
        data: { ...review.response, text, updatedAt: responseUpdatedAt },
        message: 'Response updated successfully',
      });
    } catch (error) {
      logger.error('Update response error:', error);
      res.status(500).json({
        error: 'Failed to update response',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

// ============================================================================
// Moderation Workflow
// ============================================================================

/**
 * Get admin moderation queue
 * GET /api/v2/reviews/moderation/queue
 * Query: sortBy (date, sentiment, priority), filter (pending, disputed), page, limit
 */
router.get(
  '/moderation/queue',
  authRequired,
  reviewModeration.canModerateReviews,
  async (req, res) => {
    try {
      const { sortBy, filter, page, limit } = req.query;

      const result = await reviewService.getModerationQueue({
        sortBy: sortBy || 'date',
        filter: filter || 'pending',
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 20,
      });

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Get moderation queue error:', error);
      res.status(500).json({
        error: 'Failed to get moderation queue',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

/**
 * Approve review
 * POST /api/v2/reviews/:id/moderation/approve
 */
router.post(
  '/:id/moderation/approve',
  writeLimiter,
  authRequired,
  reviewModeration.canModerateReviews,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;

      const review = await reviewService.moderateReview(
        id,
        'approve',
        req.user.id,
        'Approved by moderator'
      );

      res.json({
        success: true,
        data: review,
        message: 'Review approved successfully',
      });
    } catch (error) {
      logger.error('Approve review error:', error);
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

/**
 * Reject review
 * POST /api/v2/reviews/:id/moderation/reject
 * Body: { reason }
 */
router.post(
  '/:id/moderation/reject',
  writeLimiter,
  authRequired,
  reviewModeration.canModerateReviews,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
        return res.status(400).json({
          error: `Rejection reason is required (minimum ${MIN_REASON_LENGTH} characters)`,
        });
      }

      const review = await reviewService.moderateReview(id, 'reject', req.user.id, reason);

      res.json({
        success: true,
        data: review,
        message: 'Review rejected successfully',
      });
    } catch (error) {
      logger.error('Reject review error:', error);
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

/**
 * Request changes to review
 * POST /api/v2/reviews/:id/moderation/request-changes
 * Body: { reason }
 */
router.post(
  '/:id/moderation/request-changes',
  writeLimiter,
  authRequired,
  reviewModeration.canModerateReviews,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
        return res.status(400).json({
          error: `Change request reason is required (minimum ${MIN_REASON_LENGTH} characters)`,
        });
      }

      const review = await reviewService.requestChanges(id, req.user.id, reason);

      res.json({
        success: true,
        data: review,
        message: 'Change request sent to author',
      });
    } catch (error) {
      logger.error('Request changes error:', error);
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

/**
 * Get moderation statistics
 * GET /api/v2/reviews/moderation/stats
 */
router.get(
  '/moderation/stats',
  authRequired,
  reviewModeration.canModerateReviews,
  async (req, res) => {
    try {
      const stats = await reviewService.getModerationStats();

      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Get moderation stats error:', error);
      res.status(500).json({
        error: 'Failed to get moderation statistics',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      });
    }
  }
);

// ============================================================================
// Disputes & Appeals
// ============================================================================

/**
 * File dispute on review
 * POST /api/v2/reviews/:id/dispute
 * Body: { reason, evidence }
 */
router.post(
  '/:id/dispute',
  writeLimiter,
  authRequired,
  reviewModeration.canFileDispute,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason, evidence } = req.body;

      if (!reason || reason.trim().length < MIN_DISPUTE_REASON_LENGTH) {
        return res.status(400).json({
          error: `Dispute reason is required (minimum ${MIN_DISPUTE_REASON_LENGTH} characters)`,
        });
      }

      const result = await reviewService.fileDispute(id, req.user.id, reason, evidence || '');

      res.json({
        success: true,
        data: result,
        message: 'Dispute filed successfully',
      });
    } catch (error) {
      logger.error('File dispute error:', error);
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

/**
 * Get admin dispute queue
 * GET /api/v2/reviews/disputes
 * Query: page, limit, sortBy (priority, date)
 */
router.get('/disputes', authRequired, reviewModeration.canModerateReviews, async (req, res) => {
  try {
    const { page, limit, sortBy } = req.query;

    const result = await reviewService.getModerationQueue({
      sortBy: sortBy || 'priority',
      filter: 'disputed',
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
    });

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get disputes error:', error);
    res.status(500).json({
      error: 'Failed to get disputes',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Resolve dispute
 * POST /api/v2/reviews/:id/dispute/resolve
 * Body: { resolution (approve/reject/remove), reason }
 */
router.post(
  '/:id/dispute/resolve',
  writeLimiter,
  authRequired,
  reviewModeration.canModerateReviews,
  csrfProtection,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { resolution, reason } = req.body;

      if (!reviewModeration.isValidDisputeResolution(resolution)) {
        return res.status(400).json({
          error: 'Invalid resolution. Must be approve, reject, or remove',
        });
      }

      if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
        return res.status(400).json({
          error: `Resolution reason is required (minimum ${MIN_REASON_LENGTH} characters)`,
        });
      }

      const review = await reviewService.resolveDispute(id, resolution, req.user.id, reason);

      res.json({
        success: true,
        data: review,
        message: 'Dispute resolved successfully',
      });
    } catch (error) {
      logger.error('Resolve dispute error:', error);
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

// ============================================================================
// Analytics & Insights
// ============================================================================

/**
 * Get supplier review analytics
 * GET /api/v2/reviews/supplier/:id/analytics
 */
router.get('/supplier/:id/analytics', async (req, res) => {
  try {
    const { id } = req.params;

    const analytics = await reviewService.getSupplierAnalytics(id);

    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get supplier analytics error:', error);
    res.status(500).json({
      error: 'Failed to get analytics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get platform-wide review trends
 * GET /api/v2/reviews/analytics/trends
 * Query: timeRange (1w, 1m, 3m, 1y)
 */
router.get('/analytics/trends', async (req, res) => {
  try {
    const { timeRange } = req.query;

    const analytics = await reviewService.getPlatformAnalytics(timeRange || '1m');

    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get platform analytics error:', error);
    res.status(500).json({
      error: 'Failed to get analytics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get sentiment analysis data
 * GET /api/v2/reviews/analytics/sentiment
 * Query: timeRange, supplierId (optional)
 */
router.get('/analytics/sentiment', async (req, res) => {
  try {
    const { timeRange, supplierId } = req.query;

    if (supplierId) {
      const analytics = await reviewService.getSupplierAnalytics(supplierId);

      res.json({
        success: true,
        data: {
          sentiment: analytics.sentiment,
          keywords: analytics.topKeywords,
          trends: analytics.trends,
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      const analytics = await reviewService.getPlatformAnalytics(timeRange || '1m');

      res.json({
        success: true,
        data: {
          sentiment: analytics.sentiment,
          trends: analytics.trends,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error('Get sentiment analytics error:', error);
    res.status(500).json({
      error: 'Failed to get sentiment analytics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get rating distribution
 * GET /api/v2/reviews/analytics/distribution
 * Query: supplierId (optional)
 */
router.get('/analytics/distribution', async (req, res) => {
  try {
    const { supplierId } = req.query;

    const analytics = supplierId
      ? await reviewService.getSupplierAnalytics(supplierId)
      : await reviewService.getPlatformAnalytics();

    res.json({
      success: true,
      data: {
        ratings: analytics.ratings || {},
        metrics: analytics.metrics || {},
        response: analytics.response || {},
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get distribution analytics error:', error);
    res.status(500).json({
      error: 'Failed to get distribution analytics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

// ============================================================================
// Verification
// ============================================================================

/**
 * Check review eligibility for booking
 * GET /api/v2/reviews/bookings/:bookingId/eligible
 */
router.get('/bookings/:bookingId/eligible', authRequired, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { supplierId } = req.query;

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId query parameter is required' });
    }

    const result = await reviewService.checkReviewEligibility(req.user.id, supplierId, bookingId);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Check eligibility error:', error);
    res.status(500).json({
      error: 'Failed to check eligibility',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

/**
 * Get verified review count for supplier
 * GET /api/v2/reviews/verified-count/:supplierId
 */
router.get('/verified-count/:supplierId', async (req, res) => {
  try {
    const { supplierId } = req.params;

    const result = await reviewService.getVerifiedCount(supplierId);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Get verified count error:', error);
    res.status(500).json({
      error: 'Failed to get verified count',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
    });
  }
});

// ============================================================================
// Public Reviews Endpoint (for homepage testimonials)
// ============================================================================

/**
 * Get public approved reviews (no auth required)
 * GET /api/reviews
 * Query: limit (default 10, max 50), sort (rating or recent, default recent)
 *
 * This endpoint is used by the homepage to display testimonials
 * Only returns approved reviews with safe fields
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const sort = req.query.sort === 'rating' ? 'rating' : 'recent';

    const dbUnified = require('../db-unified');
    const allReviews = (await dbUnified.read('reviews')) || [];

    // Filter to only approved reviews
    const approvedReviews = allReviews.filter(r => r.approved === true);

    // Sort reviews
    if (sort === 'rating') {
      approvedReviews.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else {
      // Sort by createdAt (recent first)
      approvedReviews.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateB - dateA;
      });
    }

    // Limit results
    const limitedReviews = approvedReviews.slice(0, limit);

    // Project only safe fields (explicitly exclude: email, userId, ipAddress, userAgent, moderation flags, etc.)
    const safeReviews = limitedReviews.map(review => ({
      customerName: review.customerName || 'Anonymous',
      supplierName: review.supplierName || '',
      rating: review.rating || 5,
      comment: review.text || review.comment || '', // Prefer 'text' field, fallback to 'comment'
      createdAt: review.createdAt || new Date().toISOString(),
    }));

    res.json({
      reviews: safeReviews,
      total: approvedReviews.length,
    });
  } catch (error) {
    logger.error('Get public reviews error:', error);
    res.status(500).json({
      error: 'Failed to get reviews',
      reviews: [],
      total: 0,
    });
  }
});

module.exports = router;
