'use strict';

const crypto = require('crypto');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const HIGH_RISK_SCORE = 60;
const REVIEW_SCORE = 25;
const FIRST_CASHOUT_REVIEW_SCORE = 20;
const RAPID_CASHOUT_HOURS = 72;
const RAPID_MILESTONE_HOURS = 2;
const MIN_REVIEWER_ACCOUNT_HOURS = 24;
const MILESTONE_REWARD_TYPES = Object.freeze([
  'PACKAGE_BONUS',
  'SUBSCRIPTION_BONUS',
  'REFERRAL_SIGNUP_BONUS',
  'FIRST_REVIEW_BONUS',
]);
const MILESTONE_REWARD_TYPE_SET = new Set(MILESTONE_REWARD_TYPES);
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
]);

let rewardGuardsInstalled = false;

function normalise(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function emailDomain(email) {
  const value = String(email || '')
    .trim()
    .toLowerCase();
  return value.includes('@') ? value.split('@').pop() : '';
}

function hoursBetween(earlier, later) {
  const start = new Date(earlier).getTime();
  const end = new Date(later).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
}

function addSignal(signals, code, score, message, evidence = {}) {
  signals.push({ code, score, message, evidence });
}

function assessmentId(partnerId, requestId) {
  return crypto
    .createHash('sha256')
    .update(`${partnerId}:${requestId || 'preview'}`)
    .digest('hex')
    .slice(0, 20);
}

function isMeaningfulPackage(pkg) {
  return Boolean(
    pkg &&
    pkg.approved === true &&
    pkg.paused !== true &&
    String(pkg.title || '').trim().length >= 3 &&
    String(pkg.price || '').trim() &&
    String(pkg.primaryCategoryKey || '').trim() &&
    Array.isArray(pkg.eventTypes) &&
    pkg.eventTypes.length > 0
  );
}

function isIndependentVerifiedReview(review, users, supplierIds, supplierUserId, partnerUserId) {
  if (!review || !supplierIds.has(review.supplierId)) return false;
  if (review.approved !== true || review.flagged === true) return false;
  if (review.emailVerified !== true || review.verified !== true) return false;
  if (!review.userId || review.userId === supplierUserId || review.userId === partnerUserId) {
    return false;
  }

  const reviewer = (users || []).find(user => user.id === review.userId);
  if (!reviewer || reviewer.verified !== true || reviewer.role === 'supplier') return false;

  const reviewerAge = reviewer.createdAt
    ? hoursBetween(reviewer.createdAt, review.createdAt || new Date().toISOString())
    : null;
  return reviewerAge !== null && reviewerAge >= MIN_REVIEWER_ACCOUNT_HOURS;
}

async function getApprovedSupplierProfiles(supplierUserId) {
  const profiles = await dbUnified.find('suppliers', { ownerUserId: supplierUserId });
  return (profiles || []).filter(profile => profile && profile.approved === true);
}

async function packageRewardEvidence(supplierUserId) {
  const profiles = await getApprovedSupplierProfiles(supplierUserId);
  if (!profiles.length) {
    return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  }
  const supplierIds = new Set(profiles.map(profile => profile.id));
  const packages = await dbUnified.read('packages');
  const qualifying = (packages || []).find(
    pkg => supplierIds.has(pkg.supplierId) && isMeaningfulPackage(pkg)
  );
  return qualifying
    ? { eligible: true, qualifyingPackageId: qualifying.id }
    : { eligible: false, reason: 'QUALIFYING_PACKAGE_MISSING' };
}

async function reviewRewardEvidence(supplierUserId, partnerUserId) {
  const profiles = await getApprovedSupplierProfiles(supplierUserId);
  if (!profiles.length) {
    return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  }
  const supplierIds = new Set(profiles.map(profile => profile.id));
  const [reviews, users] = await Promise.all([dbUnified.read('reviews'), dbUnified.read('users')]);
  const qualifying = (reviews || []).find(review =>
    isIndependentVerifiedReview(review, users, supplierIds, supplierUserId, partnerUserId)
  );
  return qualifying
    ? { eligible: true, qualifyingReviewId: qualifying.id }
    : { eligible: false, reason: 'INDEPENDENT_VERIFIED_REVIEW_MISSING' };
}

async function supplierRewardEligibility(supplierUserId, methodName = 'awardReferralSignupBonus') {
  const supplier = await dbUnified.findOne('users', { id: supplierUserId });
  if (!supplier || supplier.role !== 'supplier') {
    return { eligible: false, reason: 'SUPPLIER_ACCOUNT_MISSING' };
  }
  if (supplier.verified !== true) {
    return { eligible: false, reason: 'SUPPLIER_EMAIL_UNVERIFIED', supplier };
  }
  if (!String(supplier.company || '').trim()) {
    return { eligible: false, reason: 'SUPPLIER_COMPANY_MISSING', supplier };
  }

  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (!referral) return { eligible: false, reason: 'REFERRAL_RECORD_MISSING', supplier };

  const partner = await dbUnified.findOne('partners', { id: referral.partnerId });
  if (!partner || partner.status !== 'active') {
    return { eligible: false, reason: 'PARTNER_NOT_ACTIVE', supplier, referral };
  }
  const partnerUser = await dbUnified.findOne('users', { id: partner.userId });
  if (!partnerUser || partnerUser.verified !== true) {
    return { eligible: false, reason: 'PARTNER_IDENTITY_INVALID', supplier, referral, partner };
  }

  const supplierCompany = normalise(supplier.company);
  const partnerCompany = normalise(partnerUser.company);
  const supplierDomain = emailDomain(supplier.email);
  const partnerDomain = emailDomain(partnerUser.email);
  const samePrivateDomain =
    supplierDomain &&
    partnerDomain &&
    supplierDomain === partnerDomain &&
    !PUBLIC_EMAIL_DOMAINS.has(supplierDomain);
  const sameCompany = supplierCompany && partnerCompany && supplierCompany === partnerCompany;

  if (partner.userId === supplierUserId || samePrivateDomain || sameCompany) {
    return {
      eligible: false,
      reason: 'POSSIBLE_SELF_REFERRAL',
      supplier,
      referral,
      partner,
      evidence: { samePrivateDomain, sameCompany },
    };
  }

  const approvedProfiles = await getApprovedSupplierProfiles(supplierUserId);
  if (!approvedProfiles.length) {
    return {
      eligible: false,
      reason: 'SUPPLIER_PROFILE_NOT_APPROVED',
      supplier,
      referral,
      partner,
    };
  }

  if (methodName === 'awardPackageBonus') {
    const evidence = await packageRewardEvidence(supplierUserId);
    if (!evidence.eligible) return { ...evidence, supplier, referral, partner };
  }
  if (methodName === 'awardFirstReviewBonus') {
    const evidence = await reviewRewardEvidence(supplierUserId, partner.userId);
    if (!evidence.eligible) return { ...evidence, supplier, referral, partner };
  }

  return { eligible: true, supplier, referral, partner, partnerUser };
}

function installRewardGuards(partnerService = require('./partnerService')) {
  if (rewardGuardsInstalled) return partnerService;
  const rewardMethods = [
    'awardReferralSignupBonus',
    'awardPackageBonus',
    'awardFirstReviewBonus',
    'awardSubscriptionBonus',
  ];

  for (const methodName of rewardMethods) {
    const original = partnerService[methodName];
    if (typeof original !== 'function') continue;
    partnerService[methodName] = async supplierUserId => {
      const eligibility = await supplierRewardEligibility(supplierUserId, methodName);
      if (!eligibility.eligible) {
        logger.warn('[PARTNER-ANTI-ABUSE] Reward withheld', {
          methodName,
          supplierUserId,
          reason: eligibility.reason,
          evidence: eligibility.evidence,
        });
        return null;
      }
      return original(supplierUserId);
    };
  }

  rewardGuardsInstalled = true;
  logger.info('[PARTNER-ANTI-ABUSE] Reward eligibility guards installed');
  return partnerService;
}

async function assessCashout({
  partnerId,
  requestId = null,
  requestedAt = new Date().toISOString(),
}) {
  const [partners, users, referrals, transactions, requests, suppliers, packages, reviews] =
    await Promise.all([
      dbUnified.read('partners'),
      dbUnified.read('users'),
      dbUnified.read('partner_referrals'),
      dbUnified.read('partner_credit_transactions'),
      dbUnified.read('partner_cashout_requests'),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
      dbUnified.read('reviews'),
    ]);

  const partner = (partners || []).find(item => item.id === partnerId);
  const partnerUser = partner ? (users || []).find(user => user.id === partner.userId) : null;
  const partnerReferrals = (referrals || []).filter(item => item.partnerId === partnerId);
  const partnerTransactions = (transactions || []).filter(item => item.partnerId === partnerId);
  const rewardTransactions = partnerTransactions.filter(
    transaction =>
      transaction.supplierUserId &&
      Number(transaction.amount) > 0 &&
      MILESTONE_REWARD_TYPE_SET.has(transaction.type)
  );
  const rewardedSupplierIds = new Set(
    rewardTransactions.map(transaction => transaction.supplierUserId)
  );
  const supportingReferrals = partnerReferrals.filter(referral =>
    rewardedSupplierIds.has(referral.supplierUserId)
  );
  const priorRequests = (requests || []).filter(
    item => item.partnerId === partnerId && item.id !== requestId
  );
  const priorDeliveredRequests = priorRequests.filter(item => item.status === 'delivered');
  const firstDeliveredCashout = priorDeliveredRequests.length === 0;
  const signals = [];

  if (!partner || !partnerUser) {
    addSignal(signals, 'MISSING_PARTNER_IDENTITY', 100, 'Partner identity record is missing.');
  } else {
    if (partner.status !== 'active') {
      addSignal(signals, 'PARTNER_NOT_ACTIVE', 100, 'Partner account is not active.', {
        status: partner.status,
      });
    }
    if (partnerUser.verified !== true) {
      addSignal(signals, 'PARTNER_EMAIL_UNVERIFIED', 50, 'Partner email is not verified.');
    }
  }

  if (firstDeliveredCashout) {
    addSignal(
      signals,
      'FIRST_CASHOUT',
      FIRST_CASHOUT_REVIEW_SCORE,
      'No previous cashout has been delivered; this request requires a recorded manual review.'
    );
  }

  const partnerAgeHours = partner?.createdAt ? hoursBetween(partner.createdAt, requestedAt) : null;
  if (firstDeliveredCashout && partnerAgeHours !== null && partnerAgeHours < RAPID_CASHOUT_HOURS) {
    addSignal(
      signals,
      'RAPID_FIRST_CASHOUT',
      35,
      'Cashout requested shortly after partner signup.',
      {
        partnerAgeHours: Math.round(partnerAgeHours * 10) / 10,
      }
    );
  }
  if (rewardTransactions.length > 0 && partnerReferrals.length === 0) {
    addSignal(signals, 'NO_REFERRAL_RECORDS', 40, 'Cashout rewards have no supporting referrals.');
  }

  const partnerCompany = normalise(partnerUser?.company);
  const partnerDomain = emailDomain(partnerUser?.email);
  const supplierDomains = new Map();
  let unverifiedSuppliers = 0;
  let unapprovedSupplierProfiles = 0;
  let identityMatches = 0;
  let rapidMilestones = 0;
  let weakPackageRewards = 0;
  let weakReviewRewards = 0;

  for (const referral of supportingReferrals) {
    const supplierUser = (users || []).find(user => user.id === referral.supplierUserId);
    if (!supplierUser || supplierUser.verified !== true) unverifiedSuppliers += 1;
    const supplierProfiles = (suppliers || []).filter(
      profile => profile.ownerUserId === referral.supplierUserId
    );
    const approvedProfiles = supplierProfiles.filter(profile => profile.approved === true);
    if (!approvedProfiles.length) unapprovedSupplierProfiles += 1;

    const supplierDomain = emailDomain(supplierUser?.email);
    if (supplierDomain) {
      supplierDomains.set(supplierDomain, (supplierDomains.get(supplierDomain) || 0) + 1);
    }
    const supplierCompany = normalise(supplierUser?.company);
    if (
      (partnerDomain &&
        supplierDomain &&
        partnerDomain === supplierDomain &&
        !PUBLIC_EMAIL_DOMAINS.has(partnerDomain)) ||
      (partnerCompany && supplierCompany && partnerCompany === supplierCompany)
    ) {
      identityMatches += 1;
    }

    const supplierTxns = rewardTransactions.filter(
      transaction => transaction.supplierUserId === referral.supplierUserId
    );
    const supplierIds = new Set(approvedProfiles.map(profile => profile.id));
    for (const transaction of supplierTxns) {
      const elapsed = hoursBetween(
        referral.supplierCreatedAt || referral.createdAt,
        transaction.createdAt
      );
      if (
        elapsed !== null &&
        elapsed < RAPID_MILESTONE_HOURS &&
        transaction.type !== 'REFERRAL_SIGNUP_BONUS'
      ) {
        rapidMilestones += 1;
      }
      if (
        transaction.type === 'PACKAGE_BONUS' &&
        !(packages || []).some(pkg => supplierIds.has(pkg.supplierId) && isMeaningfulPackage(pkg))
      ) {
        weakPackageRewards += 1;
      }
      if (
        transaction.type === 'FIRST_REVIEW_BONUS' &&
        !(reviews || []).some(review =>
          isIndependentVerifiedReview(
            review,
            users,
            supplierIds,
            referral.supplierUserId,
            partner?.userId
          )
        )
      ) {
        weakReviewRewards += 1;
      }
    }
  }

  if (unverifiedSuppliers > 0) {
    addSignal(signals, 'UNVERIFIED_REFERRED_SUPPLIERS', 30, 'Rewarded suppliers are unverified.', {
      count: unverifiedSuppliers,
    });
  }
  if (unapprovedSupplierProfiles > 0) {
    addSignal(
      signals,
      'UNAPPROVED_SUPPLIER_PROFILES',
      35,
      'Rewarded suppliers do not all have approved business profiles.',
      { count: unapprovedSupplierProfiles }
    );
  }
  if (identityMatches > 0) {
    addSignal(signals, 'POSSIBLE_SELF_REFERRAL', 50, 'Partner and supplier identities overlap.', {
      count: identityMatches,
    });
  }
  if (rapidMilestones > 0) {
    addSignal(
      signals,
      'RAPID_MILESTONE_COMPLETION',
      25,
      'Milestones completed unusually quickly after signup.',
      { count: rapidMilestones }
    );
  }
  if (weakPackageRewards > 0) {
    addSignal(
      signals,
      'PACKAGE_REWARD_WITHOUT_QUALIFYING_PACKAGE',
      60,
      'Package rewards exist without a complete approved package.',
      { count: weakPackageRewards }
    );
  }
  if (weakReviewRewards > 0) {
    addSignal(
      signals,
      'REVIEW_REWARD_WITHOUT_VERIFIED_REVIEW',
      60,
      'Review rewards exist without an approved independently verified review.',
      { count: weakReviewRewards }
    );
  }

  const repeatedDomains = [...supplierDomains.entries()].filter(
    ([domain, count]) => count >= 3 && !PUBLIC_EMAIL_DOMAINS.has(domain)
  );
  if (repeatedDomains.length) {
    addSignal(
      signals,
      'CONCENTRATED_PRIVATE_EMAIL_DOMAINS',
      20,
      'Several rewarded suppliers use the same private email domain.',
      { domains: repeatedDomains.map(([domain, count]) => ({ domain, count })) }
    );
  }

  const orphanRewardSuppliers = [...rewardedSupplierIds].filter(
    supplierUserId => !partnerReferrals.some(referral => referral.supplierUserId === supplierUserId)
  );
  if (orphanRewardSuppliers.length) {
    addSignal(
      signals,
      'ORPHAN_REWARD_TRANSACTIONS',
      60,
      'Reward transactions exist without referral records.',
      { count: orphanRewardSuppliers.length }
    );
  }

  const score = Math.min(
    100,
    signals.reduce((total, signal) => total + signal.score, 0)
  );
  const result = {
    id: assessmentId(partnerId, requestId),
    partnerId,
    requestId,
    score,
    riskLevel: score >= HIGH_RISK_SCORE ? 'high' : score >= REVIEW_SCORE ? 'review' : 'low',
    requiresManualReview: score >= REVIEW_SCORE || firstDeliveredCashout,
    blockApproval: score >= HIGH_RISK_SCORE,
    signals,
    metrics: {
      referralCount: partnerReferrals.length,
      rewardedReferralCount: supportingReferrals.length,
      priorCashoutCount: priorRequests.length,
      priorDeliveredCashoutCount: priorDeliveredRequests.length,
      unverifiedSupplierCount: unverifiedSuppliers,
      unapprovedSupplierProfileCount: unapprovedSupplierProfiles,
      identityMatchCount: identityMatches,
      rapidMilestoneCount: rapidMilestones,
      weakPackageRewardCount: weakPackageRewards,
      weakReviewRewardCount: weakReviewRewards,
    },
    assessedAt: new Date().toISOString(),
  };

  logger.info('[PARTNER-ANTI-ABUSE] Cashout assessed', {
    partnerId,
    requestId,
    score: result.score,
    riskLevel: result.riskLevel,
    signalCodes: signals.map(signal => signal.code),
  });
  return result;
}

async function persistAssessment(assessment) {
  const existing = assessment.requestId
    ? await dbUnified.findOne('partner_fraud_assessments', { requestId: assessment.requestId })
    : null;
  if (existing) {
    const updated = await dbUnified.updateOne(
      'partner_fraud_assessments',
      { id: existing.id },
      { $set: { ...assessment, id: existing.id } }
    );
    if (!updated) throw new Error('Fraud assessment update did not persist');
    return { ...assessment, id: existing.id };
  }
  const inserted = await dbUnified.insertOne('partner_fraud_assessments', assessment);
  if (!inserted) throw new Error('Fraud assessment did not persist');
  return assessment;
}

module.exports = {
  HIGH_RISK_SCORE,
  REVIEW_SCORE,
  MILESTONE_REWARD_TYPES,
  assessCashout,
  persistAssessment,
  supplierRewardEligibility,
  packageRewardEvidence,
  reviewRewardEvidence,
  installRewardGuards,
  emailDomain,
  normalise,
  isMeaningfulPackage,
  isIndependentVerifiedReview,
};
