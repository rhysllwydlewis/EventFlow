'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const { VERIFICATION_STATES } = require('../utils/supplierVerificationStateMachine');
const {
  collisionSignals,
  createSupplierBotClaimRequest,
  findSupplierBotCollision,
  isUnclaimedBotSupplier,
} = require('./supplierBotClaim.service');

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function emailLocalPart(email) {
  const raw = typeof email === 'string' ? email.trim() : '';
  const local = raw.split('@')[0];
  return local || 'Supplier';
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function readSettingsFeatures() {
  try {
    const settings = await dbUnified.read('settings');
    if (Array.isArray(settings)) {
      const settingsDoc =
        settings.find(s => s && typeof s === 'object' && s.features) || settings[0];
      return settingsDoc?.features || {};
    }
    return settings?.features || {};
  } catch (error) {
    logger.warn('Could not read settings for supplier provisioning policy:', error.message);
    return {};
  }
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function supplierApprovalDefaults(nowIso) {
  const features = await readSettingsFeatures();
  if (features.autoApproveSupplierVerification === true) {
    return {
      approved: true,
      approvedAt: nowIso,
      approvedBy: 'system',
      verified: true,
      verificationStatus: VERIFICATION_STATES.APPROVED,
    };
  }

  return {
    approved: false,
    approvedAt: null,
    approvedBy: null,
    verified: false,
    verificationStatus: VERIFICATION_STATES.UNVERIFIED,
    submittedAt: null,
    verificationSubmittedAt: null,
  };
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function recordAutomaticApprovalAudit(supplier) {
  if (!supplier || supplier.approved !== true || supplier.approvedBy !== 'system') {
    return;
  }

  try {
    const auditEntry = await auditLog({
      adminId: 'system',
      adminEmail: 'system',
      action: AUDIT_ACTIONS.SUPPLIER_APPROVED,
      targetType: 'supplier',
      targetId: supplier.id,
      details: {
        name: supplier.name,
        source: 'autoApproveSupplierVerification',
        ownerUserId: supplier.ownerUserId,
      },
    });
    if (!auditEntry) {
      // Auto-provisioning deliberately remains available during a temporary audit
      // outage, but make the missing provenance visible instead of silently treating
      // auditLog's null result as success.
      logger.warn('Automatically provisioned supplier was approved but audit persistence failed', {
        supplierId: supplier.id,
      });
    }
  } catch (error) {
    // Provisioning must not fail just because the audit store is temporarily unavailable.
    logger.warn('Failed to record automatically provisioned supplier approval audit event', {
      supplierId: supplier.id,
      error: error.message,
    });
  }
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function isDuplicateLikeError(error) {
  return Boolean(
    error &&
    (error.code === 11000 ||
      error.name === 'MongoServerError' ||
      /duplicate|E11000/i.test(error.message || ''))
  );
}

// A profile suspended by an account-type conversion (as opposed to an admin
// verification-workflow suspension) carries this marker so re-converting
// customer -> supplier reactivates it instead of leaving it dangling.
// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
function isConversionSuspension(supplier) {
  return (
    supplier &&
    supplier.status === 'suspended' &&
    typeof supplier.suspendedReason === 'string' &&
    supplier.suspendedReason.endsWith('converted_to_customer')
  );
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function reactivateConversionSuspendedProfile(supplier) {
  const nowIso = new Date().toISOString();
  // Route back through pending_review rather than restoring `approved: true`
  // silently — a previously-approved business gets a fresh look before going
  // live again, consistent with "changed profile -> re-review" elsewhere.
  const updates = {
    status: 'draft',
    verificationStatus: VERIFICATION_STATES.PENDING_REVIEW,
    approved: false,
    verified: false,
    reactivatedAt: nowIso,
    updatedAt: nowIso,
  };

  const reactivated = await dbUnified.updateOne(
    'suppliers',
    { id: supplier.id },
    { $set: updates, $unset: { suspendedAt: '', suspendedBy: '', suspendedReason: '' } }
  );
  if (!reactivated) {
    // dbUnified.updateOne normalises write failures to false. Without this
    // check, the findOne below would silently return the still-suspended
    // profile and the caller (convertToSupplier) would report success while
    // the listing stays suspended — with no way to retry since the user is
    // already 'supplier' at that point.
    throw new Error(`Failed to reactivate suspended supplier profile ${supplier.id}`);
  }

  const refreshed = await dbUnified.findOne('suppliers', { id: supplier.id });
  return refreshed || { ...supplier, ...updates };
}

async function rollbackNewCollisionClaim(pendingBotClaim) {
  if (!pendingBotClaim?.created || !pendingBotClaim.claim?.id) {
    return;
  }
  if (typeof dbUnified.deleteOne !== 'function') {
    logger.warn(
      'Could not roll back Supplier Bot collision claim because deleteOne is unavailable',
      {
        claimId: pendingBotClaim.claim.id,
      }
    );
    return;
  }
  try {
    const removed = await dbUnified.deleteOne('supplierClaims', { id: pendingBotClaim.claim.id });
    if (!removed) {
      logger.warn('Supplier Bot collision claim rollback did not remove a record', {
        claimId: pendingBotClaim.claim.id,
      });
    }
  } catch (error) {
    logger.warn('Failed to roll back Supplier Bot collision claim', {
      claimId: pendingBotClaim.claim.id,
      error: error.message,
    });
  }
}

// skipcq: JS-0067 -- CommonJS module scope prevents these declarations becoming browser globals.
async function ensureSupplierProfileForUser(user, options = {}) {
  if (!user || user.role !== 'supplier') {
    return null;
  }

  if (!user.id) {
    throw new Error('Cannot provision supplier profile without a user id');
  }

  const existing = await dbUnified.findOne('suppliers', { ownerUserId: user.id });
  if (existing) {
    if (isConversionSuspension(existing)) {
      return reactivateConversionSuspendedProfile(existing);
    }
    return existing;
  }

  // A normal supplier signup can arrive after the autonomous bot has already
  // discovered the same business. Detect that collision before creating the
  // user's ordinary profile and persist a claim request instead of silently
  // losing the relationship between the two records. Ownership is deliberately
  // NOT transferred here: Phase 5 validates email/domain/DNS/phone proof before
  // any claim can become authoritative.
  //
  // A signup that arrived via the "claim this listing" link on a specific
  // unclaimed profile carries that exact supplier id (options.claimSupplierId).
  // Prefer it over the heuristic scan below so the claim always lands on the
  // listing the visitor actually viewed, even when their signup email/website
  // doesn't happen to match it (e.g. a different mailbox on the same domain,
  // or an email domain the heuristic can't see because the optional website
  // field was left blank).
  let collision = null;
  let collisionSource = 'normal_signup_collision';
  const explicitClaimSupplierId =
    typeof options.claimSupplierId === 'string' ? options.claimSupplierId.trim().slice(0, 64) : '';
  if (explicitClaimSupplierId) {
    const explicitSupplier = await dbUnified.findOne('suppliers', { id: explicitClaimSupplierId });
    if (explicitSupplier && isUnclaimedBotSupplier(explicitSupplier)) {
      collision = { supplier: explicitSupplier, signals: collisionSignals(user, explicitSupplier) };
      collisionSource = 'claim_link_explicit';
    }
  }
  if (!collision) {
    collision = await findSupplierBotCollision({ dbUnified, user });
  }
  let pendingBotClaim = null;
  if (collision) {
    pendingBotClaim = await createSupplierBotClaimRequest({
      dbUnified,
      supplier: collision.supplier,
      user,
      signals: collision.signals,
      source: collisionSource,
    });
    logger.info('Supplier signup matched an unclaimed Supplier Bot profile', {
      userId: user.id,
      supplierId: collision.supplier.id,
      claimId: pendingBotClaim.claim.id,
      signals: collision.signals,
    });
  }

  const nowIso = new Date().toISOString();
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  const supplier = {
    id: dbUnified.uid('sup'),
    ownerUserId: user.id,
    email,
    name: String(user.company || user.businessName || user.name || emailLocalPart(email)).slice(
      0,
      120
    ),
    location: String(user.location || '').slice(0, 200),
    category: String(options.category || user.category || 'Other').slice(0, 80),
    profileComplete: false,
    photosGallery: [],
    amenities: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    ...(pendingBotClaim
      ? {
          supplierBotCollision: {
            supplierId: collision.supplier.id,
            candidateId: collision.supplier.acquisition?.candidateId || null,
            claimId: pendingBotClaim.claim.id,
            claimStatus: pendingBotClaim.claim.status,
            detectedAt: nowIso,
          },
        }
      : {}),
    ...(await supplierApprovalDefaults(nowIso)),
  };

  try {
    const inserted = await dbUnified.insertOne('suppliers', supplier);
    if (inserted) {
      await recordAutomaticApprovalAudit(inserted);
      return inserted;
    }
  } catch (error) {
    if (!isDuplicateLikeError(error)) {
      logger.warn('Supplier profile insert threw during provisioning:', error.message);
    }
  }

  // insertOne returns null on failure in db-unified; duplicate/race cases should be resolved by re-read.
  const afterInsertFailure = await dbUnified.findOne('suppliers', { ownerUserId: user.id });
  if (afterInsertFailure) {
    return afterInsertFailure;
  }

  // If this signup created a brand-new collision claim but the owned supplier
  // profile never materialised, remove that claim before the registration
  // route rolls back the user. This prevents orphaned claim requests pointing
  // at accounts that no longer exist. Pre-existing/idempotent claims are left
  // untouched because they may belong to an earlier valid attempt.
  await rollbackNewCollisionClaim(pendingBotClaim);
  throw new Error(`Failed to provision supplier profile for user ${user.id}`);
}

module.exports = {
  ensureSupplierProfileForUser,
  supplierApprovalDefaults,
};
