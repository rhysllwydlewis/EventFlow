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
    const result = await getPublicSupplierAvatar(req.params.id, { dbUnified });
    if (!result) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    return res.json(result);
  } catch (error) {
    (logger || console).error('Public supplier avatar route failed:', error);
    return res.status(500).json({ error: 'Failed to fetch supplier avatar' });
  }
});

router.get(
  '/admin/suppliers/:id/public-avatar-diagnostic',
  (req, res, next) => {
    if (process.env.NODE_ENV !== 'production' && !authRequired) {
      return next();
    }
    const mw = authRequired || ((_req, _res, done) => done());
    return mw(req, res, next);
  },
  async (req, res) => {
    if (process.env.NODE_ENV === 'production' && (!req.user || req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'Not found' });
    }
    const result = await diagnoseKnownSupplierAvatar({
      supplierId: req.params.id,
      dbUnified,
      checkReachability: req.query.checkReachability === 'true',
      baseUrl: `${req.protocol}://${req.get('host')}`,
    });
    return res.json(result);
  }
);

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
