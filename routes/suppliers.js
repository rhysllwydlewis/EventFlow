/**
 * Suppliers & Packages Routes
 * Public endpoints for browsing suppliers and packages
 */

'use strict';

const express = require('express');
const { PLACEHOLDER_PACKAGE_IMAGE } = require('../utils/constants');
const router = express.Router();

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let roleRequired;
let supplierAnalytics;
let getUserFromCookie;
let supplierIsProActive;
let logger;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Suppliers routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = [
    'dbUnified',
    'authRequired',
    'roleRequired',
    'supplierAnalytics',
    'getUserFromCookie',
    'supplierIsProActive',
    'logger',
  ];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Suppliers routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  roleRequired = deps.roleRequired;
  supplierAnalytics = deps.supplierAnalytics;
  getUserFromCookie = deps.getUserFromCookie;
  supplierIsProActive = deps.supplierIsProActive;
  logger = deps.logger;
}

/**
 * Deferred middleware wrappers
 * These are safe to reference in route definitions at require() time
 * because they defer the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

// Helper function to check if package is featured
function isFeaturedPackage(pkg) {
  return pkg.featured === true || pkg.isFeatured === true;
}

// Helper function to resolve the best available image for a package
function resolvePackageImage(pkg) {
  const placeholder = PLACEHOLDER_PACKAGE_IMAGE;
  // If the main image is set and isn't the placeholder, use it
  if (pkg.image && pkg.image !== placeholder) {
    return pkg.image;
  }
  // Fall back to the first gallery image
  if (Array.isArray(pkg.gallery) && pkg.gallery.length > 0) {
    for (const img of pkg.gallery) {
      const url =
        typeof img === 'string'
          ? img
          : img.url || img.src || img.path || img.image || img.originalUrl || img.thumbnail;
      if (url && url !== placeholder) {
        return url;
      }
    }
  }
  // Return the canonical placeholder instead of null to prevent mismatched fallbacks
  return pkg.image || placeholder;
}

// Cache for featured packages
let featuredPackagesCache = null;
let featuredPackagesCacheTime = 0;
const FEATURED_PACKAGES_CACHE_TTL = 60000; // 1 minute

// Cache for spotlight packages
let spotlightPackagesCache = null;
let spotlightPackagesCacheTime = 0;
const SPOTLIGHT_PACKAGES_CACHE_TTL = 3600000; // 1 hour (they rotate hourly anyway)

/**
 * Invalidate the featured and spotlight package caches.
 * Call this after any package photo upload so the next carousel request
 * reflects the newly-uploaded image instead of serving stale placeholder data.
 */
function invalidatePackageCaches() {
  featuredPackagesCache = null;
  featuredPackagesCacheTime = 0;
  spotlightPackagesCache = null;
  spotlightPackagesCacheTime = 0;
}

/**
 * GET /api/suppliers
 * List all suppliers with filtering and smart sorting
 */
router.get('/suppliers', async (req, res) => {
  try {
    const { category, q, price } = req.query;
    let items = (await dbUnified.read('suppliers')).filter(s => s.approved);
    if (category) {
      items = items.filter(s => s.category === category);
    }
    if (price) {
      items = items.filter(s => (s.price_display || '').includes(price));
    }
    if (q) {
      const qq = String(q).toLowerCase();
      items = items.filter(
        s =>
          (s.name || '').toLowerCase().includes(qq) ||
          (s.description_short || '').toLowerCase().includes(qq) ||
          (s.location || '').toLowerCase().includes(qq)
      );
    }

    // Mark suppliers that have at least one featured package and compute active Pro flag
    const pkgs = await dbUnified.read('packages');
    const itemsWithMeta = await Promise.all(
      items.map(async s => {
        const featuredSupplier = pkgs.some(p => p.supplierId === s.id && p.featured);
        const isProActive = await supplierIsProActive(s);
        return {
          ...s,
          featuredSupplier,
          isPro: isProActive,
          proExpiresAt: s.proExpiresAt || null,
        };
      })
    );

    // If smart scores are available, sort by them while giving Pro suppliers a gentle boost.
    items = itemsWithMeta
      .map((s, index) => ({ ...s, _idx: index }))
      .sort((a, b) => {
        const sa = typeof a.aiScore === 'number' ? a.aiScore : 0;
        const sb = typeof b.aiScore === 'number' ? b.aiScore : 0;
        const aProBoost = a.isPro ? 10 : 0;
        const bProBoost = b.isPro ? 10 : 0;
        const ea = sa + aProBoost;
        const eb = sb + bProBoost;
        if (ea === eb) {
          return a._idx - b._idx;
        }
        return eb - ea;
      })
      .map(s => {
        const copy = { ...s };
        delete copy._idx;
        delete copy.email;
        return copy;
      });

    res.json({ items });
  } catch (error) {
    logger.error('Error listing suppliers:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/suppliers/:id
 * Get supplier details by ID
 */
router.get('/suppliers/:id', async (req, res) => {
  try {
    const suppliers = await dbUnified.read('suppliers');
    const sRaw = suppliers.find(x => x.id === req.params.id);

    if (!sRaw) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Check approval status - only show approved suppliers to non-admins
    const user = getUserFromCookie(req);
    const isAdmin = user && user.role === 'admin';
    const isOwner = user && sRaw.ownerUserId === user.id;

    if (!sRaw.approved && !isAdmin && !isOwner) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const pkgs = await dbUnified.read('packages');
    const featuredSupplier = pkgs.some(p => p.supplierId === sRaw.id && p.featured);
    const isProActive = await supplierIsProActive(sRaw);

    // Enrich badges array: look up full badge definitions for each badge ID
    let badgeDetails = [];
    if (Array.isArray(sRaw.badges) && sRaw.badges.length > 0) {
      try {
        const allBadges = await dbUnified.read('badges');
        // Also include in-memory BADGE_DEFINITIONS as fallback so it works before DB seeding
        const { BADGE_DEFINITIONS } = require('../utils/badgeManagement');
        const fallbackDefs = Object.values(BADGE_DEFINITIONS);
        badgeDetails = sRaw.badges
          .map(badgeId => {
            const fromDb = allBadges.find(b => b.id === badgeId);
            if (fromDb) {
              return fromDb;
            }
            return fallbackDefs.find(b => b.id === badgeId) || null;
          })
          .filter(Boolean)
          .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99));
      } catch (badgeErr) {
        logger.warn('Failed to enrich badge details:', badgeErr.message);
      }
    }

    const s = {
      ...sRaw,
      featuredSupplier,
      isPro: isProActive,
      proExpiresAt: sRaw.proExpiresAt || null,
      badgeDetails,
    };
    // Strip sensitive fields from public response (admins/owners get data via authenticated routes)
    delete s.email;

    // Track profile view (unless preview mode)
    const isPreview = req.query.preview === 'true';
    const userId = req.user ? req.user.id : null;
    const sessionId = req.session ? req.session.id : null;

    supplierAnalytics
      .trackProfileView(req.params.id, userId, sessionId, isPreview)
      .catch(err => logger.error('Failed to track profile view:', err));

    res.json(s);
  } catch (error) {
    logger.error('Error fetching supplier:', error);
    res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

/**
 * GET /api/suppliers/:id/packages
 * Get packages for a specific supplier
 */
router.get('/suppliers/:id/packages', async (req, res) => {
  try {
    const supplier = (await dbUnified.read('suppliers')).find(
      x => x.id === req.params.id && x.approved
    );
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    const pkgs = (await dbUnified.read('packages')).filter(
      p => p.supplierId === supplier.id && p.approved
    );
    const items = pkgs.map(pkg => ({
      ...pkg,
      image: resolvePackageImage(pkg),
    }));
    res.json({ items });
  } catch (error) {
    logger.error('Error reading supplier packages:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/me/suppliers
 * Get current user's suppliers (supplier role only)
 */
router.get('/me/suppliers', applyAuthRequired, applyRoleRequired('supplier'), async (req, res) => {
  try {
    const listRaw = (await dbUnified.read('suppliers')).filter(s => s.ownerUserId === req.user.id);
    const list = await Promise.all(
      listRaw.map(async s => ({
        ...s,
        isPro: await supplierIsProActive(s),
        proExpiresAt: s.proExpiresAt || null,
      }))
    );
    res.json({ items: list });
  } catch (error) {
    logger.error('Error reading user suppliers:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/packages/featured
 * Get featured packages with caching
 */
router.get('/packages/featured', async (_req, res) => {
  try {
    const now = Date.now();

    // Return cached data if still valid
    if (featuredPackagesCache && now - featuredPackagesCacheTime < FEATURED_PACKAGES_CACHE_TTL) {
      return res.json(featuredPackagesCache);
    }

    // Use efficient querying for MongoDB
    const dbType = dbUnified.getDatabaseType();
    let items;

    if (dbType === 'mongodb') {
      // For MongoDB, try to use findWithOptions for efficient query
      // Get featured packages with approved=true and featured=true
      const packages = await dbUnified.findWithOptions(
        'packages',
        {
          approved: true,
          $or: [{ featured: true }, { isFeatured: true }],
        },
        { limit: 6, sort: { createdAt: -1 } }
      );

      // Get supplier names for the packages
      const supplierIds = [...new Set(packages.map(p => p.supplierId))];
      const suppliers = await Promise.all(
        supplierIds.map(id => dbUnified.findOne('suppliers', { id }))
      );
      const suppliersMap = new Map(suppliers.filter(Boolean).map(s => [s.id, s]));

      items = packages.map(pkg => ({
        ...pkg,
        image: resolvePackageImage(pkg),
        supplier_name: suppliersMap.get(pkg.supplierId)?.name || null,
      }));
    } else {
      // Local storage fallback
      const packages = await dbUnified.read('packages');
      const suppliers = await dbUnified.read('suppliers');

      // Create a suppliers lookup map for O(1) access
      const suppliersMap = new Map(suppliers.map(s => [s.id, s]));

      items = packages
        .filter(p => p.approved && isFeaturedPackage(p))
        .slice(0, 6)
        .map(pkg => {
          const supplier = suppliersMap.get(pkg.supplierId);
          return {
            ...pkg,
            image: resolvePackageImage(pkg),
            supplier_name: supplier ? supplier.name : null,
          };
        });
    }

    const result = { items };
    featuredPackagesCache = result;
    featuredPackagesCacheTime = now;

    res.json(result);
  } catch (error) {
    logger.error('Error fetching featured packages:', error);
    res.status(500).json({ items: [] });
  }
});

/**
 * GET /api/packages/spotlight
 * Get rotating spotlight packages (changes hourly)
 */
router.get('/packages/spotlight', async (_req, res) => {
  try {
    const now = Date.now();

    // Use current hour as cache key
    const currentHour = Math.floor(now / SPOTLIGHT_PACKAGES_CACHE_TTL);
    const cacheHour = Math.floor(spotlightPackagesCacheTime / SPOTLIGHT_PACKAGES_CACHE_TTL);

    // Return cached data if still valid for current hour
    if (spotlightPackagesCache && currentHour === cacheHour) {
      return res.json(spotlightPackagesCache);
    }

    // Get approved packages
    const dbType = dbUnified.getDatabaseType();
    let approvedPackages;

    if (dbType === 'mongodb') {
      // For MongoDB, use findWithOptions to get only approved packages
      approvedPackages = await dbUnified.findWithOptions(
        'packages',
        { approved: true },
        { limit: 100 } // Get up to 100 to have a good pool for rotation
      );
    } else {
      // Local storage fallback
      const packages = await dbUnified.read('packages');
      approvedPackages = packages.filter(p => p.approved);
    }

    // Use current hour as seed for consistent selection within the hour
    // Encode date as integer: YYYYMMDD * 24 + HH (e.g., 20260116 * 24 + 14 = 486147854)
    // This ensures same packages are shown for the entire hour
    const dateNow = new Date();
    const hourSeed =
      dateNow.getUTCFullYear() * 10000 + // Year component (e.g., 2026 * 10000)
      (dateNow.getUTCMonth() + 1) * 100 + // Month component (1-12)
      dateNow.getUTCDate() * 24 + // Day * 24 (to account for hours)
      dateNow.getUTCHours(); // Hour (0-23)

    // Shuffle packages using the hour seed for deterministic randomness
    // Using a Linear Congruential Generator (LCG) for seeded random number generation
    // These constants are from Numerical Recipes (widely used LCG parameters)
    // They provide good statistical properties: full period, minimal correlation, uniform distribution
    const LCG_MULTIPLIER = 9301; // Multiplier 'a' - ensures good mixing
    const LCG_INCREMENT = 49297; // Increment 'c' - helps avoid zero cycles
    const LCG_MODULUS = 233280; // Modulus 'm' - determines the period

    const shuffled = [...approvedPackages];
    let seed = hourSeed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Generate next pseudo-random number using LCG formula
      seed = (seed * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
      const j = Math.floor((seed / LCG_MODULUS) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Get supplier names for the selected packages
    const selectedPackages = shuffled.slice(0, 6);
    const supplierIds = [...new Set(selectedPackages.map(p => p.supplierId))];

    let suppliersMap;
    if (dbType === 'mongodb') {
      const suppliers = await Promise.all(
        supplierIds.map(id => dbUnified.findOne('suppliers', { id }))
      );
      suppliersMap = new Map(suppliers.filter(Boolean).map(s => [s.id, s]));
    } else {
      const suppliers = await dbUnified.read('suppliers');
      suppliersMap = new Map(suppliers.map(s => [s.id, s]));
    }

    // Select up to 6 spotlight packages
    const items = selectedPackages.map(pkg => {
      const supplier = suppliersMap.get(pkg.supplierId);
      return {
        ...pkg,
        image: resolvePackageImage(pkg),
        supplier_name: supplier ? supplier.name : null,
      };
    });

    const result = { items };
    spotlightPackagesCache = result;
    spotlightPackagesCacheTime = now;

    res.json(result);
  } catch (error) {
    logger.error('Error fetching spotlight packages:', error);
    res.status(500).json({ items: [] });
  }
});

/**
 * GET /api/packages/search
 * Search packages with filters
 */
router.get('/packages/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase();
    const category = String(req.query.category || '').toLowerCase();
    const eventType = String(req.query.eventType || '').toLowerCase();
    const approved = req.query.approved === 'true';

    let items = await dbUnified.read('packages');

    // Apply filters
    items = items.filter(p => {
      // Approval filter
      if (approved && !p.approved) {
        return false;
      }

      // Text search
      if (
        q &&
        !(
          (p.title || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        )
      ) {
        return false;
      }

      // Category filter
      if (category && p.primaryCategoryKey !== category) {
        return false;
      }

      // Event type filter
      if (eventType && p.eventTypes && !p.eventTypes.includes(eventType)) {
        return false;
      }

      return true;
    });

    res.json({ items: items.map(pkg => ({ ...pkg, image: resolvePackageImage(pkg) })) });
  } catch (error) {
    logger.error('Error searching packages:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/packages/:slug
 * Get package details by slug
 */
router.get('/packages/:slug', async (req, res) => {
  try {
    const packages = await dbUnified.read('packages');
    const param = req.params.slug;
    const pkg = packages.find(p => (p.slug === param || p.id === param) && p.approved);

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Get supplier details
    const suppliers = await dbUnified.read('suppliers');
    const supplier = suppliers.find(s => s.id === pkg.supplierId && s.approved);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Get category details
    const categories = await dbUnified.read('categories');
    const packageCategories = (pkg.categories || [])
      .map(slug => categories.find(c => c.slug === slug))
      .filter(Boolean);

    res.json({
      package: { ...pkg, image: resolvePackageImage(pkg) },
      supplier,
      categories: packageCategories,
    });
  } catch (error) {
    logger.error('Error reading package:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Export router and initialization function
module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
module.exports.invalidatePackageCaches = invalidatePackageCaches;
