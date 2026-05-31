'use strict';

const { PLAN_FEATURES, TIER_LEVELS } = require('../models/Subscription');

const SUPPORTED_INTERVALS = ['month', 'year'];
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const PLAN_DEFINITIONS = {
  free: { id: 'free', displayName: 'Free', tier: 'free', intervals: {}, checkout: false },
  pro: {
    id: 'pro',
    displayName: PLAN_FEATURES.pro.name,
    tier: 'pro',
    intervals: { month: process.env.STRIPE_PRO_PRICE_ID || null, year: process.env.STRIPE_PRO_YEARLY_PRICE_ID || null },
    checkout: true,
  },
  pro_plus: {
    id: 'pro_plus',
    displayName: PLAN_FEATURES.pro_plus.name,
    tier: 'pro_plus',
    intervals: { month: process.env.STRIPE_PRO_PLUS_PRICE_ID || null, year: process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID || null },
    checkout: true,
  },
};

const PLAN_ALIASES = {
  starter: { planId: 'free', billingInterval: 'month' },
  free: { planId: 'free', billingInterval: 'month' },
  pro: { planId: 'pro', billingInterval: 'month' },
  professional: { planId: 'pro', billingInterval: 'month' },
  pro_monthly: { planId: 'pro', billingInterval: 'month' },
  pro_yearly: { planId: 'pro', billingInterval: 'year' },
  pro_plus: { planId: 'pro_plus', billingInterval: 'month' },
  proplus: { planId: 'pro_plus', billingInterval: 'month' },
  'pro plus': { planId: 'pro_plus', billingInterval: 'month' },
  professional_plus: { planId: 'pro_plus', billingInterval: 'month' },
  'professional plus': { planId: 'pro_plus', billingInterval: 'month' },
  pro_plus_monthly: { planId: 'pro_plus', billingInterval: 'month' },
  pro_plus_yearly: { planId: 'pro_plus', billingInterval: 'year' },
};

function normalisePlanRequest(rawPlanId, rawInterval = 'month') {
  const requestedPlan = String(rawPlanId || '').trim().toLowerCase();
  const requestedInterval = String(rawInterval || '').trim().toLowerCase();
  const alias = PLAN_ALIASES[requestedPlan];
  if (alias) return { ...alias };
  if (!Object.prototype.hasOwnProperty.call(PLAN_DEFINITIONS, requestedPlan)) return null;
  const billingInterval = SUPPORTED_INTERVALS.includes(requestedInterval) ? requestedInterval : 'month';
  return { planId: requestedPlan, billingInterval };
}

function getPlanDefinition(planId) { return PLAN_DEFINITIONS[planId] || null; }
function getPlanTier(planId) { return getPlanDefinition(planId)?.tier || 'free'; }
function getPlanLevel(planId) { return TIER_LEVELS[getPlanTier(planId)] ?? 0; }
function resolvePriceId(planId, billingInterval = 'month') {
  const plan = getPlanDefinition(planId);
  return plan?.intervals?.[billingInterval] || null;
}
function resolvePriceIdForRequest(rawPlanId, rawInterval = 'month') {
  const normalized = normalisePlanRequest(rawPlanId, rawInterval);
  if (!normalized) return null;
  return { ...normalized, priceId: resolvePriceId(normalized.planId, normalized.billingInterval), plan: getPlanDefinition(normalized.planId) };
}
function normaliseReturnUrl(url, fallbackPath) {
  const fallback = new URL(fallbackPath, BASE_URL).toString();
  if (!url) return fallback;
  try {
    const parsed = new URL(url, BASE_URL);
    const base = new URL(BASE_URL);
    return parsed.origin === base.origin ? parsed.toString() : fallback;
  } catch (_err) {
    return fallback;
  }
}
function listPublicPlans() {
  return Object.values(PLAN_DEFINITIONS).map(plan => ({ id: plan.id, displayName: plan.displayName, tier: plan.tier, checkout: plan.checkout, features: PLAN_FEATURES[plan.tier]?.features || {}, price: PLAN_FEATURES[plan.tier]?.price || 0, intervals: Object.fromEntries(Object.entries(plan.intervals).map(([interval, priceId]) => [interval, Boolean(priceId)])) }));
}

module.exports = { PLAN_DEFINITIONS, PLAN_ALIASES, SUPPORTED_INTERVALS, normalisePlanRequest, getPlanDefinition, getPlanTier, getPlanLevel, resolvePriceId, resolvePriceIdForRequest, normaliseReturnUrl, listPublicPlans };
