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

const COUNT_SIGNAL_DEFINITIONS = Object.freeze([
  {
    metric: 'unverifiedSupplierCount',
    code: 'UNVERIFIED_REFERRED_SUPPLIERS',
    score: 30,
    message: 'Rewarded suppliers are unverified.',
  },
  {
    metric: 'unapprovedSupplierProfileCount',
    code: 'UNAPPROVED_SUPPLIER_PROFILES',
    score: 35,
    message: 'Rewarded suppliers do not all have approved business profiles.',
  },
  {
    metric: 'riskyRegistrationSupplierCount',
    code: 'RISKY_SUPPLIER_REGISTRATION_HISTORY',
    score: 25,
    message: 'Rewarded suppliers include registrations with unresolved identity or network risk.',
  },
  {
    metric: 'riskyUnverifiedPhoneCount',
    code: 'RISKY_SUPPLIER_PHONE_UNVERIFIED',
    score: 10,
    message: 'Risk-flagged supplier accounts include unverified supplied phone numbers.',
  },
  {
    metric: 'identityMatchCount',
    code: 'POSSIBLE_SELF_REFERRAL',
    score: 50,
    message: 'Partner and supplier identities overlap.',
  },
  {
    metric: 'rapidMilestoneCount',
    code: 'RAPID_MILESTONE_COMPLETION',
    score: 25,
    message: 'Milestones completed unusually quickly after signup.',
  },
  {
    metric: 'weakPackageRewardCount',
    code: 'PACKAGE_REWARD_WITHOUT_QUALIFYING_PACKAGE',
    score: 60,
    message: 'Package rewards exist without a complete approved package.',
  },
  {
    metric: 'weakReviewRewardCount',
    code: 'REVIEW_REWARD_WITHOUT_VERIFIED_REVIEW',
    score: 60,
    message: 'Review rewards exist without an approved independently verified review.',
  },
]);

const emailDomain = email => {
  const value = String(email || '')
    .trim()
    .toLowerCase();
  return value.includes('@') ? value.split('@').pop() : '';
};

const hoursBetween = (earlier, later) => {
  const start = Date.parse(earlier);
  const end = Date.parse(later);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
};

const signal = (code, score, message, evidence = {}) => ({ code, score, message, evidence });

const loadRiskCollections = async () => {
  const [partners, users, referrals, transactions, suppliers, packages, reviews] =
    await Promise.all([
      dbUnified.read('partners'),
      dbUnified.read('users'),
      dbUnified.read('partner_referrals'),
      dbUnified.read('partner_credit_transactions'),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
      dbUnified.read('reviews'),
    ]);
  return {
    partners: partners || [],
    users: users || [],
    referrals: referrals || [],
    transactions: transactions || [],
    suppliers: suppliers || [],
    packages: packages || [],
    reviews: reviews || [],
  };
};

const buildRewardContext = (partnerId, collections) => {
  const partner = collections.partners.find(item => item.id === partnerId);
  const partnerUser = partner
    ? collections.users.find(user => user.id === partner.userId) || null
    : null;
  const partnerReferrals = collections.referrals.filter(item => item.partnerId === partnerId);
  const milestoneTypes = new Set(partnerAntiAbuse.MILESTONE_REWARD_TYPES || []);
  const activeRewards = collections.transactions.filter(
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
  const reversedRewardTransactionCount = collections.transactions.filter(
    transaction =>
      transaction.partnerId === partnerId &&
      milestoneTypes.has(transaction.type) &&
      transaction.reversedAt
  ).length;
  return {
    partner,
    partnerUser,
    partnerReferrals,
    milestoneTypes,
    activeRewards,
    rewardedSupplierIds,
    supportingReferrals,
    reversedRewardTransactionCount,
  };
};

const createMetrics = context => ({
  rewardedReferralCount: context.supportingReferrals.length,
  unverifiedSupplierCount: 0,
  unapprovedSupplierProfileCount: 0,
  identityMatchCount: 0,
  rapidMilestoneCount: 0,
  weakPackageRewardCount: 0,
  weakReviewRewardCount: 0,
  riskyRegistrationSupplierCount: 0,
  riskyUnverifiedPhoneCount: 0,
  activeRewardTransactionCount: context.activeRewards.length,
  reversedRewardTransactionCount: context.reversedRewardTransactionCount,
});

const hasIdentityRisk = ({
  partnerDomain,
  supplierDomain,
  supplierIdentity,
  registrationSignals,
}) =>
  Boolean(
    (partnerDomain &&
      supplierDomain &&
      partnerDomain === supplierDomain &&
      !PUBLIC_EMAIL_DOMAINS.has(partnerDomain)) ||
    supplierIdentity.strongMatch ||
    registrationSignals.includes('PARTNER_SUPPLIER_DEVICE_OVERLAP') ||
    registrationSignals.includes('PARTNER_SUPPLIER_DEVICE_COOKIE_OVERLAP')
  );

const updateRegistrationMetrics = (supplierUser, metrics) => {
  if (!['review', 'high'].includes(supplierUser?.registrationRiskLevel)) return;
  metrics.riskyRegistrationSupplierCount += 1;
  const hasPhone = supplierUser?.phone || supplierUser?.phoneNumber;
  if (hasPhone && supplierUser?.phoneVerified !== true) {
    metrics.riskyUnverifiedPhoneCount += 1;
  }
};

const hasQualifyingPackage = (supplierIds, packages) =>
  packages.some(
    pkg => supplierIds.has(pkg.supplierId) && partnerAntiAbuse.isMeaningfulPackage(pkg)
  );

const hasQualifyingReview = ({ supplierIds, reviews, users, referral, partner }) =>
  reviews.some(review =>
    partnerAntiAbuse.isIndependentVerifiedReview(
      review,
      users,
      supplierIds,
      referral.supplierUserId,
      partner?.userId
    )
  );

const analyseRewardTransaction = ({
  transaction,
  referral,
  requestedAt,
  supplierIds,
  collections,
  context,
  metrics,
}) => {
  const elapsed = hoursBetween(
    referral.supplierCreatedAt || referral.createdAt,
    transaction.createdAt || requestedAt
  );
  if (
    elapsed !== null &&
    elapsed < RAPID_MILESTONE_HOURS &&
    transaction.type !== 'REFERRAL_SIGNUP_BONUS'
  ) {
    metrics.rapidMilestoneCount += 1;
  }
  if (
    transaction.type === 'PACKAGE_BONUS' &&
    !hasQualifyingPackage(supplierIds, collections.packages)
  ) {
    metrics.weakPackageRewardCount += 1;
  }
  if (
    transaction.type === 'FIRST_REVIEW_BONUS' &&
    !hasQualifyingReview({
      supplierIds,
      reviews: collections.reviews,
      users: collections.users,
      referral,
      partner: context.partner,
    })
  ) {
    metrics.weakReviewRewardCount += 1;
  }
};

const analyseSupportingReferral = ({
  referral,
  requestedAt,
  partnerDomain,
  supplierDomains,
  collections,
  context,
  metrics,
}) => {
  const supplierUser = collections.users.find(user => user.id === referral.supplierUserId);
  if (!supplierUser || supplierUser.verified !== true) metrics.unverifiedSupplierCount += 1;

  const supplierProfiles = collections.suppliers.filter(
    profile => profile.ownerUserId === referral.supplierUserId
  );
  const approvedProfiles = supplierProfiles.filter(profile => profile.approved === true);
  if (!approvedProfiles.length) metrics.unapprovedSupplierProfileCount += 1;

  const supplierDomain = emailDomain(supplierUser?.email);
  if (supplierDomain) {
    supplierDomains.set(supplierDomain, (supplierDomains.get(supplierDomain) || 0) + 1);
  }
  const supplierIdentity = partnerAntiAbuse.identityOverlap(context.partnerUser || {}, {
    ...(supplierUser || {}),
    ...(approvedProfiles[0] || {}),
  });
  const registrationSignals = supplierUser?.registrationRiskSignalCodes || [];
  if (hasIdentityRisk({ partnerDomain, supplierDomain, supplierIdentity, registrationSignals })) {
    metrics.identityMatchCount += 1;
  }
  updateRegistrationMetrics(supplierUser, metrics);

  const supplierIds = new Set(approvedProfiles.map(profile => profile.id));
  const supplierTransactions = context.activeRewards.filter(
    transaction => transaction.supplierUserId === referral.supplierUserId
  );
  for (const transaction of supplierTransactions) {
    analyseRewardTransaction({
      transaction,
      referral,
      requestedAt,
      supplierIds,
      collections,
      context,
      metrics,
    });
  }
};

const appendCountSignals = (signals, metrics) => {
  for (const definition of COUNT_SIGNAL_DEFINITIONS) {
    const count = metrics[definition.metric];
    if (count > 0) {
      signals.push(signal(definition.code, definition.score, definition.message, { count }));
    }
  }
};

const appendRepeatedDomainSignal = (signals, supplierDomains) => {
  const repeatedDomains = [...supplierDomains.entries()].filter(
    ([domain, count]) => count >= 3 && !PUBLIC_EMAIL_DOMAINS.has(domain)
  );
  if (!repeatedDomains.length) return;
  signals.push(
    signal(
      'CONCENTRATED_PRIVATE_EMAIL_DOMAINS',
      20,
      'Several rewarded suppliers use the same private email domain.',
      { domains: repeatedDomains.map(([domain, count]) => ({ domain, count })) }
    )
  );
};

const appendOrphanRewardSignal = (signals, context) => {
  const orphanRewardSuppliers = [...context.rewardedSupplierIds].filter(
    supplierUserId =>
      !context.partnerReferrals.some(referral => referral.supplierUserId === supplierUserId)
  );
  if (!orphanRewardSuppliers.length) return;
  signals.push(
    signal(
      'ORPHAN_REWARD_TRANSACTIONS',
      60,
      'Reward transactions exist without referral records.',
      { count: orphanRewardSuppliers.length }
    )
  );
};

const recomputeRewardSignals = async (partnerId, requestedAt = new Date().toISOString()) => {
  const collections = await loadRiskCollections();
  const context = buildRewardContext(partnerId, collections);
  const signals = [];
  if (context.activeRewards.length > 0 && context.partnerReferrals.length === 0) {
    signals.push(
      signal('NO_REFERRAL_RECORDS', 40, 'Cashout rewards have no supporting referrals.')
    );
  }

  const metrics = createMetrics(context);
  const supplierDomains = new Map();
  const partnerDomain = emailDomain(context.partnerUser?.email);
  for (const referral of context.supportingReferrals) {
    analyseSupportingReferral({
      referral,
      requestedAt,
      partnerDomain,
      supplierDomains,
      collections,
      context,
      metrics,
    });
  }

  appendCountSignals(signals, metrics);
  appendRepeatedDomainSignal(signals, supplierDomains);
  appendOrphanRewardSignal(signals, context);
  return { signals, metrics };
};

const adjustAssessment = async (assessment, { partnerId, requestedAt }) => {
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
};

module.exports = {
  adjustAssessment,
  recomputeRewardSignals,
  _test: { REWARD_DERIVED_SIGNAL_CODES, emailDomain, hoursBetween },
};
