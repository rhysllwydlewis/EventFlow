/**
 * Partner / Affiliate Service
 * Handles partner registration, referral tracking, credit ledger and cashout holds.
 *
 * Credit rules:
 *   REFERRAL_SIGNUP_BONUS  +5 credits   – referred supplier signs up
 *   PACKAGE_BONUS          +10 credits  – first package created by referred supplier within 30 days
 *   FIRST_REVIEW_BONUS     +15 credits  – first customer review received by referred supplier
 *   SUBSCRIPTION_BONUS     +100 credits – first successful payment by referred supplier within 30 days
 *
 * Default conversion: 100 points = £1.00.
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
const CREDIT_MATURITY_DAYS = 30;

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
  CASHOUT_HOLD: 'CASHOUT_HOLD',
  CASHOUT_RELEASE: 'CASHOUT_RELEASE',
};

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
  if (co.length >= 1) {
    return `${co.charAt(0)}***`;
  }
  if (email && email.includes('@')) {
    const [local, domain] = email.split('@');
    return `${(local || 'u').charAt(0)}***@${domain}`;
  }
  return 'S***r';
}

function generateRefCode() {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `p_${random}`;
}

function isWithinAttributionWindow(supplierCreatedAt) {
  if (!supplierCreatedAt) {
    return false;
  }
  const signupMs = new Date(supplierCreatedAt).getTime();
  if (!Number.isFinite(signupMs)) {
    return false;
  }
  const windowMs = ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - signupMs <= windowMs;
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

  const partnerInserted = await dbUnified.insertOne('partners', partner);
  if (!partnerInserted) {
    logger.error('[PARTNER-SVC] insertOne failed', { partnerId: partner.id });
    throw new Error('Failed to create partner record');
  }
  logger.info(`Partner created: ${partner.id} (refCode=${refCode}) for user ${userId}`);
  return partner;
}

async function getPartnerByUserId(userId) {
  return dbUnified.findOne('partners', { userId });
}

async function getPartnerByCurrentRefCode(refCode) {
  const code = cleanRefCode(refCode);
  if (!code) {
    return null;
  }
  return dbUnified.findOne('partners', { refCode: code });
}

/**
 * Get a partner by ref code.
 *
 * This intentionally checks both the current code and archived code history so
 * regenerated partner links keep working for suppliers who click older posts,
 * messages, Facebook group links or campaign assets.
 */
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
  if (!historyEntry) {
    return null;
  }

  return getPartnerById(historyEntry.partnerId);
}

async function getPartnerByAnyRefCode(refCode) {
  return getPartnerByRefCode(refCode);
}

async function getPartnerById(partnerId) {
  return dbUnified.findOne('partners', { id: partnerId });
}

async function listPartners({ search, status } = {}) {
  const all = await dbUnified.read('partners');
  let list = all;
  if (status) {
    list = list.filter(p => p.status === status);
  }
  if (search) {
    const s = search.toLowerCase();
    list = list.filter(
      p => (p.refCode || '').toLowerCase().includes(s) || (p.id || '').toLowerCase().includes(s)
    );
  }
  return list;
}

async function setPartnerStatus(partnerId, status) {
  await dbUnified.updateOne(
    'partners',
    { id: partnerId },
    { $set: { status, updatedAt: new Date().toISOString() } }
  );
}

async function softDeletePartnerByUserId(userId) {
  const partner = await dbUnified.findOne('partners', { userId });
  if (!partner) {
    return false;
  }
  await dbUnified.updateOne(
    'partners',
    { id: partner.id },
    {
      $set: {
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
  );
  logger.info(`Partner ${partner.id} marked as deleted (user ${userId} was deleted)`);
  return true;
}

async function regenerateCode(partnerId) {
  const partner = await getPartnerById(partnerId);
  if (!partner) {
    throw new Error('Partner not found');
  }

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
  const historyEntry = {
    id: uid('pch'),
    partnerId,
    refCode: oldCode,
    replacedByCode: newCode,
    createdAt: partner.createdAt || new Date().toISOString(),
    archivedAt: new Date().toISOString(),
  };

  const historyInserted = await dbUnified.insertOne('partner_code_history', historyEntry);
  if (!historyInserted) {
    logger.error('[PARTNER-SVC] code_history insertOne failed', {
      partnerId: historyEntry.partnerId,
    });
  }

  await dbUnified.updateOne(
    'partners',
    { id: partnerId },
    { $set: { refCode: newCode, updatedAt: new Date().toISOString() } }
  );

  logger.info(`Partner ${partnerId} code regenerated: ${oldCode} → ${newCode}`);
  return { oldCode, newCode };
}

async function getCodeHistory(partnerId) {
  const all = await dbUnified.find('partner_code_history', { partnerId });
  return all.sort((a, b) => new Date(a.archivedAt) - new Date(b.archivedAt));
}

async function recordReferral({
  partnerId,
  supplierUserId,
  supplierCreatedAt,
  source,
  medium,
  campaign,
  content,
  term,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  utm_term,
}) {
  const existing = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (existing) {
    logger.info(`Supplier ${supplierUserId} already attributed to partner ${existing.partnerId}`);
    return existing;
  }

  const signupDate = supplierCreatedAt ? new Date(supplierCreatedAt) : new Date();
  const expiresAt = new Date(signupDate.getTime() + ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);
  const campaignMeta = campaignFieldsFromInput({
    source,
    medium,
    campaign,
    content,
    term,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
  });

  const referral = {
    id: uid('ref'),
    partnerId,
    supplierUserId,
    supplierCreatedAt: signupDate.toISOString(),
    attributionExpiresAt: expiresAt.toISOString(),
    packageQualified: false,
    subscriptionQualified: false,
    createdAt: new Date().toISOString(),
    ...(campaignMeta.source ? { source: campaignMeta.source } : {}),
    ...(campaignMeta.medium ? { medium: campaignMeta.medium } : {}),
    ...(campaignMeta.campaign ? { campaign: campaignMeta.campaign } : {}),
    ...(campaignMeta.content ? { content: campaignMeta.content } : {}),
    ...(campaignMeta.term ? { term: campaignMeta.term } : {}),
  };

  const referralInserted = await dbUnified.insertOne('partner_referrals', referral);
  if (!referralInserted) {
    logger.error('[PARTNER-SVC] referral insertOne failed', { referralId: referral.id });
    throw new Error('Failed to record referral');
  }
  logger.info(`Referral recorded: partner ${partnerId} → supplier ${supplierUserId}`);
  return referral;
}

async function getReferralBySupplierUserId(supplierUserId) {
  return dbUnified.findOne('partner_referrals', { supplierUserId });
}

async function listReferralsByPartnerId(partnerId) {
  return dbUnified.find('partner_referrals', { partnerId });
}

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

async function _awardCredit({ partnerId, supplierUserId, type, amount, notes }) {
  const duplicate = await dbUnified.findOne('partner_credit_transactions', {
    partnerId,
    supplierUserId,
    type,
  });
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

  const creditTxInserted = await dbUnified.insertOne('partner_credit_transactions', txn);
  if (!creditTxInserted) {
    logger.error('[PARTNER-SVC] credit_tx insertOne failed');
  }
  logger.info(
    `Credit awarded: +${amount} (${type}) to partner ${partnerId} for supplier ${supplierUserId}`
  );
  return txn;
}

async function awardPackageBonus(supplierUserId) {
  const referral = await getReferralBySupplierUserId(supplierUserId);
  if (!referral) {
    return null;
  }

  const partner = await getPartnerById(referral.partnerId);
  if (!partner || partner.status !== 'active') {
    return null;
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
    await dbUnified.updateOne(
      'partner_referrals',
      { id: referral.id },
      { $set: { packageQualified: true } }
    );
  }

  return txn;
}

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
  const creditTxInserted = await dbUnified.insertOne('partner_credit_transactions', txn);
  if (!creditTxInserted) {
    logger.error('[PARTNER-SVC] credit_tx insertOne failed');
  }
  logger.info(
    `Admin credit adjustment: ${amount > 0 ? '+' : ''}${amount} to partner ${partnerId} by admin ${adminUserId}`
  );
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

  return _awardCredit({
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

  return _awardCredit({
    partnerId: referral.partnerId,
    supplierUserId,
    type: CREDIT_TYPES.FIRST_REVIEW_BONUS,
    amount: FIRST_REVIEW_BONUS,
    notes: 'First customer review received by referred supplier',
  });
}

async function awardProfileApprovedBonus(_supplierUserId) {
  return null;
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
  const creditTxInserted = await dbUnified.insertOne('partner_credit_transactions', txn);
  if (!creditTxInserted) {
    logger.error('[PARTNER-SVC] credit_tx insertOne failed');
  }
  logger.info(
    `Points debit: -${Math.abs(amount)} from partner ${partnerId} (ref: ${externalRef || 'n/a'})`
  );
  return txn;
}

async function reverseDebit(debitTxnId, partnerId) {
  const debit = await dbUnified.findOne('partner_credit_transactions', {
    id: debitTxnId,
    partnerId,
  });
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
  const creditTxInserted = await dbUnified.insertOne('partner_credit_transactions', reversal);
  if (!creditTxInserted) {
    logger.error('[PARTNER-SVC] credit_tx insertOne failed');
  }
  logger.info(
    `Debit reversed: +${reversalAmount} to partner ${partnerId} (debitTxnId: ${debitTxnId})`
  );
  return reversal;
}

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
  const creditTxInserted = await dbUnified.insertOne('partner_credit_transactions', txn);
  if (!creditTxInserted) {
    logger.error('[PARTNER-SVC] credit_tx insertOne failed');
  }
  logger.info(
    `Cashout hold: -${Math.abs(amount)} from partner ${partnerId} (cashoutId: ${cashoutId})`
  );
  return txn;
}

async function releaseCashoutHold(holdTxnId, partnerId) {
  const hold = await dbUnified.findOne('partner_credit_transactions', { id: holdTxnId, partnerId });
  if (!hold) {
    logger.warn(`releaseCashoutHold: transaction ${holdTxnId} not found for partner ${partnerId}`);
    return null;
  }

  const existingRelease = await dbUnified.findOne('partner_credit_transactions', {
    type: CREDIT_TYPES.CASHOUT_RELEASE,
    partnerId,
    externalRef: holdTxnId,
  });
  if (existingRelease) {
    logger.info(
      `releaseCashoutHold: release already exists (${existingRelease.id}) for hold ${holdTxnId} — skipping duplicate`
    );
    return existingRelease;
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
  const creditTxInserted = await dbUnified.insertOne('partner_credit_transactions', release);
  if (!creditTxInserted) {
    logger.error('[PARTNER-SVC] credit_tx insertOne failed');
  }
  logger.info(
    `Cashout hold released: +${releaseAmount} to partner ${partnerId} (holdTxnId: ${holdTxnId})`
  );
  return release;
}

async function getBalance(partnerId) {
  const partnerTxns = await dbUnified.find('partner_credit_transactions', { partnerId });
  const maturityCutoff = Date.now() - CREDIT_MATURITY_DAYS * 24 * 60 * 60 * 1000;

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

  for (const t of partnerTxns) {
    total += t.amount;
    const earnedAt = new Date(t.createdAt).getTime();
    const isMature = earnedAt <= maturityCutoff;
    const isPositiveAdjustment = t.type === CREDIT_TYPES.ADJUSTMENT && t.amount > 0;
    const isEarnedCredit =
      t.amount > 0 && t.type !== CREDIT_TYPES.ADJUSTMENT && t.type !== CREDIT_TYPES.CASHOUT_RELEASE;

    if (t.type === CREDIT_TYPES.PACKAGE_BONUS) {
      packageBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.SUBSCRIPTION_BONUS) {
      subscriptionBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.REFERRAL_SIGNUP_BONUS) {
      signupBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.FIRST_REVIEW_BONUS) {
      reviewBonusTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.ADJUSTMENT) {
      adjustmentTotal += t.amount;
    } else if (t.type === CREDIT_TYPES.REDEEM || t.type === CREDIT_TYPES.CASHOUT_HOLD) {
      redeemed += Math.abs(t.amount);
    } else if (t.type === CREDIT_TYPES.CASHOUT_RELEASE) {
      redeemed -= Math.abs(t.amount);
    }

    if (isEarnedCredit || isPositiveAdjustment) {
      totalEarned += t.amount;
      if (isMature || isPositiveAdjustment) {
        availableEarned += t.amount;
      } else {
        maturingEarned += t.amount;
      }
    }
  }

  const availableBalance = Math.max(0, availableEarned - redeemed);

  return {
    balance: total,
    availableBalance,
    maturingBalance: maturingEarned,
    totalEarned,
    packageBonusTotal,
    subscriptionBonusTotal,
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
