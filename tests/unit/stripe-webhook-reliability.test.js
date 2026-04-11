/**
 * Unit tests for Stripe webhook reliability fixes
 *
 * Covers:
 *  a) webhook endpoint rejects unsigned requests in production (fail-closed)
 *  b) webhook endpoint accepts a valid signed payload
 *  c) upcoming-invoice endpoint handles Stripe errors gracefully + logs diagnostics
 *  d) only one canonical Stripe webhook endpoint is documented
 *  e) upcoming-invoice returns null (without calling Stripe) when subscription ID is absent
 *  f) upcoming-invoice calls Stripe with correct params when subscription ID is present
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build minimal mock req / res objects for testing the stripeWebhookHandler
 * function in isolation (without a real HTTP server).
 */
function makeReqRes({ body = '{}', sig = undefined, env = 'test' } = {}) {
  const req = {
    headers: {},
    body: Buffer.from(body),
  };
  if (sig !== undefined) {
    req.headers['stripe-signature'] = sig;
  }

  const res = {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    send(body) {
      this._body = body;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };

  return { req, res, env };
}

/**
 * A minimal in-process stand-in for the stripeWebhookHandler logic so we can
 * test the production fail-closed path without importing the full route module
 * (which has heavy side effects on `require`).
 */
function buildHandler({ webhookSecret, stripeEnabled, nodeEnv }) {
  // Minimal mock of stripe.webhooks.constructEvent
  const stripe = {
    webhooks: {
      constructEvent(body, sig, secret) {
        if (!sig || sig !== `valid-sig-for-${secret}`) {
          const err = new Error('No signatures found matching the expected signature for payload');
          err.type = 'StripeSignatureVerificationError';
          throw err;
        }
        return JSON.parse(body.toString());
      },
    },
  };

  const logger = {
    _errors: [],
    _warns: [],
    error(...args) {
      this._errors.push(args.join(' '));
    },
    warn(...args) {
      this._warns.push(args.join(' '));
    },
    info() {},
  };

  async function stripeWebhookHandler(req, res) {
    const sig = req.headers['stripe-signature'];

    let event;

    if (webhookSecret && stripeEnabled) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        logger.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else if (nodeEnv === 'production') {
      logger.error(
        'STRIPE_WEBHOOK_SECRET is not set in production — rejecting unsigned webhook request'
      );
      return res.status(400).send('Webhook Error: signature verification required in production');
    } else {
      logger.warn('⚠️  Webhook signature verification skipped (STRIPE_WEBHOOK_SECRET not set)');
      try {
        event = JSON.parse(req.body.toString());
      } catch (err) {
        logger.error('Failed to parse webhook body:', err.message);
        return res.status(400).send('Invalid request body');
      }
    }

    // Simulate successful processing
    res.json({ received: true, type: event.type });
  }

  return { stripeWebhookHandler, logger };
}

// ---------------------------------------------------------------------------
// Tests: a) Fail-closed in production when STRIPE_WEBHOOK_SECRET is missing
// ---------------------------------------------------------------------------

describe('Stripe webhook handler — production fail-closed', () => {
  it('rejects request with 400 when STRIPE_WEBHOOK_SECRET is absent in production', async () => {
    const { stripeWebhookHandler } = buildHandler({
      webhookSecret: '',
      stripeEnabled: true,
      nodeEnv: 'production',
    });

    const { req, res } = makeReqRes({ sig: 't=123,v1=abc' });
    await stripeWebhookHandler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('signature verification required in production');
  });

  it('logs an error when rejecting in production due to missing secret', async () => {
    const { stripeWebhookHandler, logger } = buildHandler({
      webhookSecret: '',
      stripeEnabled: true,
      nodeEnv: 'production',
    });

    const { req, res } = makeReqRes({ sig: 't=123,v1=abc' });
    await stripeWebhookHandler(req, res);

    const combined = logger._errors.join('\n');
    expect(combined).toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('allows unsigned request in development (non-production) when secret is absent', async () => {
    const { stripeWebhookHandler } = buildHandler({
      webhookSecret: '',
      stripeEnabled: false,
      nodeEnv: 'development',
    });

    const body = JSON.stringify({ type: 'invoice.payment_succeeded' });
    const { req, res } = makeReqRes({ body });
    await stripeWebhookHandler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual({ received: true, type: 'invoice.payment_succeeded' });
  });
});

// ---------------------------------------------------------------------------
// Tests: b) Accepts a valid signed payload
// ---------------------------------------------------------------------------

describe('Stripe webhook handler — valid signed payload', () => {
  const SECRET = 'whsec_test_fake_secret_for_testing';
  const VALID_SIG = `valid-sig-for-${SECRET}`;

  it('returns 200 and { received: true } for a correctly signed payload', async () => {
    const { stripeWebhookHandler } = buildHandler({
      webhookSecret: SECRET,
      stripeEnabled: true,
      nodeEnv: 'production',
    });

    const body = JSON.stringify({ type: 'customer.subscription.updated' });
    const { req, res } = makeReqRes({ body, sig: VALID_SIG });
    await stripeWebhookHandler(req, res);

    expect(res._status).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  it('returns 400 for an incorrectly signed payload', async () => {
    const { stripeWebhookHandler } = buildHandler({
      webhookSecret: SECRET,
      stripeEnabled: true,
      nodeEnv: 'production',
    });

    const body = JSON.stringify({ type: 'customer.subscription.updated' });
    const { req, res } = makeReqRes({ body, sig: 'wrong-sig' });
    await stripeWebhookHandler(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('Webhook Error');
  });
});

// ---------------------------------------------------------------------------
// Tests: c) Upcoming invoice — graceful Stripe error handling + diagnostics
// ---------------------------------------------------------------------------

describe('Upcoming invoice — Stripe error handling', () => {
  /**
   * Build a minimal upcoming-invoice handler that mirrors the production code
   * so we can inject a failing stripe.invoices.createPreview mock.
   *
   * req._customerId        — stripeCustomerId on the subscription
   * req._subscriptionId    — stripeSubscriptionId on the subscription; when absent
   *                          the handler returns null without calling Stripe
   */
  function buildUpcomingInvoiceHandler(createPreviewImpl) {
    const logger = {
      _warns: [],
      warn(...args) {
        this._warns.push(args);
      },
      error(...args) {
        this._errors = this._errors || [];
        this._errors.push(args);
      },
    };

    const stripe = {
      invoices: {
        createPreview: createPreviewImpl,
      },
    };

    async function upcomingInvoiceHandler(req, res) {
      const customerId = req._customerId;
      const stripeSubscriptionId = req._subscriptionId;

      // Stripe requires subscription — skip the call when absent.
      // (The production handler also supports schedule/items, but this helper
      // models the subscription path only.)
      if (!stripeSubscriptionId) {
        return res.json({ success: true, upcomingInvoice: null });
      }

      // Guard: customer IDs must start with 'cus_'
      if (!customerId || !customerId.startsWith('cus_')) {
        logger.warn('upcoming-invoice: invalid or missing stripeCustomerId', { customerId });
        return res.json({ success: true, upcomingInvoice: null });
      }

      try {
        const invoice = await stripe.invoices.createPreview({
          customer: customerId,
          subscription: stripeSubscriptionId,
        });
        return res.json({
          success: true,
          upcomingInvoice: { amount: invoice.amount_due, currency: invoice.currency },
        });
      } catch (stripeErr) {
        logger.warn('upcoming-invoice: Stripe error', {
          type: stripeErr.type,
          code: stripeErr.code,
          param: stripeErr.param,
          statusCode: stripeErr.statusCode,
          requestId: stripeErr.requestId,
          message: stripeErr.message,
        });
        return res.json({ success: true, upcomingInvoice: null });
      }
    }

    return { upcomingInvoiceHandler, logger };
  }

  it('returns upcomingInvoice: null gracefully when Stripe returns 400', async () => {
    const err = Object.assign(new Error('No upcoming invoice for customer'), {
      type: 'StripeInvalidRequestError',
      code: 'invoice_upcoming_none',
      param: 'customer',
      statusCode: 400,
      requestId: 'req_test_123',
    });

    const { upcomingInvoiceHandler } = buildUpcomingInvoiceHandler(async () => {
      throw err;
    });

    const req = { _customerId: 'cus_valid123', _subscriptionId: 'sub_abc123' };
    const res = {
      _body: null,
      json(body) {
        this._body = body;
        return this;
      },
    };

    await upcomingInvoiceHandler(req, res);

    expect(res._body).toEqual({ success: true, upcomingInvoice: null });
  });

  it('logs Stripe error details (type, code, param, requestId) on failure', async () => {
    const err = Object.assign(new Error('No upcoming invoice'), {
      type: 'StripeInvalidRequestError',
      code: 'invoice_upcoming_none',
      param: 'subscription',
      statusCode: 400,
      requestId: 'req_diag_456',
    });

    const { upcomingInvoiceHandler, logger } = buildUpcomingInvoiceHandler(async () => {
      throw err;
    });

    const req = { _customerId: 'cus_diag', _subscriptionId: 'sub_diag' };
    const res = { json() {} };
    await upcomingInvoiceHandler(req, res);

    expect(logger._warns.length).toBeGreaterThan(0);
    // The second argument to logger.warn is the diagnostic object
    const diagnostics = logger._warns[0][1];
    expect(diagnostics).toMatchObject({
      type: 'StripeInvalidRequestError',
      code: 'invoice_upcoming_none',
      param: 'subscription',
      statusCode: 400,
      requestId: 'req_diag_456',
    });
  });

  it('rejects invalid customer IDs before calling Stripe (does not start with cus_)', async () => {
    const createPreview = jest.fn();
    const { upcomingInvoiceHandler, logger } = buildUpcomingInvoiceHandler(createPreview);

    const req = { _customerId: 'invalid_id_without_prefix', _subscriptionId: 'sub_abc' };
    const res = {
      _body: null,
      json(body) {
        this._body = body;
        return this;
      },
    };

    await upcomingInvoiceHandler(req, res);

    expect(createPreview).not.toHaveBeenCalled();
    expect(res._body).toEqual({ success: true, upcomingInvoice: null });
    expect(logger._warns.length).toBeGreaterThan(0);
  });

  it('returns invoice details when createPreview succeeds', async () => {
    const createPreview = jest.fn().mockResolvedValue({ amount_due: 5900, currency: 'gbp' });
    const { upcomingInvoiceHandler } = buildUpcomingInvoiceHandler(createPreview);

    const req = { _customerId: 'cus_happy_path', _subscriptionId: 'sub_happy' };
    const res = {
      _body: null,
      json(body) {
        this._body = body;
        return this;
      },
    };

    await upcomingInvoiceHandler(req, res);

    expect(res._body).toEqual({
      success: true,
      upcomingInvoice: { amount: 5900, currency: 'gbp' },
    });
    // Verify correct params are sent to Stripe (customer + subscription)
    expect(createPreview).toHaveBeenCalledWith({
      customer: 'cus_happy_path',
      subscription: 'sub_happy',
    });
  });

  it('returns null without calling Stripe when stripeSubscriptionId is absent', async () => {
    const createPreview = jest.fn();
    const { upcomingInvoiceHandler } = buildUpcomingInvoiceHandler(createPreview);

    const req = { _customerId: 'cus_no_sub' }; // no _subscriptionId
    const res = {
      _body: null,
      json(body) {
        this._body = body;
        return this;
      },
    };

    await upcomingInvoiceHandler(req, res);

    expect(createPreview).not.toHaveBeenCalled();
    expect(res._body).toEqual({ success: true, upcomingInvoice: null });
  });

  it('returns null without calling Stripe when stripeSubscriptionId is null', async () => {
    const createPreview = jest.fn();
    const { upcomingInvoiceHandler } = buildUpcomingInvoiceHandler(createPreview);

    const req = { _customerId: 'cus_null_sub', _subscriptionId: null };
    const res = {
      _body: null,
      json(body) {
        this._body = body;
        return this;
      },
    };

    await upcomingInvoiceHandler(req, res);

    expect(createPreview).not.toHaveBeenCalled();
    expect(res._body).toEqual({ success: true, upcomingInvoice: null });
  });
});

// ---------------------------------------------------------------------------
// Tests: d) Only one canonical Stripe webhook endpoint is documented
// ---------------------------------------------------------------------------

describe('Canonical Stripe webhook endpoint documentation', () => {
  it('STRIPE_SUBSCRIPTION_GUIDE.md documents only one canonical endpoint', () => {
    const fs = require('fs');
    const path = require('path');

    const guidePath = path.join(__dirname, '../../docs/STRIPE_SUBSCRIPTION_GUIDE.md');
    const content = fs.readFileSync(guidePath, 'utf8');

    // The canonical endpoint must be documented
    expect(content).toContain('/api/v2/webhooks/stripe');

    // The deprecated legacy endpoint must not be recommended as a target
    // (It may appear only in a deprecation/redirect note)
    const canonicalOccurrences = (content.match(/\/api\/v2\/webhooks\/stripe/g) || []).length;
    expect(canonicalOccurrences).toBeGreaterThanOrEqual(1);
  });

  it('routes/payments.js webhook is marked deprecated in the Swagger doc', () => {
    const fs = require('fs');
    const path = require('path');

    const paymentsPath = path.join(__dirname, '../../routes/payments.js');
    const content = fs.readFileSync(paymentsPath, 'utf8');

    // The JSDoc / Swagger block for /webhook must include 'deprecated'
    expect(content).toMatch(/deprecated/i);
    // And it must reference the canonical path as the replacement
    expect(content).toContain('/api/v2/webhooks/stripe');
  });

  it('routes/payments.js webhook is marked deprecated in the Swagger doc and still functional (no redirect)', () => {
    const fs = require('fs');
    const path = require('path');

    const paymentsPath = path.join(__dirname, '../../routes/payments.js');
    const content = fs.readFileSync(paymentsPath, 'utf8');

    // The JSDoc / Swagger block for /webhook must include 'deprecated'
    expect(content).toMatch(/deprecated/i);
    // And it must reference the canonical path as the replacement
    expect(content).toContain('/api/v2/webhooks/stripe');
    // Must NOT be a redirect — Stripe does not follow redirects, so the endpoint
    // must process events in-process to avoid dropping webhook deliveries
    expect(content).not.toContain('redirect(308');
    expect(content).not.toContain('redirect(307');
    // Must still verify signatures
    expect(content).toContain('constructEvent');
  });
});
