'use strict';

const express = require('express');
const router = express.Router();
const {
  getPublicSupplierAvatar,
  diagnoseKnownSupplierAvatar,
} = require('../services/publicSupplierAvatar.service');

let dbUnified;
let logger;
let authRequired;

function initializeDependencies(deps = {}) {
  dbUnified = deps.dbUnified;
  logger = deps.logger || console;
  authRequired = deps.authRequired;
}

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
}

router.get('/public/suppliers/:id/avatar', async (req, res) => {
  try {
    noStore(res);
    const result = await getPublicSupplierAvatar(req.params.id, { dbUnified, logger });
    if (!result) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    return res.json(result);
  } catch (error) {
    (logger || console).error('Public supplier avatar route failed:', error);
    return res.status(500).json({ error: 'Failed to fetch supplier avatar' });
  }
});

// Admin only, on every server (a test or preview site as much as the live one). It must never fall
// back to "open" if the login check was not wired in, so a missing check refuses the request.
function adminOnly(req, res, next) {
  if (!authRequired) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  return authRequired(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  });
}

router.get('/admin/suppliers/:id/public-avatar-diagnostic', adminOnly, async (req, res) => {
  const result = await diagnoseKnownSupplierAvatar({
    supplierId: req.params.id,
    dbUnified,
    checkReachability: req.query.checkReachability === 'true',
    baseUrl: `${req.protocol}://${req.get('host')}`,
  });
  return res.json(result);
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
