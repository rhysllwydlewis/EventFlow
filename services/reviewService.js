/**
 * Review Service
 *
 * Core business logic for the enhanced review system.
 * Handles review creation, moderation, responses, disputes, and analytics.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const store = require('../store');
const sentimentAnalysis = require('../utils/sentimentAnalysis');
const ReviewModel = require('../models/Review');
const ReviewAnalytics = require('../models/ReviewAnalytics');

// Configuration constants
const REVIEW_COOLDOWN_DAYS = 30; // Days before user can review same supplier again
const MAX_REVIEWS_PER_HOUR = 5; // Maximum reviews per user per hour
const AUTO_APPROVE_SENTIMENT_THRESHOLD = -0.3; // Minimum sentiment score for auto-approval
const MIN_RESPONSE_LENGTH = 10; // Minimum characters for supplier response
const MAX_RESPONSE_LENGTH = 2000; // Maximum characters for supplier response

/**
 * Check if user is eligible to review supplier
 * @param {string} userId - User ID
 * @param {string} supplierId - Supplier ID
 * @param {string} bookingId - Optional booking ID
 * @returns {Promise<Object>} Eligibility result
 */
async function checkReviewEligibility(userId, supplierId, _bookingId = null) {
  const reviews = await dbUnified.read('reviews');
  const now = Date.now();
  const cooldownMs = REVIEW_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  // Check if user already reviewed this supplier recently
  const existingReview = reviews.find(
    r =>
      r.authorId === userId &&
      r.supplierId === supplierId &&
      now - new Date(r.createdAt).getTime() < cooldownMs
  );

  if (existingReview) {
    const daysRemaining = Math.ceil(
      (cooldownMs - (now - new Date(existingReview.createdAt).getTime())) / (24 * 60 * 60 * 1000)
    );

    return {
      eligible: false,
      reason: `You have already reviewed this supplier. Please wait ${daysRemaining} days before submitting another review.`,
    };
  }

  // Check rate limiting (5 reviews per hour)
  const oneHourAgo = now - 60 * 60 * 1000;
  const recentReviews = reviews.filter(
    r => r.authorId === userId && new Date(r.createdAt).getTime() > oneHourAgo
  );

  if (recentReviews.length >= MAX_REVIEWS_PER_HOUR) {
    return {
      eligible: false,
      reason: 'You have submitted too many reviews recently. Please try again later.',
    };
  }

  // Check booking verification via customer/supplier thread relationship.
  // This is used as a booking proxy for both explicit booking checks and
  // general review trust indicators.
  const threads = await dbUnified.read('threads');
  const thread = threads.find(t => t.customerId === userId && t.supplierId === supplierId);
  const bookingVerified = !!thread;

  const deadline = new Date(now + cooldownMs).toISOString();

  return {
    eligible: true,
    bookingVerified,
    reviewDeadline: deadline,
  };
}

/**
 * Create a new review with verification and sentiment analysis
 * @param {Object} reviewData - Review data
 * @param {string} userId - Author user ID
 * @param {Object} metadata - Request metadata (IP, user agent)
 * @returns {Promise<Object>} Created review with moderation status
 */
async function createReview(reviewData, userId) {
  // Validate input
  const validation = ReviewModel.validateReview({
    ...reviewData,
    authorId: userId,
  });

  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  // Check eligibility
  const eligibility = await checkReviewEligibility(
    userId,
    reviewData.supplierId,
    reviewData.bookingId
  );

  if (!eligibility.eligible) {
    throw new Error(eligibility.reason);
  }

  // Perform sentiment analysis
  const analysis = sentimentAnalysis.analyzeReview(reviewData.title || '', reviewData.text || '');

  // Determine verification status
  let verificationStatus = ReviewModel.VERIFICATION_TYPES.UNVERIFIED;
  if (reviewData.bookingId && eligibility.bookingVerified) {
    verificationStatus = ReviewModel.VERIFICATION_TYPES.VERIFIED_BOOKING;
  }

  // Auto-approve logic:
  // - Verified booking + no spam + positive/neutral sentiment = auto-approve
  // - Spam detected = pending moderation
  // - Negative sentiment = pending moderation
  // - Admin setting autoApproveReviews=false = always pending
  const settings = (await dbUnified.read('settings')) || {};
  const autoApproveEnabled = (settings.features || {}).autoApproveReviews !== false;
  const autoApprove =
    autoApproveEnabled &&
    verificationStatus === ReviewModel.VERIFICATION_TYPES.VERIFIED_BOOKING &&
    !analysis.spam.isSpam &&
    analysis.sentiment.score >= AUTO_APPROVE_SENTIMENT_THRESHOLD;

  // Create review object
  const review = ReviewModel.createReview({
    _id: store.uid('rev'),
    supplierId: reviewData.supplierId,
    authorId: userId,
    bookingId: reviewData.bookingId || null,
    rating: reviewData.rating,
    title: reviewData.title || '',
    text: reviewData.text || '',
    verification: {
      status: verificationStatus,
      bookingDate: reviewData.eventDetails?.date || null,
      eventType: reviewData.eventDetails?.type || null,
      verifiedAt:
        verificationStatus !== ReviewModel.VERIFICATION_TYPES.UNVERIFIED
          ? new Date().toISOString()
          : null,
    },
    sentiment: {
      score: analysis.sentiment.score,
      label: analysis.sentiment.label,
      keywords: analysis.keywords,
      spamScore: analysis.spam.spamScore,
      analyzedAt: analysis.analyzedAt,
    },
    moderation: {
      state: autoApprove
        ? ReviewModel.MODERATION_STATES.APPROVED
        : ReviewModel.MODERATION_STATES.PENDING,
      autoApproved: autoApprove,
      moderatorId: autoApprove ? 'system' : null,
      moderatedAt: autoApprove ? new Date().toISOString() : null,
      reason: autoApprove
        ? 'Auto-approved: verified booking, no spam, positive sentiment'
        : !autoApproveEnabled
          ? 'Pending moderation: auto-approve disabled by admin'
          : analysis.spam.isSpam
            ? `Pending moderation: ${analysis.spam.indicators.join(', ')}`
            : 'Pending manual moderation',
      previousStates: [],
    },
  });

  // Save review
  await dbUnified.insertOne('reviews', review);

  // Track review received event
  const supplierAnalytics = require('../utils/supplierAnalytics');
  supplierAnalytics
    .trackReviewReceived(reviewData.supplierId, userId, {
      reviewId: review._id,
      rating: reviewData.rating,
      verified: verificationStatus !== ReviewModel.VERIFICATION_TYPES.UNVERIFIED,
    })
    .catch(err => logger.error('Failed to track review received:', err));

  // Trigger badge evaluation for supplier (async, non-blocking)
  const badgeManagement = require('../utils/badgeManagement');
  badgeManagement
    .evaluateSupplierBadges(reviewData.supplierId)
    .catch(err => logger.error('Failed to evaluate supplier badges:', err));

  return {
    reviewId: review._id,
    status: review.moderation.state,
    sentiment: {
      score: review.sentiment.score,
      label: review.sentiment.label,
    },
    moderation: {
      state: review.moderation.state,
      reason: review.moderation.reason,
    },
    message: autoApprove
      ? 'Review published successfully.'
      : 'Review submitted and pending moderation.',
  };
}

/**
 * Get reviews for a supplier with pagination and filtering
 * @param {string} supplierId - Supplier ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Reviews and metadata
 */
async function getSupplierReviews(supplierId, options = {}) {
  const {
    page = 1,
    limit = 10,
    sortBy = 'recent', // 'recent', 'helpful', 'rating'
    filter = null, // 'verified', 'disputed'
    approvedOnly = true,
  } = options;

  const reviews = await dbUnified.read('reviews');

  // Filter by supplier
  let filtered = reviews.filter(r => r.supplierId === supplierId);

  // Filter by approval status
  if (approvedOnly) {
    filtered = filtered.filter(r => r.moderation?.state === ReviewModel.MODERATION_STATES.APPROVED);
  }

  // Apply additional filters
  if (filter === 'verified') {
    filtered = filtered.filter(
      r => r.verification?.status !== ReviewModel.VERIFICATION_TYPES.UNVERIFIED
    );
  } else if (filter === 'disputed') {
    filtered = filtered.filter(r => r.dispute && r.dispute.filed);
  }

  // Sort reviews
  switch (sortBy) {
    case 'helpful':
      filtered.sort((a, b) => b.votes.helpful - a.votes.helpful);
      break;
    case 'rating':
      filtered.sort((a, b) => b.rating - a.rating);
      break;
    case 'recent':
    default:
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Pagination
  const total = filtered.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const end = start + limit;
  const paginatedReviews = filtered.slice(start, end);

  // Get analytics for supplier
  const analytics = ReviewAnalytics.generateSupplierAnalytics(
    reviews.filter(r => r.supplierId === supplierId)
  );

  return {
    reviews: paginatedReviews,
    pagination: {
      total,
      page,
      pages,
      limit,
    },
    analytics: {
      avgRating: analytics.metrics.averageRating,
      totalReviews: analytics.metrics.totalReviews,
      responseRate: analytics.response.responseRate,
    },
  };
}

/**
 * Moderate a review (approve/reject)
 * @param {string} reviewId - Review ID
 * @param {string} action - 'approve' or 'reject'
 * @param {string} moderatorId - Moderator user ID
 * @param {string} reason - Moderation reason
 * @returns {Promise<Object>} Updated review
 */
async function moderateReview(reviewId, action, moderatorId, reason) {
  const review = await dbUnified.findOne('reviews', { _id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  const newState =
    action === 'approve'
      ? ReviewModel.MODERATION_STATES.APPROVED
      : ReviewModel.MODERATION_STATES.REJECTED;

  ReviewModel.updateModerationState(review, newState, moderatorId, reason);

  await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: review });

  return review;
}

/**
 * Request changes to a review
 * @param {string} reviewId - Review ID
 * @param {string} moderatorId - Moderator user ID
 * @param {string} reason - Reason for requesting changes
 * @returns {Promise<Object>} Updated review
 */
async function requestChanges(reviewId, moderatorId, reason) {
  const review = await dbUnified.findOne('reviews', { _id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  ReviewModel.updateModerationState(
    review,
    ReviewModel.MODERATION_STATES.CHANGES_REQUESTED,
    moderatorId,
    reason
  );

  await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: review });

  return review;
}

/**
 * Add supplier response to review
 * @param {string} reviewId - Review ID
 * @param {string} supplierId - Supplier ID
 * @param {string} text - Response text
 * @param {string} userId - User ID of supplier
 * @returns {Promise<Object>} Updated review
 */
async function addSupplierResponse(reviewId, supplierId, text, _userId) {
  const review = await dbUnified.findOne('reviews', { _id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  if (review.supplierId !== supplierId) {
    throw new Error('Supplier ID mismatch');
  }

  // Validate text
  if (!text || text.length < MIN_RESPONSE_LENGTH) {
    throw new Error(`Response must be at least ${MIN_RESPONSE_LENGTH} characters`);
  }

  if (text.length > MAX_RESPONSE_LENGTH) {
    throw new Error(`Response cannot exceed ${MAX_RESPONSE_LENGTH} characters`);
  }

  ReviewModel.addResponse(review, supplierId, text);

  await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: review });

  return review;
}

/**
 * Add helpful/unhelpful vote to review
 * @param {string} reviewId - Review ID
 * @param {string} userId - User ID
 * @param {boolean} helpful - True for helpful, false for unhelpful
 * @returns {Promise<Object>} Updated review
 */
async function voteOnReview(reviewId, userId, helpful) {
  const review = await dbUnified.findOne('reviews', { _id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  ReviewModel.addVote(review, userId, helpful);
  await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: review });
  return review;
}

/**
 * File a dispute on a review
 * @param {string} reviewId - Review ID
 * @param {string} userId - User filing dispute
 * @param {string} reason - Dispute reason
 * @param {string} evidence - Evidence/details
 * @returns {Promise<Object>} Dispute info
 */
async function fileDispute(reviewId, userId, reason, evidence) {
  const review = await dbUnified.findOne('reviews', { _id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  if (review.dispute && review.dispute.filed) {
    throw new Error('A dispute has already been filed for this review');
  }

  ReviewModel.fileDispute(review, userId, reason, evidence);

  await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: review });

  return {
    disputeId: review._id,
    status: review.moderation.state,
    filedAt: review.dispute.filedAt,
  };
}

/**
 * Resolve a dispute
 * @param {string} reviewId - Review ID
 * @param {string} resolution - 'approve', 'reject', or 'remove'
 * @param {string} adminId - Admin user ID
 * @param {string} reason - Resolution reason
 * @returns {Promise<Object>} Updated review
 */
async function resolveDispute(reviewId, resolution, adminId, reason) {
  const review = await dbUnified.findOne('reviews', { _id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  if (!review.dispute || !review.dispute.filed) {
    throw new Error('No dispute found for this review');
  }

  ReviewModel.resolveDispute(review, resolution, adminId, reason);

  await dbUnified.updateOne('reviews', { _id: reviewId }, { $set: review });

  return review;
}

/**
 * Get moderation queue
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Moderation queue with reviews
 */
async function getModerationQueue(options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'date', // 'date', 'sentiment', 'priority'
    filter = 'pending', // 'pending', 'disputed'
  } = options;

  const reviews = await dbUnified.read('reviews');

  // Filter by moderation state
  const filtered = reviews.filter(r => {
    if (filter === 'pending') {
      return r.moderation?.state === ReviewModel.MODERATION_STATES.PENDING;
    } else if (filter === 'disputed') {
      return r.moderation?.state === ReviewModel.MODERATION_STATES.DISPUTED;
    }
    return false;
  });

  // Sort
  switch (sortBy) {
    case 'sentiment':
      filtered.sort((a, b) => a.sentiment.score - b.sentiment.score);
      break;
    case 'priority':
      // Priority: disputed > negative sentiment > spam
      filtered.sort((a, b) => {
        const aScore =
          (a.moderation.state === ReviewModel.MODERATION_STATES.DISPUTED ? 100 : 0) +
          (a.sentiment.score < -0.5 ? 50 : 0) +
          (a.sentiment.spamScore > 0.5 ? 25 : 0);
        const bScore =
          (b.moderation.state === ReviewModel.MODERATION_STATES.DISPUTED ? 100 : 0) +
          (b.sentiment.score < -0.5 ? 50 : 0) +
          (b.sentiment.spamScore > 0.5 ? 25 : 0);
        return bScore - aScore;
      });
      break;
    case 'date':
    default:
      filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // Pagination
  const total = filtered.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const end = start + limit;
  const paginatedReviews = filtered.slice(start, end);

  return {
    reviews: paginatedReviews,
    pagination: {
      total,
      page,
      pages,
      limit,
    },
  };
}

/**
 * Get moderation statistics
 * @returns {Promise<Object>} Moderation stats
 */
async function getModerationStats() {
  const reviews = await dbUnified.read('reviews');

  const pending = reviews.filter(
    r => r.moderation?.state === ReviewModel.MODERATION_STATES.PENDING
  );
  const disputed = reviews.filter(
    r => r.moderation?.state === ReviewModel.MODERATION_STATES.DISPUTED
  );

  // Calculate average age of pending reviews
  const now = Date.now();
  let avgAge = 0;
  if (pending.length > 0) {
    const totalAge = pending.reduce((sum, r) => {
      return sum + (now - new Date(r.createdAt).getTime());
    }, 0);
    avgAge = totalAge / pending.length;
  }

  const avgAgeHours = avgAge / (1000 * 60 * 60);

  return {
    pendingCount: pending.length,
    disputedCount: disputed.length,
    avgAgeHours: Number(avgAgeHours.toFixed(1)),
    oldestPending:
      pending.length > 0
        ? pending.reduce((oldest, r) => {
            return new Date(r.createdAt).getTime() < new Date(oldest.createdAt).getTime()
              ? r
              : oldest;
          }).createdAt
        : null,
  };
}

/**
 * Get analytics for a supplier
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>} Analytics data
 */
async function getSupplierAnalytics(supplierId) {
  const reviews = await dbUnified.read('reviews');
  const supplierReviews = reviews.filter(r => r.supplierId === supplierId);

  return ReviewAnalytics.generateSupplierAnalytics(supplierReviews);
}

/**
 * Get platform-wide analytics
 * @param {string} _timeRange - Time range for trends ('1w', '1m', '3m', '1y')
 * @returns {Promise<Object>} Platform analytics
 */
async function getPlatformAnalytics(_timeRange = '1m') {
  const reviews = await dbUnified.read('reviews');

  return ReviewAnalytics.generatePlatformAnalytics(reviews);
}

/**
 * Get verified review count for supplier
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>} Verified count info
 */
async function getVerifiedCount(supplierId) {
  const reviews = await dbUnified.read('reviews');
  const supplierReviews = reviews.filter(r => r.supplierId === supplierId);

  const verified = supplierReviews.filter(
    r => r.verification?.status !== ReviewModel.VERIFICATION_TYPES.UNVERIFIED
  ).length;

  const total = supplierReviews.length;
  const percentage = total > 0 ? Number(((verified / total) * 100).toFixed(1)) : 0;

  return {
    verifiedCount: verified,
    totalCount: total,
    percentage,
  };
}

module.exports = {
  checkReviewEligibility,
  createReview,
  getSupplierReviews,
  moderateReview,
  requestChanges,
  addSupplierResponse,
  voteOnReview,
  fileDispute,
  resolveDispute,
  getModerationQueue,
  getModerationStats,
  getSupplierAnalytics,
  getPlatformAnalytics,
  getVerifiedCount,
};
