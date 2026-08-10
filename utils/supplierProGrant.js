'use strict';

/**
 * Pure builders for the admin comp-Pro grant/revoke field set written to a
 * supplier record.
 *
 * Three separate routes grant or revoke admin comp-Pro access on a supplier:
 *   - routes/admin.js and routes/supplier-admin.js POST /suppliers/:id/pro
 *   - routes/admin-user-management.js POST/DELETE /suppliers/:id/subscription
 *
 * Before this module existed each wrote a different subset of the fields
 * every entitlement-adjacent reader looks at:
 *   - supplier.isPro / proExpiresAt           (utils/helpers.js supplierIsProActive)
 *   - supplier.subscription.{tier,status,...} (utils/tierPriority.js resolveSupplierTierFromRecord,
 *                                               utils/helpers.js supplierPlanTier)
 *   - supplier.proPlan / proPlanExpiry        (legacy display fields)
 * So whether search ranking, badges, and support-ticket priority agreed
 * with what an admin had actually granted depended on which of the three
 * screens they'd used. These builders are the single place all three routes
 * now get their $set payload from, so they always write the same complete,
 * consistent set of fields.
 *
 * Deliberately pure — callers own the actual DB read/write (the three
 * routes have different existing conventions, and different test mocks),
 * these functions only compute what to write.
 */

/**
 * @param {Object} [options]
 * @param {'pro'|'pro_plus'} [options.tier] - Defaults to 'pro' for routes
 *   that don't collect a tier (routes/admin.js, routes/supplier-admin.js
 *   /pro endpoints historically only ever granted a generic "Pro").
 * @param {string|null} [options.expiresAt] - ISO timestamp, or null for a
 *   grant with no expiry ("lifetime").
 * @param {string|null} [options.grantedBy] - Admin user id, for the audit trail.
 * @returns {Object} $set payload for the supplier record.
 */
function buildSupplierProGrantUpdate({ tier = 'pro', expiresAt = null, grantedBy = null } = {}) {
  const resolvedTier = tier === 'pro_plus' ? 'pro_plus' : 'pro';
  const now = new Date().toISOString();
  return {
    isPro: true,
    proExpiresAt: expiresAt,
    proPlan: resolvedTier === 'pro_plus' ? 'Pro+' : 'Pro',
    proPlanExpiry: expiresAt,
    subscription: {
      tier: resolvedTier,
      status: 'active',
      startDate: now,
      endDate: expiresAt,
      grantedBy,
      grantedAt: now,
      autoRenew: false,
    },
    updatedAt: now,
  };
}

/**
 * @param {Object} [options]
 * @param {string|null} [options.revokedBy] - Admin user id, for the audit trail.
 * @returns {Object} $set payload for the supplier record.
 */
function buildSupplierProRevokeUpdate({ revokedBy = null } = {}) {
  const now = new Date().toISOString();
  return {
    isPro: false,
    proExpiresAt: null,
    proPlan: null,
    proPlanExpiry: null,
    subscription: {
      tier: 'free',
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: revokedBy,
    },
    updatedAt: now,
  };
}

module.exports = { buildSupplierProGrantUpdate, buildSupplierProRevokeUpdate };
