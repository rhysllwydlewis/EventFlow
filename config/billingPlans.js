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
    intervals: {
      month: process.env.STRIPE_PRO_PRICE_ID || null,
      year: process.env.STRIPE_PRO_YEARLY_PRICE_ID || null,
    },
    checkout: true,
  },
  pro_plus: {
    id: 'pro_plus',
    displayName: PLAN_FEATURES.pro_plus.name,
    tier: 'pro_plus',
    intervals: {
      month: process.env.STRIPE_PRO_PLUS_PRICE_ID || null,
      year: process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID || null,
    },
    checkout: true,
  },
};

/**
 * Public pricing and merchandising copy. Stripe price IDs stay in
 * PLAN_DEFINITIONS; this object is safe to return to the browser.
 *
 * Amounts are expressed in pounds and annual prices are shown as both the
 * monthly equivalent and the actual yearly charge.
 */
const PLAN_PRESENTATION = {
  free: {
    marketingName: 'Starter',
    description: 'Establish your EventFlow presence and start receiving enquiries at no cost.',
    audience: 'For new or occasional suppliers',
    badge: 'Free forever',
    featured: false,
    cta: 'Create a free profile',
    valueStatement: 'Be present where customers are planning and begin building your profile.',
    upgradePrompt:
      'Upgrade when you want more portfolio space, stronger trust signals and better search visibility.',
    highlights: [
      'Public supplier profile — give customers a place to discover your business',
      'Up to 5 portfolio photos — show a snapshot of your best work',
      'Customer enquiries — start conversations directly through EventFlow',
      'Standard search placement — appear in relevant supplier results',
      'Email support — get help with the essentials',
    ],
    pricing: {
      month: { monthlyEquivalent: 0, total: 0, saving: 0, discountPercent: 0 },
      year: { monthlyEquivalent: 0, total: 0, saving: 0, discountPercent: 0 },
    },
  },
  pro: {
    marketingName: 'Professional',
    description: 'Turn more profile views into credible, better-qualified opportunities.',
    audience: 'Best value for growing suppliers',
    badge: 'Early access price',
    featured: true,
    cta: 'Choose Professional',
    valueStatement:
      'Be found sooner, earn trust before the first message and understand which leads deserve your time.',
    upgradePrompt:
      'Move to Plus when premium positions and hands-on performance support can create more value.',
    highlights: [
      'Priority search placement — appear above Starter profiles',
      'Unlimited photos — present a complete, persuasive portfolio',
      'Email and phone verification — reduce doubt before customers enquire',
      'Lead quality scoring — focus first on the strongest opportunities',
      'Response-time tracking — demonstrate reliable customer service',
      'Profile analytics — see what customers view and what drives interest',
      'Priority support — get faster help when your business needs it',
    ],
    pricing: {
      month: { monthlyEquivalent: 19, total: 19, saving: 0, discountPercent: 0 },
      year: { monthlyEquivalent: 16, total: 192, saving: 36, discountPercent: 16 },
    },
  },
  pro_plus: {
    marketingName: 'Professional Plus',
    description: 'Secure EventFlow’s strongest placement and receive hands-on growth support.',
    audience: 'For established, high-capacity suppliers',
    // Kept short: the pricing card sets this beside the plan name, and
    // "Professional Plus" plus a longer badge does not fit on one line.
    badge: 'Max exposure',
    featured: false,
    cta: 'Choose Professional Plus',
    valueStatement:
      'Lead the most valuable discovery positions and get structured support to improve performance.',
    upgradePrompt:
      'Designed for established suppliers with the capacity and booking value to benefit from premium exposure.',
    highlights: [
      'Homepage featured placement — reach customers before they begin searching',
      'Top of category pages — lead the results that matter most to your business',
      'Business verification badge — display EventFlow’s strongest trust signal',
      'Dedicated onboarding call — build the right premium setup from the start',
      'Monthly performance review — identify opportunities to improve results',
      'Analytics export — report on and share your EventFlow performance',
      'VIP support — receive the highest level of assistance',
    ],
    pricing: {
      month: { monthlyEquivalent: 159, total: 159, saving: 0, discountPercent: 0 },
      year: { monthlyEquivalent: 129, total: 1548, saving: 360, discountPercent: 19 },
    },
  },
};

const PLAN_ALIASES = {
  starter: { planId: 'free', billingInterval: 'month' },
  free: { planId: 'free', billingInterval: 'month' },
  pro: { planId: 'pro' },
  professional: { planId: 'pro' },
  pro_monthly: { planId: 'pro', billingInterval: 'month' },
  pro_yearly: { planId: 'pro', billingInterval: 'year' },
  pro_plus: { planId: 'pro_plus' },
  proplus: { planId: 'pro_plus' },
  'pro plus': { planId: 'pro_plus' },
  professional_plus: { planId: 'pro_plus' },
  'professional plus': { planId: 'pro_plus' },
  pro_plus_monthly: { planId: 'pro_plus', billingInterval: 'month' },
  pro_plus_yearly: { planId: 'pro_plus', billingInterval: 'year' },
};

function normalisePlanRequest(rawPlanId, rawInterval = 'month') {
  const requestedPlan = String(rawPlanId || '')
    .trim()
    .toLowerCase();
  const requestedInterval = String(rawInterval || '')
    .trim()
    .toLowerCase();
  const billingInterval = SUPPORTED_INTERVALS.includes(requestedInterval)
    ? requestedInterval
    : 'month';
  const alias = PLAN_ALIASES[requestedPlan];
  if (alias) {
    return {
      planId: alias.planId,
      billingInterval: alias.billingInterval || billingInterval,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(PLAN_DEFINITIONS, requestedPlan)) {
    return null;
  }
  return { planId: requestedPlan, billingInterval };
}

function getPlanDefinition(planId) {
  return PLAN_DEFINITIONS[planId] || null;
}

function getPlanTier(planId) {
  return getPlanDefinition(planId)?.tier || 'free';
}

function getPlanLevel(planId) {
  return TIER_LEVELS[getPlanTier(planId)] ?? 0;
}

function resolvePriceId(planId, billingInterval = 'month') {
  const plan = getPlanDefinition(planId);
  return plan?.intervals?.[billingInterval] || null;
}

function resolvePriceIdForRequest(rawPlanId, rawInterval = 'month') {
  const normalized = normalisePlanRequest(rawPlanId, rawInterval);
  if (!normalized) {
    return null;
  }
  return {
    ...normalized,
    priceId: resolvePriceId(normalized.planId, normalized.billingInterval),
    plan: getPlanDefinition(normalized.planId),
  };
}

function normaliseReturnUrl(url, fallbackPath) {
  const fallback = new URL(fallbackPath, BASE_URL).toString();
  if (!url) {
    return fallback;
  }
  try {
    const parsed = new URL(url, BASE_URL);
    const base = new URL(BASE_URL);
    return parsed.origin === base.origin ? parsed.toString() : fallback;
  } catch (_err) {
    return fallback;
  }
}

function listPublicPlans() {
  return Object.values(PLAN_DEFINITIONS).map(plan => ({
    id: plan.id,
    displayName: plan.displayName,
    tier: plan.tier,
    checkout: plan.checkout,
    features: PLAN_FEATURES[plan.tier]?.features || {},
    price: PLAN_PRESENTATION[plan.id]?.pricing?.month?.total || 0,
    intervals: Object.fromEntries(
      Object.entries(plan.intervals).map(([interval, priceId]) => [interval, Boolean(priceId)])
    ),
    presentation: PLAN_PRESENTATION[plan.id] || null,
  }));
}

module.exports = {
  PLAN_DEFINITIONS,
  PLAN_PRESENTATION,
  PLAN_ALIASES,
  SUPPORTED_INTERVALS,
  normalisePlanRequest,
  getPlanDefinition,
  getPlanTier,
  getPlanLevel,
  resolvePriceId,
  resolvePriceIdForRequest,
  normaliseReturnUrl,
  listPublicPlans,
};
