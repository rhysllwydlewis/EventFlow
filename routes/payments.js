/**
 * Payment Routes
 * Handles Stripe Checkout, Billing Portal, and the legacy webhook endpoint.
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimits');
const { csrfProtection } = require('../middleware/csrf');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { processWebhookEvent } = require('../webhooks/stripeWebhookHandler');
const {
  resolvePriceIdForRequest,
  normaliseReturnUrl,
  listPublicPlans,
  getPlanDefinition,
} = require('../config/billingPlans');

const router = express.Router();

let stripe = null;
let STRIPE_ENABLED = false;

try {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    // eslint-disable-next-line global-require
    const stripeLib = require('stripe');
    stripe = stripeLib(stripeSecretKey, { apiVersion: '2025-12-15.clover' });
    STRIPE_ENABLED = true;
    logger.info('✅ Stripe payment integration enabled');
  } else {
    logger.warn('⚠️  Stripe is not configured (STRIPE_SECRET_KEY missing)');
  }
} catch (err) {
  logger.error('❌ Failed to initialize Stripe:', err.message);
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRO_INTRO_COUPON_ID = process.env.STRIPE_PRO_INTRO_COUPON_ID || '';
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || null;
const STRIPE_PRO_YEARLY_PRICE_ID = process.env.STRIPE_PRO_YEARLY_PRICE_ID || null;
const STRIPE_PRO_PLUS_PRICE_ID = process.env.STRIPE_PRO_PLUS_PRICE_ID || null;
const STRIPE_PRO_PLUS_YEARLY_PRICE_ID = process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID || null;
const INTRO_PRICING_ENABLED = Boolean(
  process.env.STRIPE_PRO_PRICE_ID && STRIPE_PRO_INTRO_COUPON_ID
);

function ensureStripeEnabled(req, res, next) {
  if (!STRIPE_ENABLED || !stripe) {
    return res.status(503).json({
      error: 'Payment processing is not available',
      message: 'Stripe is not configured. Please contact support.',
    });
  }
  next();
}

function checkoutRequestToPlan(body = {}) {
  return body.planId || body.plan || body.planName;
}

function getSubscriptionTier(planName, billingInterval = 'month') {
  const resolved = resolvePriceIdForRequest(planName, billingInterval);
  return resolved?.planId || null;
}

function legacyPriceIdFallback(planName, billingInterval = 'month') {
  const resolved = resolvePriceIdForRequest(planName, billingInterval);
  const tier = getSubscriptionTier(planName, billingInterval);
  const interval = resolved?.billingInterval || 'month';
  const priceIds = {
    pro: { month: STRIPE_PRO_PRICE_ID, year: STRIPE_PRO_YEARLY_PRICE_ID },
    pro_plus: { month: STRIPE_PRO_PLUS_PRICE_ID, year: STRIPE_PRO_PLUS_YEARLY_PRICE_ID },
  };
  return priceIds[tier]?.[interval] || null;
}

async function getOrCreateStripeCustomer(user) {
  const existingPayments = await dbUnified.find('payments', { userId: user.id });
  const subscriptions = await dbUnified.find('subscriptions', { userId: user.id });
  const existingCustomerId =
    existingPayments.find(p => p.stripeCustomerId)?.stripeCustomerId ||
    subscriptions.find(s => s.stripeCustomerId)?.stripeCustomerId;

  if (existingCustomerId) {
    try {
      return await stripe.customers.retrieve(existingCustomerId);
    } catch (err) {
      logger.warn('Failed to retrieve existing Stripe customer:', err.message);
    }
  }

  return stripe.customers.create(
    {
      email: user.email,
      name: user.name || '',
      metadata: { userId: user.id },
    },
    { idempotencyKey: `customer:${user.id}` }
  );
}

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    STRIPE_ENABLED,
    configured: STRIPE_ENABLED,
    webhookConfigured: Boolean(STRIPE_WEBHOOK_SECRET),
    introPricingEnabled: INTRO_PRICING_ENABLED,
  });
});

/**
 * LEGACY — not called by the current UI. Both /pricing and
 * /supplier/subscription use POST /api/v2/subscriptions/create-checkout-session
 * exclusively (see routes/subscriptions-v2.js), which has no intro-pricing
 * coupon support. This route's STRIPE_PRO_INTRO_COUPON_ID branch is
 * unreachable in practice; kept alive (rather than deleted) because it has
 * its own dedicated test coverage (tests/unit/intro-pricing.test.js,
 * tests/integration/pricing-payment-fixes.test.js) and re-implementing
 * intro pricing in the v2 route is a real feature decision, not a bug fix.
 */
router.post(
  '/create-checkout-session',
  authRequired,
  writeLimiter,
  csrfProtection,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const dbStatus = dbUnified.getDatabaseStatus();
      if (!dbStatus.connected) {
        return res.status(500).json({
          error: 'Payment system temporarily unavailable',
          message: 'Database connection error. Please try again in a few moments.',
        });
      }

      const { type = 'subscription', billingInterval, successUrl, cancelUrl } = req.body || {};
      if (type !== 'subscription') {
        return res.status(400).json({
          error: 'Unsupported payment type',
          message:
            'Client-priced one-time payments are disabled. Use a server-side payment product.',
        });
      }

      const resolved = resolvePriceIdForRequest(checkoutRequestToPlan(req.body), billingInterval);
      if (!resolved) {
        return res.status(400).json({ error: 'Unknown plan or billing interval.' });
      }

      if (resolved.planId === 'free') {
        return res.json({
          success: true,
          planId: 'free',
          url: normaliseReturnUrl('/dashboard/supplier', '/dashboard/supplier'),
        });
      }

      const fallbackPriceId = legacyPriceIdFallback(
        checkoutRequestToPlan(req.body),
        resolved.billingInterval
      );
      const stripePriceId = resolved.priceId || fallbackPriceId;
      if (!stripePriceId) {
        return res.status(503).json({
          error: 'Payment processing is not currently available. Please contact support.',
          message: `Price ID is required for subscriptions. No Stripe price is configured for ${resolved.planId} (${resolved.billingInterval}).`,
        });
      }

      const user = req.user;
      const customer = await getOrCreateStripeCustomer(user);
      const plan = getPlanDefinition(resolved.planId);
      const useIntroPricing =
        INTRO_PRICING_ENABLED && resolved.planId === 'pro' && resolved.billingInterval === 'month';

      const metadata = {
        userId: user.id,
        type: 'subscription',
        planId: resolved.planId,
        billingInterval: resolved.billingInterval,
      };

      const sessionConfig = {
        customer: customer.id,
        client_reference_id: user.id,
        mode: 'subscription',
        success_url: normaliseReturnUrl(
          successUrl,
          '/payment-success?session_id={CHECKOUT_SESSION_ID}'
        ),
        cancel_url: normaliseReturnUrl(cancelUrl, '/payment-cancel'),
        line_items: [{ price: stripePriceId, quantity: 1 }],
        metadata,
        subscription_data: { metadata },
      };

      if (useIntroPricing) {
        sessionConfig.discounts = [{ coupon: STRIPE_PRO_INTRO_COUPON_ID }];
        sessionConfig.metadata.introPricing = 'true';
        sessionConfig.subscription_data.metadata.introPricing = 'true';
      } else {
        // Allow customers to use Stripe promotion codes when no intro coupon is applied.
        sessionConfig.allow_promotion_codes = true;
      }

      const session = await stripe.checkout.sessions.create(sessionConfig, {
        idempotencyKey: `checkout:${user.id}:${resolved.planId}:${resolved.billingInterval}`,
      });

      const paymentInserted = await dbUnified.insertOne('payments', {
        id: uid('pay'),
        stripePaymentId: session.payment_intent || session.id,
        stripeCustomerId: customer.id,
        userId: user.id,
        amount: 0,
        currency: 'gbp',
        status: 'pending',
        type: 'subscription',
        metadata: {
          sessionId: session.id,
          planId: resolved.planId,
          billingInterval: resolved.billingInterval,
          planName: plan?.displayName || resolved.planId,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (!paymentInserted) {
        logger.error('[PAYMENTS] insertOne failed');
        return res.status(500).json({ error: 'Failed to record payment. Please try again.' });
      }

      res.json({ success: true, sessionId: session.id, url: session.url });
    } catch (error) {
      logger.error('Error creating checkout session:', error);
      const statusCode = error.type === 'StripeInvalidRequestError' ? 400 : 500;
      res.status(statusCode).json({
        error: 'Failed to create checkout session',
        message:
          statusCode === 400 ? 'Invalid payment request. Please contact support.' : error.message,
      });
    }
  }
);

router.post(
  '/create-portal-session',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const user = req.user;
      const existingPayments = await dbUnified.find('payments', { userId: user.id });
      const subscriptions = await dbUnified.find('subscriptions', { userId: user.id });
      const stripeCustomerId =
        existingPayments.find(p => p.stripeCustomerId)?.stripeCustomerId ||
        subscriptions.find(s => s.stripeCustomerId)?.stripeCustomerId;

      if (!stripeCustomerId) {
        return res.status(404).json({
          error: 'No payment history found',
          message: 'You need to make a payment before accessing the billing portal.',
        });
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: normaliseReturnUrl(req.body?.returnUrl, '/dashboard/supplier'),
      });

      res.json({ success: true, url: session.url });
    } catch (error) {
      logger.error('Error creating portal session:', error);
      res.status(500).json({
        error: 'Failed to create billing portal session',
        message: error.message,
      });
    }
  }
);

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  logger.warn(
    '⚠️ Stripe webhook received on deprecated endpoint /api/payments/webhook. Prefer POST /api/v2/webhooks/stripe.'
  );

  if (!STRIPE_ENABLED || !stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        STRIPE_WEBHOOK_SECRET
      );
    } else if (process.env.NODE_ENV === 'production') {
      return res
        .status(400)
        .json({ error: 'Webhook signature verification required in production' });
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    logger.error('Webhook verification/parsing failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook request' });
  }

  try {
    // processWebhookEvent handles checkout.session.completed and all supported Stripe events.
    await processWebhookEvent(event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.get('/config', authRequired, (req, res) => {
  try {
    const publishableKey =
      process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    if (!publishableKey) {
      return res.status(503).json({
        error: 'Stripe configuration incomplete',
        message: 'Stripe publishable key is not configured.',
      });
    }

    res.json({
      publishableKey,
      introPricingEnabled: INTRO_PRICING_ENABLED,
      plans: listPublicPlans(),
      proPriceId: process.env.STRIPE_PRO_PRICE_ID || null,
    });
  } catch (error) {
    logger.error('Error getting payment config:', error);
    res.status(500).json({
      error: 'Failed to retrieve payment configuration',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const payments = await dbUnified.find('payments', { userId: req.user.id });
    payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, payments });
  } catch (error) {
    logger.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payment history', message: error.message });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const payments = await dbUnified.find('payments', { id: req.params.id, userId: req.user.id });
    if (payments.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json({ success: true, payment: payments[0] });
  } catch (error) {
    logger.error('Error fetching payment:', error);
    res.status(500).json({ error: 'Failed to fetch payment', message: error.message });
  }
});
module.exports = router;
