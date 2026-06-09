'use strict';

const express = require('express');
const router = express.Router();
const {
  ENDPOINT_META,
  getSupplierProfilePackageCards,
} = require('../services/supplierProfilePackageCards');

let dbUnified;
let getUserFromCookie;
let logger;

function initializeDependencies(deps = {}) {
  dbUnified = deps.dbUnified;
  getUserFromCookie = deps.getUserFromCookie;
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

function canReadSupplier(req, supplier) {
  if (!supplier) {
    return false;
  }
  if (supplier.approved === true) {
    return true;
  }
  return previewMode(req) && canPreview(req, supplier);
}

router.get('/supplier-profile/:supplierId/package-cards', async (req, res) => {
  try {
    if (!dbUnified) {
      return res
        .status(503)
        .json({ error: 'Supplier profile package cards service not initialized' });
    }

    const supplier = await dbUnified.findOne('suppliers', { id: req.params.supplierId });
    if (!canReadSupplier(req, supplier)) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const debug = req.query.debugImages === '1';
    const includeUnapproved = previewMode(req) && canPreview(req, supplier);
    const payload = await getSupplierProfilePackageCards(req.params.supplierId, {
      db: dbUnified,
      debug,
      includeUnapproved,
    });

    res.set('X-EventFlow-Supplier-Packages-Renderer', 'v2');
    res.set('X-EventFlow-Supplier-Packages-Endpoint', ENDPOINT_META);
    return res.json(payload);
  } catch (error) {
    logger.error('Supplier profile package cards v2 route failed:', error);
    return res.status(500).json({ error: 'Failed to fetch supplier package cards' });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
