/**
 * Enhanced Reviews and Ratings System for EventFlow
 *
 * Features:
 * - Comprehensive review management with MongoDB support
 * - Verified customer checks (message history validation)
 * - Anti-abuse mechanisms (rate limiting, spam detection, flagging)
 * - Supplier responses
 * - Review voting (helpful/unhelpful)
 * - Trust score calculation
 * - Badge system integration
 * - Photo attachments support
 * - Moderation workflow
 */

'use strict';

const crypto = require('crypto');
const dbUnified = require('./db-unified');
const { uid } = require('./store');
const { addPublicProfilePath } = require('./utils/publicSupplierProfilePath');

// Anti-spam configuration
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const RATE_LIMIT_MAX_REVIEWS = 5; // Max reviews per IP per hour
const REVIEW_COOLDOWN = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const MIN_REVIEW_LENGTH = 20;
const MAX_REVIEW_LENGTH = 2000;

// Spam detection patterns
const SPAM_KEYWORDS = [
  'click here',
  'buy now',
  'limited time',
  'call now',
  'visit our website',
  'check out',
  'http://',
  'https://',
  'www.',
  '.com',
  '.net',
  '.org',
];

// Competitor domain patterns (example - should be configured per supplier)
const COMPETITOR_DOMAINS = ['competitor.com', 'rival-business.co.uk'];

/**
 * Hash IP address for privacy
 * @param {string} ipAddress - Raw IP address
 * @returns {string} Hashed IP address
 */
function hashIpAddress(ipAddress) {
  if (!ipAddress) {
    return '';
  }
  return crypto.createHash('sha256').update(ipAddress).digest('hex');
}

/**
 * Check if user has messaged the supplier (verification)
 * @param {string} userId - Customer user ID
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<boolean>} True if user has message history
 */
async function hasMessageHistory(userId, supplierId) {
  const threads = await dbUnified.read('threads');

  // Check if there's a thread between this user and supplier
  const thread = threads.find(t => t.customerId === userId && t.supplierId === supplierId);

  if (!thread) {
    return false;
  }

  // Check if there are actual messages (not just a draft)
  const messages = await dbUnified.read('messages');
  const threadMessages = messages.filter(m => m.threadId === thread.id && !m.isDraft);

  return threadMessages.length > 0;
}

/**
 * Check if user can review this supplier (rate limiting)
 * @param {string} userId - User ID
 * @param {string} supplierId - Supplier ID
 * @param {string} ipAddress - IP address (hashed)
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
async function canUserReview(userId, supplierId, ipAddress) {
  const reviews = await dbUnified.read('reviews');
  const now = Date.now();

  // Check if user already reviewed this supplier recently (30 day cooldown)
  const existingReview = reviews.find(
    r =>
      r.userId === userId &&
      r.supplierId === supplierId &&
      now - new Date(r.createdAt).getTime() < REVIEW_COOLDOWN
  );

  if (existingReview) {
    const daysRemaining = Math.ceil(
      (REVIEW_COOLDOWN - (now - new Date(existingReview.createdAt).getTime())) /
        (24 * 60 * 60 * 1000)
    );
    return {
      allowed: false,
      reason: `You can only review this supplier once every 30 days. Please wait ${daysRemaining} more days.`,
    };
  }

  // Check IP-based rate limiting (5 reviews per hour)
  const hashedIp = hashIpAddress(ipAddress);
  const recentReviewsByIp = reviews.filter(
    r => r.ipAddress === hashedIp && now - new Date(r.createdAt).getTime() < RATE_LIMIT_WINDOW
  );

  if (recentReviewsByIp.length >= RATE_LIMIT_MAX_REVIEWS) {
    return {
      allowed: false,
      reason: 'Too many reviews submitted. Please try again later.',
    };
  }

  return { allowed: true };
}

/**
 * Detect spam and suspicious patterns in review
 * @param {Object} reviewData - Review data to check
 * @param {string} userId - User ID
 * @returns {Promise<{flagged: boolean, reasons: Array<string>}>}
 */
async function detectSpam(reviewData, userId) {
  const reasons = [];
  const text = `${reviewData.title} ${reviewData.comment}`.toLowerCase();

  // Check for spam keywords
  const foundKeywords = SPAM_KEYWORDS.filter(keyword => text.includes(keyword));
  if (foundKeywords.length > 0) {
    reasons.push(`Contains spam keywords: ${foundKeywords.join(', ')}`);
  }

  // Check for competitor domains in email
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === userId);
  if (user && user.email) {
    const emailDomain = user.email.split('@')[1];
    if (COMPETITOR_DOMAINS.some(domain => emailDomain.includes(domain))) {
      reasons.push('Email from competitor domain');
    }
  }

  // Check if account is very new (less than 1 day old)
  if (user) {
    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (accountAge < oneDayMs && reviewData.rating === 5) {
      reasons.push('New account with 5-star review');
    }
  }

  // Check for temporal clustering (multiple reviews for same supplier within 1 hour)
  const reviews = await dbUnified.read('reviews');
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const recentSupplierReviews = reviews.filter(
    r => r.supplierId === reviewData.supplierId && new Date(r.createdAt).getTime() > oneHourAgo
  );

  if (recentSupplierReviews.length >= 3) {
    reasons.push('Temporal clustering detected (multiple reviews in short time)');
  }

  // Check for suspicious patterns - all 5 stars from new accounts
  const supplierReviews = reviews.filter(r => r.supplierId === reviewData.supplierId);
  const recent5StarReviews = supplierReviews.filter(
    r => r.rating === 5 && r.flagReason && r.flagReason.includes('New account')
  );

  if (recent5StarReviews.length >= 3) {
    reasons.push('Pattern of 5-star reviews from new accounts');
  }

  return {
    flagged: reasons.length > 0,
    reasons,
  };
}

/**
 * Create a comprehensive review with full validation
 * @param {Object} reviewData - Review data
 * @param {Object} metadata - Request metadata (IP, user agent)
 * @returns {Promise<Object>} Created review
 */
async function createReview(reviewData, metadata = {}) {
  // Validate required fields
  if (!reviewData.supplierId || !reviewData.userId || !reviewData.rating) {
    throw new Error('Missing required fields: supplierId, userId, rating');
  }

  // Validate rating range
  if (reviewData.rating < 1 || reviewData.rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  // Validate comment length
  const commentLength = (reviewData.comment || '').length;
  if (commentLength > 0 && commentLength < MIN_REVIEW_LENGTH) {
    throw new Error(`Review comment must be at least ${MIN_REVIEW_LENGTH} characters`);
  }
  if (commentLength > MAX_REVIEW_LENGTH) {
    throw new Error(`Review comment cannot exceed ${MAX_REVIEW_LENGTH} characters`);
  }

  // Check if user can review (rate limiting)
  const canReview = await canUserReview(
    reviewData.userId,
    reviewData.supplierId,
    metadata.ipAddress
  );

  if (!canReview.allowed) {
    throw new Error(canReview.reason);
  }

  // Check if user has messaged supplier (verification)
  const verified = await hasMessageHistory(reviewData.userId, reviewData.supplierId);

  // Get user email verification status
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === reviewData.userId);
  const emailVerified = user ? user.verified === true : false;

  // Spam detection
  const spamCheck = await detectSpam(reviewData, reviewData.userId);

  // Create review object
  const review = {
    id: uid('rev'),
    supplierId: reviewData.supplierId,
    userId: reviewData.userId,
    userName: reviewData.userName || user?.name || 'Anonymous',
    rating: parseInt(reviewData.rating, 10),
    title: reviewData.title || '',
    comment: reviewData.comment || '',
    recommend: reviewData.recommend === true,
    eventType: reviewData.eventType || '',
    eventDate: reviewData.eventDate || '',
    verified, // Has message history
    emailVerified, // Email verified
    approved: !spamCheck.flagged, // Auto-approve if not flagged
    approvedAt: !spamCheck.flagged ? new Date().toISOString() : null,
    approvedBy: !spamCheck.flagged ? 'system' : null,
    flagged: spamCheck.flagged,
    flagReason: spamCheck.reasons,
    ipAddress: hashIpAddress(metadata.ipAddress),
    userAgent: metadata.userAgent || '',
    helpfulCount: 0,
    unhelpfulCount: 0,
    photos: reviewData.photos || [], // Array of photo URLs
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Save review
  await dbUnified.insertOne('reviews', review);

  // Update supplier analytics
  await updateSupplierAnalytics(reviewData.supplierId);

  return review;
}

/**
 * Get reviews for a supplier with pagination and filtering
 * @param {string} supplierId - Supplier ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Reviews with pagination info
 */
async function getSupplierReviews(supplierId, options = {}) {
  const {
    page = 1,
    perPage = 10,
    minRating,
    sortBy = 'date', // 'date', 'rating', 'helpful'
    approvedOnly = true,
    verifiedOnly = false,
  } = options;

  const reviews = await dbUnified.read('reviews');

  // Filter by supplier
  let filtered = reviews.filter(r => r.supplierId === supplierId);

  // Filter by approval status
  if (approvedOnly) {
    filtered = filtered.filter(r => r.approved);
  }

  // Filter by verification status
  if (verifiedOnly) {
    filtered = filtered.filter(r => r.verified);
  }

  // Filter by minimum rating
  if (minRating) {
    const rating = Number(minRating);
    if (!isNaN(rating) && rating >= 1 && rating <= 5) {
      filtered = filtered.filter(r => r.rating >= rating);
    }
  }

  // Sort reviews
  if (sortBy === 'rating') {
    filtered.sort((a, b) => b.rating - a.rating);
  } else if (sortBy === 'helpful') {
    filtered.sort((a, b) => b.helpfulCount - a.helpfulCount);
  } else {
    // Default: sort by date (newest first)
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // Pagination
  const total = filtered.length;
  const totalPages = Math.ceil(total / perPage);
  const start = (page - 1) * perPage;
  const end = start + perPage;
  const paginatedReviews = filtered.slice(start, end);

  // Enrich reviews with author supplier info (Issues 1 & 2)
  const suppliers = await dbUnified.read('suppliers');
  const enriched = paginatedReviews.map(review => {
    const authorSupplier = suppliers.find(s => s.ownerUserId === review.userId);
    // publicProfilePath lets the reviewer-name link point straight at the
    // reviewer's clean canonical profile URL instead of the legacy
    // /supplier?id= query form (see utils/publicSupplierProfilePath.js).
    const authorSupplierProfilePath = authorSupplier
      ? addPublicProfilePath(authorSupplier).publicProfilePath || null
      : null;
    // approvedBy/flagReason/ipAddress/userAgent are internal moderation
    // metadata and must never reach a public response. `flagged` stays —
    // public/assets/js/reviews.js reads it to style flagged review cards.
    const publicReview = { ...review };
    delete publicReview.approvedBy;
    delete publicReview.flagReason;
    delete publicReview.ipAddress;
    delete publicReview.userAgent;
    return {
      ...publicReview,
      isSupplier: !!authorSupplier,
      authorSupplierId: authorSupplier ? authorSupplier.id : null,
      authorSupplierProfilePath,
    };
  });

  return {
    reviews: enriched,
    pagination: {
      page,
      perPage,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/**
 * Vote on review (helpful/unhelpful)
 * @param {string} reviewId - Review ID
 * @param {string} voteType - 'helpful' or 'unhelpful'
 * @param {string} userId - User ID (optional for anonymous)
 * @param {string} ipAddress - IP address
 * @returns {Promise<Object>} Updated review
 */
async function voteOnReview(reviewId, voteType, userId, ipAddress) {
  if (!['helpful', 'unhelpful'].includes(voteType)) {
    throw new Error('Vote type must be "helpful" or "unhelpful"');
  }

  const hashedIp = hashIpAddress(ipAddress);

  // Check if user/IP already voted
  const votes = await dbUnified.read('reviewVotes');
  const existingVote = votes.find(
    v =>
      v.reviewId === reviewId &&
      ((v.userId === userId && userId !== null) || (v.ipAddress === hashedIp && !userId))
  );

  if (existingVote) {
    throw new Error('You have already voted on this review');
  }

  // Create vote record
  const vote = {
    id: uid('vote'),
    reviewId,
    userId: userId || null,
    voteType,
    ipAddress: hashedIp,
    createdAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('reviewVotes', vote);

  // Update review counts
  const review = await dbUnified.findOne('reviews', { id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  const helpfulCount =
    voteType === 'helpful' ? (review.helpfulCount || 0) + 1 : review.helpfulCount || 0;
  const unhelpfulCount =
    voteType !== 'helpful' ? (review.unhelpfulCount || 0) + 1 : review.unhelpfulCount || 0;
  const updatedAt = new Date().toISOString();

  await dbUnified.updateOne(
    'reviews',
    { id: reviewId },
    {
      $set: { helpfulCount, unhelpfulCount, updatedAt },
    }
  );

  return { ...review, helpfulCount, unhelpfulCount, updatedAt };
}

/**
 * Add supplier response to a review
 * @param {string} reviewId - Review ID
 * @param {string} supplierId - Supplier ID (for verification)
 * @param {string} responseText - Response text
 * @param {string} responderId - User ID of responder
 * @returns {Promise<Object>} Updated review
 */
async function addSupplierResponse(reviewId, supplierId, responseText, responderId) {
  if (!responseText || responseText.length < 10) {
    throw new Error('Response must be at least 10 characters');
  }

  if (responseText.length > 1000) {
    throw new Error('Response cannot exceed 1000 characters');
  }

  const review = await dbUnified.findOne('reviews', { id: reviewId });

  if (!review) {
    throw new Error('Review not found');
  }

  if (review.supplierId !== supplierId) {
    throw new Error('You can only respond to reviews for your business');
  }

  if (review.supplierResponse) {
    throw new Error('You have already responded to this review');
  }

  const supplierResponse = {
    text: responseText,
    respondedAt: new Date().toISOString(),
    respondedBy: responderId,
  };
  const updatedAt = new Date().toISOString();

  await dbUnified.updateOne(
    'reviews',
    { id: reviewId },
    {
      $set: { supplierResponse, updatedAt },
    }
  );

  // Update analytics (response rate)
  await updateSupplierAnalytics(supplierId);

  return review;
}

/**
 * Update comprehensive supplier analytics
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>} Updated analytics
 */
async function updateSupplierAnalytics(supplierId) {
  const reviews = await dbUnified.read('reviews');
  const supplierReviews = reviews.filter(r => r.supplierId === supplierId && r.approved);

  if (supplierReviews.length === 0) {
    const analytics = {
      id: uid('analytics'),
      supplierId,
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      recommendationRate: 0,
      trustScore: 0,
      responseRate: 0,
      averageResponseTime: 0,
      badges: [],
      lastCalculated: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save analytics
    const allAnalytics = await dbUnified.read('supplierAnalytics');
    const existingIndex = allAnalytics.findIndex(a => a.supplierId === supplierId);
    if (existingIndex >= 0) {
      await dbUnified.updateOne('supplierAnalytics', { supplierId }, { $set: analytics });
    } else {
      await dbUnified.insertOne('supplierAnalytics', analytics);
    }

    return analytics;
  }

  // Calculate metrics
  const totalRating = supplierReviews.reduce((sum, r) => sum + r.rating, 0);
  const averageRating = totalRating / supplierReviews.length;

  // Rating distribution
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  supplierReviews.forEach(r => {
    distribution[r.rating] = (distribution[r.rating] || 0) + 1;
  });

  // Recommendation rate
  const recommendCount = supplierReviews.filter(r => r.recommend).length;
  const recommendationRate = (recommendCount / supplierReviews.length) * 100;

  // Response rate and time
  const reviewsWithResponse = supplierReviews.filter(r => r.supplierResponse);
  const responseRate = (reviewsWithResponse.length / supplierReviews.length) * 100;

  let averageResponseTime = 0;
  if (reviewsWithResponse.length > 0) {
    const responseTimes = reviewsWithResponse.map(r => {
      const reviewTime = new Date(r.createdAt).getTime();
      const responseTime = new Date(r.supplierResponse.respondedAt).getTime();
      return (responseTime - reviewTime) / (1000 * 60 * 60); // Hours
    });
    averageResponseTime = responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
  }

  // Calculate trust score (0-100)
  let trustScore = 0;
  trustScore += averageRating * 15; // Max 75 points
  trustScore += Math.min(supplierReviews.length / 100, 1) * 10; // Max 10 points for volume
  trustScore +=
    (reviewsWithResponse.filter(r => r.verified).length / Math.max(supplierReviews.length, 1)) * 10; // Max 10 points for verified reviews
  trustScore += Math.min(responseRate / 10, 5); // Max 5 points for response rate

  // Determine badges
  const badges = [];
  if (averageRating >= 4.8 && supplierReviews.length >= 10) {
    badges.push('top-rated');
  }
  if (averageResponseTime < 2 && responseRate > 80) {
    badges.push('responsive');
  }
  if (supplierReviews.length >= 50) {
    badges.push('highly-reviewed');
  }
  if (averageRating >= 4.7 && supplierReviews.length >= 100) {
    badges.push('customer-favorite');
  }

  const analytics = {
    id: uid('analytics'),
    supplierId,
    averageRating: parseFloat(averageRating.toFixed(2)),
    totalReviews: supplierReviews.length,
    ratingDistribution: distribution,
    recommendationRate: parseFloat(recommendationRate.toFixed(1)),
    trustScore: parseFloat(trustScore.toFixed(1)),
    responseRate: parseFloat(responseRate.toFixed(1)),
    averageResponseTime: parseFloat(averageResponseTime.toFixed(1)),
    badges,
    lastCalculated: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Save analytics
  const allAnalytics = await dbUnified.read('supplierAnalytics');
  const existingIndex = allAnalytics.findIndex(a => a.supplierId === supplierId);
  if (existingIndex >= 0) {
    await dbUnified.updateOne('supplierAnalytics', { supplierId }, { $set: analytics });
  } else {
    await dbUnified.insertOne('supplierAnalytics', analytics);
  }

  // Update supplier record with basic metrics
  const suppliers = await dbUnified.read('suppliers');
  const supplier = suppliers.find(s => s.id === supplierId);
  if (supplier) {
    await dbUnified.updateOne(
      'suppliers',
      { id: supplierId },
      {
        $set: {
          averageRating: analytics.averageRating,
          reviewCount: analytics.totalReviews,
          trustScore: analytics.trustScore,
        },
      }
    );
  }

  return analytics;
}

/**
 * Get flagged reviews for moderation
 * @returns {Promise<Array>} Flagged reviews with supplier info
 */
async function getFlaggedReviews() {
  const reviews = await dbUnified.read('reviews');
  const suppliers = await dbUnified.read('suppliers');

  const flagged = reviews
    .filter(r => r.flagged && !r.approved)
    .map(review => {
      const supplier = suppliers.find(s => s.id === review.supplierId);
      return {
        ...review,
        supplierName: supplier ? supplier.name : 'Unknown',
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return flagged;
}

/**
 * Moderate a review (approve/reject)
 * @param {string} reviewId - Review ID
 * @param {string} action - 'approve' or 'reject'
 * @param {string} moderatorId - Moderator user ID
 * @param {string} reason - Reason for action
 * @returns {Promise<Object>} Updated review
 */
async function moderateReview(reviewId, action, moderatorId, reason = '') {
  if (!['approve', 'reject'].includes(action)) {
    throw new Error('Action must be "approve" or "reject"');
  }

  const reviews = await dbUnified.read('reviews');
  const review = reviews.find(r => r.id === reviewId);

  if (!review) {
    throw new Error('Review not found');
  }

  // Save previous state for audit
  const previousState = { ...review };

  // Update review
  const reviewUpdates = {
    approved: action === 'approve',
    approvedAt: new Date().toISOString(),
    approvedBy: moderatorId,
    flagged: action === 'reject',
    updatedAt: new Date().toISOString(),
  };
  await dbUnified.updateOne('reviews', { id: reviewId }, { $set: reviewUpdates });

  // Create moderation audit record
  const moderation = {
    id: uid('mod'),
    reviewId,
    moderatorId,
    action,
    reason,
    previousState,
    createdAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('reviewModerations', moderation);

  // Update supplier analytics
  await updateSupplierAnalytics(review.supplierId);

  return review;
}

/**
 * Get reviews for supplier dashboard
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>} Dashboard data
 */
async function getSupplierDashboardReviews(supplierId) {
  const reviews = await dbUnified.read('reviews');
  const supplierReviews = reviews.filter(r => r.supplierId === supplierId);

  const approved = supplierReviews.filter(r => r.approved);
  const pending = supplierReviews.filter(r => !r.approved && !r.flagged);
  const flagged = supplierReviews.filter(r => r.flagged);
  const needsResponse = approved.filter(r => !r.supplierResponse);

  // Get analytics
  const allAnalytics = await dbUnified.read('supplierAnalytics');
  const analytics = allAnalytics.find(a => a.supplierId === supplierId);

  return {
    summary: {
      total: supplierReviews.length,
      approved: approved.length,
      pending: pending.length,
      flagged: flagged.length,
      needsResponse: needsResponse.length,
    },
    analytics: analytics || null,
    recentReviews: approved.slice(0, 5),
    needsResponseReviews: needsResponse.slice(0, 5),
  };
}

/**
 * Delete a review (admin or owner only)
 * @param {string} reviewId - Review ID
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Is user admin
 * @returns {Promise<void>}
 */
async function deleteReview(reviewId, userId, isAdmin = false) {
  const reviews = await dbUnified.read('reviews');
  const review = reviews.find(r => r.id === reviewId);

  if (!review) {
    throw new Error('Review not found');
  }

  // Check permissions
  if (!isAdmin && review.userId !== userId) {
    throw new Error('Not authorized to delete this review');
  }

  const supplierId = review.supplierId;

  // Delete review
  await dbUnified.deleteOne('reviews', reviewId);

  // Delete associated votes
  const votes = await dbUnified.read('reviewVotes');
  await Promise.all(
    votes.filter(v => v.reviewId === reviewId).map(v => dbUnified.deleteOne('reviewVotes', v.id))
  );

  // Update analytics
  await updateSupplierAnalytics(supplierId);
}

/**
 * Get rating distribution for supplier
 * @param {string} supplierId - Supplier ID
 * @returns {Promise<Object>} Rating distribution
 */
async function getRatingDistribution(supplierId) {
  const allAnalytics = await dbUnified.read('supplierAnalytics');
  const analytics = allAnalytics.find(a => a.supplierId === supplierId);

  if (analytics) {
    return {
      distribution: analytics.ratingDistribution,
      total: analytics.totalReviews,
      average: analytics.averageRating,
    };
  }

  // If no analytics exist, calculate on the fly
  const reviews = await dbUnified.read('reviews');
  const supplierReviews = reviews.filter(r => r.supplierId === supplierId && r.approved);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  supplierReviews.forEach(r => {
    distribution[r.rating] = (distribution[r.rating] || 0) + 1;
  });

  const average =
    supplierReviews.length > 0
      ? supplierReviews.reduce((sum, r) => sum + r.rating, 0) / supplierReviews.length
      : 0;

  return {
    distribution,
    total: supplierReviews.length,
    average: parseFloat(average.toFixed(2)),
  };
}

module.exports = {
  createReview,
  getSupplierReviews,
  voteOnReview,
  addSupplierResponse,
  updateSupplierAnalytics,
  getFlaggedReviews,
  moderateReview,
  getSupplierDashboardReviews,
  deleteReview,
  getRatingDistribution,
  hasMessageHistory,
  canUserReview,
  detectSpam,
};
