'use strict';

const crypto = require('crypto');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const paymentService = require('./paymentService');
const baseIntegrity = require('./partnerRewardIntegrityService');

let evidenceStripeClient = null;

function numberEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getConfig() {
  return {
    settlementHours: numberEnv('PARTNER_REWARD_SUBSCRIPTION_SETTLEMENT_HOURS', 24, 0, 168),
    instrumentSupplierCap: numberEnv('PARTNER_REWARD_PAYMENT_INSTRUMENT_SUPPLIER_CAP', 2, 1, 20),
  };
}

function hashSecret() {
  const configured =
    process.env.PARTNER_ABUSE_HASH_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Partner abuse hash secret is required for payment evidence in production');
  }
  return 'eventflow-partner-reward-integrity-development-only';
}

function hashPaymentReference(kind, value) {
  if (!value) return null;
  return crypto
    .createHmac('sha256', hashSecret())
    .update(`partner-payment:${kind}:${String(value)}`)
    .digest('hex');
}

function objectId(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function fingerprintFromObject(value) {
  if (!value || typeof value !== 'object') return null;
  return (
    value.card?.fingerprint ||
    value.card_present?.fingerprint ||
    value.us_bank_account?.fingerprint ||
    value.bacs_debit?.fingerprint ||
    value.sepa_debit?.fingerprint ||
    value.generated_from?.payment_method_details?.card_present?.fingerprint ||
    null
  );
}

function paymentInstrumentEvidence(paymentIntent) {
  const paymentMethod = paymentIntent?.payment_method;
  const directFingerprint = fingerprintFromObject(paymentMethod);
  const chargeDetails =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge.payment_method_details
      : null;
  const chargeFingerprint = fingerprintFromObject(chargeDetails);
  const fingerprint = directFingerprint || chargeFingerprint;
  if (fingerprint) {
    return {
      kind: 'stripe-fingerprint',
      hash: hashPaymentReference('stripe-fingerprint', fingerprint),
      confidence: 'strong',
    };
  }
  const paymentMethodId = objectId(paymentMethod);
  if (paymentMethodId) {
    return {
      kind: 'stripe-payment-method-id',
      hash: hashPaymentReference('stripe-payment-method-id', paymentMethodId),
      confidence: 'moderate',
    };
  }
  return { kind: null, hash: null, confidence: 'none' };
}

function getEvidenceStripeClient() {
  if (evidenceStripeClient) return evidenceStripeClient;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  try {
    const stripeLib = require('stripe');
    evidenceStripeClient = stripeLib(secret, { apiVersion: '2025-12-15.clover' });
    return evidenceStripeClient;
  } catch (error) {
    logger.warn('[PARTNER-REWARD-INTEGRITY] Could not initialise Stripe evidence client', {
      error: error.message,
    });
    return null;
  }
}

async function enrichPaymentInstrument(paymentIntent) {
  if (!paymentIntent || paymentInstrumentEvidence(paymentIntent).confidence === 'strong') {
    return paymentIntent;
  }
  const client = getEvidenceStripeClient();
  if (!client) return paymentIntent;
  const enriched = { ...paymentIntent };

  try {
    if (typeof paymentIntent.payment_method === 'string' && client.paymentMethods?.retrieve) {
      enriched.payment_method = await client.paymentMethods.retrieve(paymentIntent.payment_method);
    }
  } catch (error) {
    logger.warn('[PARTNER-REWARD-INTEGRITY] PaymentMethod fingerprint enrichment failed', {
      paymentIntentId: paymentIntent.id,
      error: error.message,
    });
  }

  try {
    if (typeof paymentIntent.latest_charge === 'string' && client.charges?.retrieve) {
      enriched.latest_charge = await client.charges.retrieve(paymentIntent.latest_charge);
    }
  } catch (error) {
    logger.warn('[PARTNER-REWARD-INTEGRITY] Charge integrity enrichment failed', {
      paymentIntentId: paymentIntent.id,
      error: error.message,
    });
  }
  return enriched;
}

function localAdversePaymentEvidence(payments, paymentIntentId, supplierUserId) {
  const adverse = (payments || []).find(
    payment =>
      payment.userId === supplierUserId &&
      payment.stripePaymentId === paymentIntentId &&
      ['refunded', 'disputed', 'chargeback'].includes(payment.status)
  );
  if (!adverse) return { eligible: true };
  const reasonByStatus = {
    refunded: 'STRIPE_PAYMENT_REFUNDED',
    disputed: 'STRIPE_PAYMENT_DISPUTED',
    chargeback: 'STRIPE_PAYMENT_CHARGEBACK',
  };
  return {
    eligible: false,
    reason: reasonByStatus[adverse.status],
    evidence: { paymentId: adverse.id || null, status: adverse.status },
  };
}

function chargeAdverseEvidence(paymentIntent, minSubscriptionAmount) {
  const charge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge
      : null;
  if (!charge) return { eligible: true };
  if (charge.disputed === true) {
    return {
      eligible: false,
      reason: 'STRIPE_PAYMENT_DISPUTED',
      evidence: { chargeId: charge.id || null },
    };
  }
  const amountRefunded = Number(charge.amount_refunded || 0);
  const originalAmount = Number(charge.amount || paymentIntent.amount_received || 0);
  if (charge.refunded === true || (originalAmount > 0 && amountRefunded >= originalAmount)) {
    return {
      eligible: false,
      reason: 'STRIPE_PAYMENT_REFUNDED',
      evidence: { chargeId: charge.id || null },
    };
  }
  if (amountRefunded > 0 && originalAmount > 0) {
    const remaining = (originalAmount - amountRefunded) / 100;
    if (remaining < minSubscriptionAmount) {
      return {
        eligible: false,
        reason: 'SUBSCRIPTION_PAYMENT_AMOUNT_TOO_LOW_AFTER_REFUND',
        evidence: { chargeId: charge.id || null, remainingAmount: remaining },
      };
    }
  }
  return { eligible: true };
}

function storedEvidence(invoice) {
  const evidence = invoice?.partnerRewardPaymentEvidence;
  if (!evidence || typeof evidence !== 'object') return null;
  if (!evidence.capturedAt || evidence.paymentIntentStatus !== 'succeeded') return null;
  return evidence;
}

async function captureEvidence(invoice, subscription, payments = []) {
  const paymentIntentId = invoice?.stripePaymentIntentId;
  if (!paymentIntentId) {
    return { eligible: false, reason: 'STRIPE_PAYMENT_INTENT_MISSING' };
  }

  const localAdverse = localAdversePaymentEvidence(payments, paymentIntentId, invoice.userId);
  if (!localAdverse.eligible) return localAdverse;

  let paymentIntent;
  try {
    paymentIntent = await paymentService.getPaymentIntent(paymentIntentId);
  } catch (error) {
    const cached = storedEvidence(invoice);
    if (cached) return { eligible: true, evidence: cached, source: 'stored' };
    logger.warn('[PARTNER-REWARD-INTEGRITY] Stripe payment evidence lookup unavailable', {
      invoiceId: invoice.id,
      paymentIntentId,
      error: error.message,
    });
    return {
      eligible: false,
      reason: 'STRIPE_PAYMENT_EVIDENCE_UNAVAILABLE',
      evidence: { invoiceId: invoice.id },
    };
  }

  if (!paymentIntent || paymentIntent.status !== 'succeeded') {
    return {
      eligible: false,
      reason: 'STRIPE_PAYMENT_NOT_SUCCEEDED',
      evidence: { invoiceId: invoice.id, status: paymentIntent?.status || null },
    };
  }
  if (paymentIntent.livemode !== true) {
    return {
      eligible: false,
      reason: 'STRIPE_TEST_PAYMENT_NOT_ELIGIBLE',
      evidence: { invoiceId: invoice.id },
    };
  }

  const stripeCustomerId = objectId(paymentIntent.customer);
  if (
    stripeCustomerId &&
    subscription?.stripeCustomerId &&
    stripeCustomerId !== subscription.stripeCustomerId
  ) {
    return {
      eligible: false,
      reason: 'STRIPE_CUSTOMER_OWNERSHIP_MISMATCH',
      evidence: { invoiceId: invoice.id },
    };
  }

  const amountReceived = Number(paymentIntent.amount_received) / 100;
  const minimumAmount = baseIntegrity.getConfig().minSubscriptionAmount;
  if (!Number.isFinite(amountReceived) || amountReceived < minimumAmount) {
    return {
      eligible: false,
      reason: 'SUBSCRIPTION_PAYMENT_AMOUNT_TOO_LOW',
      evidence: {
        invoiceId: invoice.id,
        amountReceived: Number.isFinite(amountReceived) ? amountReceived : null,
      },
    };
  }

  const enrichedPaymentIntent = await enrichPaymentInstrument(paymentIntent);
  const adverseCharge = chargeAdverseEvidence(enrichedPaymentIntent, minimumAmount);
  if (!adverseCharge.eligible) return adverseCharge;

  const instrument = paymentInstrumentEvidence(enrichedPaymentIntent);
  const charge =
    enrichedPaymentIntent.latest_charge && typeof enrichedPaymentIntent.latest_charge === 'object'
      ? enrichedPaymentIntent.latest_charge
      : null;
  const evidence = {
    paymentIntentId,
    paymentIntentStatus: paymentIntent.status,
    livemode: true,
    stripeCustomerId: stripeCustomerId || subscription?.stripeCustomerId || null,
    stripeChargeId: charge?.id || objectId(paymentIntent.latest_charge),
    chargeDisputed: charge?.disputed === true,
    amountRefunded: Number(charge?.amount_refunded || 0) / 100,
    amountReceived,
    currency: paymentIntent.currency || invoice.currency || null,
    paymentInstrumentHash: instrument.hash,
    paymentInstrumentKind: instrument.kind,
    paymentInstrumentConfidence: instrument.confidence,
    capturedAt: new Date().toISOString(),
  };
  const updated = await dbUnified.updateOne(
    'invoices',
    { id: invoice.id },
    { $set: { partnerRewardPaymentEvidence: evidence } }
  );
  if (!updated) {
    return {
      eligible: false,
      reason: 'STRIPE_PAYMENT_EVIDENCE_PERSIST_FAILED',
      evidence: { invoiceId: invoice.id },
    };
  }
  return { eligible: true, evidence, source: 'stripe' };
}

async function subscriptionRewardEvidence(supplierUserId, invoiceId) {
  const config = getConfig();
  const [invoice, subscriptions, invoices, payments] = await Promise.all([
    dbUnified.findOne('invoices', { id: invoiceId }),
    dbUnified.read('subscriptions'),
    dbUnified.read('invoices'),
    dbUnified.read('payments'),
  ]);
  if (!invoice || invoice.userId !== supplierUserId || invoice.status !== 'paid') {
    return { eligible: false, reason: 'QUALIFYING_PAID_SUBSCRIPTION_INVOICE_MISSING' };
  }
  const subscription = (subscriptions || []).find(
    item => item.id === invoice.subscriptionId && item.userId === supplierUserId
  );
  if (!subscription || subscription.plan === 'free' || subscription.status !== 'active') {
    return { eligible: false, reason: 'ACTIVE_PAID_SUBSCRIPTION_MISSING' };
  }
  const paidAgeHours = baseIntegrity._test.hoursBetween(invoice.paidAt);
  if (paidAgeHours === null || paidAgeHours < config.settlementHours) {
    return {
      eligible: false,
      reason: 'SUBSCRIPTION_SETTLEMENT_WINDOW_NOT_MET',
      evidence: { invoiceId, paidAgeHours, requiredHours: config.settlementHours },
    };
  }

  const captured = await captureEvidence(invoice, subscription, payments);
  if (!captured.eligible) return captured;
  const evidence = captured.evidence;

  if (evidence.stripeCustomerId) {
    const customerUsers = new Set(
      (subscriptions || [])
        .filter(item => item.stripeCustomerId === evidence.stripeCustomerId && item.userId)
        .map(item => item.userId)
    );
    if (customerUsers.size > 1) {
      return {
        eligible: false,
        reason: 'STRIPE_CUSTOMER_REUSED_ACROSS_SUPPLIERS',
        evidence: { invoiceId, supplierCount: customerUsers.size },
      };
    }
  }

  if (evidence.paymentInstrumentHash) {
    const instrumentUsers = new Set(
      (invoices || [])
        .filter(
          item =>
            item.status === 'paid' &&
            item.userId &&
            item.partnerRewardPaymentEvidence?.paymentInstrumentHash ===
              evidence.paymentInstrumentHash
        )
        .map(item => item.userId)
    );
    instrumentUsers.add(supplierUserId);
    if (instrumentUsers.size > config.instrumentSupplierCap) {
      return {
        eligible: false,
        reason: 'PAYMENT_INSTRUMENT_REUSED_ACROSS_SUPPLIERS',
        evidence: {
          invoiceId,
          supplierCount: instrumentUsers.size,
          cap: config.instrumentSupplierCap,
          confidence: evidence.paymentInstrumentConfidence,
        },
      };
    }
  }

  return {
    eligible: true,
    invoiceId,
    paymentEvidence: evidence,
  };
}

function resetStripeClientForTests() {
  evidenceStripeClient = null;
}

module.exports = {
  getConfig,
  subscriptionRewardEvidence,
  _test: {
    hashPaymentReference,
    paymentInstrumentEvidence,
    fingerprintFromObject,
    objectId,
    localAdversePaymentEvidence,
    chargeAdverseEvidence,
    storedEvidence,
    captureEvidence,
    enrichPaymentInstrument,
    getEvidenceStripeClient,
    resetStripeClientForTests,
  },
};
