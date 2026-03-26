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
const REFERRAL_SIGNUP_BONUS = 5;
const FIRST_REVIEW_BONUS = 15;
const PROFILE_APPROVED_BONUS = 20;

/** Number of days a credit transaction must age before it is "available" for cashout */
const CREDIT_MATURITY_DAYS = 30;

/**
 * Points-to-GBP conversion: how many points equal £1.
 * Configurable via POINTS_PER_GBP env var (default: 100 points = £1).
 */
const _rawPointsPerGbp = parseInt(process.env.POINTS_PER_GBP, 10);
const POINTS_PER_GBP =
  Number.isInteger(_rawPointsPerGbp) && _rawPointsPerGbp > 0 ? _rawPointsPerGbp : 100;

const CREDIT_TYPES = {
  PACKAGE_BONUS: 'PACKAGE_BONUS',
  SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
  REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
  FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
  PROFILE_APPROVED_BONUS: 'PROFILE_APPROVED_BONUS',
  ADJUSTMENT: 'ADJUSTMENT',
  REDEEM: 'REDEEM',
  /** Reserved points for a pending cashout request (negative amount, reduces availableBalance) */
  CASHOUT_HOLD: 'CASHOUT_HOLD',
  /** Restores points held by CASHOUT_HOLD when a request is rejected or cancelled */
  CASHOUT_RELEASE: 'CASHOUT_RELEASE',
};

/**
 * Privacy-mask a person's display name so that only the first and last
 * character of the name string are shown, with asterisks in between.
 *
 * Masking strategy:
 *   - Full name present (e.g. "Jane Smith") → "J*******h"  (first char + asterisks + last char)
 *   - Single-character or two-character name → first char + "***"
 *   - No name, but company is provided    → first char of company + "***"
 *   - No name or company, email present   → first char of local-part + "***@" + email domain
 *   - Nothing available                   → "S***r" (generic fallback)
 *
 * The goal is to confirm that a real person signed up without revealing PII.
 *
 * @param {string|null} name    - Full name (may be null/undefined)
 * @param {string|null} company - Company name (fallback)
 * @param {string|null} email   - Email address (last-resort fallback)
 * @returns {string} Masked display string
 */
function maskReferralName(name, company, email) {
  const str = (name || '').trim();
  if (str.length >= 2) {
    const first = str.charAt(0);
    const last = str.charAt(str.length - 1);
    // Always show at least 3 asterisks so short names are not fully revealed
    const middle = '*'.repeat(Math.max(3, Math.min(str.length - 2, 5)));
    return `${first}${middle}${last}`;
  }
  if (str.length === 1) {
    return `${str}***`;
  }
  // Fallback to company initial
  const co = (company || '').trim();
  if (co.length >= 1) {
    return `${co.charAt(0)}***`;
  }
  // Fallback to email (show local-part initial + domain)
  if (email && email.includes('@')) {
    const [local, domain] = email.split('@');
    return `${(local || 'u').charAt(0)}***@${domain}`;
  }
  return 'S***r';
}

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
      p => (p.refCode || '').toLowerCase().includes(s) || (p.id || '').toLowerCase().includes(s)
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

/**
 * Soft-delete the partner record associated with a given userId.
 * Sets status to 'deleted' and records a deletedAt timestamp so that
 * the financial audit trail (credits, referrals) is preserved.
 *
 * @param {string} userId - The user ID whose partner record should be soft-deleted.
 * @returns {Promise<boolean>} - true if a partner record was found and updated, false otherwise.
 */
async function softDeletePartnerByUserId(userId) {
  const partner = await dbUnified.findOne('partners', { userId });
  if (!partner) {
    return false;
  }
  await dbUnified.updateOne(
    'partners',
    { id: partner.id },
    { $set: { status: 'deleted', deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
  );
  logger.info(`Partner ${partner.id} marked as deleted (user ${userId} was deleted)`);
  return true;
}

/**
 * Regenerate a partner's referral code.
 *
 * The old code is saved to `partner_code_history` so it remains valid for
 * lookups (callers should check history when a primary refCode lookup fails).
 * The new code is written to the `partners` record.
 *
 * @param {string} partnerId
 * @returns {{ partner: Object, oldCode: string, newCode: string }}
 */
async function regenerateCode(partnerId) {
  const partner = await getPartnerById(partnerId);
  if (!partner) {
    throw new Error('Partner not found');
  }

  // Generate a new unique code
  let newCode;
  for (let i = 0; i < 5; i++) {
    newCode = generateRefCode();
    const collision = await dbUnified.findOne('partners', { refCode: newCode });
    if (!collision) {
      break;
    }
    newCode = null;
  }
  if (!newCode) {
    throw new Error('Could not generate unique ref code');
  }

  const oldCode = partner.refCode;

  // Archive the old code so it remains resolvable
  const historyEntry = {
    id: uid('pch'),
    partnerId,
    refCode: oldCode,
    replacedByCode: newCode,
    createdAt: partner.createdAt || new Date().toISOString(),
    archivedAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('partner_code_history', historyEntry);

  // Update the live partner record
  await dbUnified.updateOne(
    'partners',
    { id: partnerId },
    { $set: { refCode: newCode, updatedAt: new Date().toISOString() } }
  );

  logger.info(`Partner ${partnerId} code regenerated: ${oldCode} → ${newCode}`);
  return { oldCode, newCode };
}

/**
 * Retrieve the code history for a partner (oldest first).
 *
 * @param {string} partnerId
 * @returns {Array<{ id, partnerId, refCode, replacedByCode, createdAt, archivedAt }>}
 */
async function getCodeHistory(partnerId) {
  const all = await dbUnified.read('partner_code_history');
  return all
    .filter(h => h.partnerId === partnerId)
    .sort((a, b) => new Date(a.archivedAt) - new Date(b.archivedAt));
}

/**
 * Look up a partner by any ref code — active or historical.
 * Used by the registration flow so old codes still resolve correctly.
 *
 * @param {string} refCode
 * @returns {Object|null} The partner record, or null if not found
 */
async function getPartnerByAnyRefCode(refCode) {
  // Check current code first
  const current = await getPartnerByRefCode(refCode);
  if (current) {
    return current;
  }
  // Fall back to code history
  const historyEntry = await dbUnified.findOne('partner_code_history', { refCode });
  if (!historyEntry) {
    return null;
  }
  return getPartnerById(historyEntry.partnerId);
}

/**
 * Calculate potential (pending) points for a partner.
 *
 * Pending points are credits that could still be earned from active referrals
 * within their 30-day attribution window that have not yet qualified.
 *
 * @param {string} partnerId
 * @returns {{ pendingPackage: number, pendingSubscription: number, totalPending: number }}
 */
async function getPendingPoints(partnerId) {
  const referrals = await listReferralsByPartnerId(partnerId);
  let pendingPackage = 0;
  let pendingSubscription = 0;

  for (const r of referrals) {
    if (!isWithinAttributionWindow(r.supplierCreatedAt)) {
      continue;
    }
    if (!r.packageQualified) {
      pendingPackage += PACKAGE_BONUS;
    }
    if (!r.subscriptionQualified) {
      pendingSubscription += SUBSCRIPTION_BONUS;
    }
  }

  return {
    pendingPackage,
    pendingSubscription,
    totalPending: pendingPackage + pendingSubscription,
  };
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
    logger.info(
      `Credit already awarded: partner=${partnerId} supplier=${supplierUserId} type=${type}`
    );
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
  logger.info(
    `Credit awarded: +${amount} (${type}) to partner ${partnerId} for supplier ${supplierUserId}`
  );
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
  logger.info(
    `Admin credit adjustment: ${amount > 0 ? '+' : ''}${amount} to partner ${partnerId} by admin ${adminUserId}`
  );
  return txn;
}

// ─── Additional Credit Mechanisms ─────────────────────────────────────────────

/**
 * Award +5 credits when a referred supplier signs up via the partner's referral link.
 * Triggered from the auth registration flow once recordReferral() has succeeded.
 *
 * @param {string} supplierUserId  – The user ID of the newly registered supplier
 * @returns {Object|null}  The credit transaction, or null if not applicable / already awarded
 */
async function awardReferralSignupBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null;
  }

  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }

  const txn = await _awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.REFERRAL_SIGNUP_BONUS,
    amount: REFERRAL_SIGNUP_BONUS,
    notes: 'Referred supplier signed up',
  });

  return txn;
}

/**
 * Award +15 credits when a referred supplier receives their first customer review.
 * Triggered from the review creation route after review is successfully submitted.
 *
 * @param {string} supplierUserId  – The user ID of the supplier who received the review
 * @returns {Object|null}  The credit transaction, or null if not applicable / already awarded
 */
async function awardFirstReviewBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null;
  }

  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }

  const txn = await _awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.FIRST_REVIEW_BONUS,
    amount: FIRST_REVIEW_BONUS,
    notes: 'First customer review received by referred supplier',
  });

  return txn;
}

/**
 * Award +20 credits when a referred supplier's profile is approved by admin.
 * NOTE: This bonus has been removed — profiles are auto-approved and awarding
 * points for approval is no longer appropriate. Function always returns null.
 *
 * @param {string} _supplierUserId  – unused
 * @returns {null}
 */
async function awardProfileApprovedBonus(_supplierUserId) {
  return null;
}

/**
 * Debit points from a partner's balance as part of a cashout.
 * This is called immediately before the Tremendous order is created.
 *
 * @param {object} opts
 * @param {string} opts.partnerId     - Partner ID
 * @param {number} opts.amount        - Points to debit (positive number, will be stored as negative)
 * @param {string} opts.notes         - Description
 * @param {string} [opts.externalRef] - Reference to the cashout order (for audit)
 * @returns {Object}  The debit transaction
 */
async function debitPoints({ partnerId, amount, notes, externalRef }) {
  const txn = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.REDEEM,
    amount: -Math.abs(amount),
    notes: notes || '',
    externalRef: externalRef || null,
    createdAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('partner_credit_transactions', txn);
  logger.info(
    `Points debit: -${Math.abs(amount)} from partner ${partnerId} (ref: ${externalRef || 'n/a'})`
  );
  return txn;
}

/**
 * Reverse a debit transaction (e.g. if the Tremendous order fails).
 *
 * @param {string} debitTxnId  - ID of the REDEEM transaction to reverse
 * @param {string} partnerId   - Partner ID (for logging)
 * @returns {Object|null}  Reversal transaction, or null if debit not found
 */
async function reverseDebit(debitTxnId, partnerId) {
  const txns = await dbUnified.read('partner_credit_transactions');
  const debit = txns.find(t => t.id === debitTxnId && t.partnerId === partnerId);
  if (!debit) {
    logger.warn(`reverseDebit: transaction ${debitTxnId} not found for partner ${partnerId}`);
    return null;
  }
  const reversalAmount = Math.abs(debit.amount);
  const reversal = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.ADJUSTMENT,
    amount: reversalAmount,
    notes: `Reversal of failed cashout debit (ref: ${debit.externalRef || debitTxnId})`,
    externalRef: debitTxnId,
    createdAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('partner_credit_transactions', reversal);
  logger.info(
    `Debit reversed: +${reversalAmount} to partner ${partnerId} (debitTxnId: ${debitTxnId})`
  );
  return reversal;
}

/**
 * Create a CASHOUT_HOLD transaction to reserve points for a pending cashout request.
 * This immediately reduces availableBalance so the partner cannot double-spend.
 *
 * @param {object} opts
 * @param {string} opts.partnerId     - Partner ID
 * @param {number} opts.amount        - Points to hold (positive number, stored as negative)
 * @param {string} opts.cashoutId     - ID of the cashout request record (for audit)
 * @returns {Object}  The hold transaction
 */
async function createCashoutHold({ partnerId, amount, cashoutId }) {
  const txn = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.CASHOUT_HOLD,
    amount: -Math.abs(amount),
    notes: `Cashout hold for request ${cashoutId}`,
    externalRef: cashoutId,
    createdAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('partner_credit_transactions', txn);
  logger.info(
    `Cashout hold: -${Math.abs(amount)} from partner ${partnerId} (cashoutId: ${cashoutId})`
  );
  return txn;
}

/**
 * Release a CASHOUT_HOLD when a cashout request is rejected or cancelled.
 * Inserts a CASHOUT_RELEASE transaction to restore the held points.
 *
 * @param {string} holdTxnId  - ID of the CASHOUT_HOLD transaction to release
 * @param {string} partnerId  - Partner ID (for logging)
 * @returns {Object|null}  Release transaction, or null if hold not found
 */
async function releaseCashoutHold(holdTxnId, partnerId) {
  const txns = await dbUnified.read('partner_credit_transactions');
  const hold = txns.find(t => t.id === holdTxnId && t.partnerId === partnerId);
  if (!hold) {
    logger.warn(
      `releaseCashoutHold: transaction ${holdTxnId} not found for partner ${partnerId}`
    );
    return null;
  }
  const releaseAmount = Math.abs(hold.amount);
  const release = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.CASHOUT_RELEASE,
    amount: releaseAmount,
    notes: `Release of cashout hold (ref: ${hold.externalRef || holdTxnId})`,
    externalRef: holdTxnId,
    createdAt: new Date().toISOString(),
  };
  await dbUnified.insertOne('partner_credit_transactions', release);
  logger.info(
    `Cashout hold released: +${releaseAmount} to partner ${partnerId} (holdTxnId: ${holdTxnId})`
  );
  return release;
}

/**
 * Compute the current credit balance for a partner.
 *
 * Returns:
 *   balance          – total net balance (earned - redeemed)
 *   availableBalance – points that are ≥ CREDIT_MATURITY_DAYS old and available for cashout
 *   maturingBalance  – points earned within the last CREDIT_MATURITY_DAYS days (not yet cashable)
 *   totalEarned      – lifetime positive credits
 *   packageBonusTotal / subscriptionBonusTotal / adjustmentTotal / redeemed – breakdowns
 *   transactions     – full transaction list, newest first
 */
async function getBalance(partnerId) {
  const txns = await dbUnified.read('partner_credit_transactions');
  const partnerTxns = txns.filter(t => t.partnerId === partnerId);

  const maturityCutoff = Date.now() - CREDIT_MATURITY_DAYS * 24 * 60 * 60 * 1000;

  let total = 0;
  let availableEarned = 0;
  let maturingEarned = 0;
  let packageBonusTotal = 0;
  let subscriptionBonusTotal = 0;
  let adjustmentTotal = 0;
  let redeemed = 0;

  for (const t of partnerTxns) {
    total += t.amount;
    const isAdjustmentPositive = t.type === CREDIT_TYPES.ADJUSTMENT && t.amount > 0;
    const earnedAt = new Date(t.createdAt).getTime();
    const isMature = earnedAt <= maturityCutoff;

    if (t.type === CREDIT_TYPES.PACKAGE_BONUS) {
      packageBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.SUBSCRIPTION_BONUS) {
      subscriptionBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.ADJUSTMENT) {
      adjustmentTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.REDEEM) {
      redeemed += Math.abs(t.amount);
    } else if (t.type === CREDIT_TYPES.CASHOUT_HOLD) {
      // Treat holds the same as redemptions for available-balance purposes
      redeemed += Math.abs(t.amount);
    } else if (t.type === CREDIT_TYPES.CASHOUT_RELEASE) {
      // A release restores held points — subtract from the redeemed tally
      redeemed -= Math.abs(t.amount);
    }

    if (t.amount > 0 && t.type !== CREDIT_TYPES.ADJUSTMENT) {
      if (isMature) {
        availableEarned += t.amount;
      } else {
        maturingEarned += t.amount;
      }
    } else if (isAdjustmentPositive) {
      // Admin positive adjustments are available immediately
      availableEarned += t.amount;
    }
  }

  // Available balance = mature earned credits minus redemptions (floor at 0)
  const availableBalance = Math.max(0, availableEarned - redeemed);
  const maturingBalance = maturingEarned;

  return {
    balance: total,
    availableBalance,
    maturingBalance,
    totalEarned:
      packageBonusTotal + subscriptionBonusTotal + (adjustmentTotal > 0 ? adjustmentTotal : 0),
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
  REFERRAL_SIGNUP_BONUS,
  FIRST_REVIEW_BONUS,
  PROFILE_APPROVED_BONUS,
  ATTRIBUTION_DAYS,
  CREDIT_MATURITY_DAYS,
  POINTS_PER_GBP,
  generateRefCode,
  isWithinAttributionWindow,
  maskReferralName,
  // Partner CRUD
  createPartner,
  getPartnerByUserId,
  getPartnerByRefCode,
  getPartnerByAnyRefCode,
  getPartnerById,
  listPartners,
  setPartnerStatus,
  softDeletePartnerByUserId,
  // Code management
  regenerateCode,
  getCodeHistory,
  // Referral tracking
  recordReferral,
  getReferralBySupplierUserId,
  listReferralsByPartnerId,
  // Credits
  awardPackageBonus,
  awardSubscriptionBonus,
  awardReferralSignupBonus,
  awardFirstReviewBonus,
  awardProfileApprovedBonus,
  applyAdminAdjustment,
  debitPoints,
  reverseDebit,
  createCashoutHold,
  releaseCashoutHold,
  getBalance,
  getPendingPoints,
};
