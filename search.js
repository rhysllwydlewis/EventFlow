/**
 * Advanced Search and Discovery System
 * Provides full-text search, filtering, and recommendations
 */

'use strict';

const dbUnified = require('./db-unified');
const { geocodeLocation, calculateDistance } = require('./utils/geocoding');
const crypto = require('crypto');

/**
 * Search suppliers with advanced filters
 * @param {Object} query - Search query parameters
 * @returns {Promise<Object>} Search results
 */
async function searchSuppliers(query) {
  const suppliers = await dbUnified.read('suppliers');
  const reviews = await dbUnified.read('reviews');

  // Calculate average ratings from reviews for each supplier
  const supplierRatings = {};
  reviews.forEach(review => {
    if (review.approved && review.supplierId) {
      if (!supplierRatings[review.supplierId]) {
        supplierRatings[review.supplierId] = { total: 0, count: 0 };
      }
      supplierRatings[review.supplierId].total += review.rating;
      supplierRatings[review.supplierId].count += 1;
    }
  });

  // Enrich suppliers with calculated ratings
  let results = suppliers
    .filter(s => s.approved)
    .map(s => {
      const ratingData = supplierRatings[s.id];
      return {
        ...s,
        calculatedRating: ratingData ? ratingData.total / ratingData.count : s.averageRating || 0,
        reviewCount: ratingData ? ratingData.count : s.reviewCount || 0,
      };
    });

  // Text search (name, description, category)
  if (query.q) {
    const searchTerm = query.q.toLowerCase();
    results = results.filter(s => {
      const searchableText = [
        s.name || '',
        s.description_short || '',
        s.description_long || '',
        s.category || '',
        typeof s.location === 'string' ? s.location : '',
        ...(s.amenities || []),
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(searchTerm);
    });
  }

  // Category filter
  if (query.category) {
    results = results.filter(s => s.category === query.category);
  }

  // Event type filter
  if (query.eventType) {
    const eventTypeTerm = query.eventType.toLowerCase();
    results = results.filter(s => {
      const category = (s.category || '').toLowerCase();
      const tags = (s.tags || []).map(t => t.toLowerCase());
      return category.includes(eventTypeTerm) || tags.some(t => t.includes(eventTypeTerm));
    });
  }

  // Location filter
  if (query.location) {
    const locationTerm = query.location.toLowerCase();
    results = results.filter(s => {
      const location = typeof s.location === 'string' ? s.location.toLowerCase() : '';
      return location.includes(locationTerm);
    });
  }

  // Distance filter using postcode lookup
  let userCoords = null;
  if (query.postcode) {
    userCoords = await geocodeLocation(query.postcode);
    if (userCoords) {
      const maxDistance = query.maxDistance ? Number(query.maxDistance) : null;
      results = results.reduce((acc, s) => {
        let supplierLat = null;
        let supplierLng = null;
        if (s.location && s.location.coordinates && Array.isArray(s.location.coordinates)) {
          [supplierLng, supplierLat] = s.location.coordinates;
        } else if (s.lat !== undefined && s.lng !== undefined) {
          supplierLat = s.lat;
          supplierLng = s.lng;
        }
        if (supplierLat !== null && supplierLng !== null) {
          const dist = calculateDistance(
            userCoords.latitude,
            userCoords.longitude,
            supplierLat,
            supplierLng
          );
          if (maxDistance !== null && dist > maxDistance) {
            return acc;
          }
          acc.push({ ...s, _distanceMiles: dist });
        } else if (!maxDistance) {
          acc.push(s);
        }
        return acc;
      }, []);
    }
  }

  // Price range filter
  if (query.minPrice || query.maxPrice) {
    results = results.filter(s => {
      // Extract numeric value from price_display (e.g., "$$" or "$100-$500")
      const priceDisplay = s.price_display || '';

      // Simple price level mapping
      const priceLevel = priceDisplay.split('$').length - 1;

      if (query.minPrice && priceLevel < Number(query.minPrice)) {
        return false;
      }
      if (query.maxPrice && priceLevel > Number(query.maxPrice)) {
        return false;
      }

      return true;
    });
  }

  // Rating filter
  if (query.minRating) {
    const minRating = Number(query.minRating);
    results = results.filter(s => {
      return (s.calculatedRating || 0) >= minRating;
    });
  }

  // Amenities filter
  if (query.amenities) {
    const requiredAmenities = Array.isArray(query.amenities)
      ? query.amenities
      : query.amenities.split(',');

    results = results.filter(s => {
      const supplierAmenities = s.amenities || [];
      return requiredAmenities.every(amenity => supplierAmenities.includes(amenity));
    });
  }

  // Max guests filter
  if (query.minGuests) {
    const minGuests = Number(query.minGuests);
    results = results.filter(s => {
      return !s.maxGuests || s.maxGuests >= minGuests;
    });
  }

  // Pro suppliers only
  if (query.proOnly === 'true') {
    results = results.filter(s => s.isPro);
  }

  // Featured suppliers only
  if (query.featuredOnly === 'true') {
    results = results.filter(s => s.featured);
  }

  // Verified suppliers only
  if (query.verifiedOnly === 'true') {
    results = results.filter(s => s.verified);
  }

  // Sorting
  const sortBy = query.sortBy || 'relevance';

  if (sortBy === 'rating') {
    results.sort((a, b) => (b.calculatedRating || 0) - (a.calculatedRating || 0));
  } else if (sortBy === 'reviews') {
    results.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
  } else if (sortBy === 'name') {
    results.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (sortBy === 'newest') {
    results.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  } else if (sortBy === 'priceAsc') {
    results.sort((a, b) => {
      const priceA = (a.price_display || '').split('$').length - 1;
      const priceB = (b.price_display || '').split('$').length - 1;
      return priceA - priceB;
    });
  } else if (sortBy === 'priceDesc') {
    results.sort((a, b) => {
      const priceA = (a.price_display || '').split('$').length - 1;
      const priceB = (b.price_display || '').split('$').length - 1;
      return priceB - priceA;
    });
  } else if (sortBy === 'distance') {
    if (userCoords) {
      results.sort((a, b) => {
        const distA = a._distanceMiles !== undefined ? a._distanceMiles : Infinity;
        const distB = b._distanceMiles !== undefined ? b._distanceMiles : Infinity;
        return distA - distB;
      });
    }
    // If no postcode provided, order is unchanged (relevance/insertion order)
  }

  // Pagination
  const page = Number(query.page) || 1;
  const perPage = Number(query.perPage) || 20;
  const startIndex = (page - 1) * perPage;
  const endIndex = startIndex + perPage;

  const paginatedResults = results.slice(startIndex, endIndex).map(s => {
    if (s._distanceMiles !== undefined) {
      const { _distanceMiles, ...rest } = s;
      return { ...rest, distanceMiles: _distanceMiles };
    }
    return s;
  });

  return {
    results: paginatedResults,
    total: results.length,
    page,
    perPage,
    totalPages: Math.ceil(results.length / perPage),
  };
}

/**
 * Get trending suppliers (most viewed/popular)
 * @param {number} limit - Number of suppliers to return
 * @returns {Promise<Array>} Trending suppliers
 */
async function getTrendingSuppliers(limit = 10) {
  const suppliers = await dbUnified.read('suppliers');

  // Filter approved and sort by view count (if available) or review count
  const trending = suppliers
    .filter(s => s.approved)
    .sort((a, b) => {
      const scoreA = (a.viewCount || 0) * 2 + (a.reviewCount || 0) * 5;
      const scoreB = (b.viewCount || 0) * 2 + (b.reviewCount || 0) * 5;
      return scoreB - scoreA;
    })
    .slice(0, limit);

  return trending;
}

/**
 * Get new arrivals (recently added suppliers)
 * @param {number} limit - Number of suppliers to return
 * @returns {Promise<Array>} New suppliers
 */
async function getNewArrivals(limit = 10) {
  const suppliers = await dbUnified.read('suppliers');

  const newSuppliers = suppliers
    .filter(s => s.approved)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);

  return newSuppliers;
}

/**
 * Get popular packages
 * @param {number} limit - Number of packages to return
 * @returns {Promise<Array>} Popular packages
 */
async function getPopularPackages(limit = 10) {
  const packages = await dbUnified.read('packages');

  const popular = packages
    .filter(p => p.approved)
    .sort((a, b) => {
      const scoreA = (a.viewCount || 0) + (a.featured ? 100 : 0);
      const scoreB = (b.viewCount || 0) + (b.featured ? 100 : 0);
      return scoreB - scoreA;
    })
    .slice(0, limit);

  return popular;
}

/**
 * Get supplier recommendations based on user's browsing history
 * @param {string} userId - User ID
 * @param {number} limit - Number of recommendations
 * @returns {Promise<Array>} Recommended suppliers
 */
async function getRecommendations(userId, limit = 10) {
  const suppliers = await dbUnified.read('suppliers');
  const searchHistory = (await dbUnified.read('searchHistory')) || [];

  // Get user's search history
  const userHistory = searchHistory
    .filter(h => h.userId === userId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);

  if (userHistory.length === 0) {
    // No history, return trending suppliers
    return getTrendingSuppliers(limit);
  }

  // Extract categories and tags from history
  const categories = {};
  const locations = {};

  userHistory.forEach(h => {
    if (h.category) {
      categories[h.category] = (categories[h.category] || 0) + 1;
    }
    if (h.location) {
      locations[h.location] = (locations[h.location] || 0) + 1;
    }
  });

  // Score suppliers based on matching criteria
  const scored = suppliers
    .filter(s => s.approved)
    .map(supplier => {
      let score = 0;

      // Category match
      if (categories[supplier.category]) {
        score += categories[supplier.category] * 10;
      }

      // Location match
      if (locations[supplier.location]) {
        score += locations[supplier.location] * 5;
      }

      // Rating boost
      score += (supplier.averageRating || 0) * 2;

      // Review count boost
      score += Math.min(supplier.reviewCount || 0, 20);

      // Pro boost
      if (supplier.isPro) {
        score += 5;
      }

      // Featured boost
      if (supplier.featured) {
        score += 10;
      }

      return { ...supplier, recommendationScore: score };
    })
    .filter(s => s.recommendationScore > 0)
    .sort((a, b) => b.recommendationScore - a.recommendationScore)
    .slice(0, limit);

  return scored;
}

/**
 * Save search query to history
 * @param {string} userId - User ID
 * @param {Object} query - Search query
 * @returns {Promise<void>}
 */
async function saveSearchHistory(userId, query) {
  const searchHistory = (await dbUnified.read('searchHistory')) || [];

  const historyEntry = {
    id: `hist_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    userId,
    query: query.q || '',
    category: query.category || '',
    location: query.location || '',
    timestamp: new Date().toISOString(),
  };

  searchHistory.push(historyEntry);

  // Trim to last 1000 entries to prevent unbounded growth
  if (searchHistory.length > 1000) {
    searchHistory.splice(0, searchHistory.length - 1000);
    await dbUnified.write('searchHistory', searchHistory);
  } else {
    await dbUnified.insertOne('searchHistory', historyEntry);
  }
}

/**
 * Get user's search history
 * @param {string} userId - User ID
 * @param {number} limit - Number of entries to return
 * @returns {Promise<Array>} Search history
 */
async function getUserSearchHistory(userId, limit = 20) {
  const searchHistory = (await dbUnified.read('searchHistory')) || [];

  return searchHistory
    .filter(h => h.userId === userId)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

/**
 * Get all available categories
 * @returns {Promise<Array>} List of categories with counts
 */
async function getCategories() {
  const suppliers = await dbUnified.read('suppliers');

  const categoryCounts = {};
  suppliers
    .filter(s => s.approved)
    .forEach(s => {
      if (s.category) {
        categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
      }
    });

  return Object.entries(categoryCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get all available amenities
 * @returns {Promise<Array>} List of amenities with counts
 */
async function getAmenities() {
  const suppliers = await dbUnified.read('suppliers');

  const amenityCounts = {};
  suppliers
    .filter(s => s.approved && s.amenities)
    .forEach(s => {
      s.amenities.forEach(amenity => {
        amenityCounts[amenity] = (amenityCounts[amenity] || 0) + 1;
      });
    });

  return Object.entries(amenityCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

module.exports = {
  searchSuppliers,
  getTrendingSuppliers,
  getNewArrivals,
  getPopularPackages,
  getRecommendations,
  saveSearchHistory,
  getUserSearchHistory,
  getCategories,
  getAmenities,
};
