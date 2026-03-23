/**
 * Stripe Webhook Handler
 * Processes webhook events from Stripe for subscriptions, invoices, and payments
 */

'use strict';
const logger = require('../utils/logger.js');

const subscriptionService = require('../services/subscriptionService');
const paymentService = require('../services/paymentService');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const postmark = require('../utils/postmark');

/**
 * Format an internal plan tier key into a human-readable display name.
 * @param {string} tier - Internal tier key ('free' | 'pro' | 'pro_plus')
 * @returns {string} Display name, e.g. 'Pro Plus'
 */
function formatPlanName(tier) {
  const names = {
    free: 'Free',
    pro: 'Pro',
    pro_plus: 'Pro Plus',
  };
  return names[tier] || tier || 'Unknown';
}

/**
 * HTML feature list items per plan tier, used in the subscription-activated email.
 * Each value is a set of <li> fragments for the {{features}} template slot.
 */
const PLAN_EMAIL_FEATURES = {
  free: '<li>Basic messaging</li><li>Standard listing</li>',
  pro: '<li>Unlimited messaging</li><li>Advanced analytics</li><li>Priority listing</li><li>Priority support</li>',
  pro_plus:
    '<li>Unlimited messaging</li><li>Advanced analytics</li><li>Priority listing</li>' +
    '<li>Priority support</li><li>Custom branding</li><li>Homepage carousel</li>',
};

/**
 * Resolve a Stripe plan identifier to an internal tier key.
 *
 * Resolution order (most to least authoritative):
 *   1. Exact match on a canonical planId value (set in Stripe metadata by the checkout session).
 *      Accepted values: 'pro', 'pro_plus', 'pro_monthly', 'pro_yearly',
 *                       'pro_plus_monthly', 'pro_plus_yearly'
 *   2. Substring heuristic on the lower-cased name as a last-resort fallback.
 *      'pro_plus' / 'proplus' / 'pro+' are checked before 'pro' to prevent false matches.
 *      Note: names like "Pro Plus Monthly" (without underscore/proplus/pro+) fall through
 *      to the 'pro' match — use metadata.planId for deterministic mapping.
 *
 * @param {string} planName - Raw plan identifier from Stripe metadata or price nickname
 * @returns {string} Canonical tier: 'pro_plus' | 'pro' | 'free'
 */
function resolvePlanTier(planName) {
  const raw = (planName || '').trim();
  const lc = raw.toLowerCase();

  // 1. Exact match on known canonical planId values (set by checkout session metadata)
  const exactMap = {
    pro: 'pro',
    pro_monthly: 'pro',
    pro_yearly: 'pro',
    pro_plus: 'pro_plus',
    pro_plus_monthly: 'pro_plus',
    pro_plus_yearly: 'pro_plus',
  };
  if (Object.prototype.hasOwnProperty.call(exactMap, lc)) {
    return exactMap[lc];
  }

  // 2. Substring heuristic fallback — check pro_plus variants before pro to avoid false matches
  if (lc.includes('pro_plus') || lc.includes('proplus') || lc.includes('pro+')) {
    return 'pro_plus';
  }
  if (lc.includes('pro')) {
    logger.info(
      `resolvePlanTier: falling back to substring match for "${raw}". ` +
        'Set metadata.planId on the Stripe subscription for deterministic tier mapping.'
    );
    return 'pro';
  }
  return 'free';
}

/**
 * Handle invoice.created event
 * @param {Object} invoice - Stripe invoice object
 */
async function handleInvoiceCreated(invoice) {
  logger.info('Processing invoice.created:', invoice.id);

  const subscription = await subscriptionService.getSubscriptionByStripeId(invoice.subscription);

  if (!subscription) {
    logger.warn('Subscription not found for invoice:', invoice.id);
    return;
  }

  // Create invoice record in database
  const lineItems = invoice.lines.data.map(line => ({
    name: line.description || 'Subscription',
    description: line.description || '',
    quantity: line.quantity || 1,
    unitPrice: line.amount / 100, // Convert from cents
    amount: line.amount / 100,
  }));

  const invoiceRecord = {
    id: uid('inv'),
    subscriptionId: subscription.id,
    userId: subscription.userId,
    stripeInvoiceId: invoice.id,
    stripePaymentIntentId: invoice.payment_intent,
    amount: invoice.total / 100,
    currency: invoice.currency,
    status: invoice.status === 'paid' ? 'paid' : 'open',
    dueDate: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
    lineItems,
    subtotal: invoice.subtotal / 100,
    tax: (invoice.tax ?? 0) / 100,
    discount: (invoice.discount ?? 0) / 100,
    attemptCount: 0,
    metadata: {
      stripeInvoiceNumber: invoice.number || '',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dbUnified.insertOne('invoices', invoiceRecord);
}

/**
 * Handle invoice.payment_succeeded event
 * @param {Object} invoice - Stripe invoice object
 */
async function handleInvoicePaymentSucceeded(invoice) {
  logger.info('Processing invoice.payment_succeeded:', invoice.id);

  const subscription = await subscriptionService.getSubscriptionByStripeId(invoice.subscription);

  if (!subscription) {
    logger.warn('Subscription not found for invoice:', invoice.id);
    return;
  }

  // Update invoice status
  const invoices = await dbUnified.read('invoices');
  const invoiceRecord = invoices.find(inv => inv.stripeInvoiceId === invoice.id);

  if (invoiceRecord) {
    await dbUnified.updateOne(
      'invoices',
      { stripeInvoiceId: invoice.id },
      {
        $set: {
          status: 'paid',
          paidAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    // Add billing record to subscription
    await subscriptionService.addBillingRecord(subscription.id, {
      invoiceId: invoiceRecord.id,
      amount: invoice.total / 100,
      currency: invoice.currency,
      paid: true,
      date: new Date().toISOString(),
    });
  }

  // Update subscription status to active if it was past_due
  if (subscription.status === 'past_due' || subscription.status === 'trialing') {
    await subscriptionService.updateSubscription(subscription.id, {
      status: 'active',
    });
  }

  // Update billing dates
  if (invoice.lines.data.length > 0) {
    const line = invoice.lines.data[0];
    if (line.period) {
      await subscriptionService.updateBillingDates(
        subscription.id,
        new Date(line.period.start * 1000),
        new Date(line.period.end * 1000)
      );
    }
  }

  // Award partner subscription bonus for first successful payment (non-blocking)
  try {
    const partnerService = require('../services/partnerService');
    await partnerService.awardSubscriptionBonus(subscription.userId);
  } catch (_pe) {
    logger.warn('Partner subscription bonus award failed (non-blocking):', _pe.message);
  }
}

/**
 * Handle invoice.payment_failed event
 * @param {Object} invoice - Stripe invoice object
 */
async function handleInvoicePaymentFailed(invoice) {
  logger.info('Processing invoice.payment_failed:', invoice.id);

  const subscription = await subscriptionService.getSubscriptionByStripeId(invoice.subscription);

  if (!subscription) {
    logger.warn('Subscription not found for invoice:', invoice.id);
    return;
  }

  // Update invoice status and attempt count
  const invoices = await dbUnified.read('invoices');
  const invoiceRecord = invoices.find(inv => inv.stripeInvoiceId === invoice.id);

  if (invoiceRecord) {
    await dbUnified.updateOne(
      'invoices',
      { stripeInvoiceId: invoice.id },
      {
        $set: {
          status: 'open',
          attemptCount: (invoiceRecord.attemptCount || 0) + 1,
          nextPaymentAttempt: invoice.next_payment_attempt
            ? new Date(invoice.next_payment_attempt * 1000).toISOString()
            : null,
          updatedAt: new Date().toISOString(),
        },
      }
    );
  }

  // Update subscription status to past_due
  await subscriptionService.updateSubscription(subscription.id, {
    status: 'past_due',
    metadata: {
      ...subscription.metadata,
      lastPaymentFailed: new Date().toISOString(),
      failedInvoiceId: invoice.id,
    },
  });

  // Get user details for notification
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === subscription.userId);

  if (user) {
    logger.info(
      `Payment failed for user ${user.email}: Invoice ${invoice.id}, Amount: ${invoice.amount_due / 100} ${invoice.currency.toUpperCase()}`
    );

    // Send payment failed email using the subscription-payment-failed template
    try {
      const gracePeriodEnd = invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });

      await postmark.sendMail({
        to: user.email,
        subject: 'Action Required: Your EventFlow Payment Failed',
        template: 'subscription-payment-failed',
        templateData: {
          name: user.name || 'there',
          planName: formatPlanName(subscription.plan),
          amount: (invoice.amount_due / 100).toFixed(2),
          attemptDate: new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
          gracePeriodEnd,
        },
        from: postmark.FROM_BILLING,
        tags: ['payment-failed', 'transactional'],
        messageStream: 'outbound',
      });
      logger.info(`Payment failed email sent to ${user.email}`);
    } catch (emailErr) {
      logger.error('Failed to send payment failed email:', emailErr.message);
    }
  }

  // Handle dunning
  await paymentService.handleFailedPayment(subscription.id, invoice);
}

/**
 * Handle customer.subscription.created event
 * @param {Object} stripeSubscription - Stripe subscription object
 */
async function handleSubscriptionCreated(stripeSubscription) {
  logger.info('Processing customer.subscription.created:', stripeSubscription.id);

  // Check if subscription already exists
  const existing = await subscriptionService.getSubscriptionByStripeId(stripeSubscription.id);
  if (existing) {
    logger.info('Subscription already exists:', existing.id);
    return;
  }

  // Find user by Stripe customer ID
  const payments = await dbUnified.read('payments');
  const payment = payments.find(p => p.stripeCustomerId === stripeSubscription.customer);

  if (!payment) {
    logger.warn('User not found for Stripe customer:', stripeSubscription.customer);
    return;
  }

  // Determine plan from metadata.planId (canonical, set by checkout session) first,
  // then fall back to planName/price nickname for older subscriptions
  const planId =
    stripeSubscription.metadata?.planId ||
    stripeSubscription.metadata?.planName ||
    stripeSubscription.items.data[0]?.price?.nickname ||
    '';
  const plan = resolvePlanTier(planId);

  // Create subscription record
  const trialEnd = stripeSubscription.trial_end
    ? new Date(stripeSubscription.trial_end * 1000)
    : null;

  await subscriptionService.createSubscription({
    userId: payment.userId,
    plan,
    stripeSubscriptionId: stripeSubscription.id,
    stripeCustomerId: stripeSubscription.customer,
    trialEnd,
  });

  // Send subscription activated email
  try {
    const users = await dbUnified.read('users');
    const user = users.find(u => u.id === payment.userId);
    if (user) {
      const item = stripeSubscription.items?.data?.[0];
      const unitAmount = item?.price?.unit_amount ?? 0;
      const billingInterval = item?.price?.recurring?.interval ?? 'month';
      const amount = (unitAmount / 100).toFixed(2);

      const trialDaysCount = trialEnd
        ? Math.round((trialEnd - new Date()) / (1000 * 60 * 60 * 24))
        : 0;

      const renewalDate = trialEnd
        ? trialEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : stripeSubscription.current_period_end
          ? new Date(stripeSubscription.current_period_end * 1000).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
          : 'N/A';

      const status = trialEnd ? 'Trial' : 'Active';
      const features = PLAN_EMAIL_FEATURES[plan] || PLAN_EMAIL_FEATURES.free;

      await postmark.sendMail({
        to: user.email,
        subject: `Welcome to EventFlow ${formatPlanName(plan)}! Your subscription is active`,
        template: 'subscription-activated',
        templateData: {
          name: user.name || 'there',
          planName: formatPlanName(plan),
          status,
          trialDays: trialDaysCount > 0 ? String(trialDaysCount) : '0',
          renewalDate,
          amount,
          billingCycle: billingInterval,
          features,
        },
        from: postmark.FROM_BILLING,
        tags: ['subscription-activated', 'transactional'],
        messageStream: 'outbound',
      });
      logger.info(`Subscription activated email sent to ${user.email}`);
    }
  } catch (emailErr) {
    logger.error('Failed to send subscription activated email:', emailErr.message);
  }
}

/**
 * Handle customer.subscription.updated event
 * @param {Object} stripeSubscription - Stripe subscription object
 */
async function handleSubscriptionUpdated(stripeSubscription) {
  logger.info('Processing customer.subscription.updated:', stripeSubscription.id);

  const subscription = await subscriptionService.getSubscriptionByStripeId(stripeSubscription.id);

  if (!subscription) {
    logger.warn('Subscription not found:', stripeSubscription.id);
    return;
  }

  // Update subscription status and dates
  const updates = {
    status: stripeSubscription.status,
    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
    nextBillingDate: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
  };

  if (stripeSubscription.canceled_at) {
    updates.canceledAt = new Date(stripeSubscription.canceled_at * 1000).toISOString();
  }

  // When a billing period renews (Stripe clears cancel_at_period_end) and a downgrade
  // was scheduled locally, apply the pending plan now.
  // We check both the Stripe flag (now false = period renewed) AND the local flag
  // (was true = we set it during the downgrade) to avoid applying a pendingPlan if
  // cancel_at_period_end happened to be false for an unrelated reason.
  if (
    subscription.cancelAtPeriodEnd &&
    !stripeSubscription.cancel_at_period_end &&
    subscription.pendingPlan
  ) {
    updates.plan = subscription.pendingPlan;
    updates.pendingPlan = null;
    logger.info(
      `Applying pending downgrade for subscription ${subscription.id}: ` +
        `${subscription.plan} → ${subscription.pendingPlan}`
    );
  } else {
    // Detect an explicit plan change pushed via Stripe metadata (e.g. admin override)
    // Prefer metadata.planId (canonical) then planName/nickname as fallback
    const planIdentifier =
      stripeSubscription.metadata?.planId ||
      stripeSubscription.metadata?.planName ||
      stripeSubscription.items.data[0]?.price?.nickname ||
      '';
    if (planIdentifier) {
      const newPlan = resolvePlanTier(planIdentifier);
      if (newPlan && newPlan !== subscription.plan && !subscription.pendingPlan) {
        updates.plan = newPlan;
      }
    }
  }

  await subscriptionService.updateSubscription(subscription.id, updates);
}

/**
 * Handle customer.subscription.trial_will_end event
 * Sent 3 days before trial ends
 * @param {Object} stripeSubscription - Stripe subscription object
 */
async function handleSubscriptionTrialWillEnd(stripeSubscription) {
  logger.info('Processing customer.subscription.trial_will_end:', stripeSubscription.id);

  const subscription = await subscriptionService.getSubscriptionByStripeId(stripeSubscription.id);

  if (!subscription) {
    logger.warn('Subscription not found:', stripeSubscription.id);
    return;
  }

  // Get user details for sending email
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === subscription.userId);

  if (!user) {
    logger.warn('User not found for subscription:', subscription.userId);
    return;
  }

  // Calculate days remaining
  const trialEndDate = new Date(stripeSubscription.trial_end * 1000);
  const now = new Date();
  const daysRemaining = Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24));

  logger.info(
    `Trial ending soon for user ${user.email}: ${daysRemaining} days remaining (ends ${trialEndDate.toISOString()})`
  );

  // Send trial ending reminder email using the subscription-trial-ending template
  try {
    // Calculate total trial days from subscription record if available
    const trialStart = subscription.trialStart ? new Date(subscription.trialStart) : null;
    const trialDays =
      trialStart && trialEndDate > trialStart
        ? Math.round((trialEndDate - trialStart) / (1000 * 60 * 60 * 24))
        : 14; // Default to 14-day trial if not recorded

    // Determine billing amount and cycle from Stripe subscription items
    const item = stripeSubscription.items?.data?.[0];
    const unitAmount = item?.price?.unit_amount ?? 0;
    const billingInterval = item?.price?.recurring?.interval ?? 'month';
    const amount = (unitAmount / 100).toFixed(2);

    const formattedTrialEnd = trialEndDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    await postmark.sendMail({
      to: user.email,
      subject: `Your EventFlow trial ends in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
      template: 'subscription-trial-ending',
      templateData: {
        name: user.name || 'there',
        planName: formatPlanName(subscription.plan),
        trialDays: String(trialDays),
        daysLeft: String(daysRemaining),
        trialEndDate: formattedTrialEnd,
        amount,
        billingCycle: billingInterval,
      },
      from: postmark.FROM_BILLING,
      tags: ['trial-ending', 'transactional'],
      messageStream: 'outbound',
    });
    logger.info(`Trial ending email sent to ${user.email}`);
  } catch (emailErr) {
    logger.error('Failed to send trial ending email:', emailErr.message);
  }

  // Update subscription metadata to track notification sent
  await subscriptionService.updateSubscription(subscription.id, {
    metadata: {
      ...subscription.metadata,
      trialEndingNotificationSent: new Date().toISOString(),
    },
  });
}

/**
 * Handle customer.subscription.deleted event
 * @param {Object} stripeSubscription - Stripe subscription object
 */
async function handleSubscriptionDeleted(stripeSubscription) {
  logger.info('Processing customer.subscription.deleted:', stripeSubscription.id);

  const subscription = await subscriptionService.getSubscriptionByStripeId(stripeSubscription.id);

  if (!subscription) {
    logger.warn('Subscription not found:', stripeSubscription.id);
    return;
  }

  // Cancel subscription and downgrade to free
  await subscriptionService.updateSubscription(subscription.id, {
    status: 'canceled',
    plan: 'free',
    canceledAt: new Date().toISOString(),
  });

  // Also clear proExpiresAt on the user record so the gate sees them as free immediately
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === subscription.userId);
  if (user) {
    await dbUnified.updateOne(
      'users',
      { id: subscription.userId },
      {
        $set: { proExpiresAt: null, updatedAt: new Date().toISOString() },
      }
    );

    // Send subscription cancelled email
    try {
      const endDate = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });

      await postmark.sendMail({
        to: user.email,
        subject: `Your EventFlow ${formatPlanName(subscription.plan)} subscription has been cancelled`,
        template: 'subscription-cancelled',
        templateData: {
          name: user.name || 'there',
          planName: formatPlanName(subscription.plan),
          endDate,
        },
        from: postmark.FROM_BILLING,
        tags: ['subscription-cancelled', 'transactional'],
        messageStream: 'outbound',
      });
      logger.info(`Subscription cancelled email sent to ${user.email}`);
    } catch (emailErr) {
      logger.error('Failed to send subscription cancelled email:', emailErr.message);
    }
  }
}

/**
 * Handle invoice.upcoming event
 * Sent by Stripe 7 days before the next invoice is finalized
 * @param {Object} invoice - Stripe upcoming invoice object
 */
async function handleInvoiceUpcoming(invoice) {
  logger.info('Processing invoice.upcoming:', invoice.id || '(draft)');

  const subscription = await subscriptionService.getSubscriptionByStripeId(invoice.subscription);

  if (!subscription) {
    logger.warn('Subscription not found for upcoming invoice:', invoice.subscription);
    return;
  }

  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === subscription.userId);

  if (!user) {
    logger.warn('User not found for subscription:', subscription.userId);
    return;
  }

  // Calculate days until renewal
  const renewalTimestamp = invoice.next_payment_attempt || invoice.period_end;
  if (!renewalTimestamp) {
    logger.warn('No renewal date on upcoming invoice, skipping reminder');
    return;
  }

  const renewalDate = new Date(renewalTimestamp * 1000);
  const now = new Date();
  const daysUntilRenewal = Math.ceil((renewalDate - now) / (1000 * 60 * 60 * 24));

  const formattedRenewalDate = renewalDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const autoRenew = subscription.cancelAtPeriodEnd ? 'Disabled' : 'Enabled';
  const renewalMessage = subscription.cancelAtPeriodEnd
    ? 'Your subscription is set to cancel at the end of the current period. Reactivate to keep your premium access.'
    : `Your ${formatPlanName(subscription.plan)} subscription will automatically renew on ${formattedRenewalDate}.`;

  const ctaText = subscription.cancelAtPeriodEnd
    ? 'Reactivate Subscription'
    : 'Manage Subscription';

  try {
    await postmark.sendMail({
      to: user.email,
      subject: `Your EventFlow subscription renews in ${daysUntilRenewal} day${daysUntilRenewal !== 1 ? 's' : ''}`,
      template: 'subscription-renewal-reminder',
      templateData: {
        name: user.name || 'there',
        planName: formatPlanName(subscription.plan),
        daysUntilRenewal: String(daysUntilRenewal),
        renewalDate: formattedRenewalDate,
        amount: (invoice.amount_due / 100).toFixed(2),
        autoRenew,
        renewalMessage,
        ctaText,
      },
      from: postmark.FROM_BILLING,
      tags: ['renewal-reminder', 'transactional'],
      messageStream: 'outbound',
    });
    logger.info(`Renewal reminder email sent to ${user.email}`);
  } catch (emailErr) {
    logger.error('Failed to send renewal reminder email:', emailErr.message);
  }
}

/**
 * Handle payment_intent.succeeded event
 * @param {Object} paymentIntent - Stripe payment intent object
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  logger.info('Processing payment_intent.succeeded:', paymentIntent.id);

  const payment = await paymentService.getPaymentByStripeId(paymentIntent.id);

  if (payment) {
    await paymentService.updatePaymentRecord(payment.id, {
      status: 'succeeded',
    });
  }
}

/**
 * Handle payment_intent.payment_failed event
 * @param {Object} paymentIntent - Stripe payment intent object
 */
async function handlePaymentIntentFailed(paymentIntent) {
  logger.info('Processing payment_intent.payment_failed:', paymentIntent.id);

  const payment = await paymentService.getPaymentByStripeId(paymentIntent.id);

  if (payment) {
    await paymentService.updatePaymentRecord(payment.id, {
      status: 'failed',
      metadata: {
        ...payment.metadata,
        failureMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
      },
    });
  }
}

/**
 * Handle charge.refunded event
 * @param {Object} charge - Stripe charge object
 */
async function handleChargeRefunded(charge) {
  logger.info('Processing charge.refunded:', charge.id);

  const payment = await paymentService.getPaymentByStripeId(charge.payment_intent);

  if (payment) {
    await paymentService.updatePaymentRecord(payment.id, {
      status: 'refunded',
      metadata: {
        ...payment.metadata,
        refundAmount: charge.amount_refunded / 100,
      },
    });
  }
}

/**
 * Process Stripe webhook event
 * @param {Object} event - Stripe event object
 */
async function processWebhookEvent(event) {
  try {
    switch (event.type) {
      // Invoice events
      case 'invoice.created':
        await handleInvoiceCreated(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;
      case 'invoice.upcoming':
        await handleInvoiceUpcoming(event.data.object);
        break;

      // Subscription events
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'customer.subscription.trial_will_end':
        await handleSubscriptionTrialWillEnd(event.data.object);
        break;

      // Payment events
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object);
        break;

      default:
        logger.info('Unhandled webhook event type:', event.type);
    }
  } catch (error) {
    logger.error(`Error processing webhook event ${event.type}:`, error);
    throw error;
  }
}

module.exports = {
  processWebhookEvent,
  formatPlanName,
  resolvePlanTier,
  handleInvoiceCreated,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceUpcoming,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleSubscriptionTrialWillEnd,
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  handleChargeRefunded,
};
