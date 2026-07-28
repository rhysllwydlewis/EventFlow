'use strict';

const dbUnified = require('../db-unified');
const partnerAntiAbuse = require('./partnerAntiAbuseService');

const HIGH_RISK_SCORE = 60;
const REVIEW_SCORE = 25;
const RAPID_MILESTONE_HOURS = 2;
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

const REWARD_DERIVED_SIGNAL_CODES = new Set([
  'NO_REFERRAL_RECORDS',
  'UNVERIFIED_REFERRED_SUPPLIERS',
  'UNAPPROVED_SUPPLIER_PROFILES',
  'RISKY_SUPPLIER_REGISTRATION_HISTORY',
  'RISKY_SUPPLIER_PHONE_UNVERIFIED',
  'POSSIBLE_SELF_REFERRAL',
  'RAPID_MILESTONE_COMPLETION',
  'PACKAGE_REWARD_WITHOUT_QUALIFYING_PACKAGE',
  'REVIEW_REWARD_WITHOUT_VERIFIED_REVIEW',
  'CONCENTRATED_PRIVATE_EMAIL_DOMAINS',
  'ORPHAN_REWARD_TRANSACTIONS',
]);

function emailDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  return value.includes('@') ? value.split('@').pop() : '';
}

function hoursBetween(earlier, later) {
  const start = Date.parse(earlier);
  const end = Date.parse(later);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
}

function signal(code, score, message, evidence = {}) {
  return { code, score, message, evidence };
}

async function recomputeRewardSignals(partnerId, requestedAt = new Date().toISOString()) {
  const [partners, users, referrals, transactions, suppliers, packages, reviews] = await Promise.all([
    dbUnified.read('partners'),
    dbUnified.read('users'),
    dbUnified.read('partner_referrals'),
    dbUnified.read('partner_credit_transactions'),
    dbUnified.read('suppliers'),
    dbUnified.read('packages'),
    dbUnified.read('reviews'),
  ]);
  const partner = (partners || []).find(item => item.id === partnerId);
  const partnerUser = partner ? (users || []).find(user => user.id === partner.userId) : null;
  const partnerReferrals = (referrals || []).filter(item => item.partnerId === partnerId);
  const milestoneTypes = new Set(partnerAntiAbuse.MILESTONE_REWARD_TYPES || []);
  const activeRewards = (transactions || []).filter(
    transaction =>
      transaction.partnerId === partnerId &&
      transaction.supplierUserId &&
      Number(transaction.amount) > 0 &&
      milestoneTypes.has(transaction.type) &&
      !transaction.reversedAt
  );
  const rewardedSupplierIds = new Set(activeRewards.map(transaction => transaction.supplierUserId));
  const supportingReferrals = partnerReferrals.filter(referral =>
    rewardedSupplierIds.has(referral.supplierUserId)
  );
  const signals = [];

  if (activeRewards.length > 0 && partnerReferrals.length === 0) {
    signals.push(signal('NO_REFERRAL_RECORDS', 40, 'Cashout rewards have no supporting referrals.'));
  }

  const partnerDomain = emailDomain(partnerUser?.email);
  const supplierDomains = new Map();
  let unverifiedSuppliers = 0;
  let unapprovedSupplierProfiles = 0;
  let identityMatches = 0;
  let rapidMilestones = 0;
  let weakPackageRewards = 0;
  let weakReviewRewards = 0;
  let riskyRegistrationSuppliers = 0;
  let riskyUnverifiedPhones = 0;

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
    const supplierIdentity = partnerAntiAbuse.identityOverlap(partnerUser || {}, {
      ...(supplierUser || {}),
      ...(approvedProfiles[0] || {}),
    });
    const registrationSignals = supplierUser?.registrationRiskSignalCodes || [];
    if (
      (partnerDomain &&
        supplierDomain &&
        partnerDomain === supplierDomain &&
        !PUBLIC_EMAIL_DOMAINS.has(partnerDomain)) ||
      supplierIdentity.strongMatch ||
      registrationSignals.includes('PARTNER_SUPPLIER_DEVICE_OVERLAP') ||
      registrationSignals.includes('PARTNER_SUPPLIER_DEVICE_COOKIE_OVERLAP')
    ) {
      identityMatches += 1;
    }
    if (['review', 'high'].includes(supplierUser?.registrationRiskLevel)) {
      riskyRegistrationSuppliers += 1;
      if (
        (supplierUser?.phone || supplierUser?.phoneNumber) &&
        supplierUser?.phoneVerified !== true
      ) {
        riskyUnverifiedPhones += 1;
      }
    }

    const supplierTxns = activeRewards.filter(
      transaction => transaction.supplierUserId === referral.supplierUserId
    );
    const supplierIds = new Set(approvedProfiles.map(profile => profile.id));
    for (const transaction of supplierTxns) {
      const elapsed = hoursBetween(
        referral.supplierCreatedAt || referral.createdAt,
        transaction.createdAt || requestedAt
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
        !(packages || []).some(
          pkg => supplierIds.has(pkg.supplierId) && partnerAntiAbuse.isMeaningfulPackage(pkg)
        )
      ) {
        weakPackageRewards += 1;
      }
      if (
        transaction.type === 'FIRST_REVIEW_BONUS' &&
        !(reviews || []).some(review =>
          partnerAntiAbuse.isIndependentVerifiedReview(
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
    signals.push(
      signal('UNVERIFIED_REFERRED_SUPPLIERS', 30, 'Rewarded suppliers are unverified.', {
        count: unverifiedSuppliers,
      })
    );
  }
  if (unapprovedSupplierProfiles > 0) {
    signals.push(
      signal(
        'UNAPPROVED_SUPPLIER_PROFILES',
        35,
        'Rewarded suppliers do not all have approved business profiles.',
        { count: unapprovedSupplierProfiles }
      )
    );
  }
  if (riskyRegistrationSuppliers > 0) {
    signals.push(
      signal(
        'RISKY_SUPPLIER_REGISTRATION_HISTORY',
        25,
        'Rewarded suppliers include registrations with unresolved identity or network risk.',
        { count: riskyRegistrationSuppliers }
      )
    );
  }
  if (riskyUnverifiedPhones > 0) {
    signals.push(
      signal(
        'RISKY_SUPPLIER_PHONE_UNVERIFIED',
        10,
        'Risk-flagged supplier accounts include unverified supplied phone numbers.',
        { count: riskyUnverifiedPhones }
      )
    );
  }
  if (identityMatches > 0) {
    signals.push(
      signal('POSSIBLE_SELF_REFERRAL', 50, 'Partner and supplier identities overlap.', {
        count: identityMatches,
      })
    );
  }
  if (rapidMilestones > 0) {
    signals.push(
      signal(
        'RAPID_MILESTONE_COMPLETION',
        25,
        'Milestones completed unusually quickly after signup.',
        { count: rapidMilestones }
      )
    );
  }
  if (weakPackageRewards > 0) {
    signals.push(
      signal(
        'PACKAGE_REWARD_WITHOUT_QUALIFYING_PACKAGE',
        60,
        'Package rewards exist without a complete approved package.',
        { count: weakPackageRewards }
      )
    );
  }
  if (weakReviewRewards > 0) {
    signals.push(
      signal(
        'REVIEW_REWARD_WITHOUT_VERIFIED_REVIEW',
        60,
        'Review rewards exist without an approved independently verified review.',
        { count: weakReviewRewards }
      )
    );
  }

  const repeatedDomains = [...supplierDomains.entries()].filter(
    ([domain, count]) => count >= 3 && !PUBLIC_EMAIL_DOMAINS.has(domain)
  );
  if (repeatedDomains.length) {
    signals.push(
      signal(
        'CONCENTRATED_PRIVATE_EMAIL_DOMAINS',
        20,
        'Several rewarded suppliers use the same private email domain.',
        { domains: repeatedDomains.map(([domain, count]) => ({ domain, count })) }
      )
    );
  }

  const orphanRewardSuppliers = [...rewardedSupplierIds].filter(
    supplierUserId =>
      !partnerReferrals.some(referral => referral.supplierUserId === supplierUserId)
  );
  if (orphanRewardSuppliers.length) {
    signals.push(
      signal(
        'ORPHAN_REWARD_TRANSACTIONS',
        60,
        'Reward transactions exist without referral records.',
        { count: orphanRewardSuppliers.length }
      )
    );
  }

  return {
    signals,
    metrics: {
      rewardedReferralCount: supportingReferrals.length,
      unverifiedSupplierCount: unverifiedSuppliers,
      unapprovedSupplierProfileCount: unapprovedSupplierProfiles,
      identityMatchCount: identityMatches,
      rapidMilestoneCount: rapidMilestones,
      weakPackageRewardCount: weakPackageRewards,
      weakReviewRewardCount: weakReviewRewards,
      riskyRegistrationSupplierCount: riskyRegistrationSuppliers,
      riskyUnverifiedPhoneCount: riskyUnverifiedPhones,
      activeRewardTransactionCount: activeRewards.length,
      reversedRewardTransactionCount: (transactions || []).filter(
        transaction =>
          transaction.partnerId === partnerId &&
          milestoneTypes.has(transaction.type) &&
          transaction.reversedAt
      ).length,
    },
  };
}

async function adjustAssessment(assessment, { partnerId, requestedAt }) {
  if (!assessment || !partnerId) return assessment;
  const recomputed = await recomputeRewardSignals(partnerId, requestedAt);
  const nonRewardSignals = (assessment.signals || []).filter(
    item => !REWARD_DERIVED_SIGNAL_CODES.has(item.code)
  );
  const signals = [...nonRewardSignals, ...recomputed.signals];
  const score = Math.min(
    100,
    signals.reduce((total, item) => total + Number(item.score || 0), 0)
  );
  const firstCashout = signals.some(item => item.code === 'FIRST_CASHOUT');
  return {
    ...assessment,
    score,
    riskLevel: score >= HIGH_RISK_SCORE ? 'high' : score >= REVIEW_SCORE ? 'review' : 'low',
    requiresManualReview: score >= REVIEW_SCORE || firstCashout,
    blockApproval: score >= HIGH_RISK_SCORE,
    signals,
    metrics: { ...(assessment.metrics || {}), ...recomputed.metrics },
  };
}

module.exports = {
  adjustAssessment,
  recomputeRewardSignals,
  _test: { REWARD_DERIVED_SIGNAL_CODES, emailDomain, hoursBetween },
};
