'use strict';

const crypto = require('crypto');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const REWARD_TYPES = new Set([
  'PACKAGE_BONUS',
  'SUBSCRIPTION_BONUS',
  'REFERRAL_SIGNUP_BONUS',
  'FIRST_REVIEW_BONUS',
]);

const PLACEHOLDER_TEXT = new Set([
  'test',
  'testing',
  'sample',
  'placeholder',
  'coming soon',
  'tbc',
  'tbd',
  'n/a',
  'na',
  'none',
]);

function numberEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getConfig() {
  return {
    signupMinAgeHours: numberEnv('PARTNER_REWARD_SIGNUP_MIN_AGE_HOURS', 24, 0, 168),
    packageMinLiveHours: numberEnv('PARTNER_REWARD_PACKAGE_MIN_LIVE_HOURS', 24, 0, 168),
    reviewMinAgeHours: numberEnv('PARTNER_REWARD_REVIEW_MIN_AGE_HOURS', 24, 0, 168),
    reviewerMinAccountHours: numberEnv('PARTNER_REWARD_REVIEWER_MIN_ACCOUNT_HOURS', 24, 0, 720),
    packageMinDescriptionLength: numberEnv(
      'PARTNER_REWARD_PACKAGE_MIN_DESCRIPTION_LENGTH',
      40,
      0,
      500
    ),
    minSubscriptionAmount: numberEnv('PARTNER_REWARD_MIN_SUBSCRIPTION_AMOUNT', 1, 1, 10000),
    dailyPointsCap: numberEnv('PARTNER_REWARD_DAILY_POINTS_CAP', 5000, 130, 1000000),
    weeklyPointsCap: numberEnv('PARTNER_REWARD_WEEKLY_POINTS_CAP', 20000, 130, 5000000),
    monthlyPointsCap: numberEnv('PARTNER_REWARD_MONTHLY_POINTS_CAP', 60000, 130, 10000000),
    campaignDailySupplierCap: numberEnv('PARTNER_REWARD_CAMPAIGN_DAILY_SUPPLIER_CAP', 50, 5, 10000),
  };
}

function normaliseText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9£$€]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseCompact(value) {
  return normaliseText(value).replace(/[^a-z0-9]/g, '');
}

function normalisePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('44') && digits.length >= 11) return digits;
  if (digits.startsWith('0') && digits.length >= 10) return `44${digits.slice(1)}`;
  return digits.length >= 7 ? digits : '';
}

function normalisePostcode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function websiteHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function hoursBetween(earlier, later = new Date().toISOString()) {
  const start = new Date(earlier).getTime();
  const end = new Date(later).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3600000;
}

function isPlaceholder(value) {
  const text = normaliseText(value);
  if (!text) return true;
  return PLACEHOLDER_TEXT.has(text) || /^(test|sample|placeholder)\s*\d*$/.test(text);
}

function parsePositivePrice(value) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function businessIdentity(profile = {}, user = {}) {
  return {
    company: normaliseCompact(
      profile.company || profile.companyName || profile.businessName || user.company
    ),
    phone: normalisePhone(
      profile.phone || profile.phoneNumber || profile.contactPhone || user.phone || user.phoneNumber
    ),
    website: websiteHost(profile.website || profile.websiteUrl || user.website || user.websiteUrl),
    postcode: normalisePostcode(profile.postcode || profile.postalCode || user.postcode),
    companyNumber: normaliseCompact(
      profile.companyNumber ||
        profile.companiesHouseNumber ||
        profile.registrationNumber ||
        user.companyNumber
    ),
    vatNumber: normaliseCompact(
      profile.vatNumber || profile.vatRegistrationNumber || user.vatNumber
    ),
  };
}

function duplicateBusinessMatch(left, right) {
  if (left.companyNumber && left.companyNumber === right.companyNumber) return 'COMPANY_NUMBER';
  if (left.vatNumber && left.vatNumber === right.vatNumber) return 'VAT_NUMBER';
  if (
    left.website &&
    left.postcode &&
    left.website === right.website &&
    left.postcode === right.postcode
  ) {
    return 'WEBSITE_AND_POSTCODE';
  }
  if (
    left.phone &&
    left.postcode &&
    left.phone === right.phone &&
    left.postcode === right.postcode
  ) {
    return 'PHONE_AND_POSTCODE';
  }
  if (
    left.company &&
    left.postcode &&
    left.company === right.company &&
    left.postcode === right.postcode
  ) {
    return 'COMPANY_AND_POSTCODE';
  }
  return null;
}

async function duplicateSupplierBusinessEvidence(supplierUserId) {
  const [users, profiles] = await Promise.all([
    dbUnified.read('users'),
    dbUnified.read('suppliers'),
  ]);
  const currentProfiles = (profiles || []).filter(
    profile => profile.ownerUserId === supplierUserId && profile.approved === true
  );
  if (!currentProfiles.length) return { duplicate: false };

  const currentUser = (users || []).find(user => user.id === supplierUserId) || {};
  for (const currentProfile of currentProfiles) {
    const currentIdentity = businessIdentity(currentProfile, currentUser);
    for (const otherProfile of profiles || []) {
      if (
        !otherProfile ||
        otherProfile.approved !== true ||
        otherProfile.ownerUserId === supplierUserId
      ) {
        continue;
      }
      const otherUser = (users || []).find(user => user.id === otherProfile.ownerUserId) || {};
      const matchType = duplicateBusinessMatch(
        currentIdentity,
        businessIdentity(otherProfile, otherUser)
      );
      if (matchType) {
        return {
          duplicate: true,
          matchType,
          otherSupplierUserId: otherProfile.ownerUserId,
          otherSupplierId: otherProfile.id,
        };
      }
    }
  }
  return { duplicate: false };
}

function packageQuality(pkg, config = getConfig()) {
  if (!pkg || pkg.approved !== true || pkg.paused === true) {
    return { eligible: false, reason: 'PACKAGE_NOT_LIVE_AND_APPROVED' };
  }
  if (isPlaceholder(pkg.title) || String(pkg.title || '').trim().length < 5) {
    return { eligible: false, reason: 'PACKAGE_TITLE_NOT_MEANINGFUL' };
  }
  const description = String(pkg.description || '').trim();
  if (description.length < config.packageMinDescriptionLength || isPlaceholder(description)) {
    return { eligible: false, reason: 'PACKAGE_DESCRIPTION_NOT_MEANINGFUL' };
  }
  if (!String(pkg.primaryCategoryKey || '').trim()) {
    return { eligible: false, reason: 'PACKAGE_CATEGORY_MISSING' };
  }
  if (!Array.isArray(pkg.eventTypes) || pkg.eventTypes.filter(Boolean).length === 0) {
    return { eligible: false, reason: 'PACKAGE_EVENT_TYPES_MISSING' };
  }
  if (parsePositivePrice(pkg.price) === null) {
    return { eligible: false, reason: 'PACKAGE_PRICE_NOT_MEANINGFUL' };
  }
  const liveHours = hoursBetween(pkg.approvedAt || pkg.createdAt);
  if (liveHours === null || liveHours < config.packageMinLiveHours) {
    return {
      eligible: false,
      reason: 'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
      evidence: { liveHours, requiredHours: config.packageMinLiveHours },
    };
  }
  return { eligible: true, packageId: pkg.id, liveHours };
}

async function packageRewardEvidence(supplierUserId) {
  const config = getConfig();
  const profiles = await dbUnified.find('suppliers', { ownerUserId: supplierUserId });
  const approvedProfiles = (profiles || []).filter(profile => profile.approved === true);
  if (!approvedProfiles.length) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  const supplierIds = new Set(approvedProfiles.map(profile => profile.id));
  const packages = await dbUnified.read('packages');
  let firstReason = 'QUALIFYING_PACKAGE_MISSING';
  for (const pkg of packages || []) {
    if (!supplierIds.has(pkg.supplierId)) continue;
    const quality = packageQuality(pkg, config);
    if (quality.eligible) return quality;
    firstReason = quality.reason || firstReason;
  }
  return { eligible: false, reason: firstReason };
}

function reviewTextKey(review) {
  const text = normaliseText(`${review?.title || ''} ${review?.comment || ''}`);
  return text.length >= 40 ? text : '';
}

async function hasTwoWayMessageHistory(reviewerUserId, supplierId, supplierOwnerUserId) {
  const [threads, messages] = await Promise.all([
    dbUnified.read('threads'),
    dbUnified.read('messages'),
  ]);
  const relevantThreads = (threads || []).filter(
    thread => thread.customerId === reviewerUserId && thread.supplierId === supplierId
  );
  if (!relevantThreads.length) return false;
  const threadIds = new Set(relevantThreads.map(thread => thread.id));
  const relevantMessages = (messages || []).filter(
    message => threadIds.has(message.threadId) && message.isDraft !== true
  );
  if (relevantMessages.length < 2) return false;
  const sender = message => message.senderId || message.fromUserId || null;
  return (
    relevantMessages.some(message => sender(message) === reviewerUserId) &&
    relevantMessages.some(message => sender(message) === supplierOwnerUserId)
  );
}

async function reviewRewardEvidence(supplierUserId, partnerUserId) {
  const config = getConfig();
  const [profiles, reviews, users] = await Promise.all([
    dbUnified.find('suppliers', { ownerUserId: supplierUserId }),
    dbUnified.read('reviews'),
    dbUnified.read('users'),
  ]);
  const approvedProfiles = (profiles || []).filter(profile => profile.approved === true);
  if (!approvedProfiles.length) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  const supplierIds = new Set(approvedProfiles.map(profile => profile.id));

  for (const review of reviews || []) {
    if (!supplierIds.has(review.supplierId)) continue;
    if (review.approved !== true || review.flagged === true) continue;
    if (review.verified !== true || review.emailVerified !== true) continue;
    if (!review.userId || review.userId === supplierUserId || review.userId === partnerUserId)
      continue;

    const reviewer = (users || []).find(user => user.id === review.userId);
    if (!reviewer || reviewer.verified !== true || reviewer.role === 'supplier') continue;
    const reviewerAge = hoursBetween(
      reviewer.createdAt,
      review.createdAt || new Date().toISOString()
    );
    if (reviewerAge === null || reviewerAge < config.reviewerMinAccountHours) continue;
    const reviewAge = hoursBetween(review.createdAt);
    if (reviewAge === null || reviewAge < config.reviewMinAgeHours) continue;
    if (!(await hasTwoWayMessageHistory(review.userId, review.supplierId, supplierUserId)))
      continue;

    const textKey = reviewTextKey(review);
    if (textKey) {
      const duplicate = (reviews || []).find(
        candidate =>
          candidate.id !== review.id &&
          candidate.userId !== review.userId &&
          candidate.approved === true &&
          reviewTextKey(candidate) === textKey
      );
      if (duplicate) {
        return {
          eligible: false,
          reason: 'DUPLICATE_REVIEW_CONTENT',
          evidence: { reviewId: review.id, duplicateReviewId: duplicate.id },
        };
      }
    }
    return { eligible: true, reviewId: review.id, reviewerUserId: review.userId };
  }
  return { eligible: false, reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING' };
}

async function subscriptionRewardEvidence(supplierUserId) {
  const config = getConfig();
  const [invoices, subscriptions] = await Promise.all([
    dbUnified.read('invoices'),
    dbUnified.read('subscriptions'),
  ]);
  for (const invoice of invoices || []) {
    if (invoice.userId !== supplierUserId || invoice.status !== 'paid') continue;
    const amount = Number(invoice.amount);
    if (!Number.isFinite(amount) || amount < config.minSubscriptionAmount) continue;
    if (!invoice.stripeInvoiceId || !invoice.paidAt) continue;
    const subscription = (subscriptions || []).find(
      item => item.id === invoice.subscriptionId && item.userId === supplierUserId
    );
    if (!subscription) continue;
    if (subscription.plan === 'free') continue;
    return {
      eligible: true,
      invoiceId: invoice.id,
      stripeInvoiceId: invoice.stripeInvoiceId,
      amount,
      currency: invoice.currency || null,
    };
  }
  return { eligible: false, reason: 'QUALIFYING_PAID_SUBSCRIPTION_INVOICE_MISSING' };
}

async function signupRewardEvidence(supplierUserId) {
  const config = getConfig();
  const supplier = await dbUnified.findOne('users', { id: supplierUserId });
  if (!supplier || supplier.role !== 'supplier') {
    return { eligible: false, reason: 'SUPPLIER_ACCOUNT_MISSING' };
  }
  const ageHours = hoursBetween(supplier.createdAt);
  if (ageHours === null || ageHours < config.signupMinAgeHours) {
    return {
      eligible: false,
      reason: 'SUPPLIER_MIN_ACCOUNT_AGE_NOT_MET',
      evidence: { ageHours, requiredHours: config.signupMinAgeHours },
    };
  }
  return { eligible: true, ageHours };
}

async function methodRewardEvidence({ supplierUserId, partnerId, partnerUserId, methodName }) {
  const duplicateBusiness = await duplicateSupplierBusinessEvidence(supplierUserId);
  if (duplicateBusiness.duplicate) {
    return {
      eligible: false,
      reason: 'DUPLICATE_SUPPLIER_BUSINESS_IDENTITY',
      evidence: duplicateBusiness,
    };
  }
  if (methodName === 'awardReferralSignupBonus') return signupRewardEvidence(supplierUserId);
  if (methodName === 'awardPackageBonus') return packageRewardEvidence(supplierUserId);
  if (methodName === 'awardFirstReviewBonus') {
    return reviewRewardEvidence(supplierUserId, partnerUserId);
  }
  if (methodName === 'awardSubscriptionBonus') return subscriptionRewardEvidence(supplierUserId);
  logger.warn('[PARTNER-REWARD-INTEGRITY] Unknown reward method evaluated', {
    supplierUserId,
    partnerId,
    methodName,
  });
  return { eligible: false, reason: 'UNKNOWN_REWARD_METHOD' };
}

function sumPositiveRewards(transactions, sinceMs) {
  return (transactions || [])
    .filter(transaction => {
      if (!REWARD_TYPES.has(transaction.type) || Number(transaction.amount) <= 0) return false;
      const createdAt = new Date(transaction.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= sinceMs;
    })
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
}

async function canAwardCredit({ partnerId, supplierUserId, type, amount }) {
  if (!REWARD_TYPES.has(type)) return { eligible: true };
  const config = getConfig();
  const now = Date.now();
  const transactions = await dbUnified.find('partner_credit_transactions', { partnerId });
  const windows = [
    ['DAILY_REWARD_CAP_REACHED', config.dailyPointsCap, now - 24 * 3600000],
    ['WEEKLY_REWARD_CAP_REACHED', config.weeklyPointsCap, now - 7 * 24 * 3600000],
    ['MONTHLY_REWARD_CAP_REACHED', config.monthlyPointsCap, now - 30 * 24 * 3600000],
  ];
  for (const [reason, cap, since] of windows) {
    const current = sumPositiveRewards(transactions, since);
    if (current + Number(amount || 0) > cap) {
      return { eligible: false, reason, evidence: { current, attempted: amount, cap } };
    }
  }

  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (referral?.campaign) {
    const referrals = await dbUnified.find('partner_referrals', { partnerId });
    const recentCampaignSuppliers = new Set(
      (referrals || [])
        .filter(item => {
          if (item.campaign !== referral.campaign) return false;
          const createdAt = new Date(item.createdAt).getTime();
          return Number.isFinite(createdAt) && createdAt >= now - 24 * 3600000;
        })
        .map(item => item.supplierUserId)
    );
    if (recentCampaignSuppliers.size > config.campaignDailySupplierCap) {
      return {
        eligible: false,
        reason: 'CAMPAIGN_DAILY_SUPPLIER_CAP_REACHED',
        evidence: {
          campaign: referral.campaign,
          supplierCount: recentCampaignSuppliers.size,
          cap: config.campaignDailySupplierCap,
        },
      };
    }
  }
  return { eligible: true };
}

function integrityEventId(parts) {
  return `pri_${crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24)}`;
}

async function recordIntegrityEvent({
  partnerId,
  supplierUserId,
  rewardType,
  reason,
  evidence = {},
  eventType = 'reward_withheld',
}) {
  const id = integrityEventId([
    eventType,
    partnerId || 'none',
    supplierUserId || 'none',
    rewardType || 'none',
    reason || 'none',
  ]);
  const existing = await dbUnified.findOne('partner_reward_integrity_events', { id });
  const now = new Date().toISOString();
  if (existing) {
    await dbUnified.updateOne(
      'partner_reward_integrity_events',
      { id },
      { $set: { lastSeenAt: now, evidence, occurrenceCount: (existing.occurrenceCount || 1) + 1 } }
    );
    return { ...existing, lastSeenAt: now };
  }
  const event = {
    id,
    eventType,
    partnerId: partnerId || null,
    supplierUserId: supplierUserId || null,
    rewardType: rewardType || null,
    reason: reason || null,
    evidence,
    occurrenceCount: 1,
    createdAt: now,
    lastSeenAt: now,
  };
  await dbUnified.insertOne('partner_reward_integrity_events', event);
  return event;
}

async function recordAttributionConflict({
  supplierUserId,
  existingPartnerId,
  attemptedPartnerId,
}) {
  return recordIntegrityEvent({
    partnerId: existingPartnerId,
    supplierUserId,
    rewardType: null,
    reason: 'REFERRAL_ATTRIBUTION_REASSIGNMENT_ATTEMPT',
    eventType: 'attribution_conflict',
    evidence: { existingPartnerId, attemptedPartnerId },
  });
}

module.exports = {
  REWARD_TYPES,
  getConfig,
  packageQuality,
  packageRewardEvidence,
  reviewRewardEvidence,
  subscriptionRewardEvidence,
  signupRewardEvidence,
  duplicateSupplierBusinessEvidence,
  methodRewardEvidence,
  canAwardCredit,
  recordIntegrityEvent,
  recordAttributionConflict,
  _test: {
    normaliseText,
    normalisePhone,
    normalisePostcode,
    websiteHost,
    parsePositivePrice,
    isPlaceholder,
    duplicateBusinessMatch,
    reviewTextKey,
    hoursBetween,
  },
};
