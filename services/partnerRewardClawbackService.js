'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');

const CLAWBACK_TYPE = 'PARTNER_REWARD_CLAWBACK';

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
  const existing = await dbUnified.findOne('partner_credit_transactions', { externalRef });
  if (existing) return existing;

  const match = await findPartnerSubscriptionReward(supplierUserId);
  if (!match) return null;

  const debit = await partnerService.debitPoints({
    partnerId: match.referral.partnerId,
    amount: Math.abs(Number(match.reward.amount) || partnerService.SUBSCRIPTION_BONUS),
    notes: `Partner subscription reward clawback: ${reason || 'payment reversed'}`,
    externalRef,
  });
  if (!debit) throw new Error('Partner reward clawback debit did not persist');

  const updatedDebit = await dbUnified.updateOne(
    'partner_credit_transactions',
    { id: debit.id },
    {
      $set: {
        type: CLAWBACK_TYPE,
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
  return { ...debit, type: CLAWBACK_TYPE, supplierUserId };
}

async function clawBackForPaymentRecord(payment, status) {
  if (!payment || !['refunded', 'disputed', 'chargeback'].includes(status)) return null;
  const paymentReference = payment.stripePaymentId || payment.id;
  return clawBackSubscriptionReward({
    supplierUserId: payment.userId,
    // One stable reference prevents a refund followed by a dispute update from debiting twice.
    externalRef: `payment:${paymentReference}:partner-subscription-reward`,
    reason: `Stripe payment marked ${status}`,
  });
}

module.exports = {
  CLAWBACK_TYPE,
  findPartnerSubscriptionReward,
  clawBackSubscriptionReward,
  clawBackForPaymentRecord,
};