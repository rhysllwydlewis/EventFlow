'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');

const CLAWBACK_SUBTYPE = 'PARTNER_REWARD_CLAWBACK';

async function findPartnerSubscriptionReward(supplierUserId) {
  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (!referral) return null;
  const reward = await dbUnified.findOne('partner_credit_transactions', {
    partnerId: referral.partnerId,
    supplierUserId,
    type: partnerService.CREDIT_TYPES.SUBSCRIPTION_BONUS,
  });
  return reward ? { referral, reward } : null;
}

async function clawBackSubscriptionReward({ supplierUserId, externalRef, reason }) {
  if (!supplierUserId || !externalRef) return null;

  const redeemType = partnerService.CREDIT_TYPES.REDEEM || 'REDEEM';
  const existingDebit = await dbUnified.findOne('partner_credit_transactions', {
    type: redeemType,
    externalRef,
  });
  if (existingDebit?.subtype === CLAWBACK_SUBTYPE) return existingDebit;

  const match = await findPartnerSubscriptionReward(supplierUserId);
  if (!match) return null;

  const debit =
    existingDebit ||
    (await partnerService.debitPoints({
      partnerId: match.referral.partnerId,
      amount: Math.abs(Number(match.reward.amount) || partnerService.SUBSCRIPTION_BONUS),
      notes: `Partner subscription reward clawback: ${reason || 'payment reversed'}`,
      externalRef,
    }));
  if (!debit) throw new Error('Partner reward clawback debit did not persist');

  // Keep the canonical REDEEM type so getBalance() continues to subtract the debit
  // from available rewards. The subtype supplies the audit classification.
  const updatedDebit = await dbUnified.updateOne(
    'partner_credit_transactions',
    { id: debit.id },
    {
      $set: {
        subtype: CLAWBACK_SUBTYPE,
        supplierUserId,
        originalRewardTxnId: match.reward.id,
      },
    }
  );
  if (!updatedDebit) throw new Error('Partner reward clawback audit fields did not persist');

  const updatedReferral = await dbUnified.updateOne(
    'partner_referrals',
    { id: match.referral.id },
    {
      $set: {
        subscriptionRewardReversedAt: new Date().toISOString(),
        subscriptionRewardReversalRef: externalRef,
      },
    }
  );
  if (!updatedReferral) throw new Error('Partner referral clawback state did not persist');

  logger.warn('[PARTNER-ANTI-ABUSE] Subscription reward clawed back', {
    partnerId: match.referral.partnerId,
    supplierUserId,
    originalRewardTxnId: match.reward.id,
    externalRef,
  });
  return { ...debit, subtype: CLAWBACK_SUBTYPE, supplierUserId };
}

async function clawBackForPaymentRecord(payment, status) {
  if (!payment || !['refunded', 'disputed', 'chargeback'].includes(status)) return null;
  const paymentReference = payment.stripePaymentId || payment.id;
  return clawBackSubscriptionReward({
    supplierUserId: payment.userId,
    externalRef: `payment:${paymentReference}:partner-subscription-reward`,
    reason: `Stripe payment marked ${status}`,
  });
}

module.exports = {
  CLAWBACK_SUBTYPE,
  findPartnerSubscriptionReward,
  clawBackSubscriptionReward,
  clawBackForPaymentRecord,
};
