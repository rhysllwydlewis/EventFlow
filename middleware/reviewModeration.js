/**
 * Review Moderation Middleware
 *
 * Handles review moderation workflow, permissions, and state transitions.
 */

'use strict';

const ReviewModel = require('../models/Review');

// Configuration constants
const EDIT_WINDOW_DAYS = 7; // Days after approval that reviews can be edited
const EDIT_WINDOW_MS = EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000; // Edit window in milliseconds

/**
 * Check if user can moderate reviews (admin only)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function canModerateReviews(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

/**
 * Check if user can respond to review (supplier only)
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function canRespondToReview(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'supplier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Supplier access required' });
  }

  next();
}

/**
 * Check if user can file dispute on review
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function canFileDispute(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Suppliers can dispute reviews about them
  // Review authors can dispute moderation decisions
  if (req.user.role !== 'supplier' && req.user.role !== 'customer') {
    return res.status(403).json({ error: 'Invalid user role for filing disputes' });
  }

  next();
}

/**
 * Validate moderation action
 * @param {string} action - Moderation action
 * @returns {boolean} True if valid
 */
function isValidModerationAction(action) {
  const validActions = ['approve', 'reject', 'request_changes'];
  return validActions.includes(action);
}

/**
 * Validate dispute resolution
 * @param {string} resolution - Resolution type
 * @returns {boolean} True if valid
 */
function isValidDisputeResolution(resolution) {
  const validResolutions = ['approve', 'reject', 'remove'];
  return validResolutions.includes(resolution);
}

/**
 * Check if review can be moderated
 * @param {Object} review - Review object
 * @returns {Object} Result with canModerate flag and reason
 */
function canModerate(review) {
  // Can moderate if in pending or disputed state
  const moderatableStates = [
    ReviewModel.MODERATION_STATES.PENDING,
    ReviewModel.MODERATION_STATES.DISPUTED,
    ReviewModel.MODERATION_STATES.CHANGES_REQUESTED,
  ];

  if (!moderatableStates.includes(review.moderation?.state)) {
    return {
      canModerate: false,
      reason: `Review is in ${review.moderation?.state} state and cannot be moderated`,
    };
  }

  return {
    canModerate: true,
  };
}

/**
 * Check if review can be edited
 * @param {Object} review - Review object
 * @param {string} userId - User ID attempting to edit
 * @returns {Object} Result with canEdit flag and reason
 */
function canEdit(review, userId) {
  // Only author can edit
  if (review.authorId !== userId) {
    return {
      canEdit: false,
      reason: 'Only the review author can edit this review',
    };
  }

  // Can edit if:
  // - Still in pending state
  // - Changes requested
  // - Approved but within 7 days
  const editableStates = [
    ReviewModel.MODERATION_STATES.PENDING,
    ReviewModel.MODERATION_STATES.CHANGES_REQUESTED,
  ];

  if (editableStates.includes(review.moderation?.state)) {
    return { canEdit: true };
  }

  if (review.moderation?.state === ReviewModel.MODERATION_STATES.APPROVED) {
    const sevenDaysMs = EDIT_WINDOW_MS;
    const approvedAt = new Date(review.moderation.moderatedAt).getTime();
    const now = Date.now();

    if (now - approvedAt < sevenDaysMs) {
      return { canEdit: true };
    } else {
      return {
        canEdit: false,
        reason: 'Approved reviews can only be edited within 7 days',
      };
    }
  }

  return {
    canEdit: false,
    reason: `Review is in ${review.moderation?.state} state and cannot be edited`,
  };
}

/**
 * Check if supplier can respond to review
 * @param {Object} review - Review object
 * @param {string} supplierId - Supplier ID
 * @returns {Object} Result with canRespond flag and reason
 */
function canRespond(review, supplierId) {
  // Check if review belongs to this supplier
  if (review.supplierId !== supplierId) {
    return {
      canRespond: false,
      reason: 'Review does not belong to this supplier',
    };
  }

  // Can only respond to approved reviews
  if (review.moderation?.state !== ReviewModel.MODERATION_STATES.APPROVED) {
    return {
      canRespond: false,
      reason: 'Can only respond to approved reviews',
    };
  }

  return {
    canRespond: true,
  };
}

/**
 * Auto-approval rules evaluation
 * @param {Object} review - Review object with sentiment data
 * @returns {Object} Auto-approval decision
 */
function evaluateAutoApproval(review) {
  // Auto-approve if:
  // 1. Verified booking
  // 2. Spam score < 0.3
  // 3. Sentiment score >= -0.3 (not very negative)
  // 4. No profanity

  const isVerified = review.verification?.status !== ReviewModel.VERIFICATION_TYPES.UNVERIFIED;
  const lowSpam = (review.sentiment?.spamScore || 0) < 0.3;
  const notNegative = (review.sentiment?.score || 0) >= -0.3;
  const noProfanity = !review.sentiment?.profanity?.hasProfanity;

  const shouldAutoApprove = isVerified && lowSpam && notNegative && noProfanity;

  let reason = '';
  if (!isVerified) {
    reason = 'Unverified review requires manual moderation';
  } else if (!lowSpam) {
    reason = 'High spam score requires manual moderation';
  } else if (!notNegative) {
    reason = 'Negative sentiment requires manual moderation';
  } else if (!noProfanity) {
    reason = 'Profanity detected requires manual moderation';
  } else {
    reason = 'Auto-approved: verified, low spam, positive sentiment';
  }

  return {
    shouldAutoApprove,
    reason,
  };
}

/**
 * Calculate moderation priority
 * @param {Object} review - Review object
 * @returns {number} Priority score (higher = more urgent)
 */
function calculateModerationPriority(review) {
  let priority = 0;

  // Disputed reviews have highest priority
  if (review.moderation?.state === ReviewModel.MODERATION_STATES.DISPUTED) {
    priority += 100;
  }

  // High spam score
  if (review.sentiment?.spamScore > 0.7) {
    priority += 50;
  }

  // Very negative sentiment
  if (review.sentiment?.score < -0.7) {
    priority += 40;
  }

  // Age (older reviews get higher priority)
  const ageHours = (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours > 48) {
    priority += 30;
  } else if (ageHours > 24) {
    priority += 15;
  }

  // Unverified reviews with low ratings
  if (
    review.verification?.status === ReviewModel.VERIFICATION_TYPES.UNVERIFIED &&
    review.rating <= 2
  ) {
    priority += 25;
  }

  return priority;
}

/**
 * Validate moderation reason
 * @param {string} action - Moderation action
 * @param {string} reason - Moderation reason
 * @returns {Object} Validation result
 */
function validateModerationReason(action, reason) {
  if (action === 'reject' || action === 'request_changes') {
    if (!reason || reason.trim().length < 10) {
      return {
        valid: false,
        error:
          'A detailed reason is required for rejection or change requests (minimum 10 characters)',
      };
    }
  }

  return {
    valid: true,
  };
}

module.exports = {
  canModerateReviews,
  canRespondToReview,
  canFileDispute,
  isValidModerationAction,
  isValidDisputeResolution,
  canModerate,
  canEdit,
  canRespond,
  evaluateAutoApproval,
  calculateModerationPriority,
  validateModerationReason,
};
