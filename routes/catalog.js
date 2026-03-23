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
 * Caching strategy:
 *   - List responses (/suppliers, /venues) are cached server-side via
 *     `services/catalogCache.js` with a TTL of `CATALOG_CACHE_TTL_SECONDS`
 *     (default 5 minutes).
 *   - The cache is automatically invalidated by `catalogCache.invalidate()`
 *     whenever a supplier is approved, rejected, suspended, or has its
 *     profile edited.  See `routes/supplier-admin.js` and
 *     `routes/supplier-management.js`.
 *   - `Cache-Control` response headers inform downstream proxies/CDNs.
 *
 * Rate limiting: uses `apiLimiter` (100 req / 15 min) — appropriate for a
 * machine-to-machine integration that may batch multiple category/page calls.
 *
 * Routes mounted at `/api/catalog`:
 *   GET /categories        - list of valid supplier categories
 *   GET /suppliers         - paginated supplier list with filters
 *   GET /supplier/:id      - single supplier by ID
 *   GET /venues            - paginated venue list (suppliers with category='Venues')
 *   GET /venue/:id         - single venue by ID
 */

'use strict';

const express = require('express');
const router = express.Router();
const dbUnified = require('../db-unified');
const { apiLimiter } = require('../middleware/rateLimits');
const logger = require('../utils/logger');
const catalogCache = require('../services/catalogCache');

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

/** Valid category values — imported from models/Supplier.js (single source of truth). */
const { VALID_CATEGORIES } = require('../models/Supplier');

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
 * Build a case-insensitive text-search RegExp for in-memory filtering.
 * Returns `null` when `q` is absent / blank so callers can skip the filter.
 *
 * The RegExp is returned directly (not wrapped in a MongoDB query object)
 * so it can be tested against multiple fields without fragile property access.
 *
 * @param {string|undefined} q - Raw search term from req.query.q.
 * @returns {RegExp|null}
 */
function buildSearchRegex(q) {
  if (!q || typeof q !== 'string' || !q.trim()) {
    return null;
  }
  const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

/**
 * Resolve the effective subscription tier level of a supplier for sorting.
 * Prefers the canonical `subscriptionTier` / `subscription.tier` fields;
 * falls back to the legacy `isPro` boolean so older records are handled correctly.
 *
 * Tier levels: pro_plus=2, pro=1, free=0
 *
 * @param {Object} supplier - Raw supplier document.
 * @returns {number} Tier level (higher = more prominent in results).
 */
function getSupplierTierLevel(supplier) {
  const LEVELS = { free: 0, pro: 1, pro_plus: 2 };
  const tier =
    supplier.subscription?.tier || supplier.subscriptionTier || (supplier.isPro ? 'pro' : 'free');
  return LEVELS[tier] ?? 0;
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
router.use(apiLimiter);

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
 * The full approved-and-published supplier list is cached server-side.
 * Filtering, sorting, and pagination are applied in-memory after the
 * cache hit so per-query results are always accurate.
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

    // ── Serve all approved/published suppliers (cached) ───────────────────
    const CACHE_KEY = 'suppliers:all';
    let allSuppliers = await catalogCache.get(CACHE_KEY);
    if (!allSuppliers) {
      allSuppliers = await dbUnified.find('suppliers', { approved: true, status: 'published' });
      await catalogCache.set(CACHE_KEY, allSuppliers);
      logger.info('[catalog] suppliers cache miss — populated from DB');
    }

    let suppliers = allSuppliers;

    // ── Apply filters ──────────────────────────────────────────────────────

    // Category filter
    if (req.query.category) {
      const cat = String(req.query.category).trim();
      if (VALID_CATEGORIES.includes(cat)) {
        suppliers = suppliers.filter(s => s.category === cat);
      }
    }

    // Location filter (substring match)
    if (req.query.location) {
      const locRe = buildSearchRegex(String(req.query.location));
      if (locRe) {
        suppliers = suppliers.filter(s => locRe.test(s.location || ''));
      }
    }

    // Free-text search across name / description / location
    if (req.query.q) {
      const qRe = buildSearchRegex(String(req.query.q));
      if (qRe) {
        suppliers = suppliers.filter(
          s => qRe.test(s.name || '') || qRe.test(s.description || '') || qRe.test(s.location || '')
        );
      }
    }

    const total = suppliers.length;

    // ── Sort: higher-tier suppliers first, then by name ───────────────────
    const sorted = suppliers.slice().sort((a, b) => {
      const tierDiff = getSupplierTierLevel(b) - getSupplierTierLevel(a);
      if (tierDiff !== 0) {
        return tierDiff;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    // ── Pagination ─────────────────────────────────────────────────────────
    const page = sorted.slice(offset, offset + limit).map(toPublicSupplier);

    res.setHeader('Cache-Control', `public, max-age=${catalogCache.getTtl()}`);
    res.json({ suppliers: page, total, limit, offset });
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
    res.setHeader('Cache-Control', `public, max-age=${catalogCache.getTtl()}`);
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
 * The full venues list is cached server-side.  Filtering, sorting, and
 * pagination are applied in-memory after the cache hit.
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

    // ── Serve all approved/published venues (cached) ───────────────────────
    const CACHE_KEY = 'venues:all';
    let allVenues = await catalogCache.get(CACHE_KEY);
    if (!allVenues) {
      allVenues = await dbUnified.find('suppliers', {
        approved: true,
        status: 'published',
        category: 'Venues',
      });
      await catalogCache.set(CACHE_KEY, allVenues);
      logger.info('[catalog] venues cache miss — populated from DB');
    }

    let venues = allVenues;

    // ── Apply filters ──────────────────────────────────────────────────────

    // Location filter
    if (req.query.location) {
      const locRe = buildSearchRegex(String(req.query.location));
      if (locRe) {
        venues = venues.filter(v => locRe.test(v.location || ''));
      }
    }

    // Free-text search
    if (req.query.q) {
      const qRe = buildSearchRegex(String(req.query.q));
      if (qRe) {
        venues = venues.filter(
          v => qRe.test(v.name || '') || qRe.test(v.description || '') || qRe.test(v.location || '')
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

    // ── Sort: higher-tier venues first, then by capacity (desc), then name ─
    const sorted = venues.slice().sort((a, b) => {
      const tierDiff = getSupplierTierLevel(b) - getSupplierTierLevel(a);
      if (tierDiff !== 0) {
        return tierDiff;
      }
      const capDiff = (b.maxGuests || 0) - (a.maxGuests || 0);
      if (capDiff !== 0) {
        return capDiff;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    // ── Pagination ─────────────────────────────────────────────────────────
    const page = sorted.slice(offset, offset + limit).map(toPublicSupplier);

    res.setHeader('Cache-Control', `public, max-age=${catalogCache.getTtl()}`);
    res.json({ venues: page, total, limit, offset });
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
    res.setHeader('Cache-Control', `public, max-age=${catalogCache.getTtl()}`);
    res.json({ venue: toPublicSupplier(venue) });
  } catch (error) {
    logger.error('[catalog] GET /venue/:id error:', error.message);
    res.status(500).json({ error: 'Failed to fetch venue.' });
  }
});

module.exports = router;
