/**
 * Review Analytics Model
 *
 * Aggregates and calculates analytics metrics for reviews.
 * Provides insights into review performance, sentiment trends,
 * and supplier reputation metrics.
 */

'use strict';

// Configuration constants
const POSITIVE_SENTIMENT_THRESHOLD = 0.3; // Threshold for positive sentiment classification
const NEGATIVE_SENTIMENT_THRESHOLD = -0.3; // Threshold for negative sentiment classification

/**
 * Calculate basic review metrics
 * @param {Array<Object>} reviews - Array of reviews
 * @returns {Object} Basic metrics
 */
function calculateBasicMetrics(reviews) {
  const total = reviews.length;

  if (total === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      verifiedReviews: 0,
      unverifiedReviews: 0,
    };
  }

  const validRatings = reviews
    .map(r => Number(r.rating))
    .filter(rating => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  const sum = validRatings.reduce((acc, rating) => acc + rating, 0);
  const verified = reviews.filter(r => r.verification?.status !== 'unverified').length;

  return {
    averageRating: validRatings.length > 0 ? Number((sum / validRatings.length).toFixed(2)) : 0,
    totalReviews: total,
    verifiedReviews: verified,
    unverifiedReviews: total - verified,
  };
}

/**
 * Calculate rating distribution
 * @param {Array<Object>} reviews - Array of reviews
 * @returns {Object} Rating distribution
 */
function calculateRatingDistribution(reviews) {
  const distribution = {
    '5_star': 0,
    '4_star': 0,
    '3_star': 0,
    '2_star': 0,
    '1_star': 0,
  };

  reviews.forEach(review => {
    const rating = Number(review.rating);
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      distribution[`${rating}_star`]++;
    }
  });

  return distribution;
}

/**
 * Calculate sentiment metrics
 * @param {Array<Object>} reviews - Array of reviews with sentiment data
 * @returns {Object} Sentiment metrics
 */
function calculateSentimentMetrics(reviews) {
  if (reviews.length === 0) {
    return {
      average: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      positivePct: 0,
      neutralPct: 0,
      negativePct: 0,
    };
  }

  let totalScore = 0;
  let positive = 0;
  let neutral = 0;
  let negative = 0;

  reviews.forEach(review => {
    const score = review.sentiment?.score || 0;
    totalScore += score;

    if (score > POSITIVE_SENTIMENT_THRESHOLD) {
      positive++;
    } else if (score < NEGATIVE_SENTIMENT_THRESHOLD) {
      negative++;
    } else {
      neutral++;
    }
  });

  const total = reviews.length;

  return {
    average: Number((totalScore / total).toFixed(2)),
    positive,
    neutral,
    negative,
    positivePct: Number(((positive / total) * 100).toFixed(1)),
    neutralPct: Number(((neutral / total) * 100).toFixed(1)),
    negativePct: Number(((negative / total) * 100).toFixed(1)),
  };
}

/**
 * Calculate response metrics
 * @param {Array<Object>} reviews - Array of reviews
 * @returns {Object} Response metrics
 */
function calculateResponseMetrics(reviews) {
  if (reviews.length === 0) {
    return {
      responseRate: 0,
      avgResponseTime: null,
      totalResponses: 0,
    };
  }

  const getResponse = review => review.response || review.supplierResponse || null;
  const withResponses = reviews.filter(r => {
    const response = getResponse(r);
    return Boolean(response?.respondedAt || response?.createdAt || response?.updatedAt);
  });
  const totalResponses = withResponses.length;
  const responseRate = totalResponses / reviews.length;

  // Calculate average response time
  let avgResponseTime = null;
  if (withResponses.length > 0) {
    const responseTimes = withResponses.map(r => {
      const reviewTime = new Date(r.createdAt).getTime();
      const response = getResponse(r);
      const responseTime = new Date(
        response.respondedAt || response.createdAt || response.updatedAt
      ).getTime();
      return responseTime - reviewTime;
    });

    const validResponseTimes = responseTimes.filter(time => Number.isFinite(time) && time >= 0);
    if (validResponseTimes.length === 0) {
      return {
        responseRate: Number(responseRate.toFixed(2)),
        avgResponseTime: null,
        totalResponses,
      };
    }

    const avgMs = validResponseTimes.reduce((sum, t) => sum + t, 0) / validResponseTimes.length;
    const avgHours = avgMs / (1000 * 60 * 60);

    if (avgHours < 1) {
      avgResponseTime = `${Math.round(avgHours * 60)} minutes`;
    } else if (avgHours < 24) {
      avgResponseTime = `${avgHours.toFixed(1)} hours`;
    } else {
      avgResponseTime = `${(avgHours / 24).toFixed(1)} days`;
    }
  }

  return {
    responseRate: Number(responseRate.toFixed(2)),
    avgResponseTime,
    totalResponses,
  };
}

/**
 * Calculate time-based trends
 * @param {Array<Object>} reviews - Array of reviews
 * @returns {Object} Trend data
 */
function calculateTrends(reviews) {
  const now = Date.now();
  const ranges = {
    lastWeek: 7 * 24 * 60 * 60 * 1000,
    lastMonth: 30 * 24 * 60 * 60 * 1000,
    last3Months: 90 * 24 * 60 * 60 * 1000,
  };

  const trends = {};

  Object.entries(ranges).forEach(([key, rangeMs]) => {
    const cutoff = now - rangeMs;
    const filtered = reviews.filter(r => new Date(r.createdAt).getTime() >= cutoff);

    if (filtered.length > 0) {
      const metrics = calculateBasicMetrics(filtered);
      const sentiment = calculateSentimentMetrics(filtered);

      trends[key] = {
        avgRating: metrics.averageRating,
        reviews: filtered.length,
        sentiment: sentiment.average,
      };
    } else {
      trends[key] = {
        avgRating: 0,
        reviews: 0,
        sentiment: 0,
      };
    }
  });

  // Add all-time stats
  const allTimeMetrics = calculateBasicMetrics(reviews);
  const allTimeSentiment = calculateSentimentMetrics(reviews);

  trends.allTime = {
    avgRating: allTimeMetrics.averageRating,
    reviews: reviews.length,
    sentiment: allTimeSentiment.average,
  };

  return trends;
}

/**
 * Extract top keywords from reviews
 * @param {Array<Object>} reviews - Array of reviews with sentiment data
 * @param {number} limit - Number of keywords to return
 * @returns {Array<Object>} Top keywords
 */
function getTopKeywords(reviews, limit = 10) {
  const keywordMap = {};

  reviews.forEach(review => {
    if (review.sentiment && review.sentiment.keywords) {
      review.sentiment.keywords.forEach(kw => {
        if (!keywordMap[kw.word]) {
          keywordMap[kw.word] = {
            keyword: kw.word,
            frequency: 0,
            sentiment: 0,
            count: 0,
          };
        }

        keywordMap[kw.word].frequency += kw.frequency;
        keywordMap[kw.word].sentiment += kw.sentiment;
        keywordMap[kw.word].count++;
      });
    }
  });

  // Calculate averages and convert to array
  const keywords = Object.values(keywordMap).map(kw => ({
    keyword: kw.keyword,
    frequency: kw.frequency,
    sentiment: Number((kw.sentiment / kw.count).toFixed(2)),
  }));

  // Sort by frequency and return top N
  return keywords.sort((a, b) => b.frequency - a.frequency).slice(0, limit);
}

/**
 * Calculate moderation metrics
 * @param {Array<Object>} reviews - Array of reviews
 * @returns {Object} Moderation metrics
 */
function calculateModerationMetrics(reviews) {
  const pending = reviews.filter(r => r.moderation?.state === 'pending').length;
  const disputed = reviews.filter(r => r.moderation?.state === 'disputed').length;
  const flagged = reviews.filter(r => r.sentiment?.spamScore >= 0.5).length;

  // Calculate average moderation time for approved reviews
  const approved = reviews.filter(
    r => r.moderation?.state === 'approved' && r.moderation?.moderatedAt
  );

  let avgModerationTime = null;
  if (approved.length > 0) {
    const times = approved.map(r => {
      const created = new Date(r.createdAt).getTime();
      const moderated = new Date(r.moderation.moderatedAt).getTime();
      return moderated - created;
    });

    const avgMs = times.reduce((sum, t) => sum + t, 0) / times.length;
    const avgHours = avgMs / (1000 * 60 * 60);

    if (avgHours < 1) {
      avgModerationTime = `${Math.round(avgHours * 60)} minutes`;
    } else {
      avgModerationTime = `${avgHours.toFixed(1)} hours`;
    }
  }

  return {
    totalPending: pending,
    totalDisputed: disputed,
    avgModerationTime,
    spamDetected: flagged,
  };
}

/**
 * Generate complete analytics for a supplier
 * @param {Array<Object>} reviews - Array of reviews for the supplier
 * @returns {Object} Complete analytics object
 */
function generateSupplierAnalytics(reviews) {
  const metrics = calculateBasicMetrics(reviews);
  const ratings = calculateRatingDistribution(reviews);
  const sentiment = calculateSentimentMetrics(reviews);
  const response = calculateResponseMetrics(reviews);
  const trends = calculateTrends(reviews);
  const keywords = getTopKeywords(reviews);
  const moderation = calculateModerationMetrics(reviews);

  return {
    metrics,
    ratings,
    sentiment,
    response,
    trends,
    topKeywords: keywords,
    moderation,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Generate platform-wide analytics
 * @param {Array<Object>} allReviews - All reviews in the system
 * @returns {Object} Platform analytics
 */
function generatePlatformAnalytics(allReviews) {
  const metrics = calculateBasicMetrics(allReviews);
  const sentiment = calculateSentimentMetrics(allReviews);
  const trends = calculateTrends(allReviews);
  const moderation = calculateModerationMetrics(allReviews);

  // Calculate supplier-level stats
  const supplierMap = {};
  allReviews.forEach(review => {
    if (!supplierMap[review.supplierId]) {
      supplierMap[review.supplierId] = [];
    }
    supplierMap[review.supplierId].push(review);
  });

  const supplierCount = Object.keys(supplierMap).length;
  const avgReviewsPerSupplier =
    supplierCount > 0 ? Number((allReviews.length / supplierCount).toFixed(1)) : 0;

  return {
    totalReviews: metrics.totalReviews,
    averageRating: metrics.averageRating,
    verifiedReviews: metrics.verifiedReviews,
    sentiment,
    trends,
    moderation,
    supplierCount,
    avgReviewsPerSupplier,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  calculateBasicMetrics,
  calculateRatingDistribution,
  calculateSentimentMetrics,
  calculateResponseMetrics,
  calculateTrends,
  getTopKeywords,
  calculateModerationMetrics,
  generateSupplierAnalytics,
  generatePlatformAnalytics,
};
