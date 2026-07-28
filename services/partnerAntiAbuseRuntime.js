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

const REWARD_TOTAL_FIELDS = Object.freeze({
  [partnerService.CREDIT_TYPES.PACKAGE_BONUS]: 'packageBonusTotal',
  [partnerService.CREDIT_TYPES.SUBSCRIPTION_BONUS]: 'subscriptionBonusTotal',
  [partnerService.CREDIT_TYPES.REFERRAL_SIGNUP_BONUS]: 'signupBonusTotal',
  [partnerService.CREDIT_TYPES.FIRST_REVIEW_BONUS]: 'reviewBonusTotal',
});

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
  const baseMaturityDays = Number(partnerService.CREDIT_MATURITY_DAYS || 30);
  const baseMaturityCutoff = now - baseMaturityDays * 86400000;
  let deferred = 0;

  for (const transaction of balance.transactions) {
    if (transaction.reversedAt || Number(transaction.amount) <= 0 || !transaction.maturesAt) continue;
    const maturesAt = Date.parse(transaction.maturesAt);
    const createdAt = Date.parse(transaction.createdAt);
    if (!Number.isFinite(maturesAt) || !Number.isFinite(createdAt)) continue;

    // The underlying balance calculator already keeps rewards younger than the normal
    // maturity window in maturingBalance. Only move a reward here once it would otherwise
    // have become available under the normal rule but its explicit risk maturity is later.
    if (createdAt <= baseMaturityCutoff && maturesAt > now) {
      deferred += Number(transaction.amount);
    }
  }
  if (!deferred) return balance;
  return {
    ...balance,
    availableBalance: Math.max(0, Number(balance.availableBalance || 0) - deferred),
    maturingBalance: Number(balance.maturingBalance || 0) + deferred,
  };
}

function applyRewardReversals(balance) {
  if (!balance || !Array.isArray(balance.transactions)) return balance;
  const reversedRewards = balance.transactions.filter(
    transaction =>
      transaction.reversedAt &&
      Number(transaction.amount) > 0 &&
      Boolean(REWARD_TOTAL_FIELDS[transaction.type])
  );
  if (!reversedRewards.length) return balance;

  const result = {
    ...balance,
    voidedPendingPoints: Number(balance.voidedPendingPoints || 0),
    clawedBackPoints: Number(balance.clawedBackPoints || 0),
  };

  for (const transaction of reversedRewards) {
    const totalField = REWARD_TOTAL_FIELDS[transaction.type];
    const amount = Number(transaction.amount);
    result[totalField] = Math.max(0, Number(result[totalField] || 0) - amount);
    result.totalEarned = Math.max(0, Number(result.totalEarned || 0) - amount);

    if (transaction.reversalMode === 'void_pending') {
      // No financial debit exists for a pending void. Remove the invalid credit itself
      // from the headline balance and from whichever maturing bucket held it.
      result.balance = Number(result.balance || 0) - amount;
      result.maturingBalance = Math.max(0, Number(result.maturingBalance || 0) - amount);
      result.voidedPendingPoints += amount;
    } else if (transaction.reversalMode === 'debit_matured') {
      // The REDEEM transaction already reduces availableBalance and headline balance.
      // Only correct the earned/reward reporting totals here.
      result.clawedBackPoints += amount;
    }
  }

  return result;
}

function installBalanceReconciliation() {
  const originalGetBalance = partnerService.getBalance.bind(partnerService);
  partnerService.getBalance = async partnerId => {
    await partnerRewardIntegrityRuntime.revalidatePartnerRewards(partnerId);
    await reconcileEligibleRewards(partnerId);
    const baseBalance = await originalGetBalance(partnerId);
    return applyRewardReversals(applyExtendedMaturity(baseBalance));
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
  _test: { applyExtendedMaturity, applyRewardReversals },
};
