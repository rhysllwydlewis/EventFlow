'use strict';

const express = require('express');
const router = express.Router();
const { resolvePackageImage } = require('../utils/packageImageUtils');
const { safePublicPackage, safePublicSupplier } = require('../utils/supplierPublicProfile');

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

    // Resolve the owner user's avatar so the public profile shows the correct
    // profile photo even when the supplier record has no direct logo/photo.
    // Walk all known owner-link field names to support legacy supplier records.
    let ownerAvatarUrl = '';
    const ownerUserId =
      supplier.ownerUserId ||
      supplier.userId ||
      supplier.ownerId ||
      supplier.accountId ||
      supplier.createdByUserId ||
      supplier.createdBy ||
      supplier.createdById;
    if (ownerUserId) {
      try {
        const ownerUser = await dbUnified.findOne('users', { id: ownerUserId });
        if (ownerUser) {
          ownerAvatarUrl =
            ownerUser.avatarUrl ||
            ownerUser.profilePhotoUrl ||
            ownerUser.displayAvatarUrl ||
            ownerUser.photoUrl ||
            ownerUser.profileImage ||
            ownerUser.image ||
            (ownerUser.profile && (ownerUser.profile.avatarUrl || ownerUser.profile.photoUrl)) ||
            '';
        }
      } catch (ownerErr) {
        // Non-fatal — fall back to supplier's own photo fields
        logger.warn('supplier-profile-safe: owner avatar lookup failed for', supplier.id, ownerErr.message);
      }
    }

    return res.json(
      safePublicSupplier(supplier, {
        badgeDetails: await badgeDetailsFor(supplier),
        featuredSupplier,
        isPreview: preview,
        isPro,
        ownerAvatarUrl,
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
