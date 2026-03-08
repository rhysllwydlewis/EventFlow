/**
 * Advanced Search Service
 * Provides weighted full-text search, filtering, and ranking
 */

'use strict';

const dbUnified = require('../db-unified');
const {
  calculateRelevanceScore,
  getMatchingSnippets,
  getMatchingFields,
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
        match: {
          fields: matchedFields,
          snippets,
        },
      };
    });

    // Filter out items with zero score
    results = results.filter(r => r.relevanceScore > 0);
  } else {
    // No search query, just project public fields
    results = results.map(supplier => ({
      ...projectPublicSupplierFields(supplier),
      ...(supplier._distanceMiles !== undefined ? { distanceMiles: supplier._distanceMiles } : {}),
    }));
  }

  // Sort results (pass userCoords for distance sort)
  const { sortBy: requestedSort } = normalizedQuery;
  // Distance sort falls back to relevance when no postcode was given
  const appliedSort = requestedSort === 'distance' && !userCoords ? 'relevance' : requestedSort;
  results = sortResults(results, appliedSort, userCoords);

  // Get total before pagination
  const total = results.length;

  // Pagination
  const { page, limit } = normalizedQuery;
  const skip = (page - 1) * limit;
  results = results.slice(skip, skip + limit);

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
        ...(s.tags || []),
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
        return scoreB - scoreA;
      });
      break;

    case 'rating':
      sorted.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));
      break;

    case 'reviews':
      sorted.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
      break;

    case 'name':
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;

    case 'newest':
      sorted.sort((a, b) => {
        const tA = new Date(a.updatedAt || a.createdAt || 0);
        const tB = new Date(b.updatedAt || b.createdAt || 0);
        return tB - tA;
      });
      break;

    case 'priceAsc':
      sorted.sort((a, b) => getPriceLevel(a.price_display) - getPriceLevel(b.price_display));
      break;

    case 'priceDesc':
      sorted.sort((a, b) => getPriceLevel(b.price_display) - getPriceLevel(a.price_display));
      break;

    case 'distance':
      if (userCoords) {
        // Suppliers with known distance first (nearest first), then those without coordinates
        sorted.sort((a, b) => {
          const distA = a.distanceMiles !== undefined ? a.distanceMiles : Infinity;
          const distB = b.distanceMiles !== undefined ? b.distanceMiles : Infinity;
          return distA - distB;
        });
      } else {
        // No postcode provided — fall back to relevance order
        sorted.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
      }
      break;

    default:
      // Default to relevance
      sorted.sort((a, b) => {
        const scoreA = a.relevanceScore || 0;
        const scoreB = b.relevanceScore || 0;
        return scoreB - scoreA;
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
        const scoreA = a.relevanceScore || 0;
        const scoreB = b.relevanceScore || 0;
        return scoreB - scoreA;
      });
      break;

    case 'priceAsc':
      sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
      break;

    case 'priceDesc':
      sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
      break;

    case 'name':
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;

    case 'newest':
      sorted.sort((a, b) => {
        const tA = new Date(a.updatedAt || a.createdAt || 0);
        const tB = new Date(b.updatedAt || b.createdAt || 0);
        return tB - tA;
      });
      break;

    default:
      sorted.sort((a, b) => {
        const scoreA = a.relevanceScore || 0;
        const scoreB = b.relevanceScore || 0;
        return scoreB - scoreA;
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

  return {
    categories,
    ratings: ratingRanges,
    priceRanges,
    amenities,
  };
}

module.exports = {
  searchSuppliers,
  searchPackages,
  advancedSearch,
  normalizeSupplierQuery,
  normalizePackageQuery,
  calculateFacets,
  getPriceLevel,
  VALID_SUPPLIER_SORT_VALUES,
  VALID_PACKAGE_SORT_VALUES,
};
