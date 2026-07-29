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

async function rollbackUnauditedTrustChange(supplierId, originalBadges, originalTrust) {
  try {
    const rolledBack = await dbUnified.updateOne(
      'suppliers',
      { id: supplierId },
      {
        $set: {
          badges: originalBadges,
          trustVerifications: originalTrust,
        },
      }
    );
    if (!rolledBack) {
      logger.error('CRITICAL: unaudited supplier trust rollback was not persisted', { supplierId });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('CRITICAL: failed to roll back unaudited supplier trust change', {
      supplierId,
      error: error.message,
    });
    return false;
  }
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
    const originalBadges = Array.isArray(supplier.badges) ? [...supplier.badges] : [];
    const originalTrust = normaliseTrustVerifications(supplier.trustVerifications);
    const badges = new Set(originalBadges);
    if (verified) {
      badges.add(badgeId);
    } else {
      badges.delete(badgeId);
    }

    const currentCredential = normaliseTrustVerifications(originalTrust[definition.key]);
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
      ...originalTrust,
      [definition.key]: credential,
    };
    const badgeList = Array.from(badges);

    const updated = await dbUnified.updateOne(
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
    if (!updated) {
      return res.status(500).json({ error: 'Failed to persist supplier trust verification' });
    }

    const auditEntry = await auditLog({
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

    // auditLog intentionally absorbs storage errors and returns null. A public
    // EventFlow trust claim must not survive without an attributable audit record,
    // so revert the trust mutation and fail closed when auditing is unavailable.
    if (!auditEntry) {
      const rolledBack = await rollbackUnauditedTrustChange(
        supplierId,
        originalBadges,
        originalTrust
      );
      return res.status(503).json({
        error: rolledBack
          ? 'Trust verification was not changed because the audit record could not be saved'
          : 'Trust verification audit failed and rollback could not be confirmed',
      });
    }

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
