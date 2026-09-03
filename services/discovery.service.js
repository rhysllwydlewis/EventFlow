/**
 * Discovery Service
 * Handles package discovery, trending, and recommendations
 */

'use strict';

const logger = require('../utils/logger');
const { getCachedData, setCachedData, invalidateCachePattern } = require('../utils/cache');

class DiscoveryService {
  constructor(dbUnified) {
    this.db = dbUnified;
  }

  /**
   * Get trending packages
   * @param {number} limit - Number of packages to return
   * @returns {Promise<Array>} - Trending packages
   */
  async getTrendingPackages(limit = 20) {
    const cacheKey = `trending:packages:${limit}`;
    const cached = getCachedData(cacheKey);

    if (cached) {
      return cached;
    }

    const packages = await this.db.read('packages');
    const reviews = await this.db.read('reviews');

    // Calculate trending score based on recent reviews and rating
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const packagesWithScore = packages
      .filter(p => p.available !== false)
      .map(pkg => {
        const packageReviews = reviews.filter(r => r.packageId === pkg.id);
        const recentReviews = packageReviews.filter(
          r => new Date(r.createdAt).getTime() > thirtyDaysAgo
        );

        const averageRating =
          packageReviews.length > 0
            ? packageReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / packageReviews.length
            : 0;

        // Trending score: recent reviews * average rating
        const trendingScore = recentReviews.length * averageRating;

        return {
          ...pkg,
          reviewCount: packageReviews.length,
          recentReviewCount: recentReviews.length,
          averageRating,
          trendingScore,
        };
      });

    // Sort by trending score
    packagesWithScore.sort((a, b) => b.trendingScore - a.trendingScore);

    const result = packagesWithScore.slice(0, limit);

    // Cache for 1 hour
    setCachedData(cacheKey, result, 3600);

    return result;
  }

  /**
   * Get new arrivals (recently added packages)
   * @param {number} limit - Number of packages to return
   * @returns {Promise<Array>} - New packages
   */
  async getNewArrivals(limit = 20) {
    const cacheKey = `new:arrivals:${limit}`;
    const cached = getCachedData(cacheKey);

    if (cached) {
      return cached;
    }

    const packages = await this.db.read('packages');

    // Filter available packages and sort by creation date
    const newPackages = packages
      .filter(p => p.available !== false)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    // Cache for 30 minutes
    setCachedData(cacheKey, newPackages, 1800);

    return newPackages;
  }

  /**
   * Get popular packages (by rating and review count)
   * @param {number} limit - Number of packages to return
   * @returns {Promise<Array>} - Popular packages
   */
  async getPopularPackages(limit = 20) {
    const cacheKey = `popular:packages:${limit}`;
    const cached = getCachedData(cacheKey);

    if (cached) {
      return cached;
    }

    const packages = await this.db.read('packages');
    const reviews = await this.db.read('reviews');

    const packagesWithRating = packages
      .filter(p => p.available !== false)
      .map(pkg => {
        const packageReviews = reviews.filter(r => r.packageId === pkg.id);
        const averageRating =
          packageReviews.length > 0
            ? packageReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / packageReviews.length
            : 0;

        return {
          ...pkg,
          reviewCount: packageReviews.length,
          averageRating,
        };
      });

    // Sort by rating and review count
    packagesWithRating.sort((a, b) => {
      if (a.averageRating !== b.averageRating) {
        return b.averageRating - a.averageRating;
      }
      return b.reviewCount - a.reviewCount;
    });

    const result = packagesWithRating.slice(0, limit);

    // Cache for 1 hour
    setCachedData(cacheKey, result, 3600);

    return result;
  }

  /**
   * Get personalized recommendations for a user
   * @param {string} userId - User ID
   * @param {number} limit - Number of recommendations
   * @returns {Promise<Array>} - Recommended packages
   */
  getRecommendations(userId, limit = 20) {
    // For now, return popular packages
    // In the future, this could use user preferences, view history, etc.
    logger.debug(`Getting recommendations for user ${userId}`);
    return this.getPopularPackages(limit);
  }

  /**
   * Invalidate discovery caches
   * Call this when packages or reviews are updated
   */
  invalidateCaches() {
    invalidateCachePattern('trending:');
    invalidateCachePattern('new:');
    invalidateCachePattern('popular:');
    logger.debug('Discovery caches invalidated');
  }
}

module.exports = DiscoveryService;
