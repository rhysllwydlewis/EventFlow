/**
 * Advanced Search Service
 * Provides weighted full-text search, filtering, and ranking
 */

'use strict';

const dbUnified = require('../db-unified');
const { resolvePackageImage } = require('../utils/packageImageUtils');
const {
  calculateRelevanceScore,
  calculateQualityScore,
  getMatchingSnippets,
  getMatchingFields,
  getRankingReason,
  RANKING_CONFIG,
} = require('../utils/searchWeighting');
const { geocodeLocation, calculateDistance } = require('../utils/geocoding');

// Valid sort values exported so routes can share the same constants
const VALID_SUPPLIER_SORT_VALUES = [
  'relevance',
  'rating',
  'reviews',
  'name',
  'newest',
  'priceAsc',
  'priceDesc',
  'distance',
];

const VALID_PACKAGE_SORT_VALUES = ['relevance', 'priceAsc', 'priceDesc', 'name', 'newest'];

/**
 * Normalize and validate raw supplier search query parameters.
 * Coerces types, clamps numeric ranges, and falls back to safe defaults
 * so that the service layer always receives predictable values.
 *
 * @param {Object} raw - Raw query parameters (e.g. from req.query)
 * @returns {Object} Normalized query object
 */
function normalizeSupplierQuery(raw) {
  const q = raw.q ? String(raw.q).trim().slice(0, 200) : '';

  const parsedPage = parseInt(raw.page, 10);
  const page = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
  const parsedLimit = parseInt(raw.limit, 10);
  const limit = Math.min(100, Math.max(1, isNaN(parsedLimit) ? 20 : parsedLimit));

  // Numeric filters — silently discard invalid values so a bad param doesn't 400
  const minPrice = raw.minPrice !== undefined ? Number(raw.minPrice) : undefined;
  const maxPrice = raw.maxPrice !== undefined ? Number(raw.maxPrice) : undefined;
  const minRating =
    raw.minRating !== undefined && raw.minRating !== '' ? Number(raw.minRating) : undefined;
  const maxDistance = raw.maxDistance !== undefined ? Number(raw.maxDistance) : undefined;
  const minGuests = raw.minGuests !== undefined ? Number(raw.minGuests) : undefined;

  // Amenities: accept CSV string or array, trim each entry, drop empties
  let amenities = raw.amenities;
  if (typeof amenities === 'string') {
    amenities = amenities
      .split(',')
      .map(a => a.trim())
      .filter(Boolean);
  } else if (!Array.isArray(amenities)) {
    amenities = undefined;
  }
  if (amenities && amenities.length === 0) {
    amenities = undefined;
  }

  // Sort — fall back to 'relevance' for any unknown value
  const sortBy = VALID_SUPPLIER_SORT_VALUES.includes(raw.sortBy) ? raw.sortBy : 'relevance';

  return {
    q,
    category: raw.category ? String(raw.category).trim() : undefined,
    eventType: raw.eventType ? String(raw.eventType).trim().slice(0, 100) : undefined,
    location: raw.location ? String(raw.location).trim() : undefined,
    postcode: raw.postcode ? String(raw.postcode).trim().slice(0, 10) : undefined,
    maxDistance:
      !isNaN(maxDistance) && maxDistance >= 0 && maxDistance <= 500 ? maxDistance : undefined,
    minPrice: !isNaN(minPrice) ? minPrice : undefined,
    maxPrice: !isNaN(maxPrice) ? maxPrice : undefined,
    minRating: minRating !== undefined && !isNaN(minRating) ? minRating : undefined,
    amenities,
    minGuests: minGuests !== undefined && !isNaN(minGuests) ? minGuests : undefined,
    proOnly: raw.proOnly,
    featuredOnly: raw.featuredOnly,
    verifiedOnly: raw.verifiedOnly,
    sortBy,
    page,
    limit,
  };
}

/**
 * Normalize and validate raw package search query parameters.
 *
 * @param {Object} raw - Raw query parameters
 * @returns {Object} Normalized query object
 */
function normalizePackageQuery(raw) {
  const q = raw.q ? String(raw.q).trim().slice(0, 200) : '';

  const parsedPage = parseInt(raw.page, 10);
  const page = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
  const parsedLimit = parseInt(raw.limit, 10);
  const limit = Math.min(100, Math.max(1, isNaN(parsedLimit) ? 20 : parsedLimit));

  const minPrice = raw.minPrice !== undefined ? Number(raw.minPrice) : undefined;
  const maxPrice = raw.maxPrice !== undefined ? Number(raw.maxPrice) : undefined;

  // Sort — fall back to 'relevance' for any unknown value
  const sortBy = VALID_PACKAGE_SORT_VALUES.includes(raw.sortBy) ? raw.sortBy : 'relevance';

  return {
    q,
    category: raw.category ? String(raw.category).trim() : undefined,
    location: raw.location ? String(raw.location).trim() : undefined,
    minPrice: !isNaN(minPrice) ? minPrice : undefined,
    maxPrice: !isNaN(maxPrice) ? maxPrice : undefined,
    sortBy,
    page,
    limit,
  };
}

/**
 * Count price-tier symbols in a price_display string.
 * Supports both £ and $ notation (e.g. "££", "$$$").
 * @param {string} priceDisplay - e.g. "££" or "$$$"
 * @returns {number} Number of price-level symbols (0 if none)
 */
function getPriceLevel(priceDisplay) {
  if (!priceDisplay) {
    return 0;
  }
  const matches = priceDisplay.match(/[£$]/g);
  return matches ? matches.length : 0;
}

/**
 * Project safe public fields from supplier object
 * Excludes sensitive information like email, phone, addresses, etc.
 */
function projectPublicSupplierFields(supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    category: supplier.category,
    location: supplier.location,
    description_short: supplier.description_short,
    description_long: supplier.description_long,
    logo: supplier.logo,
    images: supplier.images,
    price_display: supplier.price_display,
    startingPrice: supplier.startingPrice,
    rating: supplier.rating || supplier.averageRating, // Legacy field for backward compatibility
    averageRating: supplier.averageRating,
    reviewCount: supplier.reviewCount,
    verified: supplier.verified,
    isPro: supplier.isPro,
    featured: supplier.featured,
    featuredSupplier: supplier.featuredSupplier,
    approved: supplier.approved,
    amenities: supplier.amenities,
    maxGuests: supplier.maxGuests,
    badges: supplier.badges,
    verifications: supplier.verifications,
    subscriptionTier: supplier.subscriptionTier,
    isFounding: supplier.isFounding,
    isTest: supplier.isTest,
    // Safe to expose: needed for the "Message" button on supplier cards
    ownerUserId: supplier.ownerUserId,
    // Timestamps are safe to expose and needed for 'newest' sort after projection
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
    // Explicitly exclude: email, phone, address, businessAddress, etc.
  };
}

/**
 * Project safe public fields from package object
 */
function projectPublicPackageFields(pkg) {
  return {
    id: pkg.id,
    title: pkg.title,
    description: pkg.description,
    description_short: pkg.description_short,
    category: pkg.category,
    price: pkg.price,
    images: pkg.images,
    supplierId: pkg.supplierId,
    supplierName: pkg.supplierName,
    location: pkg.location,
    maxGuests: pkg.maxGuests,
    features: pkg.features,
    approved: pkg.approved,
    createdAt: pkg.createdAt,
    // Explicitly exclude: internal flags, seller contact info, etc.
  };
}

/**
 * Search suppliers with weighted relevance scoring
 * @param {Object} query - Search parameters
 * @param {string} [query.q] - Search query text (max 200 chars)
 * @param {string} [query.category] - Filter by category
 * @param {string} [query.location] - Filter by location (partial match)
 * @param {number} [query.minPrice] - Minimum price level (1-4)
 * @param {number} [query.maxPrice] - Maximum price level (1-4)
 * @param {number} [query.minRating] - Minimum average rating (0-5)
 * @param {string|Array<string>} [query.amenities] - Required amenities
 * @param {number} [query.minGuests] - Minimum guest capacity
 * @param {boolean|string} [query.proOnly] - Filter to pro suppliers only
 * @param {boolean|string} [query.featuredOnly] - Filter to featured only
 * @param {boolean|string} [query.verifiedOnly] - Filter to verified only
 * @param {string} [query.sortBy='relevance'] - Sort order: relevance, rating, reviews, name, newest, priceAsc, priceDesc, distance
 * @param {string} [query.postcode] - UK postcode for distance-based filtering/sorting
 * @param {number} [query.maxDistance] - Maximum distance in miles from postcode
 * @param {number} [query.page=1] - Page number (1-indexed)
 * @param {number} [query.limit=20] - Results per page (max 100)
 * @returns {Promise<Object>} Search results with scores
 * @returns {Promise<Object>} result - Search results object
 * @returns {Array<Object>} result.results - Array of suppliers with relevance scores and match info
 * @returns {Object} result.pagination - Pagination metadata (total, page, limit, pages)
 * @returns {Object} result.facets - Faceted search data (categories, ratings, priceRanges, amenities)
 * @returns {number} result.durationMs - Search execution time in milliseconds
 */
async function searchSuppliers(query) {
  // Normalize query to ensure consistent, safe values throughout
  const normalizedQuery = normalizeSupplierQuery(query);
  const startTime = Date.now();
  const suppliers = await dbUnified.read('suppliers');

  // Pre-load packages to embed top 3 per supplier (for carousel in search results)
  const allPackages = await dbUnified.read('packages');

  // Geocode postcode for distance filtering/sorting
  let userCoords = null;
  if (normalizedQuery.postcode) {
    userCoords = await geocodeLocation(normalizedQuery.postcode);
  }

  // Filter approved suppliers
  let results = suppliers.filter(s => s.approved);

  // Apply filters (pass userCoords for distance filtering)
  results = applyFilters(results, normalizedQuery, userCoords);

  // Calculate relevance scores if query present
  if (normalizedQuery.q) {
    results = results.map(supplier => {
      const score = calculateRelevanceScore(supplier, normalizedQuery.q, normalizedQuery);
      const matchedFields = getMatchingFields(supplier, normalizedQuery.q);
      const snippets = getMatchingSnippets(
        [
          supplier.name || '',
          supplier.description_short || '',
          supplier.description_long || '',
        ].join(' '),
        normalizedQuery.q
      );

      // Project only public fields
      const publicSupplier = projectPublicSupplierFields(supplier);

      // Attach pre-calculated distance if available
      return {
        ...publicSupplier,
        ...(supplier._distanceMiles !== undefined
          ? { distanceMiles: supplier._distanceMiles }
          : {}),
        relevanceScore: score,
        rankingReason: getRankingReason(supplier, normalizedQuery.q),
        match: {
          fields: matchedFields,
          snippets,
        },
      };
    });

    // Filter out items with zero score
    results = results.filter(r => r.relevanceScore > 0);
  } else {
    // No search query — compute quality scores for stable browse-mode ranking.
    // This ensures that when users browse without a keyword, better-quality
    // suppliers (high rating, many reviews, featured, verified) appear first
    // rather than the order being determined by DB insertion order.
    results = results.map(supplier => ({
      ...projectPublicSupplierFields(supplier),
      ...(supplier._distanceMiles !== undefined ? { distanceMiles: supplier._distanceMiles } : {}),
      relevanceScore: calculateQualityScore(supplier),
      rankingReason: getRankingReason(supplier, ''),
    }));
  }

  // Sort results (pass userCoords for distance sort)
  const { sortBy: requestedSort } = normalizedQuery;
  // Distance sort falls back to relevance when no postcode was given
  const appliedSort = requestedSort === 'distance' && !userCoords ? 'relevance' : requestedSort;
  results = sortResults(results, appliedSort, userCoords);

  // Get total before pagination
  const total = results.length;

  // Build zero-results fallback before pagination (only on the first page)
  let fallback = null;
  if (total === 0 && normalizedQuery.page === 1) {
    fallback = await buildZeroResultsFallback(
      normalizedQuery,
      suppliers.filter(s => s.approved)
    );
  }

  // Pagination
  const { page, limit } = normalizedQuery;
  const skip = (page - 1) * limit;
  results = results.slice(skip, skip + limit);

  // Enrich paginated results with top packages (for the card carousel)
  // Build a Map first to avoid O(n*m) inner filter on every supplier
  const pkgsBySupplier = new Map();
  for (const p of allPackages) {
    if (p.approved === false) {
      continue;
    }
    if (!pkgsBySupplier.has(p.supplierId)) {
      pkgsBySupplier.set(p.supplierId, []);
    }
    pkgsBySupplier.get(p.supplierId).push(p);
  }

  results = results.map(supplier => {
    const supplierPkgs = (pkgsBySupplier.get(supplier.id) || []).slice(0, 3).map(p => ({
      id: p.id,
      slug: p.slug || '',
      title: p.title || '',
      price: p.price || '',
      image: resolvePackageImage(p),
      description: p.description || '',
    }));
    return { ...supplier, topPackages: supplierPkgs };
  });

  // Calculate facets — reuse the already-loaded suppliers array (avoid a second DB read)
  const facets = calculateFacets(suppliers.filter(s => s.approved));

  const duration = Date.now() - startTime;

  return {
    results,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
    appliedSort,
    facets,
    ...(fallback ? { fallback } : {}),
    durationMs: duration,
  };
}

/**
 * Search packages across all suppliers
 * @param {Object} query - Search parameters
 * @returns {Promise<Object>} Search results
 */
async function searchPackages(query) {
  // Normalize query to ensure consistent, safe values throughout
  const normalizedQuery = normalizePackageQuery(query);
  const startTime = Date.now();
  const packages = await dbUnified.read('packages');
  const suppliers = await dbUnified.read('suppliers');

  // Create a supplier lookup map
  const supplierMap = {};
  suppliers.forEach(s => {
    supplierMap[s.id] = s;
  });

  // Filter approved packages from approved suppliers
  let results = packages.filter(p => {
    const supplier = supplierMap[p.supplierId];
    return p.approved && supplier && supplier.approved;
  });

  // Apply filters
  results = applyPackageFilters(results, normalizedQuery, supplierMap);

  // Calculate relevance scores
  if (normalizedQuery.q) {
    results = results.map(pkg => {
      const supplier = supplierMap[pkg.supplierId];
      const score = calculateRelevanceScore(pkg, normalizedQuery.q, normalizedQuery);
      const matchedFields = getMatchingFields(pkg, normalizedQuery.q);
      const snippets = getMatchingSnippets(
        [pkg.title || '', pkg.description || ''].join(' '),
        normalizedQuery.q
      );

      // Project only public fields for package
      const publicPkg = projectPublicPackageFields(pkg);

      return {
        ...publicPkg,
        supplier: supplier
          ? {
              id: supplier.id,
              name: supplier.name,
              logo: supplier.logo,
              location: supplier.location,
              averageRating: supplier.averageRating,
              verified: supplier.verified,
            }
          : null,
        relevanceScore: score,
        match: {
          fields: matchedFields,
          snippets,
        },
      };
    });

    results = results.filter(r => r.relevanceScore > 0);
  } else {
    // Add supplier info even without scoring, project public fields
    results = results.map(pkg => {
      const supplier = supplierMap[pkg.supplierId];
      const publicPkg = projectPublicPackageFields(pkg);

      return {
        ...publicPkg,
        supplier: supplier
          ? {
              id: supplier.id,
              name: supplier.name,
              logo: supplier.logo,
              location: supplier.location,
              averageRating: supplier.averageRating,
              verified: supplier.verified,
            }
          : null,
      };
    });
  }

  // Sort results
  const appliedSort = normalizedQuery.sortBy;
  results = sortPackageResults(results, appliedSort);

  const total = results.length;

  // Pagination
  const { page, limit } = normalizedQuery;
  const skip = (page - 1) * limit;
  results = results.slice(skip, skip + limit);

  const duration = Date.now() - startTime;

  return {
    results,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
    appliedSort,
    durationMs: duration,
  };
}

/**
 * Advanced search with complex criteria
 * @param {Object} criteria - Search criteria
 * @returns {Promise<Object>} Search results
 */
async function advancedSearch(criteria) {
  const startTime = Date.now();

  // Determine search type
  const searchType = criteria.type || 'suppliers'; // 'suppliers' or 'packages'

  let results;
  if (searchType === 'packages') {
    results = await searchPackages(criteria);
  } else {
    results = await searchSuppliers(criteria);
  }

  results.durationMs = Date.now() - startTime;

  return results;
}

/**
 * Apply filters to supplier results
 * @param {Array} suppliers - Supplier array
 * @param {Object} query - Query parameters
 * @param {Object|null} userCoords - User's geocoded coordinates {latitude, longitude}
 * @returns {Array} Filtered suppliers
 */
function applyFilters(suppliers, query, userCoords) {
  let results = suppliers;

  // Distance filter: annotate each supplier with distanceMiles if userCoords available
  if (userCoords) {
    const maxDistance = query.maxDistance ? Number(query.maxDistance) : null;
    results = results.reduce((acc, s) => {
      // Support GeoJSON Point: { type: 'Point', coordinates: [lng, lat] }
      // or flat lat/lng fields
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
        // Filter by maxDistance if set
        if (maxDistance !== null && dist > maxDistance) {
          return acc;
        }
        // Attach distance for sorting (using temporary private field)
        acc.push({ ...s, _distanceMiles: dist });
      } else {
        // No coordinates — include unless strict distance filter is active
        if (!maxDistance) {
          acc.push(s);
        }
      }
      return acc;
    }, []);
  }

  // Text search (applied in scoring, but also filter out non-matches)
  // Phase 2: all-words matching — split query into individual words so that
  // "wedding london" matches suppliers that mention "wedding" AND "london"
  // anywhere in their searchable fields, rather than requiring the exact phrase.
  if (query.q) {
    const queryWords = query.q.toLowerCase().split(/\s+/).filter(Boolean);
    results = results.filter(s => {
      const searchableText = [
        s.name || '',
        s.description_short || '',
        s.description_long || '',
        s.category || '',
        typeof s.location === 'string' ? s.location : '',
        ...(s.amenities || []),
        ...(s.tags || []),
      ]
        .join(' ')
        .toLowerCase();

      // Every query word must appear somewhere in the combined searchable text
      return queryWords.every(word => searchableText.includes(word));
    });
  }

  // Category filter
  if (query.category) {
    results = results.filter(s => s.category === query.category);
  }

  // Location filter
  if (query.location) {
    const locationTerm = query.location.toLowerCase();
    results = results.filter(s => {
      const location = typeof s.location === 'string' ? s.location.toLowerCase() : '';
      return location.includes(locationTerm);
    });
  }

  // Event type filter (matches category or tags)
  if (query.eventType) {
    const eventTypeTerm = query.eventType.toLowerCase();
    results = results.filter(s => {
      const category = (s.category || '').toLowerCase();
      const tags = (s.tags || []).map(t => t.toLowerCase());
      return category.includes(eventTypeTerm) || tags.some(t => t.includes(eventTypeTerm));
    });
  }

  // Price range filter
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const minPrice = query.minPrice !== undefined ? Number(query.minPrice) : NaN;
    const maxPrice = query.maxPrice !== undefined ? Number(query.maxPrice) : NaN;
    results = results.filter(s => {
      const priceLevel = getPriceLevel(s.price_display);

      if (!isNaN(minPrice) && priceLevel < minPrice) {
        return false;
      }
      if (!isNaN(maxPrice) && priceLevel > maxPrice) {
        return false;
      }

      return true;
    });
  }

  // Rating filter
  if (query.minRating !== undefined && query.minRating !== '') {
    const minRating = Number(query.minRating);
    if (!isNaN(minRating)) {
      results = results.filter(s => (s.averageRating || 0) >= minRating);
    }
  }

  // Amenities filter
  if (query.amenities) {
    const requiredAmenities = Array.isArray(query.amenities)
      ? query.amenities
      : query.amenities.split(',').map(a => a.trim());

    results = results.filter(s => {
      const supplierAmenities = s.amenities || [];
      return requiredAmenities.every(amenity => supplierAmenities.includes(amenity));
    });
  }

  // Max guests filter
  if (query.minGuests !== undefined) {
    const minGuests = Number(query.minGuests);
    results = results.filter(s => !s.maxGuests || s.maxGuests >= minGuests);
  }

  // Boolean filters
  if (query.proOnly === 'true' || query.proOnly === true) {
    results = results.filter(s => s.isPro);
  }

  if (query.featuredOnly === 'true' || query.featuredOnly === true) {
    results = results.filter(s => s.featured);
  }

  if (query.verifiedOnly === 'true' || query.verifiedOnly === true) {
    results = results.filter(s => s.verified);
  }

  return results;
}

/**
 * Apply filters to package results
 * @param {Array} packages - Package array
 * @param {Object} query - Query parameters
 * @param {Object} supplierMap - Supplier lookup map
 * @returns {Array} Filtered packages
 */
function applyPackageFilters(packages, query, supplierMap) {
  let results = packages;

  // Text search
  if (query.q) {
    const searchTerm = query.q.toLowerCase();
    results = results.filter(p => {
      const searchableText = [
        p.title || '',
        p.description || '',
        supplierMap[p.supplierId]?.name || '',
        supplierMap[p.supplierId]?.category || '',
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(searchTerm);
    });
  }

  // Category filter (from supplier)
  if (query.category) {
    results = results.filter(p => {
      const supplier = supplierMap[p.supplierId];
      return supplier && supplier.category === query.category;
    });
  }

  // Location filter (from supplier)
  if (query.location) {
    const locationTerm = query.location.toLowerCase();
    results = results.filter(p => {
      const supplier = supplierMap[p.supplierId];
      return supplier && (supplier.location || '').toLowerCase().includes(locationTerm);
    });
  }

  // Price range filter
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    results = results.filter(p => {
      const price = p.price || 0;

      if (query.minPrice !== undefined && price < Number(query.minPrice)) {
        return false;
      }
      if (query.maxPrice !== undefined && price > Number(query.maxPrice)) {
        return false;
      }

      return true;
    });
  }

  return results;
}

/**
 * Compute a stable quality tie-break score from a result object.
 * Used as the final comparator when primary sort keys are equal.
 * Higher means the supplier should rank first.
 *
 * @param {Object} item - Projected result object
 * @returns {number} Tie-break score
 */
function getQualityTieBreak(item) {
  let score = 0;
  score += (item.averageRating || 0) * 10;
  score += Math.min(item.reviewCount || 0, 200) * 0.1;
  if (item.featured) {
    score += 5;
  }
  if (item.verified) {
    score += 3;
  }
  if (item.isPro) {
    score += 2;
  }
  return score;
}

/**
 * Sort search results
 * @param {Array} results - Results to sort
 * @param {string} sortBy - Sort criteria
 * @param {Object|null} userCoords - Geocoded user coordinates for distance sort
 * @returns {Array} Sorted results
 */
function sortResults(results, sortBy, userCoords) {
  const sorted = [...results];

  switch (sortBy) {
    case 'relevance':
      sorted.sort((a, b) => {
        const scoreA = a.relevanceScore || 0;
        const scoreB = b.relevanceScore || 0;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        // Tie-break: higher quality first
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
      break;

    case 'rating':
      sorted.sort((a, b) => {
        const ratingDiff = (b.averageRating || 0) - (a.averageRating || 0);
        if (ratingDiff !== 0) {
          return ratingDiff;
        }
        // Tie-break: more reviews wins, then quality
        const reviewDiff = (b.reviewCount || 0) - (a.reviewCount || 0);
        if (reviewDiff !== 0) {
          return reviewDiff;
        }
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
      break;

    case 'reviews':
      sorted.sort((a, b) => {
        const reviewDiff = (b.reviewCount || 0) - (a.reviewCount || 0);
        if (reviewDiff !== 0) {
          return reviewDiff;
        }
        // Tie-break: higher rating wins, then quality
        const ratingDiff = (b.averageRating || 0) - (a.averageRating || 0);
        if (ratingDiff !== 0) {
          return ratingDiff;
        }
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
      break;

    case 'name':
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;

    case 'newest':
      sorted.sort((a, b) => {
        const tA = new Date(a.updatedAt || a.createdAt || 0);
        const tB = new Date(b.updatedAt || b.createdAt || 0);
        if (tB - tA !== 0) {
          return tB - tA;
        }
        // Tie-break: quality
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
      break;

    case 'priceAsc':
      sorted.sort((a, b) => {
        const priceDiff = getPriceLevel(a.price_display) - getPriceLevel(b.price_display);
        if (priceDiff !== 0) {
          return priceDiff;
        }
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
      break;

    case 'priceDesc':
      sorted.sort((a, b) => {
        const priceDiff = getPriceLevel(b.price_display) - getPriceLevel(a.price_display);
        if (priceDiff !== 0) {
          return priceDiff;
        }
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
      break;

    case 'distance':
      if (userCoords) {
        // Suppliers with known distance first (nearest first), then those without coordinates
        sorted.sort((a, b) => {
          const distA = a.distanceMiles !== undefined ? a.distanceMiles : Infinity;
          const distB = b.distanceMiles !== undefined ? b.distanceMiles : Infinity;
          if (distA !== distB) {
            return distA - distB;
          }
          // Tie-break: quality
          return getQualityTieBreak(b) - getQualityTieBreak(a);
        });
      } else {
        // No postcode provided — fall back to quality order
        sorted.sort((a, b) => {
          const scoreA = a.relevanceScore || 0;
          const scoreB = b.relevanceScore || 0;
          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }
          return getQualityTieBreak(b) - getQualityTieBreak(a);
        });
      }
      break;

    default:
      // Default to relevance with quality tie-break
      sorted.sort((a, b) => {
        const scoreA = a.relevanceScore || 0;
        const scoreB = b.relevanceScore || 0;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return getQualityTieBreak(b) - getQualityTieBreak(a);
      });
  }

  return sorted;
}

/**
 * Sort package results
 * @param {Array} results - Results to sort
 * @param {string} sortBy - Sort criteria
 * @returns {Array} Sorted results
 */
function sortPackageResults(results, sortBy) {
  const sorted = [...results];

  switch (sortBy) {
    case 'relevance':
      sorted.sort((a, b) => {
        const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        // Tie-break: supplier rating then price (lower is better)
        const ratingDiff = (b.supplier?.averageRating || 0) - (a.supplier?.averageRating || 0);
        if (ratingDiff !== 0) {
          return ratingDiff;
        }
        return (a.price || 0) - (b.price || 0);
      });
      break;

    case 'priceAsc':
      sorted.sort((a, b) => {
        const priceDiff = (a.price || 0) - (b.price || 0);
        if (priceDiff !== 0) {
          return priceDiff;
        }
        // Tie-break: higher supplier rating first, then relevance
        const ratingDiff = (b.supplier?.averageRating || 0) - (a.supplier?.averageRating || 0);
        if (ratingDiff !== 0) {
          return ratingDiff;
        }
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      });
      break;

    case 'priceDesc':
      sorted.sort((a, b) => {
        const priceDiff = (b.price || 0) - (a.price || 0);
        if (priceDiff !== 0) {
          return priceDiff;
        }
        // Tie-break: higher supplier rating first, then relevance
        const ratingDiff = (b.supplier?.averageRating || 0) - (a.supplier?.averageRating || 0);
        if (ratingDiff !== 0) {
          return ratingDiff;
        }
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      });
      break;

    case 'name':
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;

    case 'newest':
      sorted.sort((a, b) => {
        const tA = new Date(a.updatedAt || a.createdAt || 0);
        const tB = new Date(b.updatedAt || b.createdAt || 0);
        if (tB - tA !== 0) {
          return tB - tA;
        }
        // Tie-break: relevance score then supplier rating
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      });
      break;

    default:
      sorted.sort((a, b) => {
        const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return (b.supplier?.averageRating || 0) - (a.supplier?.averageRating || 0);
      });
  }

  return sorted;
}

/**
 * Calculate facets for filtering
 * @param {Array} allSuppliers - All suppliers
 * @returns {Object} Facets
 */
function calculateFacets(allSuppliers) {
  // Category facets
  const categoryCounts = {};
  allSuppliers.forEach(s => {
    if (s.category) {
      categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
    }
  });

  const categories = Object.entries(categoryCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Rating facets
  const ratingRanges = [
    { rating: '4.5+', min: 4.5, count: 0 },
    { rating: '4.0+', min: 4.0, count: 0 },
    { rating: '3.5+', min: 3.5, count: 0 },
    { rating: '3.0+', min: 3.0, count: 0 },
  ];

  allSuppliers.forEach(s => {
    const rating = s.averageRating || 0;
    ratingRanges.forEach(range => {
      if (rating >= range.min) {
        range.count++;
      }
    });
  });

  // Price range facets
  const priceRanges = [
    { label: '$', min: 0, max: 1, count: 0 },
    { label: '$$', min: 1, max: 2, count: 0 },
    { label: '$$$', min: 2, max: 3, count: 0 },
    { label: '$$$$', min: 3, max: 10, count: 0 },
  ];

  allSuppliers.forEach(s => {
    const priceLevel = getPriceLevel(s.price_display);
    priceRanges.forEach(range => {
      if (priceLevel >= range.min && priceLevel <= range.max) {
        range.count++;
      }
    });
  });

  // Amenities facets
  const amenityCounts = {};
  allSuppliers.forEach(s => {
    if (s.amenities && Array.isArray(s.amenities)) {
      s.amenities.forEach(amenity => {
        amenityCounts[amenity] = (amenityCounts[amenity] || 0) + 1;
      });
    }
  });

  const amenities = Object.entries(amenityCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Location facets — top locations by supplier count (string locations only)
  const locationCounts = {};
  allSuppliers.forEach(s => {
    if (typeof s.location === 'string' && s.location.trim()) {
      const loc = s.location.trim();
      locationCounts[loc] = (locationCounts[loc] || 0) + 1;
    }
  });

  const locations = Object.entries(locationCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    categories,
    ratings: ratingRanges,
    priceRanges,
    amenities,
    locations,
  };
}

/**
 * Get suppliers similar to a given supplier.
 * Similarity is based on: same category (required), overlapping price tier,
 * overlapping tags, and proximity of location string. Results are ranked by
 * a composite quality score so the best matches surface first.
 *
 * @param {string} supplierId - The reference supplier's ID
 * @param {number} [limit=6] - Maximum number of similar suppliers to return
 * @returns {Promise<Array>} Array of projected public supplier objects
 */
async function getSimilarSuppliers(supplierId, limit = 6) {
  const suppliers = await dbUnified.read('suppliers');

  // Find the reference supplier (approved or not — we just need its attributes)
  const reference = suppliers.find(s => s.id === supplierId || s._id === supplierId);
  if (!reference) {
    return [];
  }

  const referencePrice = getPriceLevel(reference.price_display);
  const referenceTags = new Set((reference.tags || []).map(t => t.toLowerCase()));

  // Filter to approved suppliers, excluding the reference itself.
  // Only compare an ID field when it is truthy on the reference to avoid
  // the false-negative: undefined !== undefined → false which would exclude
  // every candidate when suppliers do not carry an _id field.
  const candidates = suppliers.filter(s => {
    if (!s.approved) {
      return false;
    }
    if (reference.id && s.id === reference.id) {
      return false;
    }
    if (reference._id && s._id === reference._id) {
      return false;
    }
    return true;
  });

  // Score each candidate for similarity to the reference supplier
  const scored = candidates.map(s => {
    let score = 0;

    // Category match is the primary signal
    if (s.category && s.category === reference.category) {
      score += 50;
    }

    // Price tier proximity (max 20 points — within 1 tier gets 20, within 2 gets 10)
    const priceDiff = Math.abs(getPriceLevel(s.price_display) - referencePrice);
    if (priceDiff === 0) {
      score += 20;
    } else if (priceDiff === 1) {
      score += 10;
    } else if (priceDiff === 2) {
      score += 5;
    }

    // Tag overlap (up to 20 points)
    const sharedTags = (s.tags || []).filter(t => referenceTags.has(t.toLowerCase())).length;
    score += Math.min(sharedTags * 5, 20);

    // Location match (up to 10 points) — bidirectional substring check
    // so "London" matches "Greater London" and vice-versa
    if (
      reference.location &&
      typeof reference.location === 'string' &&
      typeof s.location === 'string'
    ) {
      const refLocLower = reference.location.toLowerCase();
      const candLocLower = s.location.toLowerCase();
      if (candLocLower.includes(refLocLower) || refLocLower.includes(candLocLower)) {
        score += 10;
      }
    }

    // Quality tie-break contribution
    score += calculateQualityScore(s) * 0.1;

    return { supplier: s, score };
  });

  // Sort by similarity score descending, then by quality
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return calculateQualityScore(b.supplier) - calculateQualityScore(a.supplier);
  });

  return scored.slice(0, limit).map(r => projectPublicSupplierFields(r.supplier));
}

/**
 * Build a curated discovery feed for browsing pages.
 * Returns a set of supplier buckets useful for homepage / discovery surfaces:
 * - featured: manually featured suppliers (already flagged)
 * - topRated: highest-rated suppliers with at least a few reviews
 * - newArrivals: suppliers added most recently
 *
 * Each bucket is independently limited and sorted so callers can render them
 * as separate carousels without further processing.
 *
 * @param {Object} [options={}] - Options
 * @param {number} [options.featuredLimit=4] - Max featured suppliers
 * @param {number} [options.topRatedLimit=6] - Max top-rated suppliers
 * @param {number} [options.newArrivalsLimit=6] - Max new-arrivals suppliers
 * @returns {Promise<Object>} Discovery buckets: { featured, topRated, newArrivals }
 */
async function getDiscoveryFeed({
  featuredLimit = 4,
  topRatedLimit = 6,
  newArrivalsLimit = 6,
} = {}) {
  const suppliers = await dbUnified.read('suppliers');
  const approved = suppliers.filter(s => s.approved);

  // Featured bucket — suppliers explicitly marked as featured, ranked by quality
  const featured = [...approved]
    .filter(s => s.featured || s.featuredSupplier)
    .sort((a, b) => calculateQualityScore(b) - calculateQualityScore(a))
    .slice(0, featuredLimit)
    .map(projectPublicSupplierFields);

  // Top-rated bucket — minimum 3 reviews, sorted by rating then review count
  const topRated = [...approved]
    .filter(s => (s.reviewCount || 0) >= 3 && (s.averageRating || 0) > 0)
    .sort((a, b) => {
      const ratingDiff = (b.averageRating || 0) - (a.averageRating || 0);
      if (ratingDiff !== 0) {
        return ratingDiff;
      }
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    })
    .slice(0, topRatedLimit)
    .map(projectPublicSupplierFields);

  // New arrivals — most recently added/updated, limited to suppliers from last 90 days
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const newArrivals = [...approved]
    .filter(s => {
      const t = new Date(s.createdAt || 0);
      return t >= cutoff;
    })
    .sort((a, b) => {
      const tA = new Date(a.updatedAt || a.createdAt || 0);
      const tB = new Date(b.updatedAt || b.createdAt || 0);
      return tB - tA;
    })
    .slice(0, newArrivalsLimit)
    .map(projectPublicSupplierFields);

  return { featured, topRated, newArrivals };
}

/**
 * Build a zero-results fallback object.
 *
 * When a supplier search returns no results, this function attempts to return
 * alternative suggestions by progressively relaxing the strictest filters.
 * The fallback is surfaced in the API response alongside an explanatory message
 * so clients can guide users toward useful alternatives rather than showing a
 * blank page.
 *
 * Relaxation order (most specific → most general):
 *   1. Drop minRating (quality gate)
 *   2. Drop amenities (feature requirements)
 *   3. Drop minGuests (capacity requirement)
 *   4. Drop location (if category still yields results)
 *   5. Drop query (browse by category)
 *
 * @param {Object} query - Normalized search query (from normalizeSupplierQuery)
 * @param {Array} approvedSuppliers - Pre-filtered approved suppliers
 * @returns {Promise<Object|null>} Fallback object or null if none possible
 */
async function buildZeroResultsFallback(query, approvedSuppliers) {
  const relaxationSteps = [
    { name: 'minRating', label: 'minimum rating removed' },
    { name: 'amenities', label: 'amenity requirements removed' },
    { name: 'minGuests', label: 'guest capacity requirement removed' },
    { name: 'location', label: 'location filter removed' },
    { name: 'q', label: 'search term removed — browsing by category' },
  ];

  const relaxedFilters = [];
  let relaxedQuery = { ...query };

  for (const step of relaxationSteps) {
    // Remove this filter from the working query
    const prevValue = relaxedQuery[step.name];
    if (prevValue === undefined || prevValue === '' || prevValue === null) {
      continue; // Already absent — skip this step
    }

    relaxedQuery = { ...relaxedQuery, [step.name]: undefined };
    relaxedFilters.push(step.label);

    // Re-filter with the relaxed query
    const candidates = applyFilters(approvedSuppliers, relaxedQuery, null);

    if (candidates.length > 0) {
      // Score and sort the fallback candidates by quality
      const suggestions = candidates
        .map(s => ({
          ...projectPublicSupplierFields(s),
          relevanceScore: calculateQualityScore(s),
          rankingReason: getRankingReason(s, relaxedQuery.q || ''),
        }))
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
        .slice(0, 6);

      const message = buildFallbackMessage(query, relaxedFilters);
      return { suggestions, relaxedFilters, message };
    }
  }

  // Nothing found even after full relaxation
  return null;
}

/**
 * Compose a user-facing message explaining why the fallback was triggered.
 * @param {Object} originalQuery - Original normalized query
 * @param {Array<string>} relaxedFilters - Labels of removed filters
 * @returns {string} Explanatory message
 */
function buildFallbackMessage(originalQuery, relaxedFilters) {
  const parts = [];

  if (originalQuery.q) {
    parts.push(`No exact matches for "${originalQuery.q}"`);
  } else {
    parts.push('No suppliers matched your filters');
  }

  if (relaxedFilters.length > 0) {
    parts.push(`Showing results with ${relaxedFilters[relaxedFilters.length - 1]}`);
  }

  return `${parts.join('. ')}. Try adjusting your search to see more options.`;
}

/**
 * Get a personalized discovery feed for a user.
 *
 * Uses the user's recent search history to infer preferred categories and
 * locations, then surfaces suppliers that match those preferences ranked by
 * quality.  Falls back gracefully to a quality-ranked generic feed when the
 * user has no history or when no matching suppliers are found.
 *
 * @param {string|null} userId - Authenticated user ID (null for anonymous)
 * @param {Object} [context={}] - Optional explicit context signals
 * @param {string} [context.eventType] - Event type hint (e.g. "wedding")
 * @param {string} [context.location] - Location hint
 * @param {number} [context.budget] - Price tier preference (1–4)
 * @param {Object} [options={}] - Limit options
 * @param {number} [options.limit=12] - Max suppliers to return
 * @param {number} [options.historyDays=30] - Look-back window for history
 * @returns {Promise<Object>} Personalized feed result
 */
async function getPersonalizedFeed(userId, context = {}, options = {}) {
  const { limit = 12, historyDays = 30 } = options;
  const { eventType, location, budget } = context;

  const suppliers = await dbUnified.read('suppliers');
  const approved = suppliers.filter(s => s.approved);

  // Build personalization signals from user search history when userId is known
  let preferredCategories = [];
  let preferredLocations = [];
  const inferredTags = [];

  if (userId) {
    const searchHistory = (await dbUnified.read('searchHistory')) || [];
    const cutoff = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);

    const recentHistory = searchHistory.filter(
      h => h.userId === userId && new Date(h.timestamp || 0) >= cutoff
    );

    // Tally categories and locations from history filters
    const categoryCounts = {};
    const locationCounts = {};

    recentHistory.forEach(h => {
      const filters = h.filters || {};
      if (filters.category) {
        categoryCounts[filters.category] = (categoryCounts[filters.category] || 0) + 1;
      }
      if (filters.location) {
        locationCounts[filters.location] = (locationCounts[filters.location] || 0) + 1;
      }
      // Extract keywords from query text as inferred tag interests
      if (h.queryText) {
        h.queryText
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 3)
          .forEach(w => inferredTags.push(w));
      }
    });

    preferredCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat)
      .slice(0, 3);

    preferredLocations = Object.entries(locationCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([loc]) => loc)
      .slice(0, 3);
  }

  // Merge explicit context signals (take precedence over inferred signals)
  const topCategory = eventType || preferredCategories[0] || null;
  const topLocation = location || preferredLocations[0] || null;

  const { categoryMatchBonus, locationMatchBonus, tagMatchBonus, budgetProximityBonus } =
    RANKING_CONFIG.personalization;

  // Score each approved supplier against personalization signals
  const scored = approved.map(s => {
    let personalizationScore = calculateQualityScore(s);
    const matchReasons = [];

    if (topCategory && s.category && s.category.toLowerCase() === topCategory.toLowerCase()) {
      personalizationScore += categoryMatchBonus;
      matchReasons.push(topCategory);
    }

    if (
      topLocation &&
      typeof s.location === 'string' &&
      s.location.toLowerCase().includes(topLocation.toLowerCase())
    ) {
      personalizationScore += locationMatchBonus;
      matchReasons.push(topLocation);
    }

    // Tag overlap with inferred interests
    if (inferredTags.length > 0 && s.tags && Array.isArray(s.tags)) {
      const tagMatches = s.tags.filter(t => inferredTags.includes(t.toLowerCase())).length;
      personalizationScore += Math.min(tagMatches * tagMatchBonus, 20);
    }

    // Budget proximity (if a budget tier is provided)
    if (budget !== undefined) {
      const priceDiff = Math.abs(getPriceLevel(s.price_display) - budget);
      if (priceDiff <= 1) {
        personalizationScore += budgetProximityBonus;
      }
    }

    const personalized = matchReasons.length > 0;
    return { supplier: s, score: personalizationScore, personalized, matchReasons };
  });

  // Sort by personalization score descending
  scored.sort((a, b) => b.score - a.score);

  const isPersonalized = topCategory !== null || topLocation !== null;
  const contextSummary = {
    isPersonalized,
    preferredCategory: topCategory,
    preferredLocation: topLocation,
    signalSource:
      userId && preferredCategories.length > 0
        ? 'history'
        : eventType || location || budget !== undefined
          ? 'context'
          : 'none',
  };

  const results = scored.slice(0, limit).map(({ supplier, personalized }) => ({
    ...projectPublicSupplierFields(supplier),
    relevanceScore: calculateQualityScore(supplier),
    rankingReason: getRankingReason(supplier, '', {
      isPersonalized: personalized,
      preferredCategory: topCategory,
      preferredLocation: topLocation,
    }),
  }));

  return { results, context: contextSummary };
}

/**
 * Get suppliers that users also viewed alongside a given supplier.
 *
 * Complements `getSimilarSuppliers` with a different signal mix: where
 * getSimilarSuppliers requires the same category, getPeopleAlsoViewed
 * is more exploratory — it weights tag overlap, price proximity, and
 * location first, so it surfaces suppliers a browsing user might consider
 * even across adjacent categories.
 *
 * @param {string} supplierId - The reference supplier's ID
 * @param {number} [limit=6] - Maximum number of results to return
 * @returns {Promise<Array>} Array of projected public supplier objects
 */
async function getPeopleAlsoViewed(supplierId, limit = 6) {
  const suppliers = await dbUnified.read('suppliers');

  const reference = suppliers.find(s => s.id === supplierId || s._id === supplierId);
  if (!reference) {
    return [];
  }

  const referencePrice = getPriceLevel(reference.price_display);
  const referenceTags = new Set((reference.tags || []).map(t => t.toLowerCase()));
  const referenceCategory = (reference.category || '').toLowerCase();

  // Exclude the reference itself (same logic as getSimilarSuppliers)
  const candidates = suppliers.filter(s => {
    if (!s.approved) {
      return false;
    }
    if (reference.id && s.id === reference.id) {
      return false;
    }
    if (reference._id && s._id === reference._id) {
      return false;
    }
    return true;
  });

  const scored = candidates.map(s => {
    let score = 0;

    // Tag overlap is the primary signal (max 30 points)
    const sharedTags = (s.tags || []).filter(t => referenceTags.has(t.toLowerCase())).length;
    score += Math.min(sharedTags * 6, 30);

    // Price tier proximity (max 20 points)
    const priceDiff = Math.abs(getPriceLevel(s.price_display) - referencePrice);
    if (priceDiff === 0) {
      score += 20;
    } else if (priceDiff === 1) {
      score += 12;
    } else if (priceDiff === 2) {
      score += 5;
    }

    // Location match (up to 15 points)
    if (
      reference.location &&
      typeof reference.location === 'string' &&
      typeof s.location === 'string'
    ) {
      const refLocLower = reference.location.toLowerCase();
      const candLocLower = s.location.toLowerCase();
      if (candLocLower.includes(refLocLower) || refLocLower.includes(candLocLower)) {
        score += 15;
      }
    }

    // Same category gives a moderate bonus (not required, unlike getSimilarSuppliers)
    if (s.category && s.category.toLowerCase() === referenceCategory) {
      score += 10;
    }

    // Quality contribution as tie-break
    score += calculateQualityScore(s) * 0.1;

    return { supplier: s, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return calculateQualityScore(b.supplier) - calculateQualityScore(a.supplier);
  });

  return scored.slice(0, limit).map(r => ({
    ...projectPublicSupplierFields(r.supplier),
    rankingReason: getRankingReason(r.supplier, ''),
  }));
}

module.exports = {
  searchSuppliers,
  searchPackages,
  advancedSearch,
  normalizeSupplierQuery,
  normalizePackageQuery,
  calculateFacets,
  getSimilarSuppliers,
  getDiscoveryFeed,
  getPersonalizedFeed,
  getPeopleAlsoViewed,
  buildZeroResultsFallback,
  getPriceLevel,
  VALID_SUPPLIER_SORT_VALUES,
  VALID_PACKAGE_SORT_VALUES,
};
