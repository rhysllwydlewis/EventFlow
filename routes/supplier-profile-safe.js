'use strict';

const express = require('express');
const router = express.Router();
const { resolvePackageImage } = require('../utils/packageImageUtils');
const { safePublicPackage, safePublicSupplier } = require('../utils/supplierPublicProfile');
const {
  findOwnerUserForSupplier,
  resolveSupplierProfilePhoto,
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
    if (!canRead(req, supplier)) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const packages = await dbUnified.read('packages');
    const featuredSupplier = packages.some(pkg => pkg.supplierId === supplier.id && pkg.featured);
    const isPro = supplierIsProActive
      ? await supplierIsProActive(supplier)
      : Boolean(supplier.isPro);
    const preview = previewMode(req) && canPreview(req, supplier);

    // Resolve the owner user's avatar using targeted findOne lookups rather
    // than loading every user into memory. Walk all known link-field names so
    // legacy supplier records without ownerUserId are still covered.
    let ownerUser = null;
    const ownerUserId =
      supplier.ownerUserId ||
      supplier.userId       ||
      supplier.ownerId      ||
      supplier.accountId    ||
      supplier.createdByUserId ||
      supplier.createdBy    ||
      supplier.createdById;

    if (ownerUserId) {
      try {
        ownerUser = await dbUnified.findOne('users', { id: String(ownerUserId).trim() });
      } catch (err) {
        logger.warn('supplier-profile-safe: id-based owner lookup failed for', supplier.id, err.message);
      }
    }

    // Email-based fallback: covers suppliers that pre-date the ownerUserId field
    if (!ownerUser) {
      const ownerEmail = supplier.ownerEmail || supplier.contactEmail || supplier.email;
      if (ownerEmail) {
        try {
          ownerUser = await dbUnified.findOne('users', {
            email: String(ownerEmail).trim().toLowerCase(),
          });
        } catch (err) {
          logger.warn('supplier-profile-safe: email-based owner lookup failed for', supplier.id, err.message);
        }
      }
    }

    const profilePhotoUrl = resolveSupplierProfilePhoto(supplier, ownerUser);
    const publicSupplier = {
      ...supplier,
      profilePhotoUrl,
      avatarUrl: profilePhotoUrl,
      displayAvatarUrl: profilePhotoUrl,
    };

    return res.json(
      safePublicSupplier(publicSupplier, {
        badgeDetails: await badgeDetailsFor(supplier),
        featuredSupplier,
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
