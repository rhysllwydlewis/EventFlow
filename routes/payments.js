/**
 * Payment Routes
 * Handles Stripe payment processing, subscriptions, and webhooks
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { authRequired } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimits');
const { csrfProtection } = require('../middleware/csrf');
const dbUnified = require('../db-unified');
const { uid } = require('../store');

const router = express.Router();

// Initialize Stripe only if configured
let stripe = null;
let STRIPE_ENABLED = false;

try {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (stripeSecretKey) {
    // eslint-disable-next-line global-require
    const stripeLib = require('stripe');
    stripe = stripeLib(stripeSecretKey);
    STRIPE_ENABLED = true;
    logger.info('✅ Stripe payment integration enabled');
  } else {
    logger.warn('⚠️  Stripe is not configured (STRIPE_SECRET_KEY missing)');
  }
} catch (err) {
  logger.error('❌ Failed to initialize Stripe:', err.message);
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_SUCCESS_URL =
  process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/payment-success';
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/payment-cancel';

// Introductory pricing configuration
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || '';
const STRIPE_PRO_INTRO_COUPON_ID = process.env.STRIPE_PRO_INTRO_COUPON_ID || '';
const INTRO_PRICING_ENABLED = !!(STRIPE_PRO_PRICE_ID && STRIPE_PRO_INTRO_COUPON_ID);

if (INTRO_PRICING_ENABLED) {
  logger.info('✅ Professional plan introductory pricing enabled');
} else if (STRIPE_PRO_PRICE_ID || STRIPE_PRO_INTRO_COUPON_ID) {
  logger.warn(
    '⚠️  Partial introductory pricing config detected. Both STRIPE_PRO_PRICE_ID and STRIPE_PRO_INTRO_COUPON_ID are required.'
  );
}

/**
 * Helper: Determine subscription tier from plan name
 * @param {string} planName - The plan name from Stripe metadata or price nickname
 * @returns {string} - 'pro', 'pro_plus', or 'free'
 */
function getSubscriptionTier(planName) {
  if (!planName) {
    return 'free';
  }

  const lowerName = planName.toLowerCase();

  // Check for Professional Plus (must come before Professional check)
  if (
    lowerName.includes('professional plus') ||
    lowerName.includes('pro plus') ||
    lowerName.includes('pro+')
  ) {
    return 'pro_plus';
  }

  // Check for Professional/Pro
  if (lowerName.includes('professional') || lowerName.includes('pro')) {
    return 'pro';
  }

  return 'free';
}

/**
 * GET /api/payments/health
 * Check payment system health and configuration status
 */
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    STRIPE_ENABLED,
    configured: STRIPE_ENABLED,
    webhookConfigured: !!STRIPE_WEBHOOK_SECRET,
    introPricingEnabled: INTRO_PRICING_ENABLED,
  });
});

/**
 * Helper: Check if Stripe is enabled
 */
function ensureStripeEnabled(req, res, next) {
  if (!STRIPE_ENABLED || !stripe) {
    return res.status(503).json({
      error: 'Payment processing is not available',
      message: 'Stripe is not configured. Please contact support.',
    });
  }
  next();
}

/**
 * @swagger
 * /api/payments/create-checkout-session:
 *   post:
 *     summary: Create a Stripe checkout session
 *     description: Create a checkout session for one-time payments or subscriptions
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [one_time, subscription]
 *                 description: Payment type
 *               amount:
 *                 type: number
 *                 description: Amount in smallest currency unit (required for one_time)
 *               currency:
 *                 type: string
 *                 default: gbp
 *                 description: Payment currency
 *               priceId:
 *                 type: string
 *                 description: Stripe price ID (required for subscription)
 *               planName:
 *                 type: string
 *                 description: Plan name for metadata
 *               successUrl:
 *                 type: string
 *                 description: Custom success redirect URL
 *               cancelUrl:
 *                 type: string
 *                 description: Custom cancel redirect URL
 *     responses:
 *       200:
 *         description: Checkout session created successfully
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized
 *       503:
 *         description: Stripe not configured
 */
router.post(
  '/create-checkout-session',
  authRequired,
  writeLimiter,
  csrfProtection,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      // Check database connectivity first
      const dbStatus = dbUnified.getDatabaseStatus();
      if (!dbStatus.connected) {
        logger.error(
          'Database not connected for checkout session creation. State:',
          dbStatus.state
        );
        return res.status(500).json({
          error: 'Payment system temporarily unavailable',
          message: 'Database connection error. Please try again in a few moments.',
        });
      }

      const { type, amount, currency = 'gbp', planName, successUrl, cancelUrl } = req.body;
      let priceId = req.body.priceId;
      const user = req.user;

      // Validation
      if (!type || !['one_time', 'subscription'].includes(type)) {
        return res
          .status(400)
          .json({ error: 'Invalid payment type. Must be "one_time" or "subscription".' });
      }

      if (type === 'one_time' && !amount) {
        return res.status(400).json({ error: 'Amount is required for one-time payments.' });
      }

      if (type === 'subscription' && !priceId) {
        // Try to fall back to the configured Pro price ID when planName matches
        const fallbackTier = planName ? getSubscriptionTier(planName) : 'free';
        if ((fallbackTier === 'pro' || fallbackTier === 'pro_plus') && STRIPE_PRO_PRICE_ID) {
          priceId = STRIPE_PRO_PRICE_ID;
          logger.info(`Subscription: using fallback priceId ${priceId} for plan "${planName}"`);
        } else {
          return res.status(400).json({
            error: 'Price ID is required for subscriptions.',
            message: 'Please contact support or select a plan from the pricing page.',
          });
        }
      }

      // Check for Professional plan with intro pricing
      const isProfessionalPlan = planName && getSubscriptionTier(planName) === 'pro';

      const useIntroPricing =
        INTRO_PRICING_ENABLED && type === 'subscription' && isProfessionalPlan;

      if (useIntroPricing) {
        logger.info('✅ Applying introductory pricing for Professional plan');
      }

      // Get or create Stripe customer
      let customer;
      const existingPayments = await dbUnified.find('payments', { userId: user.id });
      const existingCustomerId = existingPayments.find(p => p.stripeCustomerId)?.stripeCustomerId;

      if (existingCustomerId) {
        try {
          customer = await stripe.customers.retrieve(existingCustomerId);
        } catch (err) {
          logger.warn('Failed to retrieve existing customer:', err.message);
          customer = null;
        }
      }

      if (!customer) {
        customer = await stripe.customers.create({
          email: user.email,
          metadata: {
            userId: user.id,
            name: user.name || '',
          },
        });
      }

      // Create checkout session
      const sessionConfig = {
        customer: customer.id,
        mode: type === 'subscription' ? 'subscription' : 'payment',
        success_url: successUrl || `${STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl || STRIPE_CANCEL_URL,
        metadata: {
          userId: user.id,
          type: type,
        },
      };

      if (type === 'one_time') {
        sessionConfig.line_items = [
          {
            price_data: {
              currency: currency,
              product_data: {
                name: 'EventFlow Payment',
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ];
      } else {
        // Subscription
        const effectivePriceId = useIntroPricing ? STRIPE_PRO_PRICE_ID : priceId;

        sessionConfig.line_items = [
          {
            price: effectivePriceId,
            quantity: 1,
          },
        ];

        // Apply introductory coupon if enabled.
        // Note: Stripe does not allow allow_promotion_codes and discounts together,
        // so promo code entry is only enabled when no discount is pre-applied.
        if (useIntroPricing) {
          sessionConfig.discounts = [
            {
              coupon: STRIPE_PRO_INTRO_COUPON_ID,
            },
          ];
          sessionConfig.metadata.introPricing = 'true';
          logger.info(
            `Applied intro coupon: ${STRIPE_PRO_INTRO_COUPON_ID} to price: ${effectivePriceId}`
          );
        } else {
          // Allow customers to enter promotion codes at checkout
          sessionConfig.allow_promotion_codes = true;
        }

        if (planName) {
          sessionConfig.metadata.planName = planName;
        }
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      // Create pending payment record
      const paymentId = uid();
      const paymentRecord = {
        id: paymentId,
        stripePaymentId: session.payment_intent || session.id,
        stripeCustomerId: customer.id,
        userId: user.id,
        amount: type === 'one_time' ? amount / 100 : 0, // Convert to main currency unit
        currency: currency,
        status: 'pending',
        type: type,
        metadata: {
          sessionId: session.id,
          planName: planName || '',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await dbUnified.insertOne('payments', paymentRecord);

      res.json({
        success: true,
        sessionId: session.id,
        url: session.url,
      });
    } catch (error) {
      logger.error('Error creating checkout session:', error);

      // Provide more specific error messages
      let errorMessage = error.message;
      let statusCode = 500;

      // Check for specific database errors
      if (
        error.code === 'ECONNREFUSED' ||
        error.name === 'MongoNetworkError' ||
        error.name === 'MongoTimeoutError'
      ) {
        errorMessage = 'Database error. Please try again.';
      } else if (error.type === 'StripeConnectionError') {
        errorMessage = 'Unable to connect to payment processor. Please try again.';
      } else if (error.type === 'StripeInvalidRequestError') {
        errorMessage = 'Invalid payment request. Please contact support.';
        statusCode = 400;
      }

      res.status(statusCode).json({
        error: 'Failed to create checkout session',
        message: errorMessage,
      });
    }
  }
);

/**
 * @swagger
 * /api/payments/create-portal-session:
 *   post:
 *     summary: Create a billing portal session
 *     description: Create a Stripe billing portal session for managing subscriptions
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               returnUrl:
 *                 type: string
 *                 description: URL to return to after managing billing
 *     responses:
 *       200:
 *         description: Portal session created successfully
 *       404:
 *         description: No payment history found
 *       503:
 *         description: Stripe not configured
 */
router.post(
  '/create-portal-session',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const user = req.user;
      const { returnUrl } = req.body;

      // Find user's Stripe customer ID
      const existingPayments = await dbUnified.find('payments', { userId: user.id });
      const stripeCustomerId = existingPayments.find(p => p.stripeCustomerId)?.stripeCustomerId;

      if (!stripeCustomerId) {
        return res.status(404).json({
          error: 'No payment history found',
          message: 'You need to make a payment before accessing the billing portal.',
        });
      }

      // Create portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl || `${process.env.BASE_URL}/dashboard/supplier`,
      });

      res.json({
        success: true,
        url: session.url,
      });
    } catch (error) {
      logger.error('Error creating portal session:', error);
      res.status(500).json({
        error: 'Failed to create billing portal session',
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/payments/webhook:
 *   post:
 *     summary: Stripe webhook endpoint
 *     description: Handle Stripe webhook events for payments and subscriptions
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Invalid signature or missing signature
 *       503:
 *         description: Stripe not configured
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_ENABLED || !stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];

  if (!sig) {
    logger.error('Missing Stripe signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }

  let event;

  try {
    // Verify webhook signature
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // In development/test, parse without verification
      logger.warn('⚠️  Webhook signature verification skipped (STRIPE_WEBHOOK_SECRET not set)');
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    logger.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  logger.info(`Received webhook event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object;
        await handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        await handlePaymentSucceeded(paymentIntent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        await handlePaymentFailed(paymentIntent);
        break;
      }

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(session) {
  const userId = session.metadata?.userId;
  if (!userId) {
    logger.error('No userId in checkout session metadata');
    return;
  }

  // Find payment record by session ID
  const payments = await dbUnified.find('payments', {
    'metadata.sessionId': session.id,
  });

  if (payments.length === 0) {
    logger.warn('No payment record found for session:', session.id);
    return;
  }

  const payment = payments[0];

  // Update payment record
  const updates = {
    status: 'succeeded',
    stripePaymentId: session.payment_intent || session.id,
    updatedAt: new Date().toISOString(),
  };

  if (session.subscription) {
    updates.stripeSubscriptionId = session.subscription;
  }

  await dbUnified.updateOne('payments', payment.id, updates);

  logger.info(`Payment ${payment.id} marked as succeeded`);
}

/**
 * Handle customer.subscription.created event
 */
async function handleSubscriptionCreated(subscription) {
  const customerId = subscription.customer;

  // Find user by customer ID
  const payments = await dbUnified.find('payments', {
    stripeCustomerId: customerId,
  });

  if (payments.length === 0) {
    logger.warn('No payment records found for customer:', customerId);
    return;
  }

  const userId = payments[0].userId;

  // Get price details from subscription items
  const priceData = subscription.items.data[0].price;

  // Create subscription payment record
  const paymentId = uid();
  const paymentRecord = {
    id: paymentId,
    stripePaymentId: subscription.latest_invoice || subscription.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    userId: userId,
    amount: priceData.unit_amount / 100,
    currency: priceData.currency,
    status: subscription.status === 'active' ? 'succeeded' : 'pending',
    type: 'subscription',
    subscriptionDetails: {
      planId: priceData.id,
      planName: priceData.nickname || priceData.product,
      interval: priceData.recurring.interval,
      currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    metadata: subscription.metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('payments', paymentRecord);

  // Update user's Pro status and subscription tier if applicable
  if (subscription.status === 'active') {
    const users = await dbUnified.find('users', { id: userId });
    if (users.length > 0) {
      const tier = getSubscriptionTier(paymentRecord.subscriptionDetails.planName);
      const userUpdates = {
        isPro: tier === 'pro' || tier === 'pro_plus',
        proExpiresAt: new Date(subscription.current_period_end * 1000).toISOString(),
        subscriptionTier: tier,
      };
      await dbUnified.updateOne('users', userId, userUpdates);
      logger.info(`User ${userId} subscription tier set to: ${tier}`);
    }
  }

  logger.info(`Subscription ${subscription.id} created for user ${userId}`);
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(subscription) {
  // Find payment record by subscription ID
  const payments = await dbUnified.find('payments', {
    stripeSubscriptionId: subscription.id,
  });

  if (payments.length === 0) {
    logger.warn('No payment records found for subscription:', subscription.id);
    return;
  }

  const payment = payments[payments.length - 1]; // Get most recent
  const userId = payment.userId;

  // Get price details from subscription items
  const priceData = subscription.items.data[0].price;

  // Update subscription details
  const updates = {
    status: subscription.status === 'active' ? 'succeeded' : subscription.status,
    subscriptionDetails: {
      planId: priceData.id,
      planName: priceData.nickname || priceData.product,
      interval: priceData.recurring.interval,
      currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: subscription.canceled_at
        ? new Date(subscription.canceled_at * 1000).toISOString()
        : null,
    },
    updatedAt: new Date().toISOString(),
  };

  await dbUnified.updateOne('payments', payment.id, updates);

  // Update user's Pro status and subscription tier
  const users = await dbUnified.find('users', { id: userId });
  if (users.length > 0) {
    const planName = updates.subscriptionDetails.planName;
    const tier = getSubscriptionTier(planName);
    const isActive = subscription.status === 'active';

    const userUpdates = {
      isPro: isActive && (tier === 'pro' || tier === 'pro_plus'),
      proExpiresAt: new Date(subscription.current_period_end * 1000).toISOString(),
      subscriptionTier: isActive ? tier : 'free',
    };
    await dbUnified.updateOne('users', userId, userUpdates);
    logger.info(
      `User ${userId} subscription updated - tier: ${userUpdates.subscriptionTier}, active: ${isActive}`
    );
  }

  logger.info(`Subscription ${subscription.id} updated`);
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDeleted(subscription) {
  // Find payment record by subscription ID
  const payments = await dbUnified.find('payments', {
    stripeSubscriptionId: subscription.id,
  });

  if (payments.length === 0) {
    logger.warn('No payment records found for subscription:', subscription.id);
    return;
  }

  const payment = payments[payments.length - 1];
  const userId = payment.userId;

  // Mark subscription as cancelled
  await dbUnified.updateOne('payments', payment.id, {
    status: 'cancelled',
    subscriptionDetails: {
      ...payment.subscriptionDetails,
      canceledAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  });

  // Update user's Pro status to expired and remove subscription tier
  const users = await dbUnified.find('users', { id: userId });
  if (users.length > 0) {
    await dbUnified.updateOne('users', userId, {
      isPro: false,
      subscriptionTier: 'free',
    });
    logger.info(`User ${userId} subscription deleted - tier reset to free`);
  }

  logger.info(`Subscription ${subscription.id} deleted for user ${userId}`);
}

/**
 * Handle payment_intent.succeeded event
 */
async function handlePaymentSucceeded(paymentIntent) {
  const payments = await dbUnified.find('payments', {
    stripePaymentId: paymentIntent.id,
  });

  if (payments.length === 0) {
    logger.warn('No payment record found for payment intent:', paymentIntent.id);
    return;
  }

  const payment = payments[0];

  await dbUnified.updateOne('payments', payment.id, {
    status: 'succeeded',
    amount: paymentIntent.amount / 100,
    currency: paymentIntent.currency,
    updatedAt: new Date().toISOString(),
  });

  logger.info(`Payment intent ${paymentIntent.id} succeeded`);
}

/**
 * Handle payment_intent.payment_failed event
 */
async function handlePaymentFailed(paymentIntent) {
  const payments = await dbUnified.find('payments', {
    stripePaymentId: paymentIntent.id,
  });

  if (payments.length === 0) {
    logger.warn('No payment record found for payment intent:', paymentIntent.id);
    return;
  }

  const payment = payments[0];

  await dbUnified.updateOne('payments', payment.id, {
    status: 'failed',
    metadata: {
      ...payment.metadata,
      failureReason: paymentIntent.last_payment_error?.message || 'Payment failed',
    },
    updatedAt: new Date().toISOString(),
  });

  logger.info(`Payment intent ${paymentIntent.id} failed`);
}

/**
 * @swagger
 * /api/payments/config:
 *   get:
 *     summary: Get Stripe configuration
 *     description: Returns Stripe publishable key for frontend integration
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Configuration retrieved successfully
 *       401:
 *         description: Unauthorized
 *       503:
 *         description: Stripe not configured
 */
router.get('/config', authRequired, async (req, res) => {
  try {
    // Check database connectivity first
    const dbStatus = dbUnified.getDatabaseStatus();
    if (!dbStatus.connected) {
      logger.error('Database not connected for payment config endpoint. State:', dbStatus.state);
      return res.status(500).json({
        error: 'Payment system temporarily unavailable',
        message: 'Database connection error. Please try again in a few moments.',
        details:
          'The payment system requires database connectivity. Please contact support if this persists.',
      });
    }

    if (!STRIPE_ENABLED || !stripe) {
      return res.status(503).json({
        error: 'Payment processing is not available',
        message: 'Stripe is not configured. Please contact support.',
      });
    }

    const publishableKey =
      process.env.STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    if (!publishableKey) {
      logger.error('Stripe publishable key not configured');
      return res.status(503).json({
        error: 'Stripe configuration incomplete',
        message: 'Stripe publishable key is not configured.',
      });
    }

    res.json({
      publishableKey: publishableKey,
      introPricingEnabled: INTRO_PRICING_ENABLED,
      proPriceId: STRIPE_PRO_PRICE_ID || null,
    });
  } catch (error) {
    logger.error('Error getting payment config:', error);
    res.status(500).json({
      error: 'Failed to retrieve payment configuration',
      message: error.message || 'An unexpected error occurred',
    });
  }
});

/**
 * @swagger
 * /api/payments:
 *   get:
 *     summary: Get user's payment history
 *     description: Retrieve all payments for the authenticated user
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Payment history retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/', authRequired, async (req, res) => {
  try {
    const user = req.user;
    const payments = await dbUnified.find('payments', { userId: user.id });

    // Sort by creation date, newest first
    payments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      payments: payments,
    });
  } catch (error) {
    logger.error('Error fetching payments:', error);
    res.status(500).json({
      error: 'Failed to fetch payment history',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/payments/{id}:
 *   get:
 *     summary: Get specific payment details
 *     description: Retrieve details for a specific payment
 *     tags: [Payments]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment details retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment not found
 */
router.get('/:id', authRequired, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    const payments = await dbUnified.find('payments', { id: id, userId: user.id });

    if (payments.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json({
      success: true,
      payment: payments[0],
    });
  } catch (error) {
    logger.error('Error fetching payment:', error);
    res.status(500).json({
      error: 'Failed to fetch payment',
      message: error.message,
    });
  }
});

module.exports = router;
