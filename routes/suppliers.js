/**
 * Suppliers & Packages Routes
 * Public endpoints for browsing suppliers and packages
 */

'use strict';

const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimits');
const subscriptionService = require('../services/subscriptionService');
const { canPublishPublicCalendar } = require('../utils/calendarPermissions');

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

async function resolveEffectiveSupplierTier(supplier) {
  if (!supplier?.ownerUserId) {
    return supplier?.subscriptionTier || (supplier?.isPro ? 'pro' : 'free');
  }

  const subscription = await subscriptionService.getSubscriptionByUserId(supplier.ownerUserId);
  if (subscriptionService.isLiveEntitlement(subscription)) {
    return subscription.plan;
  }

  const expiry = supplier.proExpiresAt || supplier.subscription?.endDate || null;
  if (supplier.subscriptionTier && supplier.subscriptionTier !== 'free') {
    if (!expiry || new Date(expiry) > new Date()) {
      return supplier.subscriptionTier;
    }
  }
  if (supplier.subscription?.tier && supplier.subscription.tier !== 'free') {
    if (!expiry || new Date(expiry) > new Date()) {
      return supplier.subscription.tier;
    }
  }
  if (supplier.isPro) {
    if (!expiry || new Date(expiry) > new Date()) {
      return 'pro';
    }
  }
  return 'free';
}

function applyRoleRequired(role) {
  return (req, res, next) => {
    if (!roleRequired) {
      return res.status(503).json({ error: 'Role service not initialized' });
    }
    return roleRequired(role)(req, res, next);
  };
}

function normalisePackageSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPackageLookupValues(pkg) {
  return [pkg.id, pkg.packageId, pkg.slug, pkg.title && normalisePackageSlug(pkg.title)]
    .filter(Boolean)
    .map(value => String(value));
}

// Helper function to check if package is featured
function isFeaturedPackage(pkg) {
  return pkg.featured === true || pkg.isFeatured === true;
}

/**
 * Image resolution helpers — imported from the shared utils/packageImageUtils.js
 * module so that all API endpoints use the same resolution logic as the client-side
 * package-image-resolver.js.
 */
const {
  isPlaceholderImage,
  resolvePackageImage,
  normalizeGallery,
} = require('../utils/packageImageUtils');

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
const catalogCache = require('../services/catalogCache');

function invalidatePackageCaches() {
  featuredPackagesCache = null;
  featuredPackagesCacheTime = 0;
  spotlightPackagesCache = null;
  spotlightPackagesCacheTime = 0;
  // Also clear the search-service packages cache so stale data isn't served
  catalogCache
    .invalidate()
    .catch(err =>
      require('../utils/logger').warn(
        '[invalidatePackageCaches] catalogCache.invalidate failed:',
        err.message
      )
    );
}

/**
 * GET /api/suppliers
 * List all suppliers with filtering and smart sorting
 */
router.get('/suppliers', async (req, res) => {
  try {
    const { category, q, price } = req.query;

    // Load users once and build a fast lookup set so orphaned supplier profiles
    // (whose owner account was deleted) are excluded from public results.
    const users = await dbUnified.read('users');
    const validUserIds = new Set(users.map(u => u.id).filter(Boolean));

    let items = (await dbUnified.read('suppliers')).filter(
      s => s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId))
    );
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
        const subscriptionTier = await resolveEffectiveSupplierTier(s);
        const isProActive = subscriptionTier !== 'free';
        return {
          ...s,
          featuredSupplier,
          isPro: isProActive,
          subscriptionTier,
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

    // Reject orphaned supplier profiles whose owner account no longer exists.
    // Admins can still view them for moderation; the supplier owner (logged in as themselves)
    // can also still access their profile (e.g. during an account-transition window).
    if (!isAdmin && !isOwner && sRaw.ownerUserId) {
      const ownerUser = await dbUnified.findOne('users', { id: sRaw.ownerUserId });
      if (!ownerUser) {
        return res.status(404).json({ error: 'Supplier not found' });
      }
    }

    const pkgs = await dbUnified.read('packages');
    const featuredSupplier = pkgs.some(p => p.supplierId === sRaw.id && p.featured);
    const subscriptionTier = await resolveEffectiveSupplierTier(sRaw);
    const isProActive = subscriptionTier !== 'free';

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
      subscriptionTier,
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
    const supplier = await dbUnified.findOne('suppliers', { id: req.params.id, approved: true });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    // Use find with compound index { supplierId, approved }
    const pkgs = await dbUnified.find('packages', { supplierId: supplier.id, approved: true });
    const debug = req.query.debugImages === '1';
    const items = pkgs.map(pkg => {
      const resolvedImage = resolvePackageImage(pkg);
      const resolvedGallery = normalizeGallery(pkg.gallery);
      const item = {
        ...pkg,
        image: resolvedImage,
        // rawImage is the unmodified stored value — used by _renderPackageCard as the
        // highest-priority image source (mirrors what the admin packages page reads).
        rawImage: pkg.image || null,
        // Include the pre-normalised gallery so the profile page card renderer
        // can use the same image-resolution strategy as the package detail page.
        resolvedGallery,
      };
      if (debug) {
        item._debug = {
          chosenImage: resolvedImage,
          imageFieldWasEmpty: !pkg.image,
          imageFieldWasPlaceholder: isPlaceholderImage(pkg.image),
          rawImageValue: pkg.image || '(empty)',
          rawGalleryLength: Array.isArray(pkg.gallery) ? pkg.gallery.length : 0,
          resolvedGalleryLength: resolvedGallery.length,
          resolvedGalleryFirstUrl: resolvedGallery.length > 0 ? resolvedGallery[0].url : null,
          rawImagesLength: Array.isArray(pkg.images) ? pkg.images.length : 0,
        };
      }
      return item;
    });
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
    const listRaw = await dbUnified.find('suppliers', { ownerUserId: req.user.id });
    // Fetch the user's subscription once and attach the plan name to every supplier object
    // so the client-side tier checks (s.subscriptionTier === 'pro') work correctly.
    const userSubscription = await subscriptionService.getSubscriptionByUserId(req.user.id);
    const subscriptionTier = subscriptionService.isLiveEntitlement(userSubscription)
      ? userSubscription.plan
      : null;
    const list = await Promise.all(
      listRaw.map(async s => ({
        ...s,
        isPro: await supplierIsProActive(s),
        // Fresh subscription tier takes precedence over any stale value stored on the supplier document.
        subscriptionTier: subscriptionTier || s.subscriptionTier || null,
        proExpiresAt: s.proExpiresAt || null,
        // Derived publishing right so clients don't need to duplicate the logic.
        canPublishPublicCalendar: canPublishPublicCalendar(s),
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

    // Build valid user IDs set once for orphan filtering
    const users = await dbUnified.read('users');
    const validUserIds = new Set(users.map(u => u.id).filter(Boolean));

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

      // Get supplier names for the packages — filter out orphaned suppliers
      const supplierIds = [...new Set(packages.map(p => p.supplierId))];
      const suppliers = await Promise.all(
        supplierIds.map(id => dbUnified.findOne('suppliers', { id }))
      );
      const suppliersMap = new Map(
        suppliers
          .filter(s => s && s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId)))
          .map(s => [s.id, s])
      );

      items = packages
        .filter(pkg => suppliersMap.has(pkg.supplierId))
        .map(pkg => ({
          ...pkg,
          image: resolvePackageImage(pkg),
          supplier_name: suppliersMap.get(pkg.supplierId)?.name || null,
        }));
    } else {
      // Local storage fallback
      const packages = await dbUnified.read('packages');
      const suppliers = await dbUnified.read('suppliers');

      // Create a suppliers lookup map for O(1) access; exclude orphaned suppliers
      const suppliersMap = new Map(
        suppliers
          .filter(s => s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId)))
          .map(s => [s.id, s])
      );

      items = packages
        .filter(p => p.approved && isFeaturedPackage(p) && suppliersMap.has(p.supplierId))
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

    // Build valid user IDs set once for orphan filtering
    const users = await dbUnified.read('users');
    const validUserIds = new Set(users.map(u => u.id).filter(Boolean));

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

    const allSuppliersForSpotlight = await dbUnified.read('suppliers');
    // Only include approved suppliers whose owner account still exists
    const approvedSpotlightSupplierIds = new Set(
      allSuppliersForSpotlight
        .filter(s => s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId)))
        .map(s => s.id)
    );
    approvedPackages = approvedPackages.filter(p => approvedSpotlightSupplierIds.has(p.supplierId));

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
      suppliersMap = new Map(
        suppliers
          .filter(s => s && s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId)))
          .map(s => [s.id, s])
      );
    } else {
      const suppliers = await dbUnified.read('suppliers');
      suppliersMap = new Map(
        suppliers
          .filter(s => s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId)))
          .map(s => [s.id, s])
      );
    }

    // Select up to 6 spotlight packages (filter any whose supplier is orphaned)
    const items = selectedPackages
      .filter(pkg => suppliersMap.has(pkg.supplierId))
      .map(pkg => {
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
    const publicSuppliers = await dbUnified.find('suppliers', { approved: true });
    // Also load users to exclude packages from suppliers whose owner was deleted
    const usersForPkgSearch = await dbUnified.read('users');
    const validUserIdsForPkgSearch = new Set(usersForPkgSearch.map(u => u.id).filter(Boolean));
    const publicSupplierIds = new Set(
      publicSuppliers
        .filter(s => !s.ownerUserId || validUserIdsForPkgSearch.has(s.ownerUserId))
        .map(s => s.id)
    );
    items = items.filter(p => p.approved && publicSupplierIds.has(p.supplierId));

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

    res.json({ items: items.map(pkg => ({
      ...pkg,
      image: resolvePackageImage(pkg),
      resolvedGallery: normalizeGallery(pkg.gallery),
    })) });
  } catch (error) {
    logger.error('Error searching packages:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/packages/bulk
 * Fetch multiple approved packages by ID in a single request.
 * Requires authentication so that only logged-in customers can resolve
 * packages linked to their plans.
 * Body: { ids: string[] }  — up to 50 IDs, duplicates are ignored.
 */
router.post('/packages/bulk', apiLimiter, applyAuthRequired, async (req, res) => {
  try {
    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const MAX_BULK_IDS = 50;
    if (ids.length > MAX_BULK_IDS) {
      return res.status(400).json({ error: `Bulk fetch limit is ${MAX_BULK_IDS} IDs per request` });
    }

    // Validate each ID is a non-empty string and deduplicate
    const uniqueIds = [
      ...new Set(
        ids.filter(id => typeof id === 'string' && id.trim().length > 0).map(id => id.trim())
      ),
    ];

    if (uniqueIds.length === 0) {
      return res.status(400).json({ error: 'ids must contain at least one valid string ID' });
    }

    const allPackages = await dbUnified.read('packages');
    const publicSuppliers = await dbUnified.find('suppliers', { approved: true });
    const publicSupplierIds = new Set(publicSuppliers.map(s => s.id));
    const matched = allPackages.filter(
      p => p.approved && uniqueIds.includes(p.id) && publicSupplierIds.has(p.supplierId)
    );

    res.json({ packages: matched });
  } catch (error) {
    logger.error('Error fetching bulk packages:', error);
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
    const suppliers = await dbUnified.read('suppliers');
    const users = await dbUnified.read('users');
    const validUserIds = new Set(users.map(u => u.id).filter(Boolean));
    // Only include approved suppliers whose owner account still exists
    const approvedSupplierIds = new Set(
      suppliers
        .filter(s => s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId)))
        .map(s => s.id)
    );
    const param = decodeURIComponent(req.params.slug || '').trim();
    const normalisedParam = normalisePackageSlug(param);
    const pkg = packages.find(p => {
      if (!p.approved || !approvedSupplierIds.has(p.supplierId)) {
        return false;
      }
      const lookups = getPackageLookupValues(p);
      return lookups.some(
        value => value === param || normalisePackageSlug(value) === normalisedParam
      );
    });

    if (!pkg) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const supplier = suppliers.find(
      s => s.id === pkg.supplierId && s.approved && (!s.ownerUserId || validUserIds.has(s.ownerUserId))
    );
    if (!supplier) {
      return res.status(404).json({ error: 'Package not found' });
    }

    // Get category details
    const categories = await dbUnified.read('categories');
    const packageCategories = (pkg.categories || [])
      .map(slug => categories.find(c => c.slug === slug))
      .filter(Boolean);

    const resolvedImg = resolvePackageImage(pkg);
    const resolvedGallery = normalizeGallery(pkg.gallery);

    const packageResponse = {
      ...pkg,
      image: resolvedImg,
      // Pre-normalised gallery: each entry has a guaranteed `url` field and all
      // placeholder/unresolvable items have been removed.  The client should
      // prefer this over the raw `gallery` field to avoid field-name guessing.
      resolvedGallery,
    };

    // ?debugImages=1 — include diagnostic fields in the response.
    // Off by default; intended for development / production troubleshooting only.
    if (req.query.debugImages === '1') {
      packageResponse._debug = {
        chosenImage: resolvedImg,
        imageFieldWasPlaceholder: isPlaceholderImage(pkg.image),
        rawGalleryLength: Array.isArray(pkg.gallery) ? pkg.gallery.length : 0,
        resolvedGalleryLength: resolvedGallery.length,
        resolvedGalleryFirstUrl: resolvedGallery.length > 0 ? resolvedGallery[0].url : null,
      };
    }

    res.json({
      package: packageResponse,
      supplier,
      categories: packageCategories,
    });
  } catch (error) {
    logger.error('Error reading package:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Export router and initialization function

/**
 * GET /api/me/action-prompt-checklist
 * Returns the supplier's outstanding action items using the same detection logic
 * as the action-prompt email system. Used by the Supplier Dashboard "Next Steps" card.
 * Only available to authenticated suppliers.
 */
router.get(
  '/me/action-prompt-checklist',
  apiLimiter,
  applyAuthRequired,
  applyRoleRequired('supplier'),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const [allSuppliers, allPackages, settings] = await Promise.all([
        dbUnified.read('suppliers'),
        dbUnified.read('packages'),
        dbUnified.read('settings'),
      ]);

      const supplier = allSuppliers.find(s => s.ownerUserId === userId);
      if (!supplier) {
        // No profile yet — show all items as outstanding
        return res.json({
          outstanding: [
            {
              key: 'missingPackages',
              severity: 'red',
              title: 'Create your first package',
              description:
                'Attract customers by listing your services. Suppliers with active packages receive significantly more enquiries.',
              ctaUrl: '/dashboard/supplier',
              ctaText: 'Go to Dashboard',
            },
          ],
          completed: [],
          ragStatus: 'red',
          completionPercent: 0,
        });
      }

      const { computeFullReport } = require('../services/actionPromptService');
      const report = computeFullReport(supplier, allPackages, settings || {}, req.user);

      res.json({
        outstanding: report.outstanding,
        completed: report.completed,
        ragStatus: report.ragStatus,
        completionPercent: report.completionPercent,
      });
    } catch (error) {
      logger.error('Error loading action-prompt checklist:', error);
      res.status(500).json({ error: 'Failed to load checklist' });
    }
  }
);

/**
 * GET /api/v1/admin/suppliers/:id/package-image-audit
 * Admin-only diagnostic: shows exact image fields for every package belonging to a supplier.
 * Useful for troubleshooting "images not showing on profile page" reports without needing
 * direct DB access.
 *
 * Response per package:
 *   id, title, image (resolved), imageRaw (stored), gallery.length, images.length,
 *   resolvedGallery.length, firstGalleryUrl, isPlaceholder
 */
router.get(
  '/admin/suppliers/:id/package-image-audit',
  applyAuthRequired,
  applyRoleRequired('admin'),
  async (req, res) => {
    try {
      const pkgs = await dbUnified.find('packages', { supplierId: req.params.id });
      const audit = pkgs.map(pkg => {
        const resolvedImage = resolvePackageImage(pkg);
        const resolvedGallery = normalizeGallery(pkg.gallery);
        return {
          id: pkg.id,
          title: pkg.title || pkg.name,
          approved: pkg.approved,
          // Resolved image (what the API returns as `image` field)
          image: resolvedImage,
          isPlaceholder: isPlaceholderImage(resolvedImage),
          // Raw stored fields
          imageRaw: pkg.image || null,
          imageRawIsEmpty: !pkg.image,
          galleryLength: Array.isArray(pkg.gallery) ? pkg.gallery.length : 0,
          imagesLength: Array.isArray(pkg.images) ? pkg.images.length : 0,
          // Resolved gallery (what the API returns as `resolvedGallery`)
          resolvedGalleryLength: resolvedGallery.length,
          firstGalleryUrl: resolvedGallery.length > 0 ? resolvedGallery[0].url : null,
          // First raw gallery item for format inspection
          firstRawGalleryItem: Array.isArray(pkg.gallery) && pkg.gallery.length > 0
            ? pkg.gallery[0]
            : null,
        };
      });
      res.json({
        supplierId: req.params.id,
        packageCount: audit.length,
        packagesWithImages: audit.filter(p => !p.isPlaceholder).length,
        packages: audit,
      });
    } catch (err) {
      logger.error('Package image audit error:', err);
      res.status(500).json({
        error: 'Audit failed',
        ...(process.env.NODE_ENV !== 'production' && { details: err.message }),
      });
    }
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
module.exports.invalidatePackageCaches = invalidatePackageCaches;
