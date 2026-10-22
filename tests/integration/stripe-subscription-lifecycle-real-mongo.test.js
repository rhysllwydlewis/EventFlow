'use strict';

/**
 * A paid supplier's subscription through the webhook events Stripe sends, in a REAL MongoDB: start
 * (checkout completed), a failed payment, recovery, cancellation scheduled, and the end of the
 * subscription, each as the event objects Stripe documents. It checks what the dashboard's plan card
 * reads (plan, status, period end, the Stripe id) after each step, that a repeated event changes
 * nothing, and that after the end the account cannot upgrade without paying (the route answers
 * CHECKOUT_REQUIRED).
 *
 * The signature check is covered by tests/unit/stripe-webhook-reliability.test.js; this starts at
 * the verified event. Runs in the replica-set CI job (MONGO_REPLICA_SET=true).
 */

const { MongoClient } = require('mongodb');

const describeRealMongo = process.env.MONGO_REPLICA_SET === 'true' ? describe : describe.skip;
const DB_NAME = `eventflow_stripe_${process.pid}_${Date.now()}`;
const USER_ID = 'user_stripe_1';
const NOW = Math.floor(Date.now() / 1000);
const PERIOD_END = NOW + 30 * 86400;

const event = (id, type, object) => ({ id, type, data: { object } });

describeRealMongo('subscription lifecycle from Stripe events (real MongoDB)', () => {
  let client;
  let raw;
  let webhook;
  let subscriptionService;

  const record = () => raw.collection('subscriptions').findOne({ userId: USER_ID });

  beforeAll(async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eventflow?replicaSet=rs0';
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    raw = client.db(DB_NAME);
    process.env.MONGODB_URI = uri.replace(/\/[^/?]*(\?|$)/, `/${DB_NAME}$1`);
    process.env.MONGODB_DB_NAME = DB_NAME;
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_lifecycle';
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_monthly';
    process.env.STRIPE_PRO_PLUS_PRICE_ID = 'price_pro_plus_monthly';
    jest.resetModules();
    const dbUnified = require('../../db-unified');
    await dbUnified.initializeDatabase();
    webhook = require('../../webhooks/stripeWebhookHandler');
    subscriptionService = require('../../services/subscriptionService');
    await raw.collection('users').insertOne({
      id: USER_ID,
      email: 'lifecycle@example.com',
      name: 'Lifecycle Supplier',
      role: 'supplier',
      verified: true,
      subscriptionTier: 'free',
    });
    await raw.collection('suppliers').insertOne({
      id: 'sup_stripe_1',
      ownerUserId: USER_ID,
      name: 'Lifecycle Ltd',
      approved: true,
    });
  }, 60000);

  afterAll(async () => {
    if (raw) {
      await raw.dropDatabase();
    }
    if (client) {
      await client.close();
    }
  });

  it('a completed checkout starts a live Pro subscription', async () => {
    await webhook.processWebhookEvent(
      event('evt_1', 'checkout.session.completed', {
        id: 'cs_1',
        mode: 'subscription',
        customer: 'cus_1',
        subscription: 'sub_1',
        client_reference_id: USER_ID,
        metadata: { userId: USER_ID, planId: 'pro' },
      })
    );
    const sub = await record();
    expect(sub).toMatchObject({ plan: 'pro', stripeSubscriptionId: 'sub_1' });
    expect(subscriptionService.isLiveEntitlement(sub)).toBe(true);
    const user = await raw.collection('users').findOne({ id: USER_ID });
    expect(user.subscriptionTier).toBe('pro');
  });

  it('the same event delivered again changes nothing', async () => {
    const before = await record();
    await webhook.processWebhookEvent(
      event('evt_1', 'checkout.session.completed', {
        id: 'cs_1',
        mode: 'subscription',
        customer: 'cus_1',
        subscription: 'sub_1',
        client_reference_id: USER_ID,
        metadata: { userId: USER_ID, planId: 'pro_plus' },
      })
    );
    expect(await raw.collection('subscriptions').countDocuments({ userId: USER_ID })).toBe(1);
    expect((await record()).plan).toBe(before.plan);
  });

  it('a failed payment marks the subscription past due, and a successful one recovers it', async () => {
    await webhook.processWebhookEvent(
      event('evt_2', 'invoice.payment_failed', {
        id: 'in_1',
        subscription: 'sub_1',
        customer: 'cus_1',
        amount_due: 1500,
        currency: 'gbp',
        attempt_count: 1,
        next_payment_attempt: NOW + 3 * 86400,
      })
    );
    expect((await record()).status).toBe('past_due');

    await webhook.processWebhookEvent(
      event('evt_3', 'invoice.payment_succeeded', {
        id: 'in_2',
        subscription: 'sub_1',
        customer: 'cus_1',
        amount_paid: 1500,
        currency: 'gbp',
        total: 1500,
        period_end: PERIOD_END,
        lines: { data: [{ period: { start: NOW, end: PERIOD_END } }] },
      })
    );
    expect((await record()).status).toBe('active');
  });

  it('scheduling a cancellation keeps the plan live until the period ends', async () => {
    await webhook.processWebhookEvent(
      event('evt_4', 'customer.subscription.updated', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: true,
        current_period_end: PERIOD_END,
        metadata: { userId: USER_ID, planId: 'pro', downgrade_to: 'free' },
        items: { data: [{ price: { id: 'price_pro_monthly' } }] },
      })
    );
    const sub = await record();
    expect(sub.plan).toBe('pro');
    expect(subscriptionService.isLiveEntitlement(sub)).toBe(true);
  });

  it('the end of the subscription leaves a free account that cannot upgrade without paying', async () => {
    await webhook.processWebhookEvent(
      event('evt_5', 'customer.subscription.deleted', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'canceled',
        metadata: { userId: USER_ID, planId: 'pro', downgrade_to: 'free' },
      })
    );
    const sub = await record();
    expect(sub.plan).toBe('free');
    expect(sub.status).toBe('canceled');
    const user = await raw.collection('users').findOne({ id: USER_ID });
    expect(user.subscriptionTier).toBe('free');

    // Upgrading from here must go through checkout: nothing is being billed.
    const express = require('express');
    const request = require('supertest');
    jest.doMock('../../middleware/auth', () => ({
      authRequired: (req, _res, next) => {
        req.user = { id: USER_ID, role: 'supplier' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_r, _s, n) => n() }));
    jest.doMock('../../middleware/rateLimits', () => ({ writeLimiter: (_r, _s, n) => n() }));
    jest.doMock('stripe', () => jest.fn(() => ({})));
    const router = require('../../routes/subscriptions-v2');
    const app = express();
    app.use(express.json());
    app.use('/api/v2/subscriptions', router);
    const response = await request(app)
      .post(`/api/v2/subscriptions/${sub.id}/upgrade`)
      .send({ planId: 'pro_plus' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CHECKOUT_REQUIRED');
    expect((await record()).plan).toBe('free');
  });

  it('a scheduled downgrade that completes leaves a plan with no Stripe subscription, which cannot be upgraded for free', async () => {
    const otherUser = 'user_stripe_2';
    await raw.collection('users').insertOne({
      id: otherUser,
      email: 'downgrade@example.com',
      name: 'Downgrading Supplier',
      role: 'supplier',
      verified: true,
      subscriptionTier: 'pro_plus',
    });
    await raw.collection('subscriptions').insertOne({
      id: 'subrec_2',
      userId: otherUser,
      plan: 'pro_plus',
      status: 'active',
      stripeSubscriptionId: 'sub_2',
      stripeCustomerId: 'cus_2',
      pendingPlan: 'pro',
      currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
    });
    await webhook.processWebhookEvent(
      event('evt_6', 'customer.subscription.deleted', {
        id: 'sub_2',
        customer: 'cus_2',
        status: 'canceled',
      })
    );
    const after = await raw.collection('subscriptions').findOne({ userId: otherUser });
    expect(after).toMatchObject({ plan: 'pro', status: 'active', stripeSubscriptionId: null });

    const express = require('express');
    const request = require('supertest');
    jest.resetModules();
    jest.doMock('../../middleware/auth', () => ({
      authRequired: (req, _res, next) => {
        req.user = { id: otherUser, role: 'supplier' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_r, _s, n) => n() }));
    jest.doMock('../../middleware/rateLimits', () => ({ writeLimiter: (_r, _s, n) => n() }));
    jest.doMock('stripe', () => jest.fn(() => ({})));
    const router = require('../../routes/subscriptions-v2');
    const app = express();
    app.use(express.json());
    app.use('/api/v2/subscriptions', router);
    const response = await request(app)
      .post(`/api/v2/subscriptions/${after.id}/upgrade`)
      .send({ planId: 'pro_plus' });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CHECKOUT_REQUIRED');
    expect((await raw.collection('subscriptions').findOne({ userId: otherUser })).plan).toBe('pro');
  });
});
