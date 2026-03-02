/**
 * Subscription and Payment Routes (v2)
 * REST API endpoints for subscription management, invoicing, and admin analytics
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const PDFDocument = require('pdfkit');
const { authRequired, roleRequired } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimits');
const { csrfProtection } = require('../middleware/csrf');
const subscriptionService = require('../services/subscriptionService');
const paymentService = require('../services/paymentService');
const { processWebhookEvent } = require('../webhooks/stripeWebhookHandler');
const dbUnified = require('../db-unified');
const { formatInvoice } = require('../models/Invoice');
const { createAuditLog } = require('../utils/auditTrail');

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
  }
} catch (err) {
  logger.error('Failed to initialize Stripe:', err.message);
}

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

/**
 * Helper: Ensure Stripe is enabled
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
 * /api/v2/subscriptions/plans:
 *   get:
 *     summary: List all available subscription plans
 *     tags: [Subscriptions]
 *     responses:
 *       200:
 *         description: List of plans
 */
router.get('/plans', async (req, res) => {
  try {
    const plans = subscriptionService.getAllPlans();
    res.json({
      success: true,
      plans,
    });
  } catch (error) {
    logger.error('Error fetching plans:', error);
    res.status(500).json({
      error: 'Failed to fetch plans',
      message: error.message,
    });
  }
});

/**
 * POST /api/v2/subscriptions/create-checkout-session
 * Create a Stripe Checkout Session for a given planId.
 * Used by pricing.html to redirect authenticated users to Stripe.
 */
router.post(
  '/create-checkout-session',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const { planId, returnUrl } = req.body;

      if (!planId) {
        return res.status(400).json({ error: 'planId is required' });
      }

      // Map planId to Stripe price (use env vars when available).
      // 'pro' and 'pro_monthly' are intentional aliases for the same monthly Professional plan.
      // 'pro_plus' and 'pro_plus_monthly' are intentional aliases for the same monthly Pro Plus plan.
      const PLAN_PRICE_MAP = {
        pro: process.env.STRIPE_PRO_PRICE_ID || '', // monthly Professional (alias)
        pro_monthly: process.env.STRIPE_PRO_PRICE_ID || '', // monthly Professional
        pro_plus: process.env.STRIPE_PRO_PLUS_PRICE_ID || '',
        pro_plus_monthly: process.env.STRIPE_PRO_PLUS_PRICE_ID || '',
        pro_yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || '',
        pro_plus_yearly: process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID || '',
        // starter/free — no Stripe payment needed
        starter: null,
        free: null,
      };

      if (!(planId in PLAN_PRICE_MAP)) {
        return res.status(400).json({ error: `Unknown plan: ${planId}` });
      }

      const priceId = PLAN_PRICE_MAP[planId];

      // Free/starter plan — nothing to charge
      if (!priceId) {
        const dest = returnUrl || `${process.env.BASE_URL || ''}/dashboard/supplier`;
        return res.json({ success: true, url: dest });
      }

      // Get or create Stripe customer
      const customer = await paymentService.getOrCreateStripeCustomer(req.user);

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const successUrl =
        returnUrl ||
        `${baseUrl}/dashboard/supplier?billing=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/pricing?checkout=cancelled`;

      const session = await stripe.checkout.sessions.create({
        customer: customer.id,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId: req.user.id,
          planId,
        },
      });

      res.json({ success: true, url: session.url, sessionId: session.id });
    } catch (error) {
      logger.error('Error creating checkout session (v2):', error);
      const statusCode = error.type === 'StripeInvalidRequestError' ? 400 : 500;
      res.status(statusCode).json({
        error: 'Failed to create checkout session',
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/v2/subscriptions/me:
 *   get:
 *     summary: Get current user's subscription
 *     description: Returns the authenticated user's active subscription, or null with plan 'free' when none exists.
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription retrieved (subscription is null when user has no paid plan)
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authRequired, async (req, res) => {
  try {
    const subscription = await subscriptionService.getSubscriptionByUserId(req.user.id);
    const plan = subscription ? subscription.plan : 'free';
    res.json({ success: true, subscription, plan });
  } catch (error) {
    logger.error('Error fetching current user subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription', message: error.message });
  }
});

/**
 *     summary: Subscribe to a plan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - plan
 *               - priceId
 *             properties:
 *               plan:
 *                 type: string
 *                 enum: [free, basic, pro, enterprise]
 *               priceId:
 *                 type: string
 *               trialDays:
 *                 type: number
 *     responses:
 *       200:
 *         description: Subscription created
 */
router.post(
  '/',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const { plan, priceId, trialDays } = req.body;

      if (!plan || !priceId) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'plan and priceId are required',
        });
      }

      // Check if user already has an active subscription
      const existingSub = await subscriptionService.getSubscriptionByUserId(req.user.id);
      if (existingSub && existingSub.status !== 'canceled') {
        return res.status(400).json({
          error: 'Subscription already exists',
          message: 'You already have an active subscription',
        });
      }

      // Create or retrieve Stripe customer
      const customer = await paymentService.getOrCreateStripeCustomer(req.user);

      // Create Stripe subscription
      const stripeSubscription = await paymentService.createStripeSubscription({
        customerId: customer.id,
        priceId,
        metadata: {
          userId: req.user.id,
          planName: plan,
        },
        trialPeriodDays: trialDays || null,
      });

      // Create subscription record in database
      const trialEnd = trialDays ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;
      const subscription = await subscriptionService.createSubscription({
        userId: req.user.id,
        plan,
        stripeSubscriptionId: stripeSubscription.id,
        stripeCustomerId: customer.id,
        trialEnd,
      });

      // Log subscription creation to audit trail
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role || 'user',
        },
        action: 'SUBSCRIPTION_CREATED',
        resource: {
          type: 'subscription',
          id: subscription.id,
        },
        details: {
          plan: plan,
          stripeSubscriptionId: stripeSubscription.id,
          trialDays: trialDays || 0,
          effectiveDate: new Date().toISOString(),
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        subscription,
        clientSecret: stripeSubscription.latest_invoice?.payment_intent?.client_secret,
      });
    } catch (error) {
      logger.error('Error creating subscription:', error);
      res.status(500).json({
        error: 'Failed to create subscription',
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/v2/subscriptions/:id/upgrade:
 *   post:
 *     summary: Upgrade to a higher plan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/upgrade',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { newPlan, newPriceId } = req.body;

      if (!newPlan || !newPriceId) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'newPlan and newPriceId are required',
        });
      }

      const subscription = await subscriptionService.getSubscription(id);

      if (!subscription) {
        return res.status(404).json({
          error: 'Subscription not found',
        });
      }

      // Verify ownership
      if (subscription.userId !== req.user.id) {
        return res.status(403).json({
          error: 'Unauthorized',
        });
      }

      // Update Stripe subscription
      if (subscription.stripeSubscriptionId) {
        const stripeSubscription = await stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId
        );
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [
            {
              id: stripeSubscription.items.data[0].id,
              price: newPriceId,
            },
          ],
          proration_behavior: 'create_prorations',
          metadata: {
            planName: newPlan,
          },
        });
      }

      // Upgrade in database
      const updatedSubscription = await subscriptionService.upgradeSubscription(id, newPlan);

      // Log upgrade to audit trail
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role || 'user',
        },
        action: 'SUBSCRIPTION_UPGRADED',
        resource: {
          type: 'subscription',
          id: id,
        },
        changes: {
          before: { plan: subscription.plan },
          after: { plan: newPlan },
        },
        details: {
          previousPlan: subscription.plan,
          newPlan: newPlan,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          effectiveDate: new Date().toISOString(),
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        subscription: updatedSubscription,
      });
    } catch (error) {
      logger.error('Error upgrading subscription:', error);
      res.status(500).json({
        error: 'Failed to upgrade subscription',
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/v2/subscriptions/:id/downgrade:
 *   post:
 *     summary: Downgrade to a lower plan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/:id/downgrade',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { newPlan } = req.body;

      if (!newPlan) {
        return res.status(400).json({
          error: 'Missing required field',
          message: 'newPlan is required',
        });
      }

      const subscription = await subscriptionService.getSubscription(id);

      if (!subscription) {
        return res.status(404).json({
          error: 'Subscription not found',
        });
      }

      // Verify ownership
      if (subscription.userId !== req.user.id) {
        return res.status(403).json({
          error: 'Unauthorized',
        });
      }

      // Schedule downgrade at period end in Stripe
      if (subscription.stripeSubscriptionId) {
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
          metadata: {
            downgrade_to: newPlan,
          },
        });
      }

      // Downgrade in database (scheduled at period end)
      const updatedSubscription = await subscriptionService.downgradeSubscription(id, newPlan);

      // Log downgrade to audit trail
      await createAuditLog({
        actor: {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role || 'user',
        },
        action: 'SUBSCRIPTION_DOWNGRADED',
        resource: {
          type: 'subscription',
          id: id,
        },
        changes: {
          before: { plan: subscription.plan },
          after: { plan: newPlan },
        },
        details: {
          previousPlan: subscription.plan,
          newPlan: newPlan,
          scheduledAtPeriodEnd: true,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          effectiveDate: new Date().toISOString(),
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({
        success: true,
        subscription: updatedSubscription,
        message: 'Downgrade scheduled for end of billing period',
      });
    } catch (error) {
      logger.error('Error downgrading subscription:', error);
      res.status(500).json({
        error: 'Failed to downgrade subscription',
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/v2/subscriptions/:id/cancel:
 *   post:
 *     summary: Cancel subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 */
router.post('/:id/cancel', authRequired, csrfProtection, writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, immediately } = req.body;

    const subscription = await subscriptionService.getSubscription(id);

    if (!subscription) {
      return res.status(404).json({
        error: 'Subscription not found',
      });
    }

    // Verify ownership
    if (subscription.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Unauthorized',
      });
    }

    // Cancel in Stripe if applicable
    if (subscription.stripeSubscriptionId && STRIPE_ENABLED) {
      await paymentService.cancelStripeSubscription(subscription.stripeSubscriptionId, immediately);
    }

    // Cancel in database
    const updatedSubscription = await subscriptionService.cancelSubscription(
      id,
      reason,
      immediately
    );

    // Log cancellation to audit trail
    await createAuditLog({
      actor: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role || 'user',
      },
      action: 'SUBSCRIPTION_CANCELLED',
      resource: {
        type: 'subscription',
        id: id,
      },
      changes: {
        before: { status: subscription.status, plan: subscription.plan },
        after: { status: 'canceled' },
      },
      details: {
        plan: subscription.plan,
        reason: reason || 'No reason provided',
        immediately: !!immediately,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        effectiveDate: new Date().toISOString(),
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      success: true,
      subscription: updatedSubscription,
      message: immediately
        ? 'Subscription canceled immediately'
        : 'Subscription will cancel at period end',
    });
  } catch (error) {
    logger.error('Error canceling subscription:', error);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/subscriptions/:id/status:
 *   get:
 *     summary: Get subscription status
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/status', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await subscriptionService.getSubscription(id);

    if (!subscription) {
      return res.status(404).json({
        error: 'Subscription not found',
      });
    }

    // Verify ownership or admin
    if (subscription.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Unauthorized',
      });
    }

    res.json({
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
  } catch (error) {
    logger.error('Error fetching subscription status:', error);
    res.status(500).json({
      error: 'Failed to fetch subscription status',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/subscriptions/:id/features:
 *   get:
 *     summary: Get features for subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:id/features', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await subscriptionService.getSubscription(id);

    if (!subscription) {
      return res.status(404).json({
        error: 'Subscription not found',
      });
    }

    // Verify ownership or admin
    if (subscription.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Unauthorized',
      });
    }

    const features = await subscriptionService.getUserFeatures(subscription.userId);

    res.json({
      success: true,
      plan: subscription.plan,
      features: features.features,
    });
  } catch (error) {
    logger.error('Error fetching features:', error);
    res.status(500).json({
      error: 'Failed to fetch features',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/invoices:
 *   get:
 *     summary: List invoices for user
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 */
router.get('/invoices', authRequired, async (req, res) => {
  try {
    const invoices = await dbUnified.read('invoices');
    const userInvoices = invoices
      .filter(inv => inv.userId === req.user.id)
      .map(formatInvoice)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      invoices: userInvoices,
    });
  } catch (error) {
    logger.error('Error fetching invoices:', error);
    res.status(500).json({
      error: 'Failed to fetch invoices',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/invoices/:id/pay:
 *   post:
 *     summary: Retry payment for unpaid invoice
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/invoices/:id/pay',
  authRequired,
  csrfProtection,
  writeLimiter,
  ensureStripeEnabled,
  async (req, res) => {
    try {
      const { id } = req.params;
      const invoices = await dbUnified.read('invoices');
      const invoice = invoices.find(inv => inv.id === id);

      if (!invoice) {
        return res.status(404).json({
          error: 'Invoice not found',
        });
      }

      // Verify ownership
      if (invoice.userId !== req.user.id) {
        return res.status(403).json({
          error: 'Unauthorized',
        });
      }

      if (invoice.status === 'paid') {
        return res.status(400).json({
          error: 'Invoice already paid',
        });
      }

      // Retry payment in Stripe
      const stripeInvoice = await paymentService.retryInvoicePayment(invoice.stripeInvoiceId);

      // Update invoice status
      const invoiceUpdates = {
        status: stripeInvoice.status === 'paid' ? 'paid' : invoice.status,
        updatedAt: new Date().toISOString(),
      };
      if (stripeInvoice.status === 'paid') {
        invoiceUpdates.paidAt = new Date().toISOString();
      }
      await dbUnified.updateOne('invoices', { id: invoice.id }, { $set: invoiceUpdates });

      res.json({
        success: true,
        invoice: formatInvoice(invoice),
      });
    } catch (error) {
      logger.error('Error retrying invoice payment:', error);
      res.status(500).json({
        error: 'Failed to retry payment',
        message: error.message,
      });
    }
  }
);

/**
 * @swagger
 * /api/v2/invoices/:id/download:
 *   get:
 *     summary: Download invoice as PDF
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 */
router.get('/invoices/:id/download', authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const invoices = await dbUnified.read('invoices');
    const invoice = invoices.find(inv => inv.id === id);

    if (!invoice) {
      return res.status(404).json({
        error: 'Invoice not found',
      });
    }

    // Verify ownership or admin
    if (invoice.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Unauthorized',
      });
    }

    // Create PDF
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.id}.pdf`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('INVOICE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Invoice ID: ${invoice.id}`);
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`);
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
    doc.moveDown();

    // Line items
    doc.fontSize(14).text('Line Items:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10);

    invoice.lineItems.forEach(item => {
      const currencyUpper = invoice.currency.toUpperCase();
      doc.text(`${item.name} x ${item.quantity} @ ${currencyUpper} ${item.unitPrice.toFixed(2)}`);
      doc.text(`  Total: ${currencyUpper} ${item.amount.toFixed(2)}`);
      doc.moveDown(0.5);
    });

    // Totals
    doc.moveDown();
    doc.fontSize(12);
    const currencyUpper = invoice.currency.toUpperCase();
    doc.text(`Subtotal: ${currencyUpper} ${invoice.subtotal.toFixed(2)}`, { align: 'right' });
    if (invoice.tax > 0) {
      doc.text(`Tax: ${currencyUpper} ${invoice.tax.toFixed(2)}`, { align: 'right' });
    }
    if (invoice.discount > 0) {
      doc.text(`Discount: -${currencyUpper} ${invoice.discount.toFixed(2)}`, { align: 'right' });
    }
    doc
      .fontSize(14)
      .text(`Total: ${currencyUpper} ${invoice.amount.toFixed(2)}`, { align: 'right' });

    if (invoice.paidAt) {
      doc.moveDown();
      doc
        .fontSize(10)
        .text(`Paid on: ${new Date(invoice.paidAt).toLocaleDateString()}`, { align: 'right' });
    }

    doc.end();
  } catch (error) {
    logger.error('Error downloading invoice:', error);
    res.status(500).json({
      error: 'Failed to download invoice',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/admin/subscriptions:
 *   get:
 *     summary: List all subscriptions (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/admin/subscriptions', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const { status, plan, page = 1, limit = 50 } = req.query;

    const filters = {};
    if (status) {
      filters.status = status;
    }
    if (plan) {
      filters.plan = plan;
    }

    const subscriptions = await subscriptionService.listSubscriptions(filters);

    // Pagination with proper integer parsing
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedSubscriptions = subscriptions.slice(startIndex, endIndex);

    res.json({
      success: true,
      subscriptions: paginatedSubscriptions,
      pagination: {
        total: subscriptions.length,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(subscriptions.length / limitNum),
      },
    });
  } catch (error) {
    logger.error('Error fetching subscriptions:', error);
    res.status(500).json({
      error: 'Failed to fetch subscriptions',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/admin/revenue:
 *   get:
 *     summary: Get revenue analytics (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 */
router.get('/admin/revenue', authRequired, roleRequired('admin'), async (req, res) => {
  try {
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
  } catch (error) {
    logger.error('Error fetching revenue analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch revenue analytics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/v2/webhooks/stripe:
 *   post:
 *     summary: Stripe webhook endpoint
 *     tags: [Webhooks]
 *     description: Handles Stripe webhook events
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  if (STRIPE_WEBHOOK_SECRET && STRIPE_ENABLED) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // In development without webhook secret, parse body directly
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      logger.error('Failed to parse webhook body:', err.message);
      return res.status(400).send('Invalid request body');
    }
  }

  try {
    await processWebhookEvent(event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.status(500).json({
      error: 'Webhook processing failed',
      message: error.message,
    });
  }
});

module.exports = router;
