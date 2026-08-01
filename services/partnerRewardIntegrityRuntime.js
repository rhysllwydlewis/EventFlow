'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');
const partnerAntiAbuse = require('./partnerAntiAbuseService');
const integrity = require('./partnerRewardIntegrityService');
const candidateSelection = require('./partnerRewardCandidateSelectionService');
const supplierEvidence = require('./partnerRewardSupplierEvidenceService');
const advancedIntegrity = require('./partnerRewardIntegrityAdvancedService');
const exposureSafety = require('./partnerRewardExposureSafetyService');
const stripeEvidence = require('./partnerRewardStripeEvidenceService');
const qualificationEvidence = require('./partnerRewardQualificationEvidenceService');
const integrityClawback = require('./partnerRewardIntegrityClawbackService');
const integrityIndexes = require('./partnerRewardIntegrityIndexService');
const awardLock = require('./partnerRewardAwardLockService');

let installed = false;

const SOFT_SIGNAL_REASONS = new Set(['REVIEW_RING_SHARED_DEVICE_NETWORK', 'REVIEW_RING_SHARED_IP']);

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

const METHOD_NAME_BY_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(METHOD_CONFIG).map(([methodName, config]) => [config.type, methodName])
  )
);

const TECHNICAL_QUARANTINE_REASONS = new Set([
  'QUALIFICATION_EVIDENCE_PERSIST_FAILED',
  'MATURITY_EXTENSION_PERSIST_FAILED',
]);

function ensureIndexesBestEffort() {
  integrityIndexes.ensureIndexes().catch(error => {
    logger.warn('[PARTNER-REWARD-INTEGRITY] Reward integrity indexes are not ready yet', {
      error: error.message,
    });
  });
}

async function resolvePartnerContext(supplierUserId) {
  const referral = await dbUnified.findOne('partner_referrals', { supplierUserId });
  if (!referral) return { referral: null, partner: null };
  const partner = await dbUnified.findOne('partners', { id: referral.partnerId });
  return { referral, partner };
}

async function recordDecision({ supplierUserId, partnerId, rewardType, decision, eventType }) {
  try {
    await integrity.recordIntegrityEvent({
      partnerId,
      supplierUserId,
      rewardType,
      reason: decision.reason,
      evidence: decision.evidence || {},
      eventType,
    });
  } catch (error) {
    logger.warn('[PARTNER-REWARD-INTEGRITY] Failed to persist reward integrity evidence', {
      supplierUserId,
      partnerId,
      rewardType,
      reason: decision.reason,
      error: error.message,
    });
  }
}

async function applyRiskMaturity(transaction, partnerId, supplierUserId) {
  if (!transaction?.id) return transaction;
  const extraDays = await advancedIntegrity.maturityExtensionDays({ partnerId, supplierUserId });
  if (!extraDays) return transaction;
  const baseDays = Number(partnerService.CREDIT_MATURITY_DAYS || 30);
  const createdAtMs = Date.parse(transaction.createdAt);
  if (!Number.isFinite(createdAtMs)) return transaction;
  const maturesAt = new Date(createdAtMs + (baseDays + extraDays) * 86400000).toISOString();
  const updated = await dbUnified.updateOne(
    'partner_credit_transactions',
    { id: transaction.id },
    {
      $set: {
        maturesAt,
        maturityExtensionDays: extraDays,
        maturityRiskAppliedAt: new Date().toISOString(),
      },
    }
  );
  if (!updated) throw new Error('Partner reward maturity extension did not persist');
  return { ...transaction, maturesAt, maturityExtensionDays: extraDays };
}

async function evaluateStripeEvidence(methodName, supplierUserId, baseEvidence) {
  if (methodName !== 'awardSubscriptionBonus') return { eligible: true };
  if (baseEvidence.stripeDecision) return baseEvidence.stripeDecision;
  return stripeEvidence.subscriptionRewardEvidence(supplierUserId, baseEvidence.invoiceId);
}

async function withholdIfInvalid({ decision, supplierUserId, partnerId, rewardType, logMessage }) {
  if (decision.eligible) return false;
  if (SOFT_SIGNAL_REASONS.has(decision.reason)) {
    await recordDecision({
      supplierUserId,
      partnerId,
      rewardType,
      decision,
      eventType: 'reward_risk_signal',
    });
    logger.warn('[PARTNER-REWARD-INTEGRITY] Soft reward risk signal recorded without blocking', {
      supplierUserId,
      partnerId,
      rewardType,
      reason: decision.reason,
    });
    return false;
  }
  await recordDecision({
    supplierUserId,
    partnerId,
    rewardType,
    decision,
    eventType: 'reward_withheld',
  });
  logger.warn(logMessage, {
    supplierUserId,
    partnerId,
    rewardType,
    reason: decision.reason,
  });
  return true;
}

async function finaliseAward({
  reward,
  methodName,
  partnerId,
  supplierUserId,
  supplierDecision,
  baseEvidence,
  stripeDecision,
}) {
  if (!reward) return reward;
  const snapshot = qualificationEvidence.buildSnapshot({
    methodName,
    supplierDecision,
    baseEvidence,
    stripeDecision,
  });

  let persistedReward;
  try {
    persistedReward = await qualificationEvidence.persistSnapshot(reward, snapshot);
  } catch (error) {
    await integrityClawback.clawBackRewardTransaction(
      reward,
      'QUALIFICATION_EVIDENCE_PERSIST_FAILED'
    );
    throw error;
  }

  try {
    return await applyRiskMaturity(persistedReward, partnerId, supplierUserId);
  } catch (error) {
    await integrityClawback.clawBackRewardTransaction(
      persistedReward,
      'MATURITY_EXTENSION_PERSIST_FAILED'
    );
    throw error;
  }
}

async function awardInsideLock({
  original,
  methodName,
  config,
  supplierUserId,
  partner,
  supplierDecision,
  evidence,
  stripeDecision,
}) {
  const capDecision = await integrity.canAwardCredit({
    partnerId: partner.id,
    supplierUserId,
    type: config.type,
    amount: config.amount,
  });
  if (
    await withholdIfInvalid({
      decision: capDecision,
      supplierUserId,
      partnerId: partner.id,
      rewardType: config.type,
      logMessage: '[PARTNER-REWARD-INTEGRITY] Reward withheld by earning cap',
    })
  ) {
    return null;
  }

  const exposureDecision = await advancedIntegrity.exposureDecision({
    partnerId: partner.id,
    supplierUserId,
    type: config.type,
    amount: config.amount,
  });
  if (
    await withholdIfInvalid({
      decision: exposureDecision,
      supplierUserId,
      partnerId: partner.id,
      rewardType: config.type,
      logMessage: '[PARTNER-REWARD-INTEGRITY] Reward withheld by exposure control',
    })
  ) {
    return null;
  }

  const pendingDecision = await exposureSafety.pendingExposureDecision({
    partnerId: partner.id,
    amount: config.amount,
  });
  if (
    await withholdIfInvalid({
      decision: pendingDecision,
      supplierUserId,
      partnerId: partner.id,
      rewardType: config.type,
      logMessage: '[PARTNER-REWARD-INTEGRITY] Reward withheld by pending exposure control',
    })
  ) {
    return null;
  }

  const reward = await original(supplierUserId);
  return finaliseAward({
    reward,
    methodName,
    partnerId: partner.id,
    supplierUserId,
    supplierDecision,
    baseEvidence: evidence,
    stripeDecision,
  });
}

function isTechnicalQuarantinedReward(transaction) {
  return Boolean(
    transaction?.id &&
      transaction.partnerId &&
      transaction.supplierUserId &&
      transaction.reversedAt &&
      transaction.reversalMode === 'void_pending' &&
      TECHNICAL_QUARANTINE_REASONS.has(transaction.reversalReason)
  );
}

function isHardInvalidDecision(decision) {
  return !decision?.eligible && !SOFT_SIGNAL_REASONS.has(decision?.reason);
}

async function repairTechnicalReward(transaction) {
  if (!isTechnicalQuarantinedReward(transaction)) return null;
  const methodName = METHOD_NAME_BY_TYPE[transaction.type];
  const amount = Math.abs(Number(transaction.amount));
  if (!methodName || !Number.isFinite(amount) || amount <= 0) return null;

  const { referral, partner } = await resolvePartnerContext(transaction.supplierUserId);
  if (!referral || !partner || referral.partnerId !== transaction.partnerId) return null;

  try {
    return await awardLock.withPartnerAwardLock(partner.id, async () => {
      const storedReward =
        (await dbUnified.findOne('partner_credit_transactions', { id: transaction.id })) ||
        transaction;
      if (!isTechnicalQuarantinedReward(storedReward)) return null;

      const commonDecision = await partnerAntiAbuse.supplierRewardEligibility(
        transaction.supplierUserId,
        'awardReferralSignupBonus'
      );
      if (!commonDecision?.eligible) return null;

      const evidence = await candidateSelection.selectRewardEvidence({
        supplierUserId: transaction.supplierUserId,
        partnerUserId: partner.userId,
        methodName,
      });
      if (!evidence?.eligible) return null;

      const supplierDecision = await supplierEvidence.methodRewardEvidence({
        supplierUserId: transaction.supplierUserId,
        methodName,
      });
      if (!supplierDecision?.eligible) return null;

      const advancedDecision = await advancedIntegrity.methodRewardEvidence({
        supplierUserId: transaction.supplierUserId,
        partnerId: partner.id,
        partnerUserId: partner.userId,
        methodName,
        baseEvidence: evidence,
      });
      if (isHardInvalidDecision(advancedDecision)) return null;

      const stripeDecision = await evaluateStripeEvidence(
        methodName,
        transaction.supplierUserId,
        evidence
      );
      if (!stripeDecision?.eligible) return null;

      const capDecision = await integrity.canAwardCredit({
        partnerId: partner.id,
        supplierUserId: transaction.supplierUserId,
        type: transaction.type,
        amount: 0,
      });
      if (!capDecision?.eligible) return null;

      const exposureDecision = await advancedIntegrity.exposureDecision({
        partnerId: partner.id,
        supplierUserId: transaction.supplierUserId,
        type: transaction.type,
        amount: 0,
      });
      if (!exposureDecision?.eligible) return null;

      const pendingDecision = await exposureSafety.pendingExposureDecision({
        partnerId: partner.id,
        amount,
      });
      if (!pendingDecision?.eligible) return null;

      const snapshot = qualificationEvidence.buildSnapshot({
        methodName,
        supplierDecision,
        baseEvidence: evidence,
        stripeDecision,
      });
      const technicalRepairAt = new Date().toISOString();
      const repairCandidate = {
        ...storedReward,
        reversedAt: null,
        reversalTxnId: null,
        reversalReason: null,
        reversalMode: null,
        technicalRepairAt,
      };
      const snapshotReward = await qualificationEvidence.persistSnapshot(repairCandidate, snapshot);
      const updated = await dbUnified.updateOne(
        'partner_credit_transactions',
        { id: storedReward.id },
        {
          $set: {
            qualificationEvidence: snapshotReward.qualificationEvidence || snapshot,
            reversedAt: null,
            reversalTxnId: null,
            reversalReason: null,
            reversalMode: null,
            technicalRepairAt,
          },
        }
      );
      if (!updated) throw new Error('Technical partner reward repair did not persist');

      const repaired = await applyRiskMaturity(
        { ...snapshotReward, ...updated },
        partner.id,
        transaction.supplierUserId
      );
      await integrity.recordIntegrityEvent({
        partnerId: partner.id,
        supplierUserId: transaction.supplierUserId,
        rewardType: transaction.type,
        reason: 'TECHNICAL_REWARD_REPAIRED',
        eventType: 'reward_technical_repair',
        evidence: {
          rewardTxnId: storedReward.id,
          previousReversalReason: transaction.reversalReason,
        },
      });
      return repaired;
    });
  } catch (error) {
    if (error.code === 'PARTNER_REWARD_AWARD_LOCK_TIMEOUT') {
      logger.warn('[PARTNER-REWARD-INTEGRITY] Technical reward repair deferred because lock is busy', {
        partnerId: partner.id,
        rewardTxnId: transaction.id,
      });
      return null;
    }
    throw error;
  }
}

function installRewardMethodGuards() {
  for (const [methodName, config] of Object.entries(METHOD_CONFIG)) {
    const original = partnerService[methodName];
    if (typeof original !== 'function') continue;

    partnerService[methodName] = async supplierUserId => {
      ensureIndexesBestEffort();
      const { referral, partner } = await resolvePartnerContext(supplierUserId);
      if (!referral || !partner) return original(supplierUserId);

      const evidence = await candidateSelection.selectRewardEvidence({
        supplierUserId,
        partnerUserId: partner.userId,
        methodName,
      });
      if (
        await withholdIfInvalid({
          decision: evidence,
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          logMessage: '[PARTNER-REWARD-INTEGRITY] Reward withheld by qualification policy',
        })
      ) {
        return null;
      }

      const supplierDecision = await supplierEvidence.methodRewardEvidence({
        supplierUserId,
        methodName,
      });
      if (
        await withholdIfInvalid({
          decision: supplierDecision,
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          logMessage: '[PARTNER-REWARD-INTEGRITY] Reward withheld by supplier evidence policy',
        })
      ) {
        return null;
      }

      const advancedEvidence = await advancedIntegrity.methodRewardEvidence({
        supplierUserId,
        partnerId: partner.id,
        partnerUserId: partner.userId,
        methodName,
        baseEvidence: evidence,
      });
      if (
        await withholdIfInvalid({
          decision: advancedEvidence,
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          logMessage: '[PARTNER-REWARD-INTEGRITY] Reward withheld by advanced integrity policy',
        })
      ) {
        return null;
      }

      const stripeDecision = await evaluateStripeEvidence(methodName, supplierUserId, evidence);
      if (
        await withholdIfInvalid({
          decision: stripeDecision,
          supplierUserId,
          partnerId: partner.id,
          rewardType: config.type,
          logMessage:
            '[PARTNER-REWARD-INTEGRITY] Reward withheld by Stripe payment evidence policy',
        })
      ) {
        return null;
      }

      try {
        return await awardLock.withPartnerAwardLock(partner.id, () =>
          awardInsideLock({
            original,
            methodName,
            config,
            supplierUserId,
            partner,
            supplierDecision,
            evidence,
            stripeDecision,
          })
        );
      } catch (error) {
        if (error.code === 'PARTNER_REWARD_AWARD_LOCK_TIMEOUT') {
          await recordDecision({
            supplierUserId,
            partnerId: partner.id,
            rewardType: config.type,
            decision: { reason: error.code, evidence: {} },
            eventType: 'reward_deferred',
          });
          logger.warn('[PARTNER-REWARD-INTEGRITY] Reward deferred because award lock is busy', {
            supplierUserId,
            partnerId: partner.id,
            rewardType: config.type,
          });
          return null;
        }
        throw error;
      }
    };
  }
}

function installAttributionGuard() {
  const original = partnerService.recordReferral;
  if (typeof original !== 'function') return;

  partnerService.recordReferral = async input => {
    ensureIndexesBestEffort();
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

async function revalidatePartnerRewards(partnerId) {
  ensureIndexesBestEffort();
  return integrityClawback.revalidatePartnerRewards(partnerId);
}

function install() {
  if (installed) return;
  installRewardMethodGuards();
  installAttributionGuard();
  ensureIndexesBestEffort();
  installed = true;
  logger.info(
    '[PARTNER-REWARD-INTEGRITY] Supplier, payment, qualification, exposure, maturity and attribution guards installed'
  );
}

module.exports = {
  install,
  revalidatePartnerRewards,
  repairTechnicalReward,
  isTechnicalQuarantinedReward,
  METHOD_CONFIG,
  METHOD_NAME_BY_TYPE,
  SOFT_SIGNAL_REASONS,
  TECHNICAL_QUARANTINE_REASONS,
  _test: {
    resolvePartnerContext,
    applyRiskMaturity,
    evaluateStripeEvidence,
    withholdIfInvalid,
    ensureIndexesBestEffort,
    finaliseAward,
    awardInsideLock,
    isHardInvalidDecision,
  },
};
