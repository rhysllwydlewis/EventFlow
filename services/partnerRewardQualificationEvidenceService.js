'use strict';

const dbUnified = require('../db-unified');
const baseIntegrity = require('./partnerRewardIntegrityService');
const advancedIntegrity = require('./partnerRewardIntegrityAdvancedService');
const stripeEvidence = require('./partnerRewardStripeEvidenceService');

const SNAPSHOT_VERSION = 1;

const buildSnapshot = ({
  methodName,
  supplierDecision = {},
  baseEvidence = {},
  stripeDecision = {},
}) => {
  const snapshot = {
    version: SNAPSHOT_VERSION,
    methodName,
    supplierId: supplierDecision.supplierId || null,
    qualifiedAt: new Date().toISOString(),
  };
  if (methodName === 'awardPackageBonus') snapshot.packageId = baseEvidence.packageId || null;
  if (methodName === 'awardFirstReviewBonus') snapshot.reviewId = baseEvidence.reviewId || null;
  if (methodName === 'awardSubscriptionBonus') {
    snapshot.invoiceId = baseEvidence.invoiceId || stripeDecision.invoiceId || null;
    snapshot.paymentIntentId = stripeDecision.paymentEvidence?.paymentIntentId || null;
    snapshot.stripeChargeId = stripeDecision.paymentEvidence?.stripeChargeId || null;
  }
  return snapshot;
};

const persistSnapshot = async (transaction, snapshot) => {
  if (!transaction?.id) return transaction;
  const updated = await dbUnified.updateOne(
    'partner_credit_transactions',
    { id: transaction.id },
    { $set: { qualificationEvidence: snapshot, qualificationEvidenceVersion: SNAPSHOT_VERSION } }
  );
  if (!updated) {
    const error = new Error('Partner reward qualification evidence did not persist');
    error.code = 'PARTNER_REWARD_EVIDENCE_WRITE_FAILED';
    throw error;
  }
  return {
    ...transaction,
    qualificationEvidence: snapshot,
    qualificationEvidenceVersion: SNAPSHOT_VERSION,
  };
};

const reviewTextKey = review => {
  return baseIntegrity._test.reviewTextKey(review);
};

const reviewAccountAgeHours = (user, review) => {
  return user?.createdAt
    ? baseIntegrity._test.hoursBetween(user.createdAt, review?.createdAt)
    : null;
};

const hasTwoWayMessageHistory = (threads, messages, reviewerUserId, supplierIds) => {
  const candidateThreads = (threads || []).filter(
    thread => thread.customerId === reviewerUserId && supplierIds.has(thread.supplierId)
  );
  for (const thread of candidateThreads) {
    const realMessages = (messages || []).filter(
      message => message.threadId === thread.id && !message.isDraft
    );
    const fromCustomer = realMessages.some(
      message => (message.senderId || message.fromUserId) === reviewerUserId
    );
    const fromSupplier = realMessages.some(message => {
      const sender = message.senderId || message.fromUserId;
      return sender && sender !== reviewerUserId;
    });
    if (fromCustomer && fromSupplier) return true;
  }
  return false;
};

const revalidateExactPackage = async transaction => {
  const snapshot = transaction.qualificationEvidence || {};
  if (!snapshot.packageId) return { eligible: false, reason: 'QUALIFICATION_EVIDENCE_MISSING' };
  const [pkg, profiles] = await Promise.all([
    dbUnified.findOne('packages', { id: snapshot.packageId }),
    dbUnified.find('suppliers', { ownerUserId: transaction.supplierUserId }),
  ]);
  const supplierIds = new Set((profiles || []).map(profile => profile.id));
  if (!pkg || !supplierIds.has(pkg.supplierId)) {
    return { eligible: false, reason: 'QUALIFYING_PACKAGE_MISSING' };
  }
  const quality = baseIntegrity.packageQuality(pkg);
  if (!quality.eligible) return quality;
  return advancedIntegrity.packageCopyEvidence(transaction.supplierUserId, snapshot.packageId);
};

const revalidateExactReview = async (transaction, partnerUserId) => {
  const snapshot = transaction.qualificationEvidence || {};
  if (!snapshot.reviewId) return { eligible: false, reason: 'QUALIFICATION_EVIDENCE_MISSING' };
  const [review, users, profiles, reviews, threads, messages] = await Promise.all([
    dbUnified.findOne('reviews', { id: snapshot.reviewId }),
    dbUnified.read('users'),
    dbUnified.find('suppliers', { ownerUserId: transaction.supplierUserId }),
    dbUnified.read('reviews'),
    dbUnified.read('threads'),
    dbUnified.read('messages'),
  ]);
  if (!review) return { eligible: false, reason: 'QUALIFYING_REVIEW_MISSING' };
  const supplierIds = new Set((profiles || []).map(profile => profile.id));
  if (!supplierIds.has(review.supplierId)) {
    return { eligible: false, reason: 'QUALIFYING_REVIEW_MISSING' };
  }
  if (review.approved !== true || review.flagged === true) {
    return { eligible: false, reason: 'QUALIFYING_REVIEW_NOT_APPROVED' };
  }
  if (review.verified !== true || review.emailVerified !== true) {
    return { eligible: false, reason: 'REVIEW_CUSTOMER_NOT_VERIFIED' };
  }
  if (
    !review.userId ||
    review.userId === transaction.supplierUserId ||
    review.userId === partnerUserId
  ) {
    return { eligible: false, reason: 'REVIEWER_NOT_INDEPENDENT' };
  }
  const reviewer = (users || []).find(user => user.id === review.userId);
  if (!reviewer || reviewer.verified !== true || reviewer.role === 'supplier') {
    return { eligible: false, reason: 'REVIEWER_ACCOUNT_NOT_ELIGIBLE' };
  }
  const config = baseIntegrity.getConfig();
  const reviewerAgeHours = reviewAccountAgeHours(reviewer, review);
  if (reviewerAgeHours === null || reviewerAgeHours < config.reviewerMinAccountHours) {
    return { eligible: false, reason: 'REVIEWER_ACCOUNT_TOO_NEW' };
  }
  const reviewAgeHours = baseIntegrity._test.hoursBetween(review.createdAt);
  if (reviewAgeHours === null || reviewAgeHours < config.reviewMinAgeHours) {
    return { eligible: false, reason: 'REVIEW_MIN_AGE_NOT_MET' };
  }
  if (!hasTwoWayMessageHistory(threads, messages, review.userId, supplierIds)) {
    return { eligible: false, reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING' };
  }
  const selectedKey = reviewTextKey(review);
  if (
    selectedKey &&
    (reviews || []).some(
      candidate =>
        candidate.id !== review.id &&
        candidate.userId !== review.userId &&
        candidate.approved === true &&
        reviewTextKey(candidate) === selectedKey
    )
  ) {
    return { eligible: false, reason: 'DUPLICATE_REVIEW_CONTENT' };
  }
  return advancedIntegrity.reviewNetworkEvidence(
    transaction.supplierUserId,
    partnerUserId,
    snapshot.reviewId
  );
};

const revalidateExactSubscription = async transaction => {
  const snapshot = transaction.qualificationEvidence || {};
  if (!snapshot.invoiceId) return { eligible: false, reason: 'QUALIFICATION_EVIDENCE_MISSING' };
  return stripeEvidence.subscriptionRewardEvidence(transaction.supplierUserId, snapshot.invoiceId);
};

const revalidateSnapshot = async (transaction, partnerUserId) => {
  const snapshot = transaction?.qualificationEvidence;
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return null;
  if (transaction.type === 'PACKAGE_BONUS') return revalidateExactPackage(transaction);
  if (transaction.type === 'FIRST_REVIEW_BONUS') {
    return revalidateExactReview(transaction, partnerUserId);
  }
  if (transaction.type === 'SUBSCRIPTION_BONUS') return revalidateExactSubscription(transaction);
  return { eligible: true };
};

module.exports = {
  SNAPSHOT_VERSION,
  buildSnapshot,
  persistSnapshot,
  revalidateSnapshot,
  _test: {
    reviewTextKey,
    reviewAccountAgeHours,
    hasTwoWayMessageHistory,
    revalidateExactPackage,
    revalidateExactReview,
    revalidateExactSubscription,
  },
};
