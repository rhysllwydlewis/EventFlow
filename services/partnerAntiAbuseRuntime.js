'use strict';

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const partnerService = require('./partnerService');
const partnerAntiAbuse = require('./partnerAntiAbuseService');
const partnerRewardIntegrityRuntime = require('./partnerRewardIntegrityRuntime');

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
  {
    type: partnerService.CREDIT_TYPES.SUBSCRIPTION_BONUS,
    method: 'awardSubscriptionBonus',
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

function applyExtendedMaturity(balance) {
  if (!balance || !Array.isArray(balance.transactions)) return balance;
  const now = Date.now();
  let deferred = 0;
  for (const transaction of balance.transactions) {
    if (Number(transaction.amount) <= 0 || !transaction.maturesAt) continue;
    const maturesAt = Date.parse(transaction.maturesAt);
    if (Number.isFinite(maturesAt) && maturesAt > now) deferred += Number(transaction.amount);
  }
  if (!deferred) return balance;
  return {
    ...balance,
    availableBalance: Math.max(0, Number(balance.availableBalance || 0) - deferred),
    maturingBalance: Number(balance.maturingBalance || 0) + deferred,
  };
}

function installBalanceReconciliation() {
  const originalGetBalance = partnerService.getBalance.bind(partnerService);
  partnerService.getBalance = async partnerId => {
    await partnerRewardIntegrityRuntime.revalidatePartnerRewards(partnerId);
    await reconcileEligibleRewards(partnerId);
    return applyExtendedMaturity(await originalGetBalance(partnerId));
  };
}

function install() {
  if (installed) return;
  partnerAntiAbuse.installRewardGuards(partnerService);
  partnerRewardIntegrityRuntime.install();
  installBalanceReconciliation();
  installed = true;
  logger.info(
    '[PARTNER-ANTI-ABUSE] Reward eligibility, integrity guards, revalidation and reconciliation installed'
  );
}

module.exports = {
  install,
  reconcileEligibleRewards,
  RECONCILABLE_REWARDS,
  _test: { applyExtendedMaturity },
};
