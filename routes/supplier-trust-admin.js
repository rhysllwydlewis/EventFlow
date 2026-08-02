'use strict';

const express = require('express');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { writeLimiter } = require('../middleware/rateLimits');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const catalogCache = require('../services/catalogCache');
const logger = require('../utils/logger');

const router = express.Router();
const MAX_WRITE_ATTEMPTS = 3;

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

const normaliseTrustVerifications = value => {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function buildBadgeUpdate(badgeId, shouldContainBadge) {
  return shouldContainBadge ? { $addToSet: { badges: badgeId } } : { $pull: { badges: badgeId } };
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function rollbackUnauditedTrustChange({
  supplierId,
  badgeId,
  trustKey,
  originalHadBadge,
  originalCredential,
  originalCredentialExisted,
  markerField,
  markerValue,
}) {
  try {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const rollbackAt = new Date().toISOString();
      const update = {
        ...buildBadgeUpdate(badgeId, originalHadBadge),
        $set: { updatedAt: rollbackAt },
      };

      if (originalCredentialExisted) {
        update.$set[`trustVerifications.${trustKey}`] = originalCredential;
      } else {
        update.$unset = { [`trustVerifications.${trustKey}`]: '' };
      }

      const rolledBack = await dbUnified.updateOne(
        'suppliers',
        {
          id: supplierId,
          [`trustVerifications.${trustKey}.${markerField}`]: markerValue,
        },
        update
      );
      if (rolledBack) {
        return true;
      }

      const latest = await dbUnified.findOne('suppliers', { id: supplierId });
      if (!latest) {
        logger.error('CRITICAL: supplier disappeared before unaudited trust rollback', {
          supplierId,
        });
        return false;
      }

      const latestTrust = normaliseTrustVerifications(latest.trustVerifications);
      const latestCredential = normaliseTrustVerifications(latestTrust[trustKey]);
      if (latestCredential[markerField] !== markerValue) {
        logger.error(
          'CRITICAL: unaudited supplier trust rollback was superseded by a newer change',
          { supplierId, trustKey }
        );
        return false;
      }

      logger.warn('Unaudited supplier trust rollback did not persist; retrying', {
        supplierId,
        trustKey,
        attempt,
      });
    }

    logger.error('CRITICAL: unaudited supplier trust rollback exhausted retries', {
      supplierId,
      trustKey,
    });
    return false;
  } catch (error) {
    logger.error('CRITICAL: failed to roll back unaudited supplier trust change', {
      supplierId,
      trustKey,
      error: error.message,
    });
    return false;
  }
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function buildTrustMutation(supplier, definition, badgeId, verified, now, actorId) {
  const originalBadges = Array.isArray(supplier.badges) ? supplier.badges : [];
  const originalTrust = normaliseTrustVerifications(supplier.trustVerifications);
  const originalCredentialExisted = Object.prototype.hasOwnProperty.call(
    originalTrust,
    definition.key
  );
  const originalCredential = originalCredentialExisted
    ? { ...normaliseTrustVerifications(originalTrust[definition.key]) }
    : undefined;
  const currentCredential = normaliseTrustVerifications(originalTrust[definition.key]);
  const credential = verified
    ? {
        ...currentCredential,
        verified: true,
        verifiedAt: now,
        verifiedBy: actorId,
        revokedAt: null,
        revokedBy: null,
      }
    : {
        ...currentCredential,
        verified: false,
        revokedAt: now,
        revokedBy: actorId,
      };

  return {
    credential,
    originalHadBadge: originalBadges.includes(badgeId),
    originalCredential,
    originalCredentialExisted,
  };
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function persistTrustMutation(supplierId, definition, badgeId, verified, actorId) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const supplier = await dbUnified.findOne('suppliers', { id: supplierId });
    if (!supplier) {
      return { status: 'missing' };
    }

    const now = new Date().toISOString();
    const mutation = buildTrustMutation(supplier, definition, badgeId, verified, now, actorId);
    const update = {
      ...buildBadgeUpdate(badgeId, verified),
      $set: {
        [`trustVerifications.${definition.key}`]: mutation.credential,
        updatedAt: now,
      },
    };
    const updated = await dbUnified.updateOne('suppliers', { id: supplierId }, update);

    if (updated) {
      const persisted = await dbUnified.findOne('suppliers', { id: supplierId });
      return {
        status: 'updated',
        now,
        badgeList: Array.isArray(persisted?.badges) ? persisted.badges : [],
        trustVerifications: normaliseTrustVerifications(persisted?.trustVerifications),
        ...mutation,
      };
    }

    logger.warn('Supplier trust mutation did not persist; retrying', {
      supplierId,
      trustKey: definition.key,
      attempt,
    });
  }

  return { status: 'retry_exhausted' };
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function mutateTrustBadge(req, res, verified) {
  try {
    const { supplierId, badgeId } = req.params;
    const definition = TRUST_BADGES[badgeId];
    if (!definition) {
      return res.status(400).json({ error: 'Unsupported trust badge' });
    }

    const mutation = await persistTrustMutation(
      supplierId,
      definition,
      badgeId,
      verified,
      req.user.id
    );
    if (mutation.status === 'missing') {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    if (mutation.status !== 'updated') {
      return res.status(503).json({
        error: 'Supplier trust state could not be saved. Please refresh and try again.',
      });
    }

    const auditEntry = await auditLog({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action: verified
        ? AUDIT_ACTIONS.SUPPLIER_TRUST_BADGE_CONFIRMED
        : AUDIT_ACTIONS.SUPPLIER_TRUST_BADGE_REMOVED,
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

    if (!auditEntry) {
      const rolledBack = await rollbackUnauditedTrustChange({
        supplierId,
        badgeId,
        trustKey: definition.key,
        originalHadBadge: mutation.originalHadBadge,
        originalCredential: mutation.originalCredential,
        originalCredentialExisted: mutation.originalCredentialExisted,
        markerField: verified ? 'verifiedAt' : 'revokedAt',
        markerValue: mutation.now,
      });
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
        badges: mutation.badgeList,
        trustVerifications: mutation.trustVerifications,
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
