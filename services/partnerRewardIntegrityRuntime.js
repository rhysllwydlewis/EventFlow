'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');
const integrity = require('./partnerRewardIntegrityService');

let installed = false;

const METHOD_CONFIG = Object.freeze({
  awardReferralSignupBonus: {
    type: partnerService.CREDIT_TYPES.REFERRAL_SIGNUP_BONUS,
    amount: partnerService.REFERRAL_SIGNUP_BONUS,
  },
  awardPackageBonus: {
    type: partnerService.CREDIT_TYPES.PACKAGE_BONUS,
    amount: partnerService.PACKAGE_BONUS,
  },
  awardFirstReviewBonus: {
    type: partnerService.CREDIT_TYPES.FIRST_REVIEW_BONUS,
    amount: partnerService.FIRST_REVIEW_BONUS,
  },
  awardSubscriptionBonus: {
    type: partnerService.CREDIT_TYPES.SUBSCRIPTION_BONUS,
    amount: partnerService.SUBSCRIPTION_BONUS,
  },
});

async function resolvePartnerContext(supplierUserId) {
  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (!referral) return { referral: null, partner: null };
  const partner = await dbUnified.findOne('partners', { id: referral.partnerId });
  return { referral, partner };
}

async function recordWithheld({ supplierUserId, partnerId, rewardType, decision }) {
  try {
    await integrity.recordIntegrityEvent({
      partnerId,
      supplierUserId,
      rewardType,
      reason: decision.reason,
      evidence: decision.evidence || {},
    });
  } catch (error) {
    logger.warn('[PARTNER-REWARD-INTEGRITY] Failed to persist withheld reward evidence', {
      supplierUserId,
      partnerId,
      rewardType,
      reason: decision.reason,
      error: error.message,
    });
  }
}

function installRewardMethodGuards() {
  for (const [methodName, config] of Object.entries(METHOD_CONFIG)) {
    const original = partnerService[methodName];
    if (typeof original !== 'function') continue;

    partnerService[methodName] = async supplierUserId => {
      const { referral, partner } = await resolvePartnerContext(supplierUserId);
      if (!referral || !partner) return original(supplierUserId);

      const evidence = await integrity.methodRewardEvidence({
        supplierUserId,
        partnerId: partner.id,
        partnerUserId: partner.userId,
        methodName,
      });
      if (!evidence.eligible) {
        await recordWithheld({
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          decision: evidence,
        });
        logger.warn('[PARTNER-REWARD-INTEGRITY] Reward withheld by qualification policy', {
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          reason: evidence.reason,
        });
        return null;
      }

      const capDecision = await integrity.canAwardCredit({
        partnerId: partner.id,
        supplierUserId,
        type: config.type,
        amount: config.amount,
      });
      if (!capDecision.eligible) {
        await recordWithheld({
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          decision: capDecision,
        });
        logger.warn('[PARTNER-REWARD-INTEGRITY] Reward withheld by earning cap', {
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          reason: capDecision.reason,
        });
        return null;
      }

      return original(supplierUserId);
    };
  }
}

function installAttributionGuard() {
  const original = partnerService.recordReferral;
  if (typeof original !== 'function') return;

  partnerService.recordReferral = async input => {
    const existing = input?.supplierUserId
      ? await dbUnified.findOne('partner_referrals', { supplierUserId: input.supplierUserId })
      : null;
    if (existing && input?.partnerId && existing.partnerId !== input.partnerId) {
      try {
        await integrity.recordAttributionConflict({
          supplierUserId: input.supplierUserId,
          existingPartnerId: existing.partnerId,
          attemptedPartnerId: input.partnerId,
        });
      } catch (error) {
        logger.warn('[PARTNER-REWARD-INTEGRITY] Failed to persist attribution conflict', {
          supplierUserId: input.supplierUserId,
          error: error.message,
        });
      }
      return existing;
    }
    return original(input);
  };
}

function install() {
  if (installed) return;
  installRewardMethodGuards();
  installAttributionGuard();
  installed = true;
  logger.info('[PARTNER-REWARD-INTEGRITY] Qualification, cap and attribution guards installed');
}

module.exports = {
  install,
  METHOD_CONFIG,
  _test: {
    resolvePartnerContext,
  },
};
