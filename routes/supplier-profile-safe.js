'use strict';

const express = require('express');
const router = express.Router();
const { csrfProtection } = require('../middleware/csrf');
const { verifySupplierBotHmac } = require('../middleware/supplierBotHmac');
const { createUnclaimedSupplierFromBot } = require('../services/supplierBotIngestion.service');
const {
  collisionSignals,
  createSupplierBotClaimRequest,
} = require('../services/supplierBotClaim.service');
const {
  PILOT_SCOPE,
  isSupplierBotPilotProfile,
  pilotPresentationSupplier,
} = require('../services/supplierBotPilotVisibility.util');
const { lifecycleBlockReason } = require('../services/seoRecordLifecycle.util');
const { resolvePackageImage } = require('../utils/packageImageUtils');
const { safePublicPackage, safePublicSupplier } = require('../utils/supplierPublicProfile');
const { addPublicProfilePath } = require('../utils/publicSupplierProfilePath');
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
  if (isSupplierBotPilotProfile(supplier)) {
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

async function assertPilotPublicationSlot(payload) {
  const requestedScope = payload && payload.publicationScope;
  if (requestedScope === undefined || requestedScope === null || requestedScope === '') {
    return;
  }
  if (requestedScope !== PILOT_SCOPE) {
    const error = new Error('publicationScope is unsupported');
    error.code = 'SUPPLIER_BOT_INVALID_PILOT_SCOPE';
    throw error;
  }

  const candidateId = typeof payload.candidateId === 'string' ? payload.candidateId : '';
  const suppliers = await dbUnified.read('suppliers');
  const existingPilot = suppliers.find(supplier => isSupplierBotPilotProfile(supplier));
  if (
    existingPilot &&
    existingPilot.acquisition?.candidateId !== candidateId
  ) {
    const error = new Error('The one-profile Supplier Bot pilot is already in use');
    error.code = 'SUPPLIER_BOT_PILOT_LIMIT';
    error.supplierId = existingPilot.id;
    throw error;
  }
}

async function applyPilotPublicationScope(result, payload) {
  const requestedScope = payload && payload.publicationScope;
  if (requestedScope !== PILOT_SCOPE) {
    return result.supplier;
  }
  if (isSupplierBotPilotProfile(result.supplier)) {
    return result.supplier;
  }

  const now = new Date().toISOString();
  const acquisition = {
    ...(result.supplier.acquisition || {}),
    publicationScope: PILOT_SCOPE,
    pilotPublishedAt: now,
  };
  const wrote = await dbUnified.updateOne(
    'suppliers',
    { id: result.supplier.id },
    { $set: { acquisition, updatedAt: now } }
  );
  if (!wrote) {
    throw new Error('Failed to mark Supplier Bot pilot profile');
  }
  return { ...result.supplier, acquisition, updatedAt: now };
}

router.post('/internal/supplier-bot/suppliers', verifySupplierBotHmac, async (req, res) => {
  try {
    if (!dbUnified) {
      return res.status(503).json({ error: 'Database unavailable' });
    }
    await assertPilotPublicationSlot(req.body);
    const result = await createUnclaimedSupplierFromBot({ dbUnified, payload: req.body });
    const supplier = await applyPilotPublicationScope(result, req.body);
    return res.status(result.created ? 201 : 200).json({
      supplierId: supplier.id,
      slug: supplier.slug,
      status: supplier.status,
      ownershipStatus: supplier.ownershipStatus,
      publicationScope: supplier.acquisition?.publicationScope || null,
      created: result.created,
      idempotent: result.idempotent,
    });
  } catch (error) {
    if (
      error &&
      (error.code === 'SUPPLIER_WEBSITE_CONFLICT' || error.code === 'SUPPLIER_BOT_PILOT_LIMIT')
    ) {
      return res.status(409).json({
        error: error.message,
        existingSupplierId: error.supplierId || null,
      });
    }
    if (error?.code === 'SUPPLIER_BOT_INVALID_PILOT_SCOPE') {
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

// Creates a claim request only. This endpoint never transfers ownership. The
// proof methods and final handover are deliberately left to the validated
// claim lifecycle so a logged-in user cannot take over a business by merely
// knowing its profile id or website.
router.post('/supplier-bot/claims/:supplierId', csrfProtection, async (req, res) => {
  try {
    if (!dbUnified) return res.status(503).json({ error: 'Database unavailable' });
    const sessionUser = currentUser(req);
    if (!sessionUser?.id) return res.status(401).json({ error: 'Authentication required' });

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
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

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
    const presentationSupplier = pilotPresentationSupplier(supplier);
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

    if (isSupplierBotPilotProfile(supplier)) {
      safeSupplier.ownershipStatus = 'unclaimed';
      safeSupplier.isUnclaimed = true;
      safeSupplier.isSupplierBotPilot = true;
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
