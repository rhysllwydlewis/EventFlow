/**
 * Account Type Conversion Service
 *
 * Single place owning the customer<->supplier role-conversion transaction,
 * shared by the self-service settings route and the admin User Detail
 * action. See docs/ACCOUNT_TYPE_CONVERSION_PLAN.md for the full design.
 */

'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { auditLog, AUDIT_ACTIONS } = require('../middleware/audit');
const { ensureSupplierProfileForUser } = require('./supplierProfileProvisioning.service');
const { VERIFICATION_STATES } = require('../utils/supplierVerificationStateMachine');
const catalogCache = require('./catalogCache');

// One self-service conversion per rolling 30 days (per §4.1/§7.3 of the plan).
// Admin-initiated conversions are exempt — see convertToSupplier/convertToCustomer below.
const SELF_SERVICE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

class AccountTypeConversionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AccountTypeConversionError';
    this.code = code;
    Object.assign(this, extra);
  }
}

function cooldownRemaining(user) {
  if (!user.lastAccountTypeChangeAt) {
    return null;
  }
  const last = new Date(user.lastAccountTypeChangeAt).getTime();
  if (Number.isNaN(last)) {
    return null;
  }
  const elapsedMs = Date.now() - last;
  if (elapsedMs >= SELF_SERVICE_COOLDOWN_MS) {
    return null;
  }
  const retryAfterMs = SELF_SERVICE_COOLDOWN_MS - elapsedMs;
  return {
    retryAfterMs,
    retryAfterDays: Math.ceil(retryAfterMs / (24 * 60 * 60 * 1000)),
  };
}

function assertActor(actor) {
  if (!actor || (actor.type !== 'self' && actor.type !== 'admin') || !actor.id || !actor.email) {
    throw new AccountTypeConversionError(
      'INVALID_ACTOR',
      'A valid actor ({ type, id, email }) is required'
    );
  }
}

// Builds a $set/$unset pair that restores a user's role plus their exact
// pre-attempt previousRole/lastAccountTypeChangeAt, for use when a rollback
// needs to undo a role change. Restoring (rather than always unsetting) is
// required so that a user who already had conversion history/an active
// self-service cooldown before this attempt doesn't have it erased by a
// failed attempt — an admin or self retry immediately after a transient
// failure must still respect whatever cooldown/history predated it.
//
// Takes the prior values as explicit params (captured by the caller before
// any write) rather than re-reading them off the `user` object at rollback
// time — db-unified's non-Mongo store mode can hand back the very same
// object reference across reads, so re-reading post-mutation risks quietly
// restoring the just-written values instead of the real pre-attempt ones.
function rollbackFieldsUpdate(role, priorPreviousRole, priorLastAccountTypeChangeAt) {
  const setFields = { role, updatedAt: new Date().toISOString() };
  const unsetFields = {};
  if (priorPreviousRole !== undefined) {
    setFields.previousRole = priorPreviousRole;
  } else {
    unsetFields.previousRole = '';
  }
  if (priorLastAccountTypeChangeAt !== undefined) {
    setFields.lastAccountTypeChangeAt = priorLastAccountTypeChangeAt;
  } else {
    unsetFields.lastAccountTypeChangeAt = '';
  }
  const update = { $set: setFields };
  if (Object.keys(unsetFields).length) {
    update.$unset = unsetFields;
  }
  return update;
}

/**
 * Convert a `customer` user to `supplier`.
 * @param {Object} user - Full user document (must be role 'customer')
 * @param {Object} params
 * @param {Object} [params.supplierInfo] - { company, category, location, phone }
 * @param {{type:'self'|'admin', id:string, email:string}} params.actor
 */
async function convertToSupplier(user, { supplierInfo = {}, actor } = {}) {
  assertActor(actor);

  if (!user || !user.id) {
    throw new AccountTypeConversionError('NOT_FOUND', 'User not found');
  }
  if (user.role === 'admin') {
    throw new AccountTypeConversionError(
      'ADMIN_ROLE_PROTECTED',
      'Admin accounts cannot be converted through this flow'
    );
  }
  if (user.role === 'supplier') {
    throw new AccountTypeConversionError('ALREADY_TARGET_ROLE', 'User is already a supplier');
  }

  if (actor.type === 'self') {
    const cooldown = cooldownRemaining(user);
    if (cooldown) {
      throw new AccountTypeConversionError(
        'COOLDOWN_ACTIVE',
        `You can change your account type again in ${cooldown.retryAfterDays} day(s)`,
        cooldown
      );
    }
  }

  const company = String((supplierInfo && supplierInfo.company) || user.company || '').trim();
  if (actor.type === 'self' && !company) {
    throw new AccountTypeConversionError('VALIDATION_ERROR', 'Business/company name is required', {
      field: 'company',
    });
  }

  const previousRole = user.role;
  const priorPreviousRole = user.previousRole;
  const priorLastAccountTypeChangeAt = user.lastAccountTypeChangeAt;
  const now = new Date().toISOString();

  const setFields = {
    role: 'supplier',
    previousRole,
    updatedAt: now,
  };
  // Only a self-service conversion should start/consume the 30-day
  // self-service cooldown. An admin-initiated conversion must not write this
  // field at all — otherwise every support-initiated fix would silently
  // reset the user's own cooldown and lock them out of converting
  // themselves again afterward (the plan's admin path is meant to run
  // independently of the self-service cooldown, not interact with it).
  if (actor.type === 'self') {
    setFields.lastAccountTypeChangeAt = now;
  }
  if (company) {
    setFields.company = company.slice(0, 100);
  }
  if (supplierInfo && supplierInfo.location) {
    setFields.location = String(supplierInfo.location).slice(0, 200);
  }

  const roleUpdated = await dbUnified.updateOne('users', { id: user.id }, { $set: setFields });
  if (!roleUpdated) {
    throw new AccountTypeConversionError('UPDATE_FAILED', 'Failed to update account role');
  }

  let supplierProfile;
  try {
    supplierProfile = await ensureSupplierProfileForUser(
      { ...user, ...setFields },
      { category: supplierInfo && supplierInfo.category }
    );
  } catch (provisionErr) {
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      rollbackFieldsUpdate(previousRole, priorPreviousRole, priorLastAccountTypeChangeAt)
    );
    logger.error('[ACCOUNT-TYPE] supplier profile provisioning failed; role change rolled back', {
      userId: user.id,
      previousRole,
      actor: actor.type,
      error: provisionErr.message,
    });
    throw new AccountTypeConversionError(
      'SUPPLIER_PROFILE_PROVISIONING_FAILED',
      'Failed to provision supplier profile for role change to supplier.'
    );
  }

  await auditLog({
    adminId: actor.id,
    adminEmail: actor.email,
    action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
    targetType: 'user',
    targetId: user.id,
    details: {
      initiatedBy: actor.type,
      adminActorId: actor.type === 'admin' ? actor.id : undefined,
      from: previousRole,
      to: 'supplier',
      supplierProfileId: supplierProfile && supplierProfile.id,
    },
  });

  return {
    role: 'supplier',
    previousRole,
    supplierProfile,
  };
}

/**
 * Convert a `supplier` user to `customer`. Suspends (does not delete) the
 * linked supplier profile so it's no longer publicly visible, mirroring
 * routes/supplier-admin.js's POST /suppliers/:id/suspend recipe.
 * @param {Object} user - Full user document (must be role 'supplier')
 * @param {{type:'self'|'admin', id:string, email:string}} params.actor
 */
async function convertToCustomer(user, { actor } = {}) {
  assertActor(actor);

  if (!user || !user.id) {
    throw new AccountTypeConversionError('NOT_FOUND', 'User not found');
  }
  if (user.role === 'admin') {
    throw new AccountTypeConversionError(
      'ADMIN_ROLE_PROTECTED',
      'Admin accounts cannot be converted through this flow'
    );
  }
  if (user.role === 'customer') {
    throw new AccountTypeConversionError('ALREADY_TARGET_ROLE', 'User is already a customer');
  }

  if (actor.type === 'self') {
    const cooldown = cooldownRemaining(user);
    if (cooldown) {
      throw new AccountTypeConversionError(
        'COOLDOWN_ACTIVE',
        `You can change your account type again in ${cooldown.retryAfterDays} day(s)`,
        cooldown
      );
    }
  }

  const previousRole = user.role;
  const priorPreviousRole = user.previousRole;
  const priorLastAccountTypeChangeAt = user.lastAccountTypeChangeAt;
  const now = new Date().toISOString();

  const setFields = {
    role: 'customer',
    previousRole,
    updatedAt: now,
  };
  // See the matching comment in convertToSupplier: admin-initiated
  // conversions must not touch the self-service cooldown timer.
  if (actor.type === 'self') {
    setFields.lastAccountTypeChangeAt = now;
  }

  const roleUpdated = await dbUnified.updateOne('users', { id: user.id }, { $set: setFields });
  if (!roleUpdated) {
    throw new AccountTypeConversionError('UPDATE_FAILED', 'Failed to update account role');
  }

  const supplier = await dbUnified.findOne('suppliers', { ownerUserId: user.id });
  let subscriptionCancelled = false;

  if (supplier) {
    const suspendFields = {
      approved: false,
      verified: false,
      verificationStatus: VERIFICATION_STATES.SUSPENDED,
      status: 'suspended',
      suspendedAt: now,
      suspendedBy: actor.id,
      suspendedReason:
        actor.type === 'self' ? 'owner_converted_to_customer' : 'admin_converted_owner_to_customer',
      updatedAt: now,
    };

    const suspended = await dbUnified.updateOne(
      'suppliers',
      { id: supplier.id },
      { $set: suspendFields }
    );

    if (!suspended) {
      // Non-atomic writes (db-unified has no transaction support) — revert the role
      // change rather than leave a `customer` whose listing is still live/approved.
      await dbUnified.updateOne(
        'users',
        { id: user.id },
        rollbackFieldsUpdate(previousRole, priorPreviousRole, priorLastAccountTypeChangeAt)
      );
      logger.error('[ACCOUNT-TYPE] supplier suspend failed; role change rolled back', {
        userId: user.id,
        supplierId: supplier.id,
        actor: actor.type,
      });
      throw new AccountTypeConversionError(
        'SUPPLIER_SUSPEND_FAILED',
        'Failed to suspend the linked supplier profile'
      );
    }

    try {
      const subscriptionService = require('./subscriptionService');
      await subscriptionService.cancelSubscriptionForAccountDeletion(user.id);
      subscriptionCancelled = true;
    } catch (subErr) {
      // Billing teardown failing isn't a reason to roll back the conversion —
      // matches the same non-blocking pattern routes/profile.js's DELETE / uses.
      logger.warn('[ACCOUNT-TYPE] subscription cancellation failed during downgrade', {
        userId: user.id,
        error: subErr.message,
      });
    }

    catalogCache
      .invalidate()
      .catch(e =>
        logger.warn('[ACCOUNT-TYPE] catalogCache invalidate failed', { error: e.message })
      );
  }

  await auditLog({
    adminId: actor.id,
    adminEmail: actor.email,
    action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
    targetType: 'user',
    targetId: user.id,
    details: {
      initiatedBy: actor.type,
      adminActorId: actor.type === 'admin' ? actor.id : undefined,
      from: previousRole,
      to: 'customer',
      supplierProfileId: supplier && supplier.id,
      supplierSuspended: Boolean(supplier),
      subscriptionCancelled,
    },
  });

  return {
    role: 'customer',
    previousRole,
    supplierSuspended: Boolean(supplier),
    subscriptionCancelled,
  };
}

module.exports = {
  AccountTypeConversionError,
  convertToSupplier,
  convertToCustomer,
  cooldownRemaining,
  SELF_SERVICE_COOLDOWN_MS,
};
