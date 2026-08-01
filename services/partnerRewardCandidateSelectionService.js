'use strict';

const dbUnified = require('../db-unified');
const baseIntegrity = require('./partnerRewardIntegrityService');
const advancedIntegrity = require('./partnerRewardIntegrityAdvancedService');
const stripeEvidence = require('./partnerRewardStripeEvidenceService');
const qualificationEvidence = require('./partnerRewardQualificationEvidenceService');

const SOFT_REVIEW_REASONS = new Set(['REVIEW_RING_SHARED_DEVICE_NETWORK', 'REVIEW_RING_SHARED_IP']);

const withBase = (result, extra = {}) => {
  return result.eligible ? { ...result, ...extra } : result;
};

const selectPackageEvidence = async supplierUserId => {
  const profiles = await dbUnified.find('suppliers', { ownerUserId: supplierUserId });
  const approvedProfiles = (profiles || []).filter(profile => profile.approved === true);
  if (!approvedProfiles.length) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  const supplierIds = new Set(approvedProfiles.map(profile => profile.id));
  const packages = await dbUnified.read('packages');
  let firstFailure = { eligible: false, reason: 'QUALIFYING_PACKAGE_MISSING' };

  for (const pkg of packages || []) {
    if (!supplierIds.has(pkg.supplierId)) continue;
    const quality = baseIntegrity.packageQuality(pkg);
    if (!quality.eligible) {
      if (firstFailure.reason === 'QUALIFYING_PACKAGE_MISSING') firstFailure = quality;
      continue;
    }
    const copyCheck = await advancedIntegrity.packageCopyEvidence(supplierUserId, pkg.id);
    if (copyCheck.eligible) return withBase(quality, { packageId: pkg.id });
    if (firstFailure.reason === 'QUALIFYING_PACKAGE_MISSING') firstFailure = copyCheck;
  }
  return firstFailure;
};

const selectReviewEvidence = async (supplierUserId, partnerUserId) => {
  const [profiles, reviews] = await Promise.all([
    dbUnified.find('suppliers', { ownerUserId: supplierUserId }),
    dbUnified.read('reviews'),
  ]);
  const approvedProfiles = (profiles || []).filter(profile => profile.approved === true);
  if (!approvedProfiles.length) return { eligible: false, reason: 'SUPPLIER_PROFILE_NOT_APPROVED' };
  const supplierIds = new Set(approvedProfiles.map(profile => profile.id));
  let firstFailure = { eligible: false, reason: 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING' };
  let softCandidate = null;

  for (const review of reviews || []) {
    if (!supplierIds.has(review.supplierId)) continue;
    const pseudoTransaction = {
      supplierUserId,
      qualificationEvidence: {
        version: qualificationEvidence.SNAPSHOT_VERSION,
        reviewId: review.id,
      },
    };
    const decision = await qualificationEvidence._test.revalidateExactReview(
      pseudoTransaction,
      partnerUserId
    );
    if (decision.eligible) {
      return { eligible: true, reviewId: review.id, reviewerUserId: review.userId };
    }
    if (SOFT_REVIEW_REASONS.has(decision.reason)) {
      if (!softCandidate) {
        softCandidate = {
          eligible: true,
          reviewId: review.id,
          reviewerUserId: review.userId,
          softReason: decision.reason,
          softEvidence: decision.evidence || {},
        };
      }
      continue;
    }
    if (firstFailure.reason === 'INDEPENDENT_CUSTOMER_INTERACTION_MISSING') {
      firstFailure = decision;
    }
  }

  return softCandidate || firstFailure;
};

const selectSubscriptionEvidence = async supplierUserId => {
  const config = baseIntegrity.getConfig();
  const invoices = await dbUnified.read('invoices');
  let firstFailure = { eligible: false, reason: 'QUALIFYING_PAID_SUBSCRIPTION_INVOICE_MISSING' };
  let temporaryFailure = null;
  const candidates = (invoices || [])
    .filter(invoice => {
      const amount = Number(invoice.amount);
      return (
        invoice.userId === supplierUserId &&
        invoice.status === 'paid' &&
        Number.isFinite(amount) &&
        amount >= config.minSubscriptionAmount &&
        invoice.stripeInvoiceId &&
        invoice.paidAt
      );
    })
    .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));

  for (const invoice of candidates) {
    const decision = await stripeEvidence.subscriptionRewardEvidence(supplierUserId, invoice.id);
    if (decision.eligible) {
      return {
        eligible: true,
        invoiceId: invoice.id,
        stripeInvoiceId: invoice.stripeInvoiceId,
        amount: Number(invoice.amount),
        currency: invoice.currency || null,
        stripeDecision: decision,
      };
    }
    if (
      ['STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE', 'STRIPE_PAYMENT_EVIDENCE_PERSIST_FAILED'].includes(
        decision.reason
      )
    ) {
      temporaryFailure = temporaryFailure || decision;
    } else if (firstFailure.reason === 'QUALIFYING_PAID_SUBSCRIPTION_INVOICE_MISSING') {
      firstFailure = decision;
    }
  }

  return temporaryFailure || firstFailure;
};

const selectRewardEvidence = async ({ supplierUserId, partnerUserId, methodName }) => {
  const duplicateBusiness = await baseIntegrity.duplicateSupplierBusinessEvidence(supplierUserId);
  if (duplicateBusiness.duplicate) {
    return {
      eligible: false,
      reason: 'DUPLICATE_SUPPLIER_BUSINESS_IDENTITY',
      evidence: duplicateBusiness,
    };
  }

  if (methodName === 'awardReferralSignupBonus') {
    return baseIntegrity.signupRewardEvidence(supplierUserId);
  }
  if (methodName === 'awardPackageBonus') return selectPackageEvidence(supplierUserId);
  if (methodName === 'awardFirstReviewBonus') {
    return selectReviewEvidence(supplierUserId, partnerUserId);
  }
  if (methodName === 'awardSubscriptionBonus') return selectSubscriptionEvidence(supplierUserId);
  return { eligible: false, reason: 'UNKNOWN_REWARD_METHOD' };
};

module.exports = {
  SOFT_REVIEW_REASONS,
  selectRewardEvidence,
  _test: {
    selectPackageEvidence,
    selectReviewEvidence,
    selectSubscriptionEvidence,
  },
};
