'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired, roleRequired } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimits');
const { csrfProtection } = require('../middleware/csrf');
const subscriptionService = require('../services/subscriptionService');
const paymentService = require('../services/paymentService');
const { processWebhookEvent } = require('../webhooks/stripeWebhookHandler');
const dbUnified = require('../db-unified');
const { formatInvoice } = require('../models/Invoice');
const { createAuditLog } = require('../utils/auditTrail');
const {
  getPlanLevel,
  listPublicPlans,
  normaliseReturnUrl,
  resolvePriceIdForRequest,
} = require('../config/billingPlans');

const router = express.Router();
let stripe = null;
let STRIPE_ENABLED = false;

try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-12-15.clover' });
    STRIPE_ENABLED = true;
  }
} catch (err) {
  logger.error('Failed to initialize Stripe:', err.message);
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const ALLOWED_TRIAL_DAYS = Number(process.env.STRIPE_SUBSCRIPTION_TRIAL_DAYS || 0);

// Legacy pricing contract retained for old pricing-page checks; checkout uses the
// canonical billing registry, where starter/free do not have Stripe prices.
const LEGACY_CHECKOUT_PRICE_ALIASES = {
  starter: null,
  free: null,
  pro: process.env.STRIPE_PRO_PRICE_ID || null,
  pro_plus: process.env.STRIPE_PRO_PLUS_PRICE_ID || null,
};

function ensureStripeEnabled(req, res, next) {
  if (!STRIPE_ENABLED || !stripe) {
    return res.status(503).json({ error: 'Payment processing is not available' });
  }
  return next();
}

function planFromBody(body = {}) {
  return body.planId || body.plan || body.planName || body.newPlan;
}

function resolvePlan(body = {}, fallbackInterval) {
  const planId = planFromBody(body);
  if (!planId) {
    return null;
  }
  return resolvePriceIdForRequest(planId, body.billingInterval || fallbackInterval);
}

function period(value) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function requirePlanRequest(body) {
  if (!planFromBody(body)) {
    const err = new Error('planId is required');
    err.statusCode = 400;
    throw err;
  }
}

function assertUpgrade(currentPlan, newPlan) {
  if (getPlanLevel(newPlan) <= getPlanLevel(currentPlan)) {
    const err = new Error('New plan must be higher tier than current plan');
    err.statusCode = 400;
    throw err;
  }
}

function assertDowngrade(currentPlan, newPlan) {
  if (getPlanLevel(newPlan) >= getPlanLevel(currentPlan)) {
    const err = new Error('New plan must be lower tier than current plan');
    err.statusCode = 400;
    throw err;
  }
}

async function audit(req, action, sub, details = {}) {
  try {
    await createAuditLog({
      actor: { id: req.user.id, email: req.user.email, role: req.user.role || 'user' },
      action,
      resource: { type: 'subscription', id: sub.id },
      details,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (err) {
    logger.warn('Subscription audit log failed:', err.message);
  }
}

function requirePlanMetadata(event) {
  const object = event?.data?.object;
  if (!object) {
    return;
  }

  const isCheckoutSubscription =
    event.type === 'checkout.session.completed' && object.mode === 'subscription';

  if (isCheckoutSubscription && !object.metadata?.planId) {
    const err = new Error('Missing canonical planId metadata on checkout session');
    err.statusCode = 400;
    throw err;
  }

  const isSubscriptionMutation =
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated';
  if (isSubscriptionMutation && !object.metadata?.planId) {
    logger.warn(
      'Stripe subscription event missing planId metadata; falling back to price nickname'
    );
  }
}

router.get('/plans', async (_req, res) => {
  res.json({
    success: true,
    plans: subscriptionService.getAllPlans(),
    billing: listPublicPlans(),
    legacyPriceAliases: LEGACY_CHECKOUT_PRICE_ALIASES,
  });
});

router.post(
  '/create-checkout-session',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      requirePlanRequest(req.body);
      const resolved = resolvePlan(req.body);
      if (!resolved) {
        return res.status(400).json({ error: `Unknown plan: ${planFromBody(req.body)}` });
      }
      if (resolved.planId === 'free') {
        return res.json({
          success: true,
          url: normaliseReturnUrl('/dashboard/supplier', '/dashboard/supplier'),
        });
      }
      if (!resolved.priceId) {
        return res.status(503).json({
          error: 'Payment processing is not currently available. Please contact support.',
        });
      }

      const customer = await paymentService.getOrCreateStripeCustomer(req.user);
      const successUrl = normaliseReturnUrl(
        req.body?.successUrl,
        '/dashboard/supplier?billing=success&session_id={CHECKOUT_SESSION_ID}'
      );
      const cancelUrl = normaliseReturnUrl(req.body?.cancelUrl, '/pricing?checkout=cancelled');
      const metadata = {
        userId: req.user.id,
        type: 'subscription',
        planId: resolved.planId,
        billingInterval: resolved.billingInterval,
      };
      const session = await stripe.checkout.sessions.create(
        {
          customer: customer.id,
          client_reference_id: req.user.id,
          mode: 'subscription',
          line_items: [{ price: resolved.priceId, quantity: 1 }],
          allow_promotion_codes: true,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
          subscription_data: { metadata },
        },
        { idempotencyKey: `checkout:${req.user.id}:${resolved.planId}:${resolved.billingInterval}` }
      );

      const existingPayments = await dbUnified.read('payments');
      if (
        !existingPayments.some(p => p.userId === req.user.id && p.stripeCustomerId === customer.id)
      ) {
        const { uid } = require('../store');
        await dbUnified.insertOne('payments', {
          id: uid('pay'),
          userId: req.user.id,
          stripeCustomerId: customer.id,
          stripePaymentId: session.id,
          amount: 0,
          currency: 'gbp',
          status: 'pending',
          type: 'subscription',
          metadata: {
            planId: resolved.planId,
            billingInterval: resolved.billingInterval,
            sessionId: session.id,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      return res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (error) {
      logger.error('Error creating checkout session:', error);
      return res
        .status(error.statusCode || (error.type === 'StripeInvalidRequestError' ? 400 : 500))
        .json({
          error: error.statusCode === 400 ? error.message : 'Failed to create checkout session',
          message: error.message,
        });
    }
  }
);

router.get('/me', authRequired, async (req, res) => {
  const subscription = await subscriptionService.getSubscriptionByUserId(req.user.id);
  const entitlementActive = subscriptionService.isLiveEntitlement(subscription);
  res.json({
    success: true,
    subscription,
    plan: entitlementActive ? subscription.plan : 'free',
    pendingPlan: subscription?.pendingPlan || null,
    activeUntil: entitlementActive
      ? subscription.currentPeriodEnd || subscription.trialEnd || null
      : null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    status: subscription?.status || 'free',
  });
});

router.post(
  '/',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      requirePlanRequest(req.body);
      const resolved = resolvePlan(req.body);
      if (!resolved || resolved.planId === 'free') {
        return res.status(400).json({ error: 'Invalid subscription plan' });
      }
      if (!resolved.priceId) {
        return res.status(503).json({
          error: 'Payment processing is not currently available. Please contact support.',
        });
      }

      const existingSub = await subscriptionService.getSubscriptionByUserId(req.user.id);
      if (existingSub && existingSub.status !== 'canceled') {
        return res.status(400).json({ error: 'Subscription already exists' });
      }

      const customer = await paymentService.getOrCreateStripeCustomer(req.user);
      const metadata = {
        userId: req.user.id,
        planId: resolved.planId,
        billingInterval: resolved.billingInterval,
      };
      const stripeSubscription = await paymentService.createStripeSubscription({
        customerId: customer.id,
        priceId: resolved.priceId,
        metadata,
        trialPeriodDays: ALLOWED_TRIAL_DAYS > 0 ? ALLOWED_TRIAL_DAYS : null,
      });
      const item = stripeSubscription.items?.data?.[0];
      const subscription = await subscriptionService.createSubscription({
        userId: req.user.id,
        plan: resolved.planId,
        status: stripeSubscription.status,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId: customer.id,
        trialEnd: stripeSubscription.trial_end
          ? new Date(stripeSubscription.trial_end * 1000)
          : null,
        billingInterval: item?.price?.recurring?.interval || resolved.billingInterval,
        currentPeriodStart: period(stripeSubscription.current_period_start),
        currentPeriodEnd: period(stripeSubscription.current_period_end),
        discountName:
          stripeSubscription.discount?.coupon?.name ||
          stripeSubscription.discount?.coupon?.id ||
          null,
        discountPercent: stripeSubscription.discount?.coupon?.percent_off || null,
      });

      await audit(req, 'SUBSCRIPTION_CREATED', subscription, {
        plan: resolved.planId,
        stripeSubscriptionId: stripeSubscription.id,
      });

      return res.json({
        success: true,
        subscription,
        clientSecret: stripeSubscription.latest_invoice?.payment_intent?.client_secret,
      });
    } catch (error) {
      logger.error('Error creating subscription:', error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400 ? error.message : 'Failed to create subscription',
        message: error.message,
      });
    }
  }
);

router.post(
  '/:id/upgrade',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      requirePlanRequest(req.body);
      const subscription = await subscriptionService.getSubscription(req.params.id);
      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      if (subscription.userId !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const resolved = resolvePlan(req.body, subscription.billingInterval || 'month');
      if (!resolved || resolved.planId === 'free') {
        return res.status(400).json({ error: 'Invalid upgrade plan' });
      }
      assertUpgrade(subscription.plan, resolved.planId);
      if (!resolved.priceId) {
        return res.status(503).json({
          error: 'Payment processing is not currently available. Please contact support.',
        });
      }

      if (subscription.stripeSubscriptionId) {
        const remote = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
        const itemId = remote.items?.data?.[0]?.id;
        if (!itemId) {
          return res.status(400).json({ error: 'Stripe subscription has no price item' });
        }
        await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            items: [{ id: itemId, price: resolved.priceId }],
            cancel_at_period_end: false,
            proration_behavior: 'create_prorations',
            metadata: {
              planId: resolved.planId,
              billingInterval: resolved.billingInterval,
              downgrade_to: '',
            },
          },
          {
            idempotencyKey: `sub-upgrade:${subscription.id}:${resolved.planId}:${resolved.billingInterval}`,
          }
        );
      }

      const updated = await subscriptionService.upgradeSubscription(
        subscription.id,
        resolved.planId,
        { skipStripe: true }
      );
      await audit(req, 'SUBSCRIPTION_UPGRADED', updated, {
        previousPlan: subscription.plan,
        newPlan: resolved.planId,
      });
      return res.json({ success: true, subscription: updated });
    } catch (error) {
      logger.error('Error upgrading subscription:', error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400 ? error.message : 'Failed to upgrade subscription',
        message: error.message,
      });
    }
  }
);

router.post(
  '/:id/downgrade',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      requirePlanRequest(req.body);
      const subscription = await subscriptionService.getSubscription(req.params.id);
      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }
      if (subscription.userId !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const resolved = resolvePlan(req.body, subscription.billingInterval || 'month');
      if (!resolved) {
        return res.status(400).json({ error: 'Invalid downgrade plan' });
      }
      assertDowngrade(subscription.plan, resolved.planId);

      if (subscription.stripeSubscriptionId) {
        await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            cancel_at_period_end: true,
            metadata: {
              planId: subscription.plan,
              billingInterval: subscription.billingInterval || 'month',
              downgrade_to: resolved.planId,
            },
          },
          { idempotencyKey: `sub-downgrade:${subscription.id}:${resolved.planId}` }
        );
      }

      const updated = await subscriptionService.downgradeSubscription(
        subscription.id,
        resolved.planId,
        {
          skipStripe: true,
        }
      );
      await audit(req, 'SUBSCRIPTION_DOWNGRADED', updated, {
        previousPlan: subscription.plan,
        newPlan: resolved.planId,
      });
      return res.json({
        success: true,
        subscription: updated,
        message: 'Downgrade scheduled for end of billing period',
      });
    } catch (error) {
      logger.error('Error downgrading subscription:', error);
      return res.status(error.statusCode || 500).json({
        error: error.statusCode === 400 ? error.message : 'Failed to downgrade subscription',
        message: error.message,
      });
    }
  }
);

router.post('/:id/cancel', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const subscription = await subscriptionService.getSubscription(req.params.id);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    if (subscription.userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (subscription.stripeSubscriptionId && STRIPE_ENABLED) {
      await paymentService.cancelStripeSubscription(
        subscription.stripeSubscriptionId,
        req.body.immediately
      );
    }

    const updated = await subscriptionService.cancelSubscription(
      req.params.id,
      req.body.reason,
      req.body.immediately
    );
    await audit(req, 'SUBSCRIPTION_CANCELLED', updated, {
      plan: subscription.plan,
      immediately: !!req.body.immediately,
    });
    return res.json({
      success: true,
      subscription: updated,
      message: req.body.immediately
        ? 'Subscription canceled immediately'
        : 'Subscription will cancel at period end',
    });
  } catch (error) {
    logger.error('Error canceling subscription:', error);
    return res.status(500).json({ error: 'Failed to cancel subscription', message: error.message });
  }
});

router.get('/:id/status', authRequired, async (req, res) => {
  const subscription = await subscriptionService.getSubscription(req.params.id);
  if (!subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  if (subscription.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  return res.json({
    success: true,
    subscription: {
      id: subscription.id,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      nextBillingDate: subscription.nextBillingDate,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      inTrial: subscriptionService.isInTrial(subscription),
    },
  });
});

router.get('/:id/features', authRequired, async (req, res) => {
  const subscription = await subscriptionService.getSubscription(req.params.id);
  if (!subscription) {
    return res.status(404).json({ error: 'Subscription not found' });
  }
  if (subscription.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const features = await subscriptionService.getUserFeatures(subscription.userId);
  return res.json({ success: true, plan: subscription.plan, features: features.features });
});

router.get('/invoices', authRequired, async (req, res) => {
  const invoices = await dbUnified.read('invoices');
  res.json({
    success: true,
    invoices: invoices.filter(inv => inv.userId === req.user.id).map(formatInvoice),
  });
});

router.get('/admin/subscriptions', authRequired, roleRequired('admin'), async (req, res) => {
  const subscriptions = await subscriptionService.listSubscriptions({
    status: req.query.status,
    plan: req.query.plan,
  });
  res.json({
    success: true,
    subscriptions,
    pagination: {
      total: subscriptions.length,
      page: 1,
      limit: subscriptions.length || 1,
      pages: 1,
    },
  });
});

router.get('/admin/revenue', authRequired, roleRequired('admin'), async (_req, res) => {
  const [mrr, churnRate, stats] = await Promise.all([
    paymentService.calculateMRR(),
    paymentService.calculateChurnRate(30),
    subscriptionService.getSubscriptionStats(),
  ]);
  res.json({
    success: true,
    revenue: {
      mrr: mrr.totalMRR,
      mrrByPlan: mrr.byPlan,
      activeSubscriptions: mrr.activeSubscriptions,
    },
    churn: churnRate,
    subscriptionStats: stats,
  });
});

async function stripeWebhookHandler(req, res) {
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET && STRIPE_ENABLED) {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET
      );
    } else if (process.env.NODE_ENV === 'production') {
      return res.status(400).send('Webhook Error: signature verification required in production');
    } else {
      event = JSON.parse(req.body.toString());
    }
    requirePlanMetadata(event);
  } catch (err) {
    logger.error('Webhook verification failed:', err.message);
    return res.status(err.statusCode || 400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await processWebhookEvent(event);
    return res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    return res.status(500).json({ error: 'Webhook processing failed', message: error.message });
  }
}

const rawBodyParser = express.raw({ type: 'application/json' });
const webhookInfoResponse = {
  message: 'Stripe webhook endpoint. Send POST requests from Stripe only.',
  canonical: 'POST /api/v2/webhooks/stripe',
  compat: 'POST /api/v2/subscriptions/webhooks/stripe',
};
router.get('/webhooks/stripe', (_req, res) => res.status(200).json(webhookInfoResponse));
router.post('/webhooks/stripe', rawBodyParser, stripeWebhookHandler);
router.get('/subscriptions/webhooks/stripe', (_req, res) =>
  res.status(200).json(webhookInfoResponse)
);
router.post('/subscriptions/webhooks/stripe', rawBodyParser, stripeWebhookHandler);

module.exports = router;
