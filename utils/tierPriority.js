'use strict';

/**
 * Tier-based ticket priority derivation
 *
 * Maps supplier subscription tiers (and fallback customer role) to support
 * ticket priorities so that higher-plan accounts receive faster triage.
 *
 * Tier → Priority mapping:
 *   pro_plus  → urgent   (highest)
 *   pro       → high
 *   free      → medium
 *   <none>    → medium   (customer default / unknown)
 */

/**
 * Map from account tier to ticket priority string.
 * @type {Record<string, string>}
 */
const TIER_TO_PRIORITY = {
  pro_plus: 'urgent',
  pro: 'high',
  free: 'medium',
};

/**
 * Numeric rank for each priority value (higher = more urgent).
 * Used for queue-oriented sorting in the admin view.
 * @type {Record<string, number>}
 */
const PRIORITY_RANK = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Human-readable label for each account tier.
 * @param {string} tier
 * @returns {string}
 */
function tierDisplayLabel(tier) {
  switch (tier) {
    case 'pro_plus':
      return 'Pro Plus';
    case 'pro':
      return 'Pro';
    case 'free':
      return 'Starter';
    default:
      return 'Starter';
  }
}

/**
 * Resolve the subscription tier for a supplier from their stored record.
 *
 * Looks for:
 *   1. supplier.subscription.tier (most authoritative), gated on
 *      supplier.subscription.endDate not having passed
 *   2. supplier.subscriptionTier (denormalised fallback) and the legacy
 *      supplier.isPro boolean, both gated on supplier.proExpiresAt not
 *      having passed — subscriptionService.persistUserSubscriptionState
 *      always writes those two fields together, so a lapsed grant whose
 *      proExpiresAt is in the past must not still read as live here.
 *
 * Returns 'free' if no currently-live paid subscription is found. Without
 * the expiry checks, a lapsed admin comp grant (see routes/admin.js and
 * routes/admin-user-management.js /suppliers/:id/pro|subscription) would
 * keep this supplier's support tickets at urgent/high priority forever,
 * since nothing else ever flips these stored fields back on its own.
 *
 * @param {object} supplier - Raw supplier record from the database.
 * @returns {'free'|'pro'|'pro_plus'}
 */
function resolveSupplierTierFromRecord(supplier) {
  if (!supplier) {
    return 'free';
  }

  const now = Date.now();

  // Check subscription object (primary source)
  const sub = supplier.subscription;
  if (sub && sub.tier) {
    const status = sub.status;
    const subscriptionNotExpired = !sub.endDate || new Date(sub.endDate).getTime() > now;
    if (
      (status === 'active' || status === 'trial' || status === 'trialing') &&
      subscriptionNotExpired
    ) {
      const tier = sub.tier;
      if (tier === 'pro_plus') {
        return 'pro_plus';
      }
      if (tier === 'pro') {
        return 'pro';
      }
    }
    // expired / cancelled → fall through
  }

  const proGrantNotExpired =
    !supplier.proExpiresAt || new Date(supplier.proExpiresAt).getTime() > now;
  if (proGrantNotExpired) {
    // Denormalised subscriptionTier field
    const direct = supplier.subscriptionTier;
    if (direct === 'pro_plus') {
      return 'pro_plus';
    }
    if (direct === 'pro') {
      return 'pro';
    }

    // Legacy isPro boolean
    if (supplier.isPro === true) {
      return 'pro';
    }
  }

  return 'free';
}

/**
 * Derive the ticket priority and triage metadata for a new ticket.
 *
 * - Supplier tickets: resolved by looking up their supplier record and
 *   mapping the active subscription tier to a priority level.
 * - Customer tickets: customers have no paid support tier, so they always
 *   receive the base 'medium' priority.
 *
 * @param {string} senderType - 'customer' | 'supplier'
 * @param {string} userId - The ticket creator's user ID.
 * @param {object} db - A db-unified compatible object with a `read(collection)` method.
 * @returns {Promise<{priority: string, accountTier: string, prioritySource: string}>}
 */
async function deriveTicketPriority(senderType, userId, db) {
  if (senderType === 'supplier') {
    try {
      const suppliers = await db.read('suppliers');
      const supplier = suppliers.find(s => s.userId === userId || s.ownerId === userId);
      const tier = resolveSupplierTierFromRecord(supplier);
      const priority = TIER_TO_PRIORITY[tier] || 'medium';
      return { priority, accountTier: tier, prioritySource: 'auto' };
    } catch (_err) {
      // Fail open: use default if lookup errors
      return { priority: 'medium', accountTier: 'free', prioritySource: 'auto' };
    }
  }

  // Customers default to free-tier priority (medium)
  return { priority: 'medium', accountTier: 'free', prioritySource: 'auto' };
}

module.exports = {
  TIER_TO_PRIORITY,
  PRIORITY_RANK,
  tierDisplayLabel,
  resolveSupplierTierFromRecord,
  deriveTicketPriority,
};
