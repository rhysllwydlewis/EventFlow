'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');
const partnerAntiAbuse = require('./partnerAntiAbuseService');
const partnerClawback = require('./partnerRewardClawbackService');

let installed = false;

const RECONCILABLE_REWARDS = [
  {
    type: partnerService.CREDIT_TYPES.REFERRAL_SIGNUP_BONUS,
    method: 'awardReferralSignupBonus',
  },
  {
    type: partnerService.CREDIT_TYPES.PACKAGE_BONUS,
    method: 'awardPackageBonus',
  },
  {
    type: partnerService.CREDIT_TYPES.FIRST_REVIEW_BONUS,
    method: 'awardFirstReviewBonus',
  },
];

async function reconcileEligibleRewards(partnerId) {
  const [referrals, rewardedTransactions] = await Promise.all([
    dbUnified.find('partner_referrals', { partnerId }),
    dbUnified.find('partner_credit_transactions', { partnerId }),
  ]);
  const rewardedKeys = new Set(
    (rewardedTransactions || [])
      .filter(transaction => transaction.supplierUserId && transaction.type)
      .map(transaction => `${transaction.supplierUserId}:${transaction.type}`)
  );

  for (const referral of referrals || []) {
    for (const rewardDefinition of RECONCILABLE_REWARDS) {
      const rewardKey = `${referral.supplierUserId}:${rewardDefinition.type}`;
      if (rewardedKeys.has(rewardKey)) continue;

      try {
        const reward = await partnerService[rewardDefinition.method](referral.supplierUserId);
        if (reward) rewardedKeys.add(rewardKey);
      } catch (error) {
        logger.warn('[PARTNER-ANTI-ABUSE] Deferred reward reconciliation failed', {
          partnerId,
          supplierUserId: referral.supplierUserId,
          rewardType: rewardDefinition.type,
          error: error.message,
        });
      }
    }
  }
}

function installBalanceReconciliation() {
  const originalGetBalance = partnerService.getBalance.bind(partnerService);
  partnerService.getBalance = async partnerId => {
    await reconcileEligibleRewards(partnerId);
    return originalGetBalance(partnerId);
  };
}

function reviewNoteFrom(request, update) {
  return String(
    update?.$set?.adminInternalNotes ??
      update?.adminInternalNotes ??
      request?.adminInternalNotes ??
      ''
  ).trim();
}

function installDatabaseGuards() {
  const originalUpdateOne = dbUnified.updateOne.bind(dbUnified);

  dbUnified.updateOne = async (collection, query, update, ...rest) => {
    const nextStatus = update?.$set?.status ?? update?.status;

    if (collection === 'partner_cashout_requests' && nextStatus === 'approved') {
      const request = await dbUnified.findOne('partner_cashout_requests', query);
      if (!request) return originalUpdateOne(collection, query, update, ...rest);

      const assessment = await partnerAntiAbuse.assessCashout({
        partnerId: request.partnerId,
        requestId: request.id,
        requestedAt: request.createdAt,
      });
      await partnerAntiAbuse.persistAssessment(assessment);

      const riskFields = {
        fraudRiskScore: assessment.score,
        fraudRiskLevel: assessment.riskLevel,
        fraudReviewRequired: assessment.requiresManualReview,
        fraudAssessedAt: assessment.assessedAt,
      };

      if (assessment.blockApproval) {
        await originalUpdateOne(
          'partner_cashout_requests',
          { id: request.id },
          { $set: riskFields }
        );
        const error = new Error(
          'High-risk partner cashout blocked. Reject the request or resolve the underlying fraud signals.'
        );
        error.code = 'PARTNER_CASHOUT_HIGH_RISK';
        error.statusCode = 409;
        error.assessment = assessment;
        throw error;
      }

      const reviewNote = reviewNoteFrom(request, update);
      if (assessment.requiresManualReview && reviewNote.length < 20) {
        await originalUpdateOne(
          'partner_cashout_requests',
          { id: request.id },
          { $set: riskFields }
        );
        const error = new Error(
          'This cashout requires manual review. Add an internal review note of at least 20 characters before approval.'
        );
        error.code = 'PARTNER_CASHOUT_REVIEW_NOTE_REQUIRED';
        error.statusCode = 409;
        error.assessment = assessment;
        throw error;
      }

      const guardedUpdate = update?.$set
        ? {
            ...update,
            $set: {
              ...update.$set,
              ...riskFields,
              fraudReviewedAt: new Date().toISOString(),
            },
          }
        : { ...update, ...riskFields, fraudReviewedAt: new Date().toISOString() };
      return originalUpdateOne(collection, query, guardedUpdate, ...rest);
    }

    if (collection === 'payments' && ['refunded', 'disputed', 'chargeback'].includes(nextStatus)) {
      const payment = await dbUnified.findOne('payments', query);
      const result = await originalUpdateOne(collection, query, update, ...rest);
      if (!result) {
        const error = new Error('Adverse payment status update did not persist');
        error.code = 'PARTNER_PAYMENT_STATUS_WRITE_FAILED';
        throw error;
      }
      if (payment) {
        try {
          await partnerClawback.clawBackForPaymentRecord(
            { ...payment, ...(update?.$set || update) },
            nextStatus
          );
        } catch (error) {
          logger.error('[PARTNER-ANTI-ABUSE] Automatic reward clawback failed', {
            paymentId: payment.id,
            status: nextStatus,
            error: error.message,
          });
          throw error;
        }
      }
      return result;
    }

    return originalUpdateOne(collection, query, update, ...rest);
  };
}

function install() {
  if (installed) return;
  partnerAntiAbuse.installRewardGuards(partnerService);
  installBalanceReconciliation();
  installDatabaseGuards();
  installed = true;
  logger.info('[PARTNER-ANTI-ABUSE] Runtime guards installed');
}

module.exports = {
  install,
  reconcileEligibleRewards,
  reviewNoteFrom,
  RECONCILABLE_REWARDS,
};
