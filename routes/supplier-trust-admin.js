'use strict';

const express = require('express');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { auditLog } = require('../middleware/audit');
const catalogCache = require('../services/catalogCache');
const logger = require('../utils/logger');

const router = express.Router();

const TRUST_BADGES = Object.freeze({
  'public-liability-verified': {
    key: 'publicLiability',
    label: 'Public Liability Insurance',
  },
  'dbs-checked': {
    key: 'dbs',
    label: 'DBS Check',
  },
  'licence-verified': {
    key: 'licence',
    label: 'Relevant Licence',
  },
});

function normaliseTrustVerifications(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function mutateTrustBadge(req, res, verified) {
  try {
    const { supplierId, badgeId } = req.params;
    const definition = TRUST_BADGES[badgeId];
    if (!definition) {
      return res.status(400).json({ error: 'Unsupported trust badge' });
    }

    const supplier = await dbUnified.findOne('suppliers', { id: supplierId });
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const now = new Date().toISOString();
    const badges = new Set(Array.isArray(supplier.badges) ? supplier.badges : []);
    if (verified) {
      badges.add(badgeId);
    } else {
      badges.delete(badgeId);
    }

    const currentTrust = normaliseTrustVerifications(supplier.trustVerifications);
    const currentCredential = normaliseTrustVerifications(currentTrust[definition.key]);
    const credential = verified
      ? {
          ...currentCredential,
          verified: true,
          verifiedAt: now,
          verifiedBy: req.user.id,
          revokedAt: null,
          revokedBy: null,
        }
      : {
          ...currentCredential,
          verified: false,
          revokedAt: now,
          revokedBy: req.user.id,
        };

    const trustVerifications = {
      ...currentTrust,
      [definition.key]: credential,
    };
    const badgeList = Array.from(badges);

    await dbUnified.updateOne(
      'suppliers',
      { id: supplierId },
      {
        $set: {
          badges: badgeList,
          trustVerifications,
          updatedAt: now,
        },
      }
    );

    await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: verified ? 'supplier_trust_badge_confirmed' : 'supplier_trust_badge_removed',
      targetType: 'supplier',
      targetId: supplierId,
      details: {
        badgeId,
        trustKey: definition.key,
        label: definition.label,
        verified,
      },
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent: req.get('user-agent') || null,
    });

    catalogCache
      .invalidate()
      .catch(error => logger.warn('[catalogCache] trust badge invalidate error:', error.message));

    return res.json({
      ok: true,
      supplier: {
        id: supplierId,
        badges: badgeList,
        trustVerifications,
      },
    });
  } catch (error) {
    logger.error('Error updating supplier trust badge', {
      supplierId: req.params.supplierId,
      badgeId: req.params.badgeId,
      verified,
      error: error.message,
    });
    return res.status(500).json({ error: 'Failed to update supplier trust verification' });
  }
}

router.post(
  '/suppliers/:supplierId/trust-badges/:badgeId',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  writeLimiter,
  (req, res) => mutateTrustBadge(req, res, true)
);

router.delete(
  '/suppliers/:supplierId/trust-badges/:badgeId',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  writeLimiter,
  (req, res) => mutateTrustBadge(req, res, false)
);

module.exports = router;
module.exports.TRUST_BADGES = TRUST_BADGES;
