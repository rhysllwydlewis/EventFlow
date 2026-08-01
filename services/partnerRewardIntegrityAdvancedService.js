'use strict';

const dbUnified = require('../db-unified');
const baseIntegrity = require('./partnerRewardIntegrityService');

const MILESTONE_TYPES = new Set([
  'PACKAGE_BONUS',
  'SUBSCRIPTION_BONUS',
  'REFERRAL_SIGNUP_BONUS',
  'FIRST_REVIEW_BONUS',
]);

const DEFAULT_PROHIBITED_CAMPAIGN_TERMS = [
  'paid signup',
  'paid-signup',
  'fake signup',
  'fake-signup',
  'cash for signup',
  'cash-for-signup',
  'incentivised signup',
  'incentivized signup',
  'rewarded signup',
  'bot signup',
];

const numberEnv = (name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const getConfig = () => {
  return {
    packageSimilarityPercent: numberEnv('PARTNER_REWARD_PACKAGE_SIMILARITY_PERCENT', 94, 80, 100),
    reviewSimilarityPercent: numberEnv('PARTNER_REWARD_REVIEW_SIMILARITY_PERCENT', 92, 80, 100),
    reviewRingWindowDays: numberEnv('PARTNER_REWARD_REVIEW_RING_WINDOW_DAYS', 30, 1, 180),
    reviewRingSameDeviceMax: numberEnv('PARTNER_REWARD_REVIEW_RING_SAME_DEVICE_MAX', 3, 2, 20),
    reviewRingSameIpMax: numberEnv('PARTNER_REWARD_REVIEW_RING_SAME_IP_MAX', 5, 3, 50),
    subscriptionSettlementHours: numberEnv(
      'PARTNER_REWARD_SUBSCRIPTION_SETTLEMENT_HOURS',
      24,
      0,
      168
    ),
    paymentInstrumentSupplierCap: numberEnv(
      'PARTNER_REWARD_PAYMENT_INSTRUMENT_SUPPLIER_CAP',
      2,
      1,
      20
    ),
    perSupplierPointsCap: numberEnv('PARTNER_REWARD_PER_SUPPLIER_POINTS_CAP', 130, 130, 10000),
    pendingPointsCap: numberEnv('PARTNER_REWARD_PENDING_POINTS_CAP', 5000, 130, 1000000),
    newPartnerAgeDays: numberEnv('PARTNER_REWARD_NEW_PARTNER_AGE_DAYS', 14, 1, 90),
    newPartnerPointsCap: numberEnv('PARTNER_REWARD_NEW_PARTNER_POINTS_CAP', 1000, 130, 100000),
    rapidRewardWindowHours: numberEnv('PARTNER_REWARD_RAPID_WINDOW_HOURS', 1, 1, 24),
    rapidRewardCountCap: numberEnv('PARTNER_REWARD_RAPID_COUNT_CAP', 12, 2, 500),
    riskyMaturityExtraDays: numberEnv('PARTNER_REWARD_RISKY_MATURITY_EXTRA_DAYS', 30, 0, 180),
    highRiskMaturityExtraDays: numberEnv(
      'PARTNER_REWARD_HIGH_RISK_MATURITY_EXTRA_DAYS',
      60,
      0,
      365
    ),
    revalidationDays: numberEnv('PARTNER_REWARD_REVALIDATION_DAYS', 30, 1, 365),
  };
};

const normaliseText = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const tokenSet = value => {
  return new Set(
    normaliseText(value)
      .split(' ')
      .filter(token => token.length >= 2)
  );
};

const jaccardSimilarity = (left, right) => {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
};

const packageText = pkg => {
  return `${pkg?.title || ''} ${pkg?.description || ''}`.trim();
};

const reviewText = review => {
  return `${review?.title || ''} ${review?.comment || ''}`.trim();
};

const paidRewardTransactions = transactions => {
  return (transactions || []).filter(
    transaction =>
      MILESTONE_TYPES.has(transaction.type) &&
      Number(transaction.amount) > 0 &&
      !transaction.reversedAt
  );
};

const latestCreatedEvent = (events, userId) => {
  return (
    (events || [])
      .filter(event => event.userId === userId && event.outcome === 'created')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null
  );
};

const supplierHoldEvidence = async supplierUserId => {
  const [user, profiles] = await Promise.all([
    dbUnified.findOne('users', { id: supplierUserId }),
    dbUnified.find('suppliers', { ownerUserId: supplierUserId }),
  ]);
  if (!user) return { eligible: false, reason: 'SUPPLIER_ACCOUNT_MISSING' };
  if (user.partnerRewardHold === true || user.fraudHold === true) {
    return { eligible: false, reason: 'SUPPLIER_REWARD_HOLD_ACTIVE' };
  }
  const blockedProfile = (profiles || []).find(
    profile =>
      profile.rewardHold === true ||
      profile.suspended === true ||
      String(profile.verificationStatus || '').toLowerCase() === 'suspended'
  );
  if (blockedProfile) {
    return {
      eligible: false,
      reason: 'SUPPLIER_REWARD_HOLD_ACTIVE',
      evidence: { supplierId: blockedProfile.id },
    };
  }
  return { eligible: true };
};

const packageCopyEvidence = async (supplierUserId, packageId) => {
  if (!packageId) return { eligible: true };
  const config = getConfig();
  const [packages, profiles] = await Promise.all([
    dbUnified.read('packages'),
    dbUnified.read('suppliers'),
  ]);
  const current = (packages || []).find(pkg => pkg.id === packageId);
  if (!current) return { eligible: false, reason: 'QUALIFYING_PACKAGE_MISSING' };
  const profileById = new Map((profiles || []).map(profile => [profile.id, profile]));
  const currentOwner = profileById.get(current.supplierId)?.ownerUserId;
  if (!currentOwner) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  const currentText = packageText(current);
  const threshold = config.packageSimilarityPercent / 100;
  for (const candidate of packages || []) {
    if (!candidate || candidate.id === current.id || candidate.approved !== true) continue;
    const otherOwner = profileById.get(candidate.supplierId)?.ownerUserId;
    if (!otherOwner || otherOwner === currentOwner) continue;
    const similarity = jaccardSimilarity(currentText, packageText(candidate));
    const sameTitle = normaliseText(current.title) === normaliseText(candidate.title);
    const samePrice = normaliseText(current.price) === normaliseText(candidate.price);
    const strongMetadataCopy = sameTitle && samePrice && similarity >= 0.8;
    if (strongMetadataCopy || (similarity >= threshold && (sameTitle || samePrice))) {
      return {
        eligible: false,
        reason: 'NEAR_DUPLICATE_PACKAGE_CONTENT',
        evidence: {
          packageId: current.id,
          duplicatePackageId: candidate.id,
          similarity: Math.round(similarity * 1000) / 1000,
        },
      };
    }
  }
  return { eligible: true };
};

const reviewNetworkKey = review => {
  const ip = String(review?.ipAddress || '').trim();
  const ua = normaliseText(review?.userAgent || '');
  return ip && ua ? `${ip}:${ua}` : '';
};

const nearDuplicateReviewEvidence = (review, reviews, config) => {
  const selectedText = reviewText(review);
  if (normaliseText(selectedText).length < 80) return null;
  const threshold = config.reviewSimilarityPercent / 100;
  const duplicate = (reviews || []).find(candidate => {
    if (
      !candidate ||
      candidate.id === review.id ||
      candidate.userId === review.userId ||
      candidate.approved !== true
    ) {
      return false;
    }
    return jaccardSimilarity(selectedText, reviewText(candidate)) >= threshold;
  });
  if (!duplicate) return null;
  const similarity = jaccardSimilarity(selectedText, reviewText(duplicate));
  return {
    eligible: false,
    reason: 'NEAR_DUPLICATE_REVIEW_CONTENT',
    evidence: {
      reviewId: review.id,
      duplicateReviewId: duplicate.id,
      similarity: Math.round(similarity * 1000) / 1000,
    },
  };
};

const recentApprovedSupplierReviews = (review, reviews, config) => {
  const cutoff = Date.now() - config.reviewRingWindowDays * 86400000;
  return (reviews || []).filter(candidate => {
    if (!candidate || candidate.supplierId !== review.supplierId || candidate.approved !== true) {
      return false;
    }
    const createdAt = Date.parse(candidate.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
};

const reviewRingEvidence = (review, reviews, config) => {
  const recentReviews = recentApprovedSupplierReviews(review, reviews, config);
  const deviceKey = reviewNetworkKey(review);
  const sameDeviceUsers = deviceKey
    ? new Set(
        recentReviews
          .filter(candidate => reviewNetworkKey(candidate) === deviceKey)
          .map(candidate => candidate.userId)
          .filter(Boolean)
      )
    : new Set();
  if (sameDeviceUsers.size >= config.reviewRingSameDeviceMax) {
    return {
      eligible: false,
      reason: 'REVIEW_RING_SHARED_DEVICE_NETWORK',
      evidence: { reviewId: review.id, reviewerCount: sameDeviceUsers.size },
    };
  }

  const sameIpUsers = review.ipAddress
    ? new Set(
        recentReviews
          .filter(candidate => candidate.ipAddress === review.ipAddress)
          .map(candidate => candidate.userId)
          .filter(Boolean)
      )
    : new Set();
  if (sameIpUsers.size >= config.reviewRingSameIpMax) {
    return {
      eligible: false,
      reason: 'REVIEW_RING_SHARED_IP',
      evidence: { reviewId: review.id, reviewerCount: sameIpUsers.size },
    };
  }
  return null;
};

const linkedRewardPartyEvidence = async (review, supplierUserId, partnerUserId) => {
  const abuseEvents = await dbUnified.read('partner_abuse_events');
  const reviewerEvent = latestCreatedEvent(abuseEvents, review.userId);
  if (!reviewerEvent?.deviceCookieHash) return null;
  const linkedParties = [
    ['supplier', latestCreatedEvent(abuseEvents, supplierUserId)],
    ['partner', latestCreatedEvent(abuseEvents, partnerUserId)],
  ];
  const match = linkedParties.find(
    ([, event]) => event?.deviceCookieHash === reviewerEvent.deviceCookieHash
  );
  return match
    ? {
        eligible: false,
        reason: 'REVIEWER_LINKED_DEVICE_TO_REWARD_PARTY',
        evidence: { reviewId: review.id, linkedRole: match[0] },
      }
    : null;
};

const reviewNetworkEvidence = async (supplierUserId, partnerUserId, reviewId) => {
  if (!reviewId) return { eligible: true };
  const config = getConfig();
  const [reviews, profiles] = await Promise.all([
    dbUnified.read('reviews'),
    dbUnified.read('suppliers'),
  ]);
  const review = (reviews || []).find(item => item.id === reviewId);
  if (!review) return { eligible: false, reason: 'QUALIFYING_REVIEW_MISSING' };
  if ((profiles || []).some(profile => profile.ownerUserId === review.userId)) {
    return {
      eligible: false,
      reason: 'REVIEWER_OWNS_SUPPLIER_PROFILE',
      evidence: { reviewId },
    };
  }

  const approvedAt = review.approvedAt || review.createdAt;
  const approvalAgeHours = baseIntegrity._test.hoursBetween(approvedAt);
  if (approvalAgeHours === null || approvalAgeHours < baseIntegrity.getConfig().reviewMinAgeHours) {
    return {
      eligible: false,
      reason: 'REVIEW_MODERATION_WINDOW_NOT_MET',
      evidence: { reviewId, approvalAgeHours },
    };
  }

  const duplicateEvidence = nearDuplicateReviewEvidence(review, reviews, config);
  if (duplicateEvidence) return duplicateEvidence;
  const ringEvidence = reviewRingEvidence(review, reviews, config);
  if (ringEvidence) return ringEvidence;
  return (
    (await linkedRewardPartyEvidence(review, supplierUserId, partnerUserId)) || {
      eligible: true,
    }
  );
};

const paymentInstrumentHash = invoice => {
  return String(
    invoice?.paymentInstrumentHash || invoice?.metadata?.paymentInstrumentHash || ''
  ).trim();
};

const subscriptionPaymentEvidence = async (supplierUserId, invoiceId) => {
  if (!invoiceId) return { eligible: true };
  const config = getConfig();
  const [invoices, subscriptions] = await Promise.all([
    dbUnified.read('invoices'),
    dbUnified.read('subscriptions'),
  ]);
  const invoice = (invoices || []).find(item => item.id === invoiceId);
  if (!invoice) return { eligible: false, reason: 'QUALIFYING_PAID_SUBSCRIPTION_INVOICE_MISSING' };
  if (invoice.livemode === false) {
    return { eligible: false, reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE', evidence: { invoiceId } };
  }
  const paidAgeHours = baseIntegrity._test.hoursBetween(invoice.paidAt);
  if (paidAgeHours === null || paidAgeHours < config.subscriptionSettlementHours) {
    return {
      eligible: false,
      reason: 'SUBSCRIPTION_SETTLEMENT_WINDOW_NOT_MET',
      evidence: { invoiceId, paidAgeHours, requiredHours: config.subscriptionSettlementHours },
    };
  }

  const subscription = (subscriptions || []).find(
    item => item.id === invoice.subscriptionId && item.userId === supplierUserId
  );
  if (!subscription || subscription.plan === 'free' || subscription.status !== 'active') {
    return { eligible: false, reason: 'ACTIVE_PAID_SUBSCRIPTION_MISSING', evidence: { invoiceId } };
  }
  if (
    invoice.stripeSubscriptionId &&
    subscription.stripeSubscriptionId &&
    invoice.stripeSubscriptionId !== subscription.stripeSubscriptionId
  ) {
    return {
      eligible: false,
      reason: 'STRIPE_SUBSCRIPTION_OWNERSHIP_MISMATCH',
      evidence: { invoiceId },
    };
  }
  if (
    invoice.stripeCustomerId &&
    subscription.stripeCustomerId &&
    invoice.stripeCustomerId !== subscription.stripeCustomerId
  ) {
    return {
      eligible: false,
      reason: 'STRIPE_CUSTOMER_OWNERSHIP_MISMATCH',
      evidence: { invoiceId },
    };
  }

  const customerId = invoice.stripeCustomerId || subscription.stripeCustomerId;
  if (customerId) {
    const customerUsers = new Set(
      (subscriptions || [])
        .filter(item => item.stripeCustomerId === customerId && item.userId)
        .map(item => item.userId)
    );
    if (customerUsers.size > 1) {
      return {
        eligible: false,
        reason: 'STRIPE_CUSTOMER_REUSED_ACROSS_SUPPLIERS',
        evidence: { invoiceId, supplierCount: customerUsers.size },
      };
    }
  }

  const instrument = paymentInstrumentHash(invoice);
  if (instrument) {
    const instrumentUsers = new Set(
      (invoices || [])
        .filter(
          item =>
            item.status === 'paid' && paymentInstrumentHash(item) === instrument && item.userId
        )
        .map(item => item.userId)
    );
    if (instrumentUsers.size > config.paymentInstrumentSupplierCap) {
      return {
        eligible: false,
        reason: 'PAYMENT_INSTRUMENT_REUSED_ACROSS_SUPPLIERS',
        evidence: {
          invoiceId,
          supplierCount: instrumentUsers.size,
          cap: config.paymentInstrumentSupplierCap,
        },
      };
    }
  }

  return { eligible: true };
};

const referralLoopEvidence = async (partnerId, supplierUserId) => {
  const [partners, referrals] = await Promise.all([
    dbUnified.read('partners'),
    dbUnified.read('partner_referrals'),
  ]);
  const partnerByUserId = new Map((partners || []).map(partner => [partner.userId, partner]));
  const supplierPartner = partnerByUserId.get(supplierUserId);
  if (!supplierPartner) return { eligible: true };

  const edges = new Map();
  for (const referral of referrals || []) {
    const target = partnerByUserId.get(referral.supplierUserId);
    if (!target) continue;
    if (!edges.has(referral.partnerId)) edges.set(referral.partnerId, new Set());
    edges.get(referral.partnerId).add(target.id);
  }
  if (!edges.has(partnerId)) edges.set(partnerId, new Set());
  edges.get(partnerId).add(supplierPartner.id);

  const stack = [supplierPartner.id];
  const visited = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === partnerId) {
      return {
        eligible: false,
        reason: 'REFERRAL_LOOP_DETECTED',
        evidence: { partnerId, supplierPartnerId: supplierPartner.id },
      };
    }
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of edges.get(current) || []) stack.push(next);
  }
  return { eligible: true };
};

const prohibitedCampaignTerms = () => {
  const configured = String(process.env.PARTNER_REWARD_PROHIBITED_CAMPAIGN_TERMS || '')
    .split(',')
    .map(value => normaliseText(value))
    .filter(Boolean);
  return [...DEFAULT_PROHIBITED_CAMPAIGN_TERMS.map(normaliseText), ...configured];
};

const campaignPolicyEvidence = async supplierUserId => {
  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (!referral) return { eligible: true };
  const haystack = normaliseText(
    [referral.source, referral.medium, referral.campaign, referral.content, referral.term]
      .filter(Boolean)
      .join(' ')
  );
  if (!haystack) return { eligible: true };
  const matched = prohibitedCampaignTerms().find(term => term && haystack.includes(term));
  return matched
    ? {
        eligible: false,
        reason: 'PROHIBITED_INCENTIVISED_CAMPAIGN',
        evidence: { matchedTerm: matched },
      }
    : { eligible: true };
};

const normaliseCompanyName = value => {
  return normaliseText(value)
    .split(' ')
    .filter(
      token =>
        !['limited', 'ltd', 'llp', 'plc', 'inc', 'incorporated', 'company', 'co'].includes(token)
    )
    .join(' ');
};

const fuzzyDuplicateBusinessEvidence = async supplierUserId => {
  const [users, profiles] = await Promise.all([
    dbUnified.read('users'),
    dbUnified.read('suppliers'),
  ]);
  const own = (profiles || []).filter(
    profile => profile.ownerUserId === supplierUserId && profile.approved === true
  );
  for (const current of own) {
    const currentName = normaliseCompanyName(
      current.businessName ||
        current.companyName ||
        current.name ||
        users.find(user => user.id === supplierUserId)?.company
    );
    const currentPostcode = normaliseText(current.postcode || current.postalCode).replace(
      /\s/g,
      ''
    );
    if (!currentName || !currentPostcode) continue;
    for (const other of profiles || []) {
      if (!other || other.ownerUserId === supplierUserId || other.approved !== true) continue;
      const otherName = normaliseCompanyName(
        other.businessName ||
          other.companyName ||
          other.name ||
          users.find(user => user.id === other.ownerUserId)?.company
      );
      const otherPostcode = normaliseText(other.postcode || other.postalCode).replace(/\s/g, '');
      if (!otherName || !otherPostcode || currentPostcode !== otherPostcode) continue;
      const similarity = jaccardSimilarity(currentName, otherName);
      if (similarity >= 0.9) {
        return {
          eligible: false,
          reason: 'FUZZY_DUPLICATE_SUPPLIER_BUSINESS',
          evidence: {
            otherSupplierUserId: other.ownerUserId,
            similarity: Math.round(similarity * 1000) / 1000,
          },
        };
      }
    }
  }
  return { eligible: true };
};

const methodRewardEvidence = async ({
  supplierUserId,
  partnerId,
  partnerUserId,
  methodName,
  baseEvidence = {},
}) => {
  for (const check of [
    () => supplierHoldEvidence(supplierUserId),
    () => referralLoopEvidence(partnerId, supplierUserId),
    () => campaignPolicyEvidence(supplierUserId),
    () => fuzzyDuplicateBusinessEvidence(supplierUserId),
  ]) {
    const result = await check();
    if (!result.eligible) return result;
  }

  if (methodName === 'awardPackageBonus') {
    return packageCopyEvidence(supplierUserId, baseEvidence.packageId);
  }
  if (methodName === 'awardFirstReviewBonus') {
    return reviewNetworkEvidence(supplierUserId, partnerUserId, baseEvidence.reviewId);
  }
  if (methodName === 'awardSubscriptionBonus') {
    return subscriptionPaymentEvidence(supplierUserId, baseEvidence.invoiceId);
  }
  return { eligible: true };
};

const exposureDecision = async ({ partnerId, supplierUserId, amount }) => {
  const config = getConfig();
  const [transactions, partner] = await Promise.all([
    dbUnified.find('partner_credit_transactions', { partnerId }),
    dbUnified.findOne('partners', { id: partnerId }),
  ]);
  const rewards = paidRewardTransactions(transactions);
  const supplierTotal = rewards
    .filter(transaction => transaction.supplierUserId === supplierUserId)
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  if (supplierTotal + Number(amount || 0) > config.perSupplierPointsCap) {
    return {
      eligible: false,
      reason: 'PER_SUPPLIER_REWARD_CAP_REACHED',
      evidence: { current: supplierTotal, attempted: amount, cap: config.perSupplierPointsCap },
    };
  }

  const now = Date.now();
  const pendingTotal = rewards
    .filter(transaction => {
      const at = Date.parse(transaction.createdAt);
      return Number.isFinite(at) && at >= now - 30 * 86400000;
    })
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  if (pendingTotal + Number(amount || 0) > config.pendingPointsCap) {
    return {
      eligible: false,
      reason: 'PENDING_REWARD_EXPOSURE_CAP_REACHED',
      evidence: { current: pendingTotal, attempted: amount, cap: config.pendingPointsCap },
    };
  }

  const partnerAgeMs = partner?.createdAt
    ? now - Date.parse(partner.createdAt)
    : Number.POSITIVE_INFINITY;
  if (Number.isFinite(partnerAgeMs) && partnerAgeMs < config.newPartnerAgeDays * 86400000) {
    const total = rewards.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    if (total + Number(amount || 0) > config.newPartnerPointsCap) {
      return {
        eligible: false,
        reason: 'NEW_PARTNER_REWARD_CAP_REACHED',
        evidence: { current: total, attempted: amount, cap: config.newPartnerPointsCap },
      };
    }
  }

  const rapidCutoff = now - config.rapidRewardWindowHours * 3600000;
  const rapidCount = rewards.filter(transaction => {
    const at = Date.parse(transaction.createdAt);
    return Number.isFinite(at) && at >= rapidCutoff;
  }).length;
  if (rapidCount >= config.rapidRewardCountCap) {
    return {
      eligible: false,
      reason: 'RAPID_REWARD_VELOCITY_CAP_REACHED',
      evidence: {
        currentCount: rapidCount,
        cap: config.rapidRewardCountCap,
        windowHours: config.rapidRewardWindowHours,
      },
    };
  }

  return { eligible: true };
};

const maturityExtensionDays = async ({ partnerId, supplierUserId }) => {
  const config = getConfig();
  const [partner, supplier] = await Promise.all([
    dbUnified.findOne('partners', { id: partnerId }),
    dbUnified.findOne('users', { id: supplierUserId }),
  ]);
  const partnerUser = partner ? await dbUnified.findOne('users', { id: partner.userId }) : null;
  const levels = [supplier?.registrationRiskLevel, partnerUser?.registrationRiskLevel].filter(
    Boolean
  );
  if (levels.includes('high')) return config.highRiskMaturityExtraDays;
  if (levels.includes('review')) return config.riskyMaturityExtraDays;
  return 0;
};

module.exports = {
  getConfig,
  packageCopyEvidence,
  reviewNetworkEvidence,
  subscriptionPaymentEvidence,
  referralLoopEvidence,
  campaignPolicyEvidence,
  fuzzyDuplicateBusinessEvidence,
  methodRewardEvidence,
  exposureDecision,
  maturityExtensionDays,
  _test: {
    normaliseText,
    jaccardSimilarity,
    packageText,
    reviewText,
    reviewNetworkKey,
    prohibitedCampaignTerms,
    latestCreatedEvent,
    normaliseCompanyName,
  },
};
