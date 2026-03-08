/**
 * Search Weighting and Relevance Scoring
 * Implements weighted full-text search with boost factors
 */

'use strict';

// Field weights for relevance scoring
const FIELD_WEIGHTS = {
  supplierName: 10, // Exact match on supplier name
  packageTitle: 8, // Exact match on package title
  description: 3, // Match in description
  tags: 5, // Match in tags
  category: 4, // Category match
  amenities: 2, // Match in amenities
  location: 3, // Location match
};

// Boost factors
const BOOSTS = {
  featured: 1.5, // 50% boost for featured
  newSupplier: 1.3, // 30% boost for new (< 30 days)
  highRating: 1.4, // 40% boost for 4.5+ rating
  verifiedSupplier: 1.2, // 20% boost for verified
  activeSubscription: 1.1, // 10% boost for premium members
};

// Constants
const NEW_SUPPLIER_DAYS = 30;
const HIGH_RATING_THRESHOLD = 4.5;

/**
 * Calculate relevance score for a search result
 *
 * This function implements a weighted full-text search algorithm with the following components:
 *
 * 1. Field Scoring: Different fields have different weights
 *    - supplierName: 10 (highest - exact business name matches)
 *    - packageTitle: 8 (package/service titles)
 *    - tags: 5 (tagged keywords)
 *    - category: 4 (category classifications)
 *    - description: 3 (full description text)
 *    - location: 3 (geographic location)
 *    - amenities: 2 (available amenities/features)
 *
 * 2. Match Quality: Scores vary based on match type
 *    - Exact field match: weight × 3
 *    - Starts with query: weight × 2
 *    - Whole word match: weight × 1.5
 *    - Contains query: weight × 1
 *    - Partial word matches: weight × 0.5 (proportional)
 *
 * 3. Proximity Bonus: +5 points if query words appear close together (within 50 chars)
 *
 * 4. Boost Factors (multipliers applied to base score):
 *    - Featured: 1.5× (50% boost)
 *    - New (<30 days): 1.3× (30% boost)
 *    - High rating (≥4.5): 1.4× (40% boost)
 *    - Verified: 1.2× (20% boost)
 *    - Pro/Premium: 1.1× (10% boost)
 *
 * 5. Filter Match Bonuses:
 *    - Exact category match: +10%
 *    - Location match: +10%
 *    - Amenity matches: +5% per amenity
 *
 * 6. Freshness Factor (recency decay):
 *    - 0-7 days: 1.0×
 *    - 8-30 days: 0.95×
 *    - 31-90 days: 0.9×
 *    - 91-180 days: 0.85×
 *    - 181-365 days: 0.8×
 *    - 365+ days: 0.75×
 *
 * Final Score = ((field_matches × field_weights + proximity_bonus) × boosts × filter_bonuses) × freshness
 *
 * @param {Object} item - Supplier or package object to score
 * @param {string} item.name - Item name/title
 * @param {string} [item.description_short] - Short description
 * @param {string} [item.description_long] - Long description
 * @param {string} [item.category] - Category classification
 * @param {string} [item.location] - Geographic location
 * @param {Array<string>} [item.tags] - Tagged keywords
 * @param {Array<string>} [item.amenities] - Available amenities
 * @param {boolean} [item.featured] - Whether item is featured
 * @param {boolean} [item.verified] - Whether supplier is verified
 * @param {boolean} [item.isPro] - Whether has premium subscription
 * @param {number} [item.averageRating] - Average rating (0-5)
 * @param {string} [item.createdAt] - Creation date (ISO 8601)
 * @param {string} query - Search query text
 * @param {Object} [filters={}] - Applied search filters
 * @param {string} [filters.category] - Category filter
 * @param {string} [filters.location] - Location filter
 * @param {Array<string>} [filters.amenities] - Required amenities
 * @returns {number} Relevance score (0+, rounded to 2 decimal places). Higher scores indicate better matches.
 */
function calculateRelevanceScore(item, query, filters = {}) {
  let score = 0;
  const queryLower = (query || '').toLowerCase().trim();

  if (!queryLower) {
    // No query, use default scoring based on quality signals
    score = calculateQualityScore(item);
  } else {
    // Calculate field match scores
    score += calculateFieldScore(item.name || '', queryLower, FIELD_WEIGHTS.supplierName);
    score += calculateFieldScore(item.title || '', queryLower, FIELD_WEIGHTS.packageTitle);
    score += calculateFieldScore(
      item.description_short || '',
      queryLower,
      FIELD_WEIGHTS.description
    );
    score += calculateFieldScore(
      item.description_long || '',
      queryLower,
      FIELD_WEIGHTS.description * 0.5
    );
    score += calculateFieldScore(item.category || '', queryLower, FIELD_WEIGHTS.category);
    score += calculateFieldScore(item.location || '', queryLower, FIELD_WEIGHTS.location);

    // Tags and amenities array matching
    if (item.tags && Array.isArray(item.tags)) {
      score += calculateArrayFieldScore(item.tags, queryLower, FIELD_WEIGHTS.tags);
    }
    if (item.amenities && Array.isArray(item.amenities)) {
      score += calculateArrayFieldScore(item.amenities, queryLower, FIELD_WEIGHTS.amenities);
    }

    // Proximity bonus (words appearing closer together)
    score += calculateProximityBonus(item, queryLower);
  }

  // Apply boost factors
  score = applyBoosts(score, item);

  // Apply filter match bonuses
  score = applyFilterBonuses(score, item, filters);

  // Freshness factor (recency decay)
  score *= calculateFreshnessFactor(item.createdAt);

  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate profile completeness bonus (0-15 points).
 * Suppliers with richer, more complete profiles are more trustworthy and
 * discoverable, so they receive a ranking boost in no-query (browse) results.
 *
 * @param {Object} item - Supplier or package object
 * @param {string} [item.logo] - Logo URL
 * @param {string} [item.description_short] - Short description
 * @param {string} [item.description_long] - Long description
 * @param {Array} [item.amenities] - List of amenities
 * @param {Array} [item.images] - Gallery images
 * @param {Array} [item.tags] - Keyword tags
 * @returns {number} Completeness bonus (0–15)
 */
function calculateProfileCompleteness(item) {
  let bonus = 0;
  if (item.logo) {
    bonus += 3;
  }
  if (item.description_short && String(item.description_short).length > 20) {
    bonus += 2;
  }
  if (item.description_long && String(item.description_long).length > 50) {
    bonus += 3;
  }
  if (item.amenities && Array.isArray(item.amenities) && item.amenities.length > 0) {
    bonus += 2;
  }
  if (item.images && Array.isArray(item.images) && item.images.length > 0) {
    bonus += 3;
  }
  if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
    bonus += 2;
  }
  return bonus;
}

/**
 * Calculate quality score for items without query
 * @param {Object} item - Item to score
 * @returns {number} Quality score
 */
function calculateQualityScore(item) {
  let score = 0;

  // Rating contribution (0-50 points)
  const rating = item.averageRating || 0;
  score += rating * 10;

  // Review count contribution (0-30 points, logarithmic)
  const reviewCount = item.reviewCount || 0;
  score += Math.min(Math.log(reviewCount + 1) * 5, 30);

  // View count contribution (0-20 points, logarithmic)
  const viewCount = item.viewCount || 0;
  score += Math.min(Math.log(viewCount + 1) * 3, 20);

  // Profile completeness bonus (0-15 points)
  score += calculateProfileCompleteness(item);

  return score;
}

/**
 * Calculate score for a single field
 * @param {string} fieldValue - Field content
 * @param {string} query - Search query
 * @param {number} weight - Field weight
 * @returns {number} Field score
 */
function calculateFieldScore(fieldValue, query, weight) {
  if (!fieldValue) {
    return 0;
  }

  const fieldLower = fieldValue.toLowerCase();
  let score = 0;

  // Exact match (full field)
  if (fieldLower === query) {
    return weight * 3;
  }

  // Starts with query
  if (fieldLower.startsWith(query)) {
    score += weight * 2;
  }

  // Contains query as whole word
  const regex = new RegExp(`\\b${escapeRegex(query)}\\b`, 'i');
  if (regex.test(fieldValue)) {
    score += weight * 1.5;
  }

  // Contains query anywhere
  if (fieldLower.includes(query)) {
    score += weight;
  }

  // Partial word matches (for longer queries)
  const queryWords = query.split(/\s+/);
  if (queryWords.length > 1) {
    const matchedWords = queryWords.filter(word => fieldLower.includes(word)).length;
    score += (matchedWords / queryWords.length) * weight * 0.5;
  }

  return score;
}

/**
 * Calculate score for array fields
 * @param {Array} arr - Array of strings
 * @param {string} query - Search query
 * @param {number} weight - Field weight
 * @returns {number} Array field score
 */
function calculateArrayFieldScore(arr, query, weight) {
  let score = 0;
  for (const item of arr) {
    const itemScore = calculateFieldScore(item, query, weight);
    score += itemScore;
  }
  return score;
}

/**
 * Calculate proximity bonus for query words appearing close together
 * @param {Object} item - Item to analyze
 * @param {string} query - Search query
 * @returns {number} Proximity bonus
 */
function calculateProximityBonus(item, query) {
  const words = query.split(/\s+/);
  if (words.length < 2) {
    return 0;
  }

  // Combine all searchable text
  const fullText = [
    item.name || '',
    item.title || '',
    item.description_short || '',
    item.description_long || '',
  ]
    .join(' ')
    .toLowerCase();

  // Check if all words appear in order within a window
  let bonus = 0;
  const windowSize = 50; // characters

  for (let i = 0; i < fullText.length - windowSize; i++) {
    const window = fullText.slice(i, i + windowSize);
    const allWordsPresent = words.every(word => window.includes(word));
    if (allWordsPresent) {
      bonus = 5; // Proximity bonus points
      break;
    }
  }

  return bonus;
}

/**
 * Apply boost factors to score
 * @param {number} baseScore - Base relevance score
 * @param {Object} item - Item to boost
 * @returns {number} Boosted score
 */
function applyBoosts(baseScore, item) {
  let score = baseScore;

  // Featured boost
  if (item.featured) {
    score *= BOOSTS.featured;
  }

  // New supplier boost
  if (item.createdAt) {
    const daysOld = (Date.now() - new Date(item.createdAt)) / (1000 * 60 * 60 * 24);
    if (daysOld < NEW_SUPPLIER_DAYS) {
      score *= BOOSTS.newSupplier;
    }
  }

  // High rating boost
  if (item.averageRating >= HIGH_RATING_THRESHOLD) {
    score *= BOOSTS.highRating;
  }

  // Verified supplier boost
  if (item.verified) {
    score *= BOOSTS.verifiedSupplier;
  }

  // Pro/Premium subscription boost
  if (item.isPro) {
    score *= BOOSTS.activeSubscription;
  }

  return score;
}

/**
 * Apply filter match bonuses
 * @param {number} baseScore - Base score
 * @param {Object} item - Item to check
 * @param {Object} filters - Applied filters
 * @returns {number} Score with filter bonuses
 */
function applyFilterBonuses(baseScore, item, filters) {
  const score = baseScore;
  let bonusMultiplier = 1;

  // Category exact match
  if (filters.category && item.category === filters.category) {
    bonusMultiplier += 0.1;
  }

  // Location match
  if (filters.location && item.location) {
    const locationLower = item.location.toLowerCase();
    const filterLocationLower = filters.location.toLowerCase();
    if (locationLower.includes(filterLocationLower)) {
      bonusMultiplier += 0.1;
    }
  }

  // Amenities match
  if (filters.amenities && Array.isArray(filters.amenities) && item.amenities) {
    const matchCount = filters.amenities.filter(a => item.amenities.includes(a)).length;
    if (matchCount > 0) {
      bonusMultiplier += matchCount * 0.05;
    }
  }

  return score * bonusMultiplier;
}

/**
 * Calculate freshness factor (recency decay)
 * @param {string} createdAt - ISO timestamp
 * @returns {number} Freshness multiplier (0.7 - 1.0)
 */
function calculateFreshnessFactor(createdAt) {
  if (!createdAt) {
    return 0.85;
  } // Default for items without date

  const daysOld = (Date.now() - new Date(createdAt)) / (1000 * 60 * 60 * 24);

  // Decay function: newer items get higher scores
  // 0-7 days: 1.0
  // 30 days: 0.95
  // 90 days: 0.9
  // 180 days: 0.85
  // 365+ days: 0.8

  if (daysOld <= 7) {
    return 1.0;
  }
  if (daysOld <= 30) {
    return 0.95;
  }
  if (daysOld <= 90) {
    return 0.9;
  }
  if (daysOld <= 180) {
    return 0.85;
  }
  if (daysOld <= 365) {
    return 0.8;
  }
  return 0.75; // Very old items get slight penalty
}

/**
 * Escape special regex characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get matching snippets from text
 * @param {string} text - Text to search
 * @param {string} query - Search query
 * @param {number} contextLength - Characters of context
 * @returns {Array<string>} Array of snippets
 */
function getMatchingSnippets(text, query, contextLength = 100) {
  if (!text || !query) {
    return [];
  }

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const snippets = [];

  let index = textLower.indexOf(queryLower);
  while (index !== -1 && snippets.length < 3) {
    const start = Math.max(0, index - contextLength / 2);
    const end = Math.min(text.length, index + query.length + contextLength / 2);

    let snippet = text.slice(start, end);
    if (start > 0) {
      snippet = `...${snippet}`;
    }
    if (end < text.length) {
      snippet = `${snippet}...`;
    }

    snippets.push(snippet);
    index = textLower.indexOf(queryLower, index + 1);
  }

  return snippets;
}

/**
 * Get fields that matched the query
 * @param {Object} item - Item to check
 * @param {string} query - Search query
 * @returns {Array<string>} Array of field names that matched
 */
function getMatchingFields(item, query) {
  if (!query) {
    return [];
  }

  const queryLower = query.toLowerCase();
  const matchedFields = [];

  if ((item.name || '').toLowerCase().includes(queryLower)) {
    matchedFields.push('name');
  }
  if ((item.title || '').toLowerCase().includes(queryLower)) {
    matchedFields.push('title');
  }
  if ((item.description_short || '').toLowerCase().includes(queryLower)) {
    matchedFields.push('description');
  }
  if ((item.description_long || '').toLowerCase().includes(queryLower)) {
    matchedFields.push('description');
  }
  if ((item.category || '').toLowerCase().includes(queryLower)) {
    matchedFields.push('category');
  }
  if (item.tags && item.tags.some(t => t.toLowerCase().includes(queryLower))) {
    matchedFields.push('tags');
  }
  if (item.amenities && item.amenities.some(a => a.toLowerCase().includes(queryLower))) {
    matchedFields.push('amenities');
  }

  return [...new Set(matchedFields)]; // Remove duplicates
}

module.exports = {
  FIELD_WEIGHTS,
  BOOSTS,
  calculateRelevanceScore,
  calculateQualityScore,
  calculateProfileCompleteness,
  getMatchingSnippets,
  getMatchingFields,
};
