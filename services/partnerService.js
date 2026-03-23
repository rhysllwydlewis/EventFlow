/**
 * Partner / Affiliate Service
 * Handles partner registration, referral tracking, and credit ledger
 *
 * Credit rules:
 *   PACKAGE_BONUS    +10 credits  – first package created by referred supplier within 30 days
 *   SUBSCRIPTION_BONUS +100 credits – first successful payment by referred supplier within 30 days
 *
 * 1 credit = £0.01  (10 credits = £0.10, 100 credits = £1)
 */

'use strict';

const crypto = require('crypto');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const logger = require('../utils/logger');

const ATTRIBUTION_DAYS = 30;
const PACKAGE_BONUS = 10;
const SUBSCRIPTION_BONUS = 100;

const CREDIT_TYPES = {
  PACKAGE_BONUS: 'PACKAGE_BONUS',
  SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
  ADJUSTMENT: 'ADJUSTMENT',
  REDEEM: 'REDEEM',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Generate a unique, short referral code like p_A1B2C3D4 */
function generateRefCode() {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `p_${random}`;
}

/** Returns true if the supplier signup was within the attribution window */
function isWithinAttributionWindow(supplierCreatedAt) {
  if (!supplierCreatedAt) {
    return false;
  }
  const signupMs = new Date(supplierCreatedAt).getTime();
  const windowMs = ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - signupMs <= windowMs;
}

// ─── Partner CRUD ─────────────────────────────────────────────────────────────

/**
 * Create a new partner account for an existing user.
 * Generates a unique ref code and stores the partner record.
 */
async function createPartner(userId) {
  // Ensure no duplicate partner for this userId
  const existing = await dbUnified.findOne('partners', { userId });
  if (existing) {
    return existing;
  }

  // Generate unique ref code (retry if collision)
  let refCode;
  for (let i = 0; i < 5; i++) {
    refCode = generateRefCode();
    const collision = await dbUnified.findOne('partners', { refCode });
    if (!collision) {
      break;
    }
    refCode = null;
  }
  if (!refCode) {
    throw new Error('Could not generate unique ref code');
  }

  const partner = {
    id: uid('prt'),
    userId,
    refCode,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('partners', partner);
  logger.info(`Partner created: ${partner.id} (refCode=${refCode}) for user ${userId}`);
  return partner;
}

/** Get partner by userId */
async function getPartnerByUserId(userId) {
  return dbUnified.findOne('partners', { userId });
}

/** Get partner by ref code */
async function getPartnerByRefCode(refCode) {
  return dbUnified.findOne('partners', { refCode });
}

/** Get partner by id */
async function getPartnerById(partnerId) {
  return dbUnified.findOne('partners', { id: partnerId });
}

/** List all partners (admin) */
async function listPartners({ search, status } = {}) {
  const all = await dbUnified.read('partners');
  let list = all;
  if (status) {
    list = list.filter(p => p.status === status);
  }
  if (search) {
    const s = search.toLowerCase();
    // We'll need to join with user data at call site; here just return all
    list = list.filter(
      p =>
        (p.refCode || '').toLowerCase().includes(s) || (p.id || '').toLowerCase().includes(s)
    );
  }
  return list;
}

/** Update partner status (admin) */
async function setPartnerStatus(partnerId, status) {
  await dbUnified.updateOne(
    'partners',
    { id: partnerId },
    { $set: { status, updatedAt: new Date().toISOString() } }
  );
}

// ─── Referral Tracking ────────────────────────────────────────────────────────

/**
 * Record that a supplier signed up through a partner's referral link.
 * Called during supplier registration when a `ref` query param is present.
 */
async function recordReferral({ partnerId, supplierUserId, supplierCreatedAt }) {
  // One supplier → one partner attribution
  const existing = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (existing) {
    logger.info(`Supplier ${supplierUserId} already attributed to partner ${existing.partnerId}`);
    return existing;
  }

  const signupDate = supplierCreatedAt ? new Date(supplierCreatedAt) : new Date();
  const expiresAt = new Date(signupDate.getTime() + ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);

  const referral = {
    id: uid('ref'),
    partnerId,
    supplierUserId,
    supplierCreatedAt: signupDate.toISOString(),
    attributionExpiresAt: expiresAt.toISOString(),
    packageQualified: false,
    subscriptionQualified: false,
    createdAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('partner_referrals', referral);
  logger.info(`Referral recorded: partner ${partnerId} → supplier ${supplierUserId}`);
  return referral;
}

/** Get referral record for a supplier */
async function getReferralBySupplierUserId(supplierUserId) {
  return dbUnified.findOne('partner_referrals', { supplierUserId });
}

/** List referrals for a partner */
async function listReferralsByPartnerId(partnerId) {
  const all = await dbUnified.read('partner_referrals');
  return all.filter(r => r.partnerId === partnerId);
}

// ─── Credit Ledger ────────────────────────────────────────────────────────────

/**
 * Insert a credit transaction and update the referral's qualification flag.
 * Idempotent: checks existing transactions before inserting.
 */
async function _awardCredit({ partnerId, supplierUserId, type, amount, notes }) {
  // Idempotency check: one award per supplier per type
  const txns = await dbUnified.read('partner_credit_transactions');
  const duplicate = txns.find(
    t => t.supplierUserId === supplierUserId && t.type === type && t.partnerId === partnerId
  );
  if (duplicate) {
    logger.info(`Credit already awarded: partner=${partnerId} supplier=${supplierUserId} type=${type}`);
    return null;
  }

  const txn = {
    id: uid('ptx'),
    partnerId,
    supplierUserId,
    type,
    amount,
    notes: notes || '',
    createdAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('partner_credit_transactions', txn);
  logger.info(`Credit awarded: +${amount} (${type}) to partner ${partnerId} for supplier ${supplierUserId}`);
  return txn;
}

/**
 * Award +10 credits for the supplier's first package creation.
 * Triggered from the package creation route.
 *
 * @param {string} supplierUserId  – The user ID of the supplier who created the package
 * @returns {Object|null}  The credit transaction, or null if not applicable / already awarded
 */
async function awardPackageBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null; // Not a referred supplier
  }

  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null; // Partner disabled or missing
  }

  if (!isWithinAttributionWindow(referral.supplierCreatedAt)) {
    logger.info(`Package bonus: attribution window expired for supplier ${supplierUserId}`);
    return null;
  }

  const txn = await _awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.PACKAGE_BONUS,
    amount: PACKAGE_BONUS,
    notes: 'First package created by referred supplier',
  });

  if (txn) {
    // Update referral qualification flag
    await dbUnified.updateOne(
      'partner_referrals',
      { id: referral.id },
      { $set: { packageQualified: true } }
    );
  }

  return txn;
}

/**
 * Award +100 credits for the supplier's first successful subscription payment.
 * Triggered from the Stripe webhook handler (invoice.payment_succeeded).
 *
 * @param {string} supplierUserId  – The user ID of the supplier who paid
 * @returns {Object|null}  The credit transaction, or null if not applicable / already awarded
 */
async function awardSubscriptionBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null;
  }

  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }

  if (!isWithinAttributionWindow(referral.supplierCreatedAt)) {
    logger.info(`Subscription bonus: attribution window expired for supplier ${supplierUserId}`);
    return null;
  }

  const txn = await _awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.SUBSCRIPTION_BONUS,
    amount: SUBSCRIPTION_BONUS,
    notes: 'First subscription payment by referred supplier',
  });

  if (txn) {
    await dbUnified.updateOne(
      'partner_referrals',
      { id: referral.id },
      { $set: { subscriptionQualified: true } }
    );
  }

  return txn;
}

/**
 * Admin: apply a manual credit adjustment (positive or negative).
 */
async function applyAdminAdjustment({ partnerId, amount, notes, adminUserId }) {
  const txn = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.ADJUSTMENT,
    amount,
    notes: notes || '',
    adminUserId: adminUserId || null,
    createdAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('partner_credit_transactions', txn);
  logger.info(`Admin credit adjustment: ${amount > 0 ? '+' : ''}${amount} to partner ${partnerId} by admin ${adminUserId}`);
  return txn;
}

/**
 * Compute the current credit balance for a partner.
 */
async function getBalance(partnerId) {
  const txns = await dbUnified.read('partner_credit_transactions');
  const partnerTxns = txns.filter(t => t.partnerId === partnerId);

  let total = 0;
  let packageBonusTotal = 0;
  let subscriptionBonusTotal = 0;
  let adjustmentTotal = 0;
  let redeemed = 0;

  for (const t of partnerTxns) {
    total += t.amount;
    if (t.type === CREDIT_TYPES.PACKAGE_BONUS) {
      packageBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.SUBSCRIPTION_BONUS) {
      subscriptionBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.ADJUSTMENT) {
      adjustmentTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.REDEEM) {
      redeemed += Math.abs(t.amount);
    }
  }

  return {
    balance: total,
    totalEarned: packageBonusTotal + subscriptionBonusTotal + (adjustmentTotal > 0 ? adjustmentTotal : 0),
    packageBonusTotal,
    subscriptionBonusTotal,
    adjustmentTotal,
    redeemed,
    transactions: partnerTxns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}

module.exports = {
  CREDIT_TYPES,
  PACKAGE_BONUS,
  SUBSCRIPTION_BONUS,
  ATTRIBUTION_DAYS,
  generateRefCode,
  isWithinAttributionWindow,
  // Partner CRUD
  createPartner,
  getPartnerByUserId,
  getPartnerByRefCode,
  getPartnerById,
  listPartners,
  setPartnerStatus,
  // Referral tracking
  recordReferral,
  getReferralBySupplierUserId,
  listReferralsByPartnerId,
  // Credits
  awardPackageBonus,
  awardSubscriptionBonus,
  applyAdminAdjustment,
  getBalance,
};
