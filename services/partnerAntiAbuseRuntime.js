'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');
const partnerAntiAbuse = require('./partnerAntiAbuseService');

let installed = false;

async function reconcileVerifiedSignupRewards(partnerId) {
  const referrals = await dbUnified.find('partner_referrals', { partnerId });
  for (const referral of referrals || []) {
    try {
      await partnerService.awardReferralSignupBonus(referral.supplierUserId);
    } catch (error) {
      logger.warn('[PARTNER-ANTI-ABUSE] Signup reward reconciliation failed', {
        partnerId,
        supplierUserId: referral.supplierUserId,
        error: error.message,
      });
    }
  }
}

function installBalanceReconciliation() {
  const originalGetBalance = partnerService.getBalance.bind(partnerService);
  partnerService.getBalance = async partnerId => {
    await reconcileVerifiedSignupRewards(partnerId);
    return originalGetBalance(partnerId);
  };
}

function installCashoutApprovalGuard() {
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
          'High-risk partner cashout blocked. Review the fraud assessment and reject the request or resolve the underlying signals.'
        );
        error.code = 'PARTNER_CASHOUT_HIGH_RISK';
        error.statusCode = 409;
        error.assessment = assessment;
        throw error;
      }

      const guardedUpdate = update?.$set
        ? { ...update, $set: { ...update.$set, ...riskFields } }
        : { ...update, ...riskFields };
      return originalUpdateOne(collection, query, guardedUpdate, ...rest);
    }

    return originalUpdateOne(collection, query, update, ...rest);
  };
}

function install() {
  if (installed) return;
  partnerAntiAbuse.installRewardGuards(partnerService);
  installBalanceReconciliation();
  installCashoutApprovalGuard();
  installed = true;
  logger.info('[PARTNER-ANTI-ABUSE] Runtime guards installed');
}

module.exports = {
  install,
  reconcileVerifiedSignupRewards,
};
