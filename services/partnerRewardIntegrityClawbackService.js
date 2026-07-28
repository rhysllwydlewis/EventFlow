'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');
const baseIntegrity = require('./partnerRewardIntegrityService');
const supplierEvidence = require('./partnerRewardSupplierEvidenceService');
const advancedIntegrity = require('./partnerRewardIntegrityAdvancedService');
const stripeEvidence = require('./partnerRewardStripeEvidenceService');

const CLAWBACK_SUBTYPE = 'PARTNER_REWARD_INTEGRITY_CLAWBACK';

const METHOD_BY_TYPE = Object.freeze({
  REFERRAL_SIGNUP_BONUS: 'awardReferralSignupBonus',
  PACKAGE_BONUS: 'awardPackageBonus',
  FIRST_REVIEW_BONUS: 'awardFirstReviewBonus',
  SUBSCRIPTION_BONUS: 'awardSubscriptionBonus',
});

const TEMPORAL_REASONS = new Set([
  'SUPPLIER_MIN_ACCOUNT_AGE_NOT_MET',
  'PACKAGE_MIN_LIVE_PERIOD_NOT_MET',
  'REVIEW_MODERATION_WINDOW_NOT_MET',
  'SUBSCRIPTION_SETTLEMENT_WINDOW_NOT_MET',
  'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
  'STRIPE_PAYMENT_EVIDENCE_PERSIST_FAILED',
]);

function isWithinRevalidationWindow(transaction, now = Date.now()) {
  const createdAt = Date.parse(transaction?.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  return now - createdAt <= advancedIntegrity.getConfig().revalidationDays * 86400000;
}

async function clawBackRewardTransaction(transaction, reason) {
  if (!transaction?.id || !transaction.partnerId || !transaction.supplierUserId) return null;
  const rewardAmount = Math.abs(Number(transaction.amount));
  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    const error = new Error('Partner integrity clawback reward amount is invalid');
    error.code = 'PARTNER_REWARD_CLAWBACK_AMOUNT_INVALID';
    throw error;
  }

  const externalRef = `reward-integrity:${transaction.id}`;
  const existing = await dbUnified.findOne('partner_credit_transactions', {
    type: partnerService.CREDIT_TYPES.REDEEM,
    externalRef,
  });
  const debit =
    existing ||
    (await partnerService.debitPoints({
      partnerId: transaction.partnerId,
      amount: rewardAmount,
      notes: `Partner reward integrity clawback: ${reason}`,
      externalRef,
    }));
  if (!debit) throw new Error('Partner integrity clawback debit did not persist');

  // Reapply every audit write on retries. This repairs a partial attempt where the
  // financial debit persisted but one of the later audit markers did not.
  const now = new Date().toISOString();
  const updatedDebit = await dbUnified.updateOne(
    'partner_credit_transactions',
    { id: debit.id },
    {
      $set: {
        subtype: CLAWBACK_SUBTYPE,
        supplierUserId: transaction.supplierUserId,
        originalRewardTxnId: transaction.id,
        originalRewardType: transaction.type,
        integrityReason: reason,
      },
    }
  );
  if (!updatedDebit) throw new Error('Partner integrity clawback audit fields did not persist');

  const updatedReward = await dbUnified.updateOne(
    'partner_credit_transactions',
    { id: transaction.id },
    {
      $set: {
        reversedAt: transaction.reversedAt || now,
        reversalTxnId: debit.id,
        reversalReason: reason,
      },
    }
  );
  if (!updatedReward) throw new Error('Original reward reversal marker did not persist');

  await baseIntegrity.recordIntegrityEvent({
    partnerId: transaction.partnerId,
    supplierUserId: transaction.supplierUserId,
    rewardType: transaction.type,
    reason,
    eventType: 'reward_clawback',
    evidence: { originalRewardTxnId: transaction.id, reversalTxnId: debit.id },
  });

  logger.warn('[PARTNER-REWARD-INTEGRITY] Reward clawed back after evidence invalidation', {
    partnerId: transaction.partnerId,
    supplierUserId: transaction.supplierUserId,
    rewardType: transaction.type,
    originalRewardTxnId: transaction.id,
    reason,
  });
  return { ...debit, subtype: CLAWBACK_SUBTYPE, supplierUserId: transaction.supplierUserId };
}

async function clawBackIfDurablyInvalid(transaction, decision) {
  if (decision.eligible || TEMPORAL_REASONS.has(decision.reason)) return false;
  await clawBackRewardTransaction(transaction, decision.reason);
  return true;
}

async function revalidatePartnerRewards(partnerId) {
  const [partner, transactions] = await Promise.all([
    dbUnified.findOne('partners', { id: partnerId }),
    dbUnified.find('partner_credit_transactions', { partnerId }),
  ]);
  if (!partner) return { checked: 0, clawedBack: 0 };

  let checked = 0;
  let clawedBack = 0;
  const positiveRewards = (transactions || []).filter(
    transaction =>
      METHOD_BY_TYPE[transaction.type] &&
      transaction.supplierUserId &&
      Number(transaction.amount) > 0 &&
      !transaction.reversedAt &&
      isWithinRevalidationWindow(transaction)
  );

  for (const transaction of positiveRewards) {
    checked += 1;
    const methodName = METHOD_BY_TYPE[transaction.type];
    try {
      const baseEvidence = await baseIntegrity.methodRewardEvidence({
        supplierUserId: transaction.supplierUserId,
        partnerId,
        partnerUserId: partner.userId,
        methodName,
      });
      if (!baseEvidence.eligible) {
        if (await clawBackIfDurablyInvalid(transaction, baseEvidence)) clawedBack += 1;
        continue;
      }

      const supplierDecision = await supplierEvidence.methodRewardEvidence({
        supplierUserId: transaction.supplierUserId,
        methodName,
      });
      if (!supplierDecision.eligible) {
        if (await clawBackIfDurablyInvalid(transaction, supplierDecision)) clawedBack += 1;
        continue;
      }

      const advancedEvidence = await advancedIntegrity.methodRewardEvidence({
        supplierUserId: transaction.supplierUserId,
        partnerId,
        partnerUserId: partner.userId,
        methodName,
        baseEvidence,
      });
      if (!advancedEvidence.eligible) {
        if (await clawBackIfDurablyInvalid(transaction, advancedEvidence)) clawedBack += 1;
        continue;
      }

      if (methodName === 'awardSubscriptionBonus') {
        const paymentDecision = await stripeEvidence.subscriptionRewardEvidence(
          transaction.supplierUserId,
          baseEvidence.invoiceId
        );
        if (await clawBackIfDurablyInvalid(transaction, paymentDecision)) clawedBack += 1;
      }
    } catch (error) {
      logger.error('[PARTNER-REWARD-INTEGRITY] Reward revalidation failed', {
        partnerId,
        rewardTxnId: transaction.id,
        error: error.message,
      });
      throw error;
    }
  }

  return { checked, clawedBack };
}

module.exports = {
  CLAWBACK_SUBTYPE,
  METHOD_BY_TYPE,
  clawBackRewardTransaction,
  revalidatePartnerRewards,
  _test: { isWithinRevalidationWindow, TEMPORAL_REASONS, clawBackIfDurablyInvalid },
};
