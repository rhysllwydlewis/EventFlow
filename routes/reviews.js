/**
 * Reviews Routes
 * Review submission, voting, supplier responses, and moderation endpoints
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const mongoDb = require('../db');
const NotificationService = require('../services/notification.service');
const { writeLimiter, uploadLimiter } = require('../middleware/rateLimits');
const { uid } = require('../store');
const { getUserDisplayName } = require('../utils/user-display-name');
const router = express.Router();

// These will be injected by server.js during route mounting
let dbUnified;
let authRequired;
let roleRequired;
let requireVerifiedUser;
let featureRequired;
let csrfProtection;
let reviewsSystem;
let photoUpload;

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
    'requireVerifiedUser',
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
  requireVerifiedUser = deps.requireVerifiedUser;
  featureRequired = deps.featureRequired;
  csrfProtection = deps.csrfProtection;
  reviewsSystem = deps.reviewsSystem;
  // Optional: photo upload service (may not be available in all environments)
  photoUpload = deps.photoUpload || null;
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

function applyRequireVerifiedUser(req, res, next) {
  if (!requireVerifiedUser) {
    return res.status(503).json({ error: 'Verification service not initialized' });
  }
  return requireVerifiedUser(req, res, next);
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

/**
 * Get a NotificationService instance using the live DB and WebSocket server.
 * @param {Object} req - Express request (used to resolve the WS server)
 * @returns {Promise<NotificationService|null>}
 */
async function getNotificationService(req) {
  try {
    const db = await mongoDb.getDb();
    const wsServer =
      req && req.app ? req.app.get('wsServerV2') || req.app.get('wsServer') || null : null;
    return new NotificationService(db, wsServer);
  } catch (err) {
    logger.warn('Could not create NotificationService for reviews route:', err.message);
    return null;
  }
}

/**
 * Fire-and-forget helper: notify the supplier when a new review is submitted.
 * Errors are logged but never propagate to the caller.
 * @param {Object} req - Express request
 * @param {string} supplierUserId - The supplier's user ID to notify
 * @param {string} customerName - Display name of the reviewer
 * @param {number} rating - Star rating (1–5)
 */
function sendReviewNotification(req, supplierUserId, customerName, rating) {
  getNotificationService(req)
    .then(notifSvc => {
      if (!notifSvc) {
        return;
      }
      notifSvc.notifyNewReview(supplierUserId, customerName, rating).catch(err => {
        logger.error('Failed to send review notification:', err);
      });
    })
    .catch(err => {
      logger.warn('Failed to create NotificationService for review notification:', err.message);
    });
}

// ---------- Review Photo Upload Route ----------

/**
 * Upload up to 5 photos for attachment to a review
 * POST /api/reviews/photos/upload
 * Body: multipart/form-data with 'photos' field (up to 5 files)
 * Returns: { success: true, urls: ['/api/photos/...', ...] }
 */
router.post(
  '/reviews/photos/upload',
  uploadLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  (req, res) => {
    if (!photoUpload) {
      return res.status(503).json({ error: 'Photo upload service is not available' });
    }

    // Parse multipart via the shared multer instance (memory storage, max 5 files × 10 MB)
    const multerMiddleware = photoUpload.upload.fields([{ name: 'photos', maxCount: 5 }]);

    multerMiddleware(req, res, async multerErr => {
      if (multerErr) {
        logger.warn('Review photo upload multer error:', multerErr.message);
        return res.status(400).json({ error: multerErr.message });
      }

      const files = (req.files && req.files.photos) || [];
      if (!files.length) {
        return res.status(400).json({ error: 'No photos provided' });
      }

      if (files.length > 5) {
        return res.status(400).json({ error: 'Maximum 5 photos per review' });
      }

      const urls = [];
      const errors = [];

      for (const file of files) {
        try {
          const images = await photoUpload.processAndSaveImage(
            file.buffer,
            file.originalname,
            'supplier'
          );
          // Use the optimized (medium) size as the display URL
          urls.push(images.optimized);
        } catch (err) {
          logger.warn('Review photo processing failed:', {
            filename: file.originalname,
            error: err.message,
          });
          errors.push({ filename: file.originalname, error: err.message });
        }
      }

      if (!urls.length) {
        return res.status(422).json({
          error: 'All photo uploads failed',
          details: errors,
        });
      }

      logger.info('Review photos uploaded', {
        userId: req.user.id,
        count: urls.length,
        failedCount: errors.length,
      });

      return res.json({
        success: true,
        urls,
        errors: errors.length ? errors : undefined,
        message: `${urls.length} photo${urls.length !== 1 ? 's' : ''} uploaded successfully`,
      });
    });
  }
);

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
  applyRequireVerifiedUser,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { supplierId } = req.params;
      const { rating, title, comment, recommend, eventType, eventDate, photos } = req.body;

      // Check if supplier exists
      const supplier = await dbUnified.findOne('suppliers', { id: supplierId });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Get user info
      const user = await dbUnified.findOne('users', { id: req.user.id });

      // Create review with full validation and anti-abuse checks
      const review = await reviewsSystem.createReview(
        {
          supplierId,
          userId: req.user.id,
          userName: getUserDisplayName(user, 'Anonymous'),
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

      // Award first-review partner bonus if applicable (non-blocking)
      try {
        const partnerService = require('../services/partnerService');
        partnerService.awardFirstReviewBonus(supplier.ownerUserId).catch(bonusErr => {
          logger.warn('Partner first-review bonus failed (non-blocking):', bonusErr.message);
        });
      } catch (_bonusErr) {
        // Non-blocking
      }

      // Notify the supplier about the new review (fire-and-forget)
      if (supplier.ownerUserId) {
        const customerName = getUserDisplayName(user, 'A customer');
        sendReviewNotification(req, supplier.ownerUserId, customerName, Number(rating));
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
  applyRequireVerifiedUser,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { supplierId, rating, comment, eventType, eventDate } = req.body;

      // Validate input
      if (!supplierId || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid input. Rating must be between 1 and 5.' });
      }

      // Check if supplier exists
      const supplier = await dbUnified.findOne('suppliers', { id: supplierId });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      // Get user info
      const user = await dbUnified.findOne('users', { id: req.user.id });

      // Create review using enhanced system
      const review = await reviewsSystem.createReview(
        {
          supplierId,
          userId: req.user.id,
          userName: getUserDisplayName(user, 'Anonymous'),
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

      // Notify the supplier about the new review (fire-and-forget)
      if (supplier.ownerUserId) {
        const customerName = getUserDisplayName(user, 'A customer');
        sendReviewNotification(req, supplier.ownerUserId, customerName, Number(rating));
      }

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
    res.status(500).json({
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
    res.status(500).json({
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
    res.status(500).json({
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
      const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });

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
      const supplier = await dbUnified.findOne('suppliers', { ownerUserId: req.user.id });

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
      res.status(500).json({
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
    res.status(500).json({
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
      res.status(500).json({
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
      res.status(500).json({
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

/**
 * Edit own review
 * PUT /api/reviews/:reviewId
 * Body: { rating, title, comment, recommend, eventType }
 */
router.put(
  '/reviews/:reviewId',
  writeLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { rating, title, comment, recommend, eventType } = req.body;

      if (!comment || comment.length < 20) {
        return res.status(400).json({ error: 'Review comment must be at least 20 characters' });
      }

      // Parse and validate rating once to avoid duplicate conversions
      const parsedRating = rating !== undefined ? parseInt(rating, 10) : undefined;
      if (
        parsedRating !== undefined &&
        (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5)
      ) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }

      const review = await dbUnified.findOne('reviews', { _id: reviewId });

      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      if (review.userId !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'You can only edit your own reviews' });
      }

      const updates = {
        editedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (parsedRating !== undefined) {
        updates.rating = parsedRating;
      }
      if (title !== undefined) {
        updates.title = title;
      }
      if (comment !== undefined) {
        updates.comment = comment;
      }
      if (recommend !== undefined) {
        updates.recommend = recommend === true || recommend === 'true';
      }
      if (eventType !== undefined) {
        updates.eventType = eventType;
      }

      await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: updates });

      res.json({
        success: true,
        message: 'Review updated successfully',
        review: { ...review, ...updates },
      });
    } catch (error) {
      logger.error('Edit review error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * Report a review
 * POST /api/reviews/:reviewId/report
 * Body: { reason, detail }
 */
router.post(
  '/reviews/:reviewId/report',
  writeLimiter,
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { reason, detail } = req.body;

      const VALID_REASONS = ['inappropriate', 'spam', 'fake', 'offensive', 'other'];
      if (!reason || !VALID_REASONS.includes(reason)) {
        return res.status(400).json({ error: 'A valid reason is required to report a review' });
      }

      const review = await dbUnified.findOne('reviews', { _id: reviewId });

      if (!review) {
        return res.status(404).json({ error: 'Review not found' });
      }

      if (review.userId === req.user.id) {
        return res.status(400).json({ error: 'You cannot report your own review' });
      }

      // Record the report on the review
      const reports = review.reports || [];
      const alreadyReported = reports.some(r => r.reportedBy === req.user.id);
      if (alreadyReported) {
        return res.status(409).json({ error: 'You have already reported this review' });
      }

      const reportEntry = {
        reportedBy: req.user.id,
        reason,
        detail: detail || '',
        reportedAt: new Date().toISOString(),
      };
      reports.push(reportEntry);

      await dbUnified.updateOne(
        'reviews',
        { _id: reviewId },
        { $set: { reports, flagged: true, updatedAt: new Date().toISOString() } }
      );

      // Create a support ticket so admins can review it
      try {
        const ticketData = {
          id: uid('tkt'),
          type: 'review_report',
          status: 'open',
          reportedBy: req.user.id,
          reviewId,
          supplierId: review.supplierId,
          reason,
          detail: detail || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const reviewTicketInserted = await dbUnified.insertOne('support_tickets', ticketData);
        if (!reviewTicketInserted) {
          logger.error('[REVIEWS] support_ticket insertOne failed', { reviewId: reviewId });
          return res.status(500).json({ error: 'Failed to submit report. Please try again.' });
        }
      } catch (ticketErr) {
        logger.warn(
          'Failed to create support ticket for review report (non-blocking):',
          ticketErr.message
        );
      }

      // Notify all admin users so they can action the report
      try {
        const adminUsers = await dbUnified.find('users', { role: 'admin' });
        if (adminUsers.length > 0) {
          const notifSvc = await getNotificationService(req);
          if (notifSvc) {
            await Promise.all(
              adminUsers.map(admin =>
                notifSvc
                  .create({
                    userId: admin.id,
                    type: 'review_report',
                    title: '🚩 Review Reported',
                    message: `A review has been reported (reason: ${reason}). Please review and take action.`,
                    actionUrl: '/admin-reviews',
                    actionText: 'View Reports',
                    priority: 'high',
                    icon: '🚩',
                    metadata: { reviewId, reason, reportedBy: req.user.id },
                  })
                  .catch(err =>
                    logger.warn(`Failed to notify admin ${admin.id} of review report:`, err.message)
                  )
              )
            );
          }
        }
      } catch (notifErr) {
        logger.warn(
          'Failed to send admin notifications for review report (non-blocking):',
          notifErr.message
        );
      }

      res.json({
        success: true,
        message: 'Report submitted. Our team will review it shortly.',
      });
    } catch (error) {
      logger.error('Report review error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
