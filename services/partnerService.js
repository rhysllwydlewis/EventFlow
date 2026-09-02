/**
 * Partner / Affiliate Service
 * Handles partner registration, referral tracking, reward ledger and cashout holds.
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
const PROFILE_APPROVED_BONUS = 20; // retained for historical ledger compatibility only
const CREDIT_MATURITY_DAYS = 30;

const rawPointsPerGbp = parseInt(process.env.POINTS_PER_GBP, 10);
const POINTS_PER_GBP =
  Number.isInteger(rawPointsPerGbp) && rawPointsPerGbp > 0 ? rawPointsPerGbp : 100;

const CREDIT_TYPES = Object.freeze({
  PACKAGE_BONUS: 'PACKAGE_BONUS',
  SUBSCRIPTION_BONUS: 'SUBSCRIPTION_BONUS',
  REFERRAL_SIGNUP_BONUS: 'REFERRAL_SIGNUP_BONUS',
  FIRST_REVIEW_BONUS: 'FIRST_REVIEW_BONUS',
  PROFILE_APPROVED_BONUS: 'PROFILE_APPROVED_BONUS',
  ADJUSTMENT: 'ADJUSTMENT',
  REDEEM: 'REDEEM',
  CASHOUT_HOLD: 'CASHOUT_HOLD',
  CASHOUT_RELEASE: 'CASHOUT_RELEASE',
});

function assertInserted(result, operation, context = {}) {
  if (!result) {
    const error = new Error(`${operation} did not persist`);
    error.code = 'PARTNER_LEDGER_WRITE_FAILED';
    logger.error(`[PARTNER-SVC] ${operation} failed`, context);
    throw error;
  }
  return result;
}

// Per-key serialization for awardCredit's check-then-insert sequence.
// dbUnified has no atomic "insert if not exists" primitive, so two concurrent
// calls for the same (partnerId, supplierUserId, type) — e.g. a Stripe
// webhook and a dashboard load both reconciling the same reward at once —
// can both pass the duplicate check before either insert lands, double
// crediting real, cashable-out points. Chaining same-key calls through this
// map closes that race for calls within this process; it does not protect
// a horizontally-scaled deployment, which would need a DB-level unique
// index on (partnerId, supplierUserId, type) as well.
const _awardCreditLocks = new Map();

function runExclusive(key, fn) {
  const prior = _awardCreditLocks.get(key) || Promise.resolve();
  const next = prior.then(fn, fn);
  // Keep the chain alive even if this call rejects, without leaking that
  // rejection into unrelated future callers for the same key.
  _awardCreditLocks.set(
    key,
    next.catch(() => {})
  );
  return next;
}

function maskReferralName(name, company, email) {
  const str = (name || '').trim();
  if (str.length >= 2) {
    const first = str.charAt(0);
    const last = str.charAt(str.length - 1);
    const middle = '*'.repeat(Math.max(3, Math.min(str.length - 2, 5)));
    return `${first}${middle}${last}`;
  }
  if (str.length === 1) {
    return `${str}***`;
  }
  const co = (company || '').trim();
  if (co) {
    return `${co.charAt(0)}***`;
  }
  if (email && email.includes('@')) {
    const [local, domain] = email.split('@');
    return `${(local || 'u').charAt(0)}***@${domain}`;
  }
  return 'S***r';
}

function generateRefCode() {
  return `p_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function isWithinAttributionWindow(supplierCreatedAt) {
  if (!supplierCreatedAt) {
    return false;
  }
  const signupMs = new Date(supplierCreatedAt).getTime();
  if (!Number.isFinite(signupMs)) {
    return false;
  }
  return Date.now() - signupMs <= ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;
}

function cleanRefCode(refCode) {
  return typeof refCode === 'string' ? refCode.trim() : '';
}

function sanitizeCampaignValue(value, maxLength = 80) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const clean = value
    .trim()
    .replace(/[^\w\s\-./:@]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
  return clean || undefined;
}

function campaignFieldsFromInput(input = {}) {
  return {
    source: sanitizeCampaignValue(input.source || input.utm_source),
    medium: sanitizeCampaignValue(input.medium || input.utm_medium),
    campaign: sanitizeCampaignValue(input.campaign || input.utm_campaign),
    content: sanitizeCampaignValue(input.content || input.utm_content),
    term: sanitizeCampaignValue(input.term || input.utm_term),
  };
}

async function createPartner(userId) {
  const existing = await dbUnified.findOne('partners', { userId });
  if (existing) {
    return existing;
  }

  let refCode = null;
  for (let i = 0; i < 5; i += 1) {
    const candidate = generateRefCode();
    if (!(await dbUnified.findOne('partners', { refCode: candidate }))) {
      refCode = candidate;
      break;
    }
  }
  if (!refCode) {
    throw new Error('Could not generate unique ref code');
  }

  const now = new Date().toISOString();
  const partner = {
    id: uid('prt'),
    userId,
    refCode,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  assertInserted(await dbUnified.insertOne('partners', partner), 'partner insert', {
    partnerId: partner.id,
  });
  logger.info(`Partner created: ${partner.id} (refCode=${refCode}) for user ${userId}`);
  return partner;
}

const getPartnerByUserId = userId => dbUnified.findOne('partners', { userId });
const getPartnerById = partnerId => dbUnified.findOne('partners', { id: partnerId });

function getPartnerByCurrentRefCode(refCode) {
  const code = cleanRefCode(refCode);
  return code ? dbUnified.findOne('partners', { refCode: code }) : null;
}

async function getPartnerByRefCode(refCode) {
  const code = cleanRefCode(refCode);
  if (!code) {
    return null;
  }
  const current = await getPartnerByCurrentRefCode(code);
  if (current) {
    return current;
  }
  const historyEntry = await dbUnified.findOne('partner_code_history', { refCode: code });
  return historyEntry ? getPartnerById(historyEntry.partnerId) : null;
}

const getPartnerByAnyRefCode = getPartnerByRefCode;

async function listPartners({ search, status } = {}) {
  let list = await dbUnified.read('partners');
  if (status) {
    list = list.filter(partner => partner.status === status);
  }
  if (search) {
    const value = search.toLowerCase();
    list = list.filter(
      partner =>
        (partner.refCode || '').toLowerCase().includes(value) ||
        (partner.id || '').toLowerCase().includes(value)
    );
  }
  return list;
}

function setPartnerStatus(partnerId, status) {
  return dbUnified.updateOne(
    'partners',
    { id: partnerId },
    { $set: { status, updatedAt: new Date().toISOString() } }
  );
}

async function softDeletePartnerByUserId(userId) {
  const partner = await getPartnerByUserId(userId);
  if (!partner) {
    return false;
  }
  const now = new Date().toISOString();
  await dbUnified.updateOne(
    'partners',
    { id: partner.id },
    { $set: { status: 'deleted', deletedAt: now, updatedAt: now } }
  );
  return true;
}

async function regenerateCode(partnerId) {
  const partner = await getPartnerById(partnerId);
  if (!partner) {
    throw new Error('Partner not found');
  }

  let newCode = null;
  for (let i = 0; i < 5; i += 1) {
    const candidate = generateRefCode();
    if (!(await dbUnified.findOne('partners', { refCode: candidate }))) {
      newCode = candidate;
      break;
    }
  }
  if (!newCode) {
    throw new Error('Could not generate unique ref code');
  }

  const oldCode = partner.refCode;
  const now = new Date().toISOString();
  const historyEntry = {
    id: uid('pch'),
    partnerId,
    refCode: oldCode,
    replacedByCode: newCode,
    createdAt: partner.createdAt || now,
    archivedAt: now,
  };
  assertInserted(
    await dbUnified.insertOne('partner_code_history', historyEntry),
    'partner code history insert',
    { partnerId, oldCode, newCode }
  );
  const updated = await dbUnified.updateOne(
    'partners',
    { id: partnerId },
    { $set: { refCode: newCode, updatedAt: now } }
  );
  if (!updated) {
    throw new Error('Failed to update partner code');
  }
  return { oldCode, newCode };
}

async function getCodeHistory(partnerId) {
  const items = await dbUnified.find('partner_code_history', { partnerId });
  return items.sort((a, b) => new Date(a.archivedAt) - new Date(b.archivedAt));
}

async function recordReferral(input) {
  const existing = await dbUnified.findOne('partner_referrals', {
    supplierUserId: input.supplierUserId,
  });
  if (existing) {
    return existing;
  }

  const signupDate = input.supplierCreatedAt ? new Date(input.supplierCreatedAt) : new Date();
  const expiresAt = new Date(signupDate.getTime() + ATTRIBUTION_DAYS * 86400000);
  const campaign = campaignFieldsFromInput(input);
  const referral = {
    id: uid('ref'),
    partnerId: input.partnerId,
    supplierUserId: input.supplierUserId,
    supplierCreatedAt: signupDate.toISOString(),
    attributionExpiresAt: expiresAt.toISOString(),
    packageQualified: false,
    subscriptionQualified: false,
    createdAt: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(campaign).filter(([, value]) => value)),
  };
  assertInserted(await dbUnified.insertOne('partner_referrals', referral), 'referral insert', {
    referralId: referral.id,
  });
  return referral;
}

const getReferralBySupplierUserId = supplierUserId =>
  dbUnified.findOne('partner_referrals', { supplierUserId });
const listReferralsByPartnerId = partnerId => dbUnified.find('partner_referrals', { partnerId });

async function getReviewQualifications(partnerId) {
  const txns = await dbUnified.find('partner_credit_transactions', {
    partnerId,
    type: CREDIT_TYPES.FIRST_REVIEW_BONUS,
  });
  const qualifications = new Map();
  for (const txn of txns) {
    if (txn.supplierUserId && !qualifications.has(txn.supplierUserId)) {
      qualifications.set(txn.supplierUserId, txn.createdAt || null);
    }
  }
  return qualifications;
}

async function getPendingPoints(partnerId) {
  const [referrals, reviewQualifications] = await Promise.all([
    listReferralsByPartnerId(partnerId),
    getReviewQualifications(partnerId),
  ]);
  let pendingPackage = 0;
  let pendingSubscription = 0;
  let pendingReview = 0;

  for (const referral of referrals) {
    if (isWithinAttributionWindow(referral.supplierCreatedAt)) {
      if (!referral.packageQualified) {
        pendingPackage += PACKAGE_BONUS;
      }
      if (!referral.subscriptionQualified) {
        pendingSubscription += SUBSCRIPTION_BONUS;
      }
    }
    if (!reviewQualifications.has(referral.supplierUserId)) {
      pendingReview += FIRST_REVIEW_BONUS;
    }
  }

  return {
    pendingPackage,
    pendingSubscription,
    pendingReview,
    totalPending: pendingPackage + pendingSubscription + pendingReview,
  };
}

function awardCredit({ partnerId, supplierUserId, type, amount, notes }) {
  const lockKey = `${partnerId}:${supplierUserId}:${type}`;
  return runExclusive(lockKey, async () => {
    const duplicate = await dbUnified.findOne('partner_credit_transactions', {
      partnerId,
      supplierUserId,
      type,
    });
    if (duplicate) {
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
    assertInserted(await dbUnified.insertOne('partner_credit_transactions', txn), 'credit insert', {
      partnerId,
      supplierUserId,
      type,
    });
    return txn;
  });
}

async function awardPackageBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral || !isWithinAttributionWindow(referral.supplierCreatedAt)) {
    return null;
  }
  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }
  const txn = await awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.PACKAGE_BONUS,
    amount: PACKAGE_BONUS,
    notes: 'First package created by referred supplier',
  });
  if (txn) {
    await dbUnified.updateOne(
      'partner_referrals',
      { id: referral.id },
      { $set: { packageQualified: true, packageQualifiedAt: txn.createdAt } }
    );
  }
  return txn;
}

async function awardSubscriptionBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral || !isWithinAttributionWindow(referral.supplierCreatedAt)) {
    return null;
  }
  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }
  const txn = await awardCredit({
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
      { $set: { subscriptionQualified: true, subscriptionQualifiedAt: txn.createdAt } }
    );
  }
  return txn;
}

async function awardReferralSignupBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null;
  }
  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }
  return awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.REFERRAL_SIGNUP_BONUS,
    amount: REFERRAL_SIGNUP_BONUS,
    notes: 'Referred supplier signed up',
  });
}

async function awardFirstReviewBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null;
  }
  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
  }
  return awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.FIRST_REVIEW_BONUS,
    amount: FIRST_REVIEW_BONUS,
    notes: 'First customer review received by referred supplier',
  });
}

function awardProfileApprovedBonus() {
  return null;
}

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
  assertInserted(
    await dbUnified.insertOne('partner_credit_transactions', txn),
    'adjustment insert',
    {
      partnerId,
    }
  );
  return txn;
}

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
  assertInserted(
    await dbUnified.insertOne('partner_credit_transactions', txn),
    'points debit insert',
    {
      partnerId,
      externalRef,
    }
  );
  return txn;
}

async function reverseDebit(debitTxnId, partnerId) {
  const debit = await dbUnified.findOne('partner_credit_transactions', {
    id: debitTxnId,
    partnerId,
  });
  if (!debit) {
    return null;
  }
  const reversal = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.ADJUSTMENT,
    amount: Math.abs(debit.amount),
    notes: `Reversal of failed cashout debit (ref: ${debit.externalRef || debitTxnId})`,
    externalRef: debitTxnId,
    createdAt: new Date().toISOString(),
  };
  assertInserted(
    await dbUnified.insertOne('partner_credit_transactions', reversal),
    'debit reversal insert',
    {
      partnerId,
      debitTxnId,
    }
  );
  return reversal;
}

async function createCashoutHold({ partnerId, amount, cashoutId }) {
  const existing = await dbUnified.findOne('partner_credit_transactions', {
    partnerId,
    type: CREDIT_TYPES.CASHOUT_HOLD,
    externalRef: cashoutId,
  });
  if (existing) {
    return existing;
  }

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
  assertInserted(
    await dbUnified.insertOne('partner_credit_transactions', txn),
    'cashout hold insert',
    {
      partnerId,
      cashoutId,
    }
  );
  return txn;
}

async function releaseCashoutHold(holdTxnId, partnerId) {
  const hold = await dbUnified.findOne('partner_credit_transactions', { id: holdTxnId, partnerId });
  if (!hold) {
    return null;
  }
  const existing = await dbUnified.findOne('partner_credit_transactions', {
    type: CREDIT_TYPES.CASHOUT_RELEASE,
    partnerId,
    externalRef: holdTxnId,
  });
  if (existing) {
    return existing;
  }

  const release = {
    id: uid('ptx'),
    partnerId,
    supplierUserId: null,
    type: CREDIT_TYPES.CASHOUT_RELEASE,
    amount: Math.abs(hold.amount),
    notes: `Release of cashout hold (ref: ${hold.externalRef || holdTxnId})`,
    externalRef: holdTxnId,
    createdAt: new Date().toISOString(),
  };
  assertInserted(
    await dbUnified.insertOne('partner_credit_transactions', release),
    'cashout release insert',
    {
      partnerId,
      holdTxnId,
    }
  );
  return release;
}

async function getBalance(partnerId) {
  const partnerTxns = await dbUnified.find('partner_credit_transactions', { partnerId });
  const maturityCutoff = Date.now() - CREDIT_MATURITY_DAYS * 86400000;
  let total = 0;
  let availableEarned = 0;
  let maturingEarned = 0;
  let packageBonusTotal = 0;
  let subscriptionBonusTotal = 0;
  let signupBonusTotal = 0;
  let reviewBonusTotal = 0;
  let adjustmentTotal = 0;
  let redeemed = 0;
  let totalEarned = 0;

  for (const txn of partnerTxns) {
    total += txn.amount;
    const earnedAt = new Date(txn.createdAt).getTime();
    const isMature = earnedAt <= maturityCutoff;
    const isPositiveAdjustment = txn.type === CREDIT_TYPES.ADJUSTMENT && txn.amount > 0;
    const isEarnedCredit =
      txn.amount > 0 &&
      txn.type !== CREDIT_TYPES.ADJUSTMENT &&
      txn.type !== CREDIT_TYPES.CASHOUT_RELEASE;

    if (txn.type === CREDIT_TYPES.PACKAGE_BONUS) {
      packageBonusTotal += txn.amount;
    } else if (txn.type === CREDIT_TYPES.SUBSCRIPTION_BONUS) {
      subscriptionBonusTotal += txn.amount;
    } else if (txn.type === CREDIT_TYPES.REFERRAL_SIGNUP_BONUS) {
      signupBonusTotal += txn.amount;
    } else if (txn.type === CREDIT_TYPES.FIRST_REVIEW_BONUS) {
      reviewBonusTotal += txn.amount;
    } else if (txn.type === CREDIT_TYPES.ADJUSTMENT) {
      adjustmentTotal += txn.amount;
    } else if (txn.type === CREDIT_TYPES.REDEEM || txn.type === CREDIT_TYPES.CASHOUT_HOLD) {
      redeemed += Math.abs(txn.amount);
    } else if (txn.type === CREDIT_TYPES.CASHOUT_RELEASE) {
      redeemed -= Math.abs(txn.amount);
    }

    if (isEarnedCredit || isPositiveAdjustment) {
      totalEarned += txn.amount;
      if (isMature || isPositiveAdjustment) {
        availableEarned += txn.amount;
      } else {
        maturingEarned += txn.amount;
      }
    }
  }

  return {
    balance: total,
    availableBalance: Math.max(0, availableEarned - redeemed),
    maturingBalance: maturingEarned,
    totalEarned,
    packageBonusTotal,
    subscriptionBonusTotal,
    signupBonusTotal,
    reviewBonusTotal,
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
  createPartner,
  getPartnerByUserId,
  getPartnerByCurrentRefCode,
  getPartnerByRefCode,
  getPartnerByAnyRefCode,
  getPartnerById,
  listPartners,
  setPartnerStatus,
  softDeletePartnerByUserId,
  regenerateCode,
  getCodeHistory,
  recordReferral,
  getReferralBySupplierUserId,
  listReferralsByPartnerId,
  getReviewQualifications,
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
