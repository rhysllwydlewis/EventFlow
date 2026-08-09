'use strict';

const express = require('express');
const router = express.Router();
const { resolvePackageImage } = require('../utils/packageImageUtils');
const { safePublicPackage, safePublicSupplier } = require('../utils/supplierPublicProfile');
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
  if (supplier.approved) {
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

router.get('/suppliers/:id', async (req, res, next) => {
  try {
    if (!dbUnified) {
      return next();
    }
    const supplier = await dbUnified.findOne('suppliers', { id: req.params.id });
    // No supplier carries this id, so this router has nothing to say about the
    // request — hand it on rather than answering 404. This router is mounted
    // ahead of routes/suppliers.js, so answering here made every sibling path
    // under /api/suppliers unreachable: `/api/suppliers/showcase` was read as
    // an id lookup and 404'd before it could match its own route. A supplier
    // that exists but may not be read still 404s below; only unmatched ids
    // fall through, and the last router to see them answers 404 the same way.
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
    const publicSupplier = hydrateSupplierProfilePhoto(supplier, ownerUser);
    const profilePhotoUrl = publicSupplier.profilePhotoUrl;

    return res.json(
      safePublicSupplier(publicSupplier, {
        badgeDetails: await badgeDetailsFor(supplier),
        exposeMessagingRecipient: true,
        exposeOwnerUserId: isOwner,
        featuredSupplier,
        isOwner,
        isPreview: preview,
        isPro,
        profilePhotoUrl,
      })
    );
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
    // No supplier carries this id, so this router has nothing to say about the
    // request — hand it on rather than answering 404. This router is mounted
    // ahead of routes/suppliers.js, so answering here made every sibling path
    // under /api/suppliers unreachable: `/api/suppliers/showcase` was read as
    // an id lookup and 404'd before it could match its own route. A supplier
    // that exists but may not be read still 404s below; only unmatched ids
    // fall through, and the last router to see them answers 404 the same way.
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
