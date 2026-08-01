'use strict';

const dbUnified = require('../db-unified');
const partnerService = require('./partnerService');

const MILESTONE_TYPES = new Set([
  'PACKAGE_BONUS',
  'SUBSCRIPTION_BONUS',
  'REFERRAL_SIGNUP_BONUS',
  'FIRST_REVIEW_BONUS',
]);

const numberEnv = (name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const getConfig = () => {
  return {
    pendingPointsCap: numberEnv('PARTNER_REWARD_PENDING_POINTS_CAP', 5000, 130, 1000000),
  };
};

const isPendingReward = (transaction, now = Date.now()) => {
  if (
    !transaction ||
    transaction.reversedAt ||
    !MILESTONE_TYPES.has(transaction.type) ||
    Number(transaction.amount) <= 0
  ) {
    return false;
  }
  const explicit = Date.parse(transaction.maturesAt);
  if (Number.isFinite(explicit)) return explicit > now;
  const createdAt = Date.parse(transaction.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  const maturityDays = Number(partnerService.CREDIT_MATURITY_DAYS || 30);
  return createdAt > now - maturityDays * 86400000;
};

const pendingExposureDecision = async ({ partnerId, amount }) => {
  const config = getConfig();
  const transactions = await dbUnified.find('partner_credit_transactions', { partnerId });
  const pending = (transactions || [])
    .filter(transaction => isPendingReward(transaction))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  if (pending + Number(amount || 0) > config.pendingPointsCap) {
    return {
      eligible: false,
      reason: 'PENDING_REWARD_EXPOSURE_CAP_REACHED',
      evidence: { current: pending, attempted: amount, cap: config.pendingPointsCap },
    };
  }
  return { eligible: true };
};

module.exports = {
  getConfig,
  pendingExposureDecision,
  _test: { isPendingReward },
};
