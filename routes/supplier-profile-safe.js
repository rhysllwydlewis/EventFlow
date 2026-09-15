'use strict';

const express = require('express');
const router = express.Router();
const { csrfProtection } = require('../middleware/csrf');
const { verifySupplierBotHmac } = require('../middleware/supplierBotHmac');
const {
  createUnclaimedSupplierFromBot,
  isManagedUnclaimedSupplier,
} = require('../services/supplierBotIngestion.service');
const catalogCache = require('../services/catalogCache');
const {
  collisionSignals,
  createSupplierBotClaimRequest,
} = require('../services/supplierBotClaim.service');
const {
  PILOT_SCOPE,
  PUBLIC_UNCLAIMED_SCOPE,
  isPublishedUnclaimedSupplierBotProfile,
  isSupplierBotPilotProfile,
  publishedUnclaimedPresentationSupplier,
} = require('../services/supplierBotPilotVisibility.util');
const {
  ensurePublishedUnclaimedMarketplaceState,
  reconcilePublishedUnclaimedMarketplaceState,
} = require('../services/supplierBotMarketplaceParity.service');
const { lifecycleBlockReason } = require('../services/seoRecordLifecycle.util');
const { isPlaceholderImage, resolvePackageImage } = require('../utils/packageImageUtils');
const {
  safePhone,
  safePublicPackage,
  safePublicSupplier,
} = require('../utils/supplierPublicProfile');
const { addPublicProfilePath } = require('../utils/publicSupplierProfilePath');
const { supplierSlugToken } = require('../services/publicSupplierSeo.service');
const {
  findOwnerUserForSupplierFromDb,
  hydrateSupplierProfilePhoto,
} = require('../utils/supplierProfilePhoto');

let dbUnified;
let getUserFromCookie;
let supplierIsProActive;
let logger;

function initializeDependencies(deps = {}) {
  dbUnified = deps.dbUnified;
  getUserFromCookie = deps.getUserFromCookie;
  supplierIsProActive = deps.supplierIsProActive;
  logger = deps.logger || console;

  // Backfill previously-published Supplier Bot profiles (including the original
  // Hensol pilot) into the same marketplace state used by new publications.
  // The reconciliation is idempotent and supplier-agnostic: it also materialises
  // provenance-backed source packages as ordinary EventFlow package records.
  if (dbUnified && typeof dbUnified.read === 'function') {
    reconcilePublishedUnclaimedMarketplaceState({ dbUnified, logger }).catch(error => {
      logger.error('Published Supplier Bot marketplace reconciliation failed:', error);
    });
  }
}

function currentUser(req) {
  try {
    return getUserFromCookie ? getUserFromCookie(req) : null;
  } catch (_err) {
    return null;
  }
}

function previewMode(req) {
  return (
    req.query.preview === 'true' || /[?&]preview=true(?:&|$)/.test(String(req.get('referer') || ''))
  );
}

function canPreview(req, supplier) {
  const user = currentUser(req);
  return Boolean(user && supplier && (user.role === 'admin' || user.id === supplier.ownerUserId));
}

function canRead(req, supplier) {
  if (!supplier) {
    return false;
  }
  if (isPublishedUnclaimedSupplierBotProfile(supplier)) {
    return true;
  }
  if (supplier.approved === true && lifecycleBlockReason(supplier) === null) {
    return true;
  }
  return canPreview(req, supplier);
}

async function badgeDetailsFor(supplier) {
  if (!Array.isArray(supplier.badges) || supplier.badges.length === 0) {
    return [];
  }
  try {
    const stored = await dbUnified.read('badges');
    const { BADGE_DEFINITIONS } = require('../utils/badgeManagement');
    const fallback = Object.values(BADGE_DEFINITIONS || {});
    return supplier.badges
      .map(id => stored.find(b => b.id === id) || fallback.find(b => b.id === id) || null)
      .filter(Boolean)
      .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99));
  } catch (error) {
    logger.warn('Badge enrichment failed:', error.message);
    return [];
  }
}

async function assertSupplierBotPublicationScope(payload) {
  const requestedScope = payload && payload.publicationScope;
  if (requestedScope === undefined || requestedScope === null || requestedScope === '') {
    return;
  }
  if (![PILOT_SCOPE, PUBLIC_UNCLAIMED_SCOPE].includes(requestedScope)) {
    const error = new Error('publicationScope is unsupported');
    error.code = 'SUPPLIER_BOT_INVALID_PUBLICATION_SCOPE';
    throw error;
  }
  if (requestedScope !== PILOT_SCOPE) {
    return;
  }

  const candidateId = typeof payload.candidateId === 'string' ? payload.candidateId : '';
  const suppliers = await dbUnified.read('suppliers');
  const existingPilot = suppliers.find(supplier => isSupplierBotPilotProfile(supplier));
  if (existingPilot && existingPilot.acquisition?.candidateId !== candidateId) {
    const error = new Error('The one-profile Supplier Bot pilot is already in use');
    error.code = 'SUPPLIER_BOT_PILOT_LIMIT';
    error.supplierId = existingPilot.id;
    throw error;
  }
}

async function applySupplierBotPublicationScope(result, payload) {
  const requestedScope = payload && payload.publicationScope;
  if (![PILOT_SCOPE, PUBLIC_UNCLAIMED_SCOPE].includes(requestedScope)) {
    return result.supplier;
  }

  // Once a bot-managed profile is explicitly published, keep its established
  // scope stable. This prevents the legacy pilot reconciler and the generic
  // live worker from flipping a profile back and forth between scope labels.
  const existingScope = result.supplier?.acquisition?.publicationScope;
  if ([PILOT_SCOPE, PUBLIC_UNCLAIMED_SCOPE].includes(existingScope)) {
    return result.supplier;
  }

  const now = new Date().toISOString();
  const acquisition = {
    ...(result.supplier.acquisition || {}),
    publicationScope: requestedScope,
    publishedUnclaimedAt: result.supplier.acquisition?.publishedUnclaimedAt || now,
    ...(requestedScope === PILOT_SCOPE
      ? { pilotPublishedAt: result.supplier.acquisition?.pilotPublishedAt || now }
      : {}),
  };
  const wrote = await dbUnified.updateOne(
    'suppliers',
    { id: result.supplier.id },
    { $set: { acquisition, updatedAt: now } }
  );
  if (!wrote) {
    throw new Error('Failed to mark published Supplier Bot profile');
  }
  return { ...result.supplier, acquisition, updatedAt: now };
}

// Supplier Bot ingestion pins the public URL to the persisted slug (set once
// at creation) rather than the shared name-derived builder, so repeat
// crawls that refresh the business name in place don't churn the canonical
// unclaimed profile URL. The trailing id token still lets the normal
// name-based canonical route resolve and redirect this URL if it drifts.
function stableSupplierBotProfilePath(supplier) {
  if (!supplier?.id || !supplier?.slug) {
    return null;
  }
  const token = supplierSlugToken(supplier.id);
  return token ? `/supplier/${supplier.slug}--${token}` : null;
}

router.post('/internal/supplier-bot/suppliers', verifySupplierBotHmac, async (req, res) => {
  try {
    if (!dbUnified) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    await assertSupplierBotPublicationScope(req.body);
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: req.body });
    const scopedSupplier = await applySupplierBotPublicationScope(result, req.body);
    const marketplace = await ensurePublishedUnclaimedMarketplaceState({
      dbUnified,
      supplier: scopedSupplier,
    });
    const supplier = marketplace.supplier;
    const publicProfilePath = isPublishedUnclaimedSupplierBotProfile(supplier)
      ? stableSupplierBotProfilePath(supplier)
      : null;
    return res.status(result.created ? 201 : 200).json({
      supplierId: supplier.id,
      slug: supplier.slug,
      publicProfilePath,
      status: supplier.status,
      ownershipStatus: supplier.ownershipStatus,
      publicationScope: supplier.acquisition?.publicationScope || null,
      created: result.created,
      idempotent: result.idempotent,
      refreshed: Boolean(result.refreshed),
    });
  } catch (error) {
    if (
      error &&
      (error.code === 'SUPPLIER_WEBSITE_CONFLICT' ||
        error.code === 'SUPPLIER_BOT_PILOT_LIMIT' ||
        error.code === 'SUPPLIER_BOT_OWNERSHIP_CONFLICT')
    ) {
      return res.status(409).json({
        error: error.message,
        existingSupplierId: error.supplierId || null,
      });
    }
    if (error?.code === 'SUPPLIER_BOT_INVALID_PUBLICATION_SCOPE') {
      return res.status(400).json({ error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Invalid Supplier Bot payload';
    const validationMessage = /required|unsupported|must be|must use|must contain|website/i.test(
      message
    );
    if (validationMessage) {
      return res.status(400).json({ error: message });
    }
    logger.error('Supplier Bot ingestion failed:', error);
    return res.status(500).json({ error: 'Supplier Bot ingestion failed' });
  }
});

// Reverses the effect of the ingestion route above for one supplier, for the
// rare case where a published unclaimed profile turns out not to belong on
// the marketplace at all (wrong region, wrong category, a directory page
// mistaken for a business) rather than merely having fixable data problems a
// recrawl-and-refresh would correct. Deliberately restricted to records the
// bot itself still owns (isManagedUnclaimedSupplier) so this can never touch
// a claimed supplier or one that predates the bot, however this endpoint is
// called. approved:false mirrors the exact field the admin reject/delete
// routes and search-v2.js's own listing filters already treat as "not
// visible"; clearing acquisition.publicationScope additionally turns off
// isPublishedUnclaimedSupplierBotProfile()'s own gate (supplier-profile-safe
// GET /suppliers/:id and the marketplace-parity sync both key off it), so
// the profile disappears from both paths rather than just one of them.
router.post(
  '/internal/supplier-bot/suppliers/:id/unpublish',
  verifySupplierBotHmac,
  async (req, res) => {
    try {
      if (!dbUnified) {
        return res.status(503).json({ error: 'Database unavailable' });
      }
      const supplier = await dbUnified.findOne('suppliers', { id: req.params.id });
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }
      if (!isManagedUnclaimedSupplier(supplier)) {
        return res.status(409).json({ error: 'Supplier is not a bot-managed unclaimed profile' });
      }

      const reason =
        typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || null : null;
      const now = new Date().toISOString();
      const acquisition = {
        ...(supplier.acquisition && typeof supplier.acquisition === 'object'
          ? supplier.acquisition
          : {}),
        publicationScope: null,
        unpublishedAt: now,
        unpublishedReason: reason,
      };
      const wrote = await dbUnified.updateOne(
        'suppliers',
        { id: supplier.id },
        { $set: { approved: false, acquisition, updatedAt: now } }
      );
      if (!wrote) {
        return res.status(500).json({ error: 'Failed to unpublish supplier' });
      }
      if (catalogCache && typeof catalogCache.invalidate === 'function') {
        await catalogCache.invalidate().catch(() => undefined);
      }
      return res.json({ success: true, supplierId: supplier.id });
    } catch (error) {
      logger.error('Supplier Bot unpublish failed:', error);
      return res.status(500).json({ error: 'Supplier Bot unpublish failed' });
    }
  }
);

function hostnameOf(website) {
  const hostname = new URL(String(website)).hostname;
  return hostname.toLowerCase().replace(/^www\./, '');
}

// Read-only existence check, called by the bot at discovery time -- before
// it spends any crawl or AI budget on a newly-found website -- so it can
// skip a business that already has a real EventFlow supplier record,
// regardless of how that record got there (this bot's own past publish, a
// different campaign run, or someone signing up directly through the site;
// this bot never sees direct signups any other way). Deliberately returns
// only a boolean: enough for the bot to decide whether to proceed, nothing
// that identifies or describes the matched supplier.
//
// Matches by hostname, not canonicalWebsite()'s full path-sensitive
// comparison used by the ingestion route's own conflict check above: at
// discovery time the bot only has a bare domain from search results, not
// yet a specific page, and every other duplicate-prevention check this bot
// already has (published_suppliers, discovery.service.ts) is domain-keyed
// too -- matching this endpoint to that existing, coarser granularity is
// the intended behaviour, not an oversight. The ingestion route's stricter
// full-URL conflict check remains the authoritative backstop at actual
// publish time regardless.
router.post('/internal/supplier-bot/suppliers/lookup', verifySupplierBotHmac, async (req, res) => {
  try {
    if (!dbUnified) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    const rawDomain = typeof req.body?.domain === 'string' ? req.body.domain.trim() : '';
    if (!rawDomain || /[\s/]/.test(rawDomain) || rawDomain.includes('://')) {
      return res.status(400).json({ error: 'domain must be a bare hostname, e.g. "example.com"' });
    }
    let domain;
    try {
      domain = hostnameOf(`https://${rawDomain}`);
    } catch (_error) {
      return res.status(400).json({ error: 'domain must be a bare hostname, e.g. "example.com"' });
    }
    if (!domain.includes('.')) {
      return res.status(400).json({ error: 'domain must be a bare hostname, e.g. "example.com"' });
    }
    const suppliers = await dbUnified.read('suppliers');
    const exists = suppliers.some(item => {
      if (!item.website) {
        return false;
      }
      try {
        return hostnameOf(item.website) === domain;
      } catch (_error) {
        return false;
      }
    });
    return res.json({ exists });
  } catch (error) {
    logger.error('Supplier Bot lookup failed:', error);
    return res.status(500).json({ error: 'Supplier Bot lookup failed' });
  }
});

const MAX_AUDIT_QUEUE_LIMIT = 50;
const DEFAULT_AUDIT_QUEUE_LIMIT = 20;
const MAX_AUDIT_EXCLUDE_IDS = 500;
const AUDIT_GAP_COUNT = 7; // keep in sync with the gap fields set in supplierQualityGaps()

// Scores one published unclaimed profile's real data gaps -- missing cover/
// gallery photos, thin contact/description/tag data, and packages whose
// image resolves to the public placeholder -- against the same fields the
// public profile and package cards actually render, so a gap reported here
// is a gap a visitor would actually see, not a false positive off stale
// acquisition bookkeeping. Resolves cover/gallery/package-fallback the same
// way the public routes do (publishedUnclaimedPresentationSupplier), rather
// than reading acquisition.sourceMedia directly, so a canonical/admin-
// corrected field takes precedence exactly like it does for a real visitor.
function supplierQualityGaps(supplier, packages) {
  const presentation = publishedUnclaimedPresentationSupplier(supplier);
  const hasCoverImage = Boolean(presentation.coverImage || presentation.bannerUrl);
  // presentation.photosGallery and presentation.images each independently
  // fall back to acquisition.sourceMedia.images only when their own
  // same-named canonical field is empty -- so a profile with real photos in
  // one canonical field but not the other (e.g. images set, photosGallery
  // never populated) can have one of these resolve non-empty while the
  // other resolves to sourceMedia's own (possibly empty) list. Neither
  // field is reliably a superset of the other, so take whichever is larger
  // rather than treating photosGallery as authoritative.
  const galleryCount = Math.max(
    Array.isArray(presentation.photosGallery) ? presentation.photosGallery.length : 0,
    Array.isArray(presentation.images) ? presentation.images.length : 0
  );
  const description = String(supplier?.description || '').trim();

  // Packages retired by marketplace-parity reconciliation (approved:false)
  // are excluded from public package-card queries, so they must be excluded
  // here too -- otherwise a retired package with no photo can permanently
  // keep an otherwise-complete supplier in this queue.
  const materializedPackages = packages.filter(pkg => pkg && pkg.approved !== false);
  const packagesMissingPhotos =
    materializedPackages.length > 0
      ? materializedPackages
          .filter(pkg => isPlaceholderImage(resolvePackageImage(pkg)))
          .map(pkg => ({ id: pkg.id, title: pkg.title || null }))
      : // No materialised package record yet (pending the startup
        // reconciliation/backfill) -- the public package-cards route falls
        // back to rendering acquisition.sourcePackages evidence cards
        // directly, and that fallback never carries an image field, so
        // every one of them is a real missing-photo gap a visitor sees
        // today, not an absence of packages.
        (Array.isArray(presentation.topPackages) ? presentation.topPackages : []).map(pkg => ({
          id: pkg.id,
          title: pkg.title || pkg.name || null,
        }));

  const gaps = {
    missingCoverImage: !hasCoverImage,
    missingGalleryImages: galleryCount === 0,
    missingDescription: description.length < 20,
    missingPhone: !safePhone(supplier?.phone),
    missingEmail: !String(supplier?.email || '').trim(),
    missingTags: !Array.isArray(supplier?.tags) || supplier.tags.length === 0,
    packagesMissingPhotos,
  };

  const gapCount =
    Number(gaps.missingCoverImage) +
    Number(gaps.missingGalleryImages) +
    Number(gaps.missingDescription) +
    Number(gaps.missingPhone) +
    Number(gaps.missingEmail) +
    Number(gaps.missingTags) +
    (packagesMissingPhotos.length > 0 ? 1 : 0);
  const completenessScore = Math.round(((AUDIT_GAP_COUNT - gapCount) / AUDIT_GAP_COUNT) * 100);

  return { gaps, completenessScore };
}

// Read-only feed for the Unclaimed Profile Quality routine: a capped,
// worst-first batch of published unclaimed Supplier Bot profiles together
// with their real data-quality gaps, so that routine can decide what to
// re-crawl and fix without re-deriving completeness rules itself from raw
// supplier/package records. Never writes anything -- fixes still go back
// through the existing idempotent POST /internal/supplier-bot/suppliers
// refresh path above.
router.post(
  '/internal/supplier-bot/suppliers/audit-queue',
  verifySupplierBotHmac,
  async (req, res) => {
    try {
      if (!dbUnified) {
        return res.status(503).json({ error: 'Database unavailable' });
      }
      const rawLimit = Number(req.body?.limit);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), MAX_AUDIT_QUEUE_LIMIT)
          : DEFAULT_AUDIT_QUEUE_LIMIT;

      // Lets a caller that already attempted (and couldn't improve) a
      // profile's worst offenders exclude them this call, so a persistently
      // unfixable gap can't monopolise every worst-first batch forever and
      // starve the rest of the queue of ever being seen.
      const excludeSupplierIds = new Set(
        (Array.isArray(req.body?.excludeSupplierIds) ? req.body.excludeSupplierIds : [])
          .slice(0, MAX_AUDIT_EXCLUDE_IDS)
          .map(id => String(id))
      );

      const [suppliers, allPackages] = await Promise.all([
        dbUnified.read('suppliers'),
        dbUnified.read('packages'),
      ]);
      const published = (suppliers || []).filter(
        supplier =>
          isPublishedUnclaimedSupplierBotProfile(supplier) &&
          !excludeSupplierIds.has(String(supplier.id))
      );

      const packagesBySupplier = new Map();
      for (const pkg of allPackages || []) {
        if (!pkg || pkg.acquisition?.source !== 'supplier_bot') {
          continue;
        }
        const supplierKey = pkg.supplierId || pkg.supplier_id;
        if (!supplierKey) {
          continue;
        }
        const key = String(supplierKey);
        if (!packagesBySupplier.has(key)) {
          packagesBySupplier.set(key, []);
        }
        packagesBySupplier.get(key).push(pkg);
      }

      const audited = published.map(supplier => {
        const packages = packagesBySupplier.get(String(supplier.id)) || [];
        const { gaps, completenessScore } = supplierQualityGaps(supplier, packages);
        return {
          supplierId: supplier.id,
          candidateId: supplier.acquisition?.candidateId || null,
          website: supplier.website,
          slug: supplier.slug,
          name: supplier.name,
          publicationScope: supplier.acquisition?.publicationScope || null,
          publishedUnclaimedAt: supplier.acquisition?.publishedUnclaimedAt || null,
          completenessScore,
          gaps,
        };
      });

      const needsWork = audited.filter(item => item.completenessScore < 100);
      const queue = needsWork
        .slice()
        .sort((a, b) => a.completenessScore - b.completenessScore)
        .slice(0, limit);

      return res.json({
        totalPublished: published.length,
        totalNeedingWork: needsWork.length,
        queue,
      });
    } catch (error) {
      logger.error('Supplier Bot audit-queue failed:', error);
      return res.status(500).json({ error: 'Supplier Bot audit-queue failed' });
    }
  }
);

router.post('/supplier-bot/claims/:supplierId', csrfProtection, async (req, res) => {
  try {
    if (!dbUnified) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    const sessionUser = currentUser(req);
    if (!sessionUser?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await dbUnified.findOne('users', { id: sessionUser.id });
    if (!user || user.role !== 'supplier') {
      return res
        .status(403)
        .json({ error: 'A supplier account is required to claim this profile' });
    }
    if (user.verified !== true) {
      return res.status(403).json({
        error: 'Verify your email address before requesting a supplier profile claim',
        code: 'EMAIL_VERIFICATION_REQUIRED',
      });
    }

    const supplier = await dbUnified.findOne('suppliers', { id: req.params.supplierId });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const result = await createSupplierBotClaimRequest({
      dbUnified,
      supplier,
      user,
      signals: collisionSignals(user, supplier),
      source: 'profile_claim',
    });
    return res.status(result.created ? 202 : 200).json({
      claimId: result.claim.id,
      supplierId: result.claim.supplierId,
      status: result.claim.status,
      created: result.created,
      idempotent: result.idempotent,
    });
  } catch (error) {
    if (error?.code === 'SUPPLIER_BOT_NOT_CLAIMABLE') {
      return res.status(409).json({ error: error.message });
    }
    if (error?.code === 'SUPPLIER_BOT_CLAIM_ACCOUNT_REQUIRED') {
      return res.status(403).json({ error: error.message });
    }
    logger.error('Supplier Bot claim request failed:', error);
    return res.status(500).json({ error: 'Failed to request supplier profile claim' });
  }
});

router.get('/suppliers/:id', async (req, res, next) => {
  try {
    if (!dbUnified) {
      return next();
    }
    const supplier = await dbUnified.findOne('suppliers', { id: req.params.id });
    if (!supplier) {
      return next();
    }
    if (!canRead(req, supplier)) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const user = currentUser(req);
    const isOwner = Boolean(user && supplier.ownerUserId && user.id === supplier.ownerUserId);
    const packages = await dbUnified.read('packages');
    const featuredSupplier = packages.some(pkg => pkg.supplierId === supplier.id && pkg.featured);
    const isPro = supplierIsProActive
      ? await supplierIsProActive(supplier)
      : Boolean(supplier.isPro);
    const preview = previewMode(req) && canPreview(req, supplier);

    const ownerUser = await findOwnerUserForSupplierFromDb(supplier, dbUnified, logger);
    const presentationSupplier = publishedUnclaimedPresentationSupplier(supplier);
    const publicSupplier = hydrateSupplierProfilePhoto(presentationSupplier, ownerUser);
    const profilePhotoUrl = publicSupplier.profilePhotoUrl;
    const safeSupplier = safePublicSupplier(publicSupplier, {
      badgeDetails: await badgeDetailsFor(supplier),
      exposeMessagingRecipient: true,
      exposeOwnerUserId: isOwner,
      featuredSupplier,
      isOwner,
      isPreview: preview,
      isPro,
      profilePhotoUrl,
    });

    if (isPublishedUnclaimedSupplierBotProfile(supplier)) {
      safeSupplier.ownershipStatus = 'unclaimed';
      safeSupplier.isUnclaimed = true;
      safeSupplier.isSupplierBotProfile = true;
      safeSupplier.isSupplierBotPilot = isSupplierBotPilotProfile(supplier);
    }

    return res.json(addPublicProfilePath(safeSupplier));
  } catch (error) {
    logger.error('Supplier profile safe route failed:', error);
    return res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

router.get('/suppliers/:id/packages', async (req, res, next) => {
  try {
    if (!dbUnified) {
      return next();
    }
    const supplier = await dbUnified.findOne('suppliers', { id: req.params.id });
    if (!supplier) {
      return next();
    }
    if (!canRead(req, supplier)) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const includeUnpublished = previewMode(req) && canPreview(req, supplier);
    const items = (await dbUnified.read('packages'))
      .filter(pkg => pkg.supplierId === supplier.id && (includeUnpublished || pkg.approved))
      .map(pkg => safePublicPackage(pkg, resolvePackageImage));

    return res.json({ items });
  } catch (error) {
    logger.error('Supplier package safe route failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
