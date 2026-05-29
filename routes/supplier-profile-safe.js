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
  return req.query.preview === 'true' || /[?&]preview=true(?:&|$)/.test(String(req.get('referer') || ''));
}

function canRead(req, supplier) {
  if (!supplier) return false;
  if (supplier.approved) return true;
  const user = currentUser(req);
  return Boolean(user && (user.role === 'admin' || user.id === supplier.ownerUserId));
}

async function badgeDetailsFor(supplier) {
  if (!Array.isArray(supplier.badges) || supplier.badges.length === 0) return [];
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
    if (!dbUnified) return next();
    const supplier = (await dbUnified.read('suppliers')).find(item => item.id === req.params.id);
    if (!canRead(req, supplier)) return res.status(404).json({ error: 'Supplier not found' });

    const packages = await dbUnified.read('packages');
    const featuredSupplier = packages.some(pkg => pkg.supplierId === supplier.id && pkg.featured);
    const isPro = supplierIsProActive ? await supplierIsProActive(supplier) : Boolean(supplier.isPro);
    const preview = previewMode(req);

    return res.json(
      safePublicSupplier(supplier, {
        badgeDetails: await badgeDetailsFor(supplier),
        featuredSupplier,
        isPreview: preview,
        isPro,
      })
    );
  } catch (error) {
    logger.error('Supplier profile safe route failed:', error);
    return res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

router.get('/suppliers/:id/packages', async (req, res, next) => {
  try {
    if (!dbUnified) return next();
    const supplier = (await dbUnified.read('suppliers')).find(item => item.id === req.params.id);
    if (!canRead(req, supplier)) return res.status(404).json({ error: 'Supplier not found' });

    const preview = previewMode(req);
    const items = (await dbUnified.read('packages'))
      .filter(pkg => pkg.supplierId === supplier.id && (preview || pkg.approved))
      .map(pkg => safePublicPackage(pkg, resolvePackageImage));

    return res.json({ items });
  } catch (error) {
    logger.error('Supplier package safe route failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
