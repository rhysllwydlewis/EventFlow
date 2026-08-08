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
    description: 'Everything you need to be found by customers and take enquiries.',
    audience: 'For new or occasional suppliers',
    badge: 'Free forever',
    featured: false,
    cta: 'Create a free profile',
    valueStatement: 'Be present where customers are planning and begin building your profile.',
    upgradePrompt:
      'Upgrade when a daily reply cap or three package listings starts holding you back.',
    // Each highlight is "what it is — what it does for you". The second half
    // is what the pricing page shows beneath the feature name, so it has to
    // read as a benefit rather than a restatement.
    //
    // Every claim here is one the platform actually delivers. Package limits
    // in particular are enforced in routes/packages.js and unwound on
    // downgrade by subscriptionService, so they are a real difference between
    // the plans rather than a marketing line.
    highlights: [
      'Public supplier profile — a page on EventFlow with your services, photos and contact details',
      'Up to 3 package listings — publish set packages with prices so customers can see what you offer',
      'Up to 10 portfolio photos — show your work on your profile',
      'Up to 10 enquiry replies a day — answer the enquiries that come in, at no cost',
      'Standard search placement — appear in results when customers browse your category and area',
      '7 days of profile analytics — see who viewed your profile this week',
    ],
    pricing: {
      month: { monthlyEquivalent: 0, total: 0, saving: 0, discountPercent: 0 },
      year: { monthlyEquivalent: 0, total: 0, saving: 0, discountPercent: 0 },
    },
  },
  pro: {
    marketingName: 'Professional',
    description:
      'Be found sooner, earn trust earlier and know which enquiries are worth your time.',
    audience: 'For growing suppliers taking regular bookings',
    // The pricing page shows one marker, on the recommended plan only. The
    // early-access fact is carried by the struck-through standard price and
    // the terms line beneath the plans, so it does not need the badge too.
    badge: 'Most popular',
    featured: true,
    cta: 'Choose Professional',
    valueStatement:
      'Be found sooner, earn trust before the first message and understand which leads deserve your time.',
    upgradePrompt: 'Move to Plus for homepage placement and a monthly review of what is working.',
    highlights: [
      'Higher search placement — a ranking boost that lifts you above Starter suppliers in your categories and areas',
      'Up to 50 package listings — publish your full range instead of a handful',
      'Up to 500 portfolio photos — show every side of your work',
      'Unlimited enquiry replies — never leave an enquiry waiting because you have hit a daily cap',
      'Longer messages — up to 5,000 characters, so a full quote fits in one reply',
      '90 days of profile analytics — see what draws interest across a season, not just a week',
      'Priority support — your questions go to the front of the queue',
    ],
    pricing: {
      month: { monthlyEquivalent: 19, total: 19, saving: 0, discountPercent: 0 },
      year: { monthlyEquivalent: 16, total: 192, saving: 36, discountPercent: 16 },
    },
  },
  pro_plus: {
    marketingName: 'Professional Plus',
    description: 'Take the most valuable positions on EventFlow, with hands-on help to use them.',
    audience: 'For established suppliers with capacity to fill',
    badge: 'Maximum exposure',
    featured: false,
    cta: 'Choose Professional Plus',
    valueStatement:
      'Lead the most valuable discovery positions and get structured support to improve performance.',
    upgradePrompt:
      'Designed for established suppliers with the capacity and booking value to benefit from premium exposure.',
    highlights: [
      'Homepage featured placement — your packages appear on the EventFlow homepage, in front of customers before they start searching',
      'Top search placement — the strongest ranking boost EventFlow gives, above Professional profiles',
      'Unlimited package listings — no cap on how much of your range you publish',
      'Unlimited portfolio photos — a complete portfolio, however large it gets',
      'A full year of profile analytics — compare this season against last',
      'Dedicated onboarding call — we build your profile with you so it works from day one',
      'Monthly performance review — a monthly read on what is working and what to change',
      'VIP support — a direct line to the team',
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
