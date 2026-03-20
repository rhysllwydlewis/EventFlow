/**
 * JadeAssist Catalog API
 *
 * Read-only endpoints that expose EventFlow supplier and venue data
 * for consumption by the JadeAssist chat backend.
 *
 * All endpoints are protected by an optional API key (`X-Catalog-Api-Key`)
 * driven by the `CATALOG_API_KEY` environment variable. When the env var
 * is set, every request must present the correct key; when it is unset the
 * endpoints are publicly accessible (suitable for development/staging).
 *
 * Rate limiting: uses the shared `searchLimiter` (30 req/min) which is
 * appropriate for a machine-to-machine integration.
 *
 * Routes mounted at `/api/catalog`:
 *   GET /suppliers         - paginated supplier list with filters
 *   GET /suppliers/:id     - single supplier by ID
 *   GET /venues            - paginated venue list (suppliers with category='Venues')
 *   GET /venues/:id        - single venue by ID
 *   GET /categories        - list of valid supplier categories
 */

'use strict';

const express = require('express');
const router = express.Router();
const dbUnified = require('../db-unified');
const { searchLimiter } = require('../middleware/rateLimits');
const logger = require('../utils/logger');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fields that are safe to return to external consumers. */
const SUPPLIER_PUBLIC_FIELDS = [
  'id',
  'name',
  'category',
  'description',
  'location',
  'priceRange',
  'price_display',
  'logo',
  'coverImage',
  'images',
  'amenities',
  'website',
  'bookingUrl',
  'slug',
  'isPro',
  'tags',
  'maxGuests',
  'responseTime',
  'viewCount',
];

/** Valid category values — kept in sync with models/Supplier.js. */
const VALID_CATEGORIES = [
  'Venues',
  'Catering',
  'Photography',
  'Videography',
  'Entertainment',
  'Florist',
  'Decor',
  'Transport',
  'Cake',
  'Stationery',
  'Hair & Makeup',
  'Planning',
  'Other',
];

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strips private/internal fields from a supplier document, returning only
 * the fields in SUPPLIER_PUBLIC_FIELDS.
 *
 * @param {Object} supplier - Raw supplier document from the database.
 * @returns {Object} Sanitised public representation.
 */
function toPublicSupplier(supplier) {
  const out = {};
  for (const field of SUPPLIER_PUBLIC_FIELDS) {
    if (supplier[field] !== undefined) {
      out[field] = supplier[field];
    }
  }
  return out;
}

/**
 * Parse and clamp integer query parameters.
 *
 * @param {string|undefined} value - Raw string value from req.query.
 * @param {number} defaultVal - Value to use when the param is absent or invalid.
 * @param {number} min - Minimum allowed value.
 * @param {number} max - Maximum allowed value.
 * @returns {number}
 */
function parseIntParam(value, defaultVal, min, max) {
  const n = parseInt(value, 10);
  if (isNaN(n)) {
    return defaultVal;
  }
  return Math.min(max, Math.max(min, n));
}

/**
 * Build a simple case-insensitive text filter for MongoDB queries.
 * Returns undefined when the query string is empty/absent so callers can
 * skip appending an empty filter object.
 *
 * @param {string} q - Search term from req.query.q.
 * @returns {Object|undefined}
 */
function buildTextFilter(q) {
  if (!q || typeof q !== 'string' || !q.trim()) {
    return undefined;
  }
  const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i');
  return { $or: [{ name: re }, { description: re }, { location: re }] };
}

// ─── Auth middleware ───────────────────────────────────────────────────────────

/**
 * API key middleware.
 *
 * When `CATALOG_API_KEY` env var is set, every request to the catalog API
 * must supply a matching `X-Catalog-Api-Key` header.  When the env var is
 * unset (e.g. local dev) the middleware is a no-op.
 */
function catalogApiKeyAuth(req, res, next) {
  const requiredKey = process.env.CATALOG_API_KEY;
  if (!requiredKey) {
    // Env var not configured — allow public access
    return next();
  }
  const providedKey = req.headers['x-catalog-api-key'];
  if (!providedKey || providedKey !== requiredKey) {
    return res.status(401).json({ error: 'Missing or invalid X-Catalog-Api-Key header.' });
  }
  return next();
}

// Apply auth check and rate limiter to every catalog route
router.use(catalogApiKeyAuth);
router.use(searchLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/catalog/categories
 * Returns the list of valid supplier categories.
 * Cached for 1 hour — categories rarely change.
 */
router.get('/categories', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
  res.json({ categories: VALID_CATEGORIES });
});

/**
 * GET /api/catalog/suppliers
 * Paginated list of approved, active suppliers with optional filters.
 *
 * Query params:
 *   q         {string}  Free-text search across name/description/location.
 *   category  {string}  Filter to a specific category (e.g. "Photography").
 *   location  {string}  Filter by location substring (case-insensitive).
 *   limit     {number}  Page size, 1–100, default 20.
 *   offset    {number}  Number of records to skip, default 0.
 */
router.get('/suppliers', async (req, res) => {
  try {
    const limit = parseIntParam(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parseIntParam(req.query.offset, 0, 0, 100000);

    // Base filter: only return approved, published suppliers
    const baseFilter = { approved: true, status: 'published' };

    // Category filter
    if (req.query.category) {
      const cat = String(req.query.category).trim();
      if (VALID_CATEGORIES.includes(cat)) {
        baseFilter.category = cat;
      }
    }

    // Location filter (substring match)
    if (req.query.location) {
      const loc = String(req.query.location)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (loc) {
        baseFilter.location = new RegExp(loc, 'i');
      }
    }

    // Fetch matching documents
    let suppliers = await dbUnified.find('suppliers', baseFilter);

    // Post-filter: free-text search (applied in-memory for portability)
    if (req.query.q) {
      const textFilter = buildTextFilter(String(req.query.q));
      if (textFilter) {
        const re = textFilter.$or[0].name; // shared RegExp for all fields
        suppliers = suppliers.filter(
          s => re.test(s.name || '') || re.test(s.description || '') || re.test(s.location || '')
        );
      }
    }

    const total = suppliers.length;

    // Sort: Pro suppliers first, then by name
    suppliers.sort((a, b) => {
      if (a.isPro && !b.isPro) {
        return -1;
      }
      if (!a.isPro && b.isPro) {
        return 1;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    // Pagination
    const page = suppliers.slice(offset, offset + limit).map(toPublicSupplier);

    res.setHeader('Cache-Control', 'public, max-age=60'); // 1 minute
    res.json({
      suppliers: page,
      total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('[catalog] GET /suppliers error:', error.message);
    res.status(500).json({ error: 'Failed to fetch suppliers.' });
  }
});

/**
 * GET /api/catalog/supplier/:id
 * Returns a single approved supplier by ID.
 */
router.get('/supplier/:id', async (req, res) => {
  try {
    const supplier = await dbUnified.findOne('suppliers', {
      id: req.params.id,
      approved: true,
      status: 'published',
    });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=120'); // 2 minutes
    res.json({ supplier: toPublicSupplier(supplier) });
  } catch (error) {
    logger.error('[catalog] GET /supplier/:id error:', error.message);
    res.status(500).json({ error: 'Failed to fetch supplier.' });
  }
});

/**
 * GET /api/catalog/venues
 * Paginated list of approved venues (suppliers where category === 'Venues').
 *
 * Query params:
 *   q           {string}  Free-text search.
 *   location    {string}  Location substring filter.
 *   minCapacity {number}  Minimum guest capacity (maxGuests field).
 *   maxCapacity {number}  Maximum guest capacity (maxGuests field).
 *   limit       {number}  Page size, 1–100, default 20.
 *   offset      {number}  Records to skip, default 0.
 */
router.get('/venues', async (req, res) => {
  try {
    const limit = parseIntParam(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parseIntParam(req.query.offset, 0, 0, 100000);

    // Venues are suppliers with category 'Venues'
    const baseFilter = { approved: true, status: 'published', category: 'Venues' };

    // Location filter
    if (req.query.location) {
      const loc = String(req.query.location)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (loc) {
        baseFilter.location = new RegExp(loc, 'i');
      }
    }

    let venues = await dbUnified.find('suppliers', baseFilter);

    // Free-text search (in-memory)
    if (req.query.q) {
      const textFilter = buildTextFilter(String(req.query.q));
      if (textFilter) {
        const re = textFilter.$or[0].name;
        venues = venues.filter(
          v => re.test(v.name || '') || re.test(v.description || '') || re.test(v.location || '')
        );
      }
    }

    // Capacity filters
    if (req.query.minCapacity !== undefined) {
      const minCap = parseInt(req.query.minCapacity, 10);
      if (!isNaN(minCap) && minCap > 0) {
        venues = venues.filter(v => v.maxGuests !== undefined && v.maxGuests >= minCap);
      }
    }
    if (req.query.maxCapacity !== undefined) {
      const maxCap = parseInt(req.query.maxCapacity, 10);
      if (!isNaN(maxCap) && maxCap > 0) {
        venues = venues.filter(v => v.maxGuests !== undefined && v.maxGuests <= maxCap);
      }
    }

    const total = venues.length;

    // Sort: Pro first, then by capacity (desc), then name
    venues.sort((a, b) => {
      if (a.isPro && !b.isPro) {
        return -1;
      }
      if (!a.isPro && b.isPro) {
        return 1;
      }
      const capDiff = (b.maxGuests || 0) - (a.maxGuests || 0);
      if (capDiff !== 0) {
        return capDiff;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    const page = venues.slice(offset, offset + limit).map(toPublicSupplier);

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      venues: page,
      total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('[catalog] GET /venues error:', error.message);
    res.status(500).json({ error: 'Failed to fetch venues.' });
  }
});

/**
 * GET /api/catalog/venue/:id
 * Returns a single approved venue (supplier with category 'Venues') by ID.
 */
router.get('/venue/:id', async (req, res) => {
  try {
    const venue = await dbUnified.findOne('suppliers', {
      id: req.params.id,
      approved: true,
      status: 'published',
      category: 'Venues',
    });
    if (!venue) {
      return res.status(404).json({ error: 'Venue not found.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json({ venue: toPublicSupplier(venue) });
  } catch (error) {
    logger.error('[catalog] GET /venue/:id error:', error.message);
    res.status(500).json({ error: 'Failed to fetch venue.' });
  }
});

module.exports = router;
