'use strict';

const logger = require('../utils/logger');

let ensurePromise = null;

async function createIndexes(db) {
  const integrityEvents = db.collection('partner_reward_integrity_events');
  await integrityEvents.createIndex({ id: 1 }, { name: 'uniq_partner_reward_integrity_event', unique: true });
  await integrityEvents.createIndex({ partnerId: 1, lastSeenAt: -1 }, { name: 'partner_reward_integrity_partner_time' });
  await integrityEvents.createIndex({ supplierUserId: 1, lastSeenAt: -1 }, { name: 'partner_reward_integrity_supplier_time' });
  await integrityEvents.createIndex({ eventType: 1, reason: 1, lastSeenAt: -1 }, { name: 'partner_reward_integrity_reason_time' });

  const transactions = db.collection('partner_credit_transactions');
  await transactions.createIndex(
    { partnerId: 1, supplierUserId: 1, createdAt: -1 },
    { name: 'partner_reward_exposure_lookup' }
  );
  await transactions.createIndex({ maturesAt: 1 }, { name: 'partner_reward_explicit_maturity' });
  await transactions.createIndex({ reversedAt: 1 }, { name: 'partner_reward_reversal_lookup' });

  const referrals = db.collection('partner_referrals');
  await referrals.createIndex(
    { partnerId: 1, campaign: 1, createdAt: -1 },
    { name: 'partner_reward_campaign_velocity' }
  );

  const reviews = db.collection('reviews');
  await reviews.createIndex(
    { supplierId: 1, ipAddress: 1, createdAt: -1 },
    { name: 'partner_reward_review_network' }
  );

  const invoices = db.collection('invoices');
  await invoices.createIndex(
    { userId: 1, status: 1, paidAt: -1 },
    { name: 'partner_reward_paid_invoice_lookup' }
  );
  await invoices.createIndex(
    { 'partnerRewardPaymentEvidence.paymentInstrumentHash': 1, status: 1 },
    {
      name: 'partner_reward_payment_instrument',
      partialFilterExpression: {
        'partnerRewardPaymentEvidence.paymentInstrumentHash': { $type: 'string' },
      },
    }
  );

  const subscriptions = db.collection('subscriptions');
  await subscriptions.createIndex(
    { stripeCustomerId: 1, userId: 1 },
    {
      name: 'partner_reward_stripe_customer_lookup',
      partialFilterExpression: { stripeCustomerId: { $type: 'string' } },
    }
  );
}

async function ensureIndexes() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const { getDb } = require('../db');
    const db = await getDb();
    await createIndexes(db);
    logger.info('[PARTNER-REWARD-INTEGRITY] Reward integrity indexes ensured');
    return true;
  })().catch(error => {
    ensurePromise = null;
    logger.warn('[PARTNER-REWARD-INTEGRITY] Reward integrity index initialization failed', {
      error: error.message,
    });
    throw error;
  });
  return ensurePromise;
}

function resetForTests() {
  ensurePromise = null;
}

module.exports = { ensureIndexes, _test: { createIndexes, resetForTests } };
