/**
 * Unit tests for Stripe promotion-code support and webhook route hardening.
 *
 * Verifies:
 * 1. Subscription checkout sessions include allow_promotion_codes: true
 *    (when no intro-pricing discount is pre-applied).
 * 2. Webhook handler is registered at both the canonical and compat alias paths.
 * 3. GET responders exist for both webhook paths.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readSrc(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
}

// ─── Promotion codes ──────────────────────────────────────────────────────────

describe('Stripe Checkout — allow_promotion_codes', () => {
  describe('routes/payments.js (v1 checkout)', () => {
    let src;
    beforeAll(() => {
      src = readSrc('routes', 'payments.js');
    });

    it('sets allow_promotion_codes to true in the subscription else-branch', () => {
      // The flag must be set when useIntroPricing is false
      expect(src).toContain('allow_promotion_codes = true');
    });

    it('only sets allow_promotion_codes when NOT using intro pricing', () => {
      // Verify it is inside the else branch of `if (useIntroPricing)`
      const elseIdx = src.indexOf('} else {\n          // Allow customers');
      expect(elseIdx).toBeGreaterThan(-1);
      const promoIdx = src.indexOf('allow_promotion_codes = true', elseIdx);
      expect(promoIdx).toBeGreaterThan(elseIdx);
    });

    it('does not assign allow_promotion_codes inside the intro-pricing block', () => {
      // The intro-pricing block applies discounts; allow_promotion_codes must only be
      // assigned in the else branch (i.e. after "} else {").
      // We verify this by confirming the assignment `sessionConfig.allow_promotion_codes = true`
      // does NOT appear before the else branch.
      const introPricingStart = src.indexOf('if (useIntroPricing) {');
      const elseIdx = src.indexOf('} else {\n          // Allow customers');
      expect(introPricingStart).toBeGreaterThan(-1);
      expect(elseIdx).toBeGreaterThan(introPricingStart);

      const introPricingBlock = src.substring(introPricingStart, elseIdx);
      // The assignment (not just a mention in a comment) must not appear before the else
      expect(introPricingBlock).not.toContain('sessionConfig.allow_promotion_codes');
    });
  });

  describe('routes/subscriptions-v2.js (v2 checkout session)', () => {
    let src;
    beforeAll(() => {
      src = readSrc('routes', 'subscriptions-v2.js');
    });

    it('includes allow_promotion_codes: true in the create-checkout-session config', () => {
      expect(src).toContain('allow_promotion_codes: true');
    });

    it('sets allow_promotion_codes before success_url in the session config', () => {
      const promoIdx = src.indexOf('allow_promotion_codes: true');
      const successIdx = src.indexOf('success_url: successUrl');
      expect(promoIdx).toBeGreaterThan(-1);
      expect(successIdx).toBeGreaterThan(promoIdx);
    });
  });
});

// ─── Webhook route hardening ──────────────────────────────────────────────────

describe('Stripe Webhook Routes — dual-path hardening', () => {
  let src;
  beforeAll(() => {
    src = readSrc('routes', 'subscriptions-v2.js');
  });

  it('registers POST /webhooks/stripe (canonical path)', () => {
    expect(src).toContain("router.post('/webhooks/stripe'");
  });

  it('registers POST /subscriptions/webhooks/stripe (compat alias)', () => {
    expect(src).toContain("router.post('/subscriptions/webhooks/stripe'");
  });

  it('both POST routes use the same shared handler function', () => {
    // Both routes must reference the named stripeWebhookHandler function
    const canonicalLine = src.match(/router\.post\('\/webhooks\/stripe'[^)]+stripeWebhookHandler/);
    const aliasLine = src.match(
      /router\.post\('\/subscriptions\/webhooks\/stripe'[^)]+stripeWebhookHandler/
    );
    expect(canonicalLine).not.toBeNull();
    expect(aliasLine).not.toBeNull();
  });

  it('registers GET /webhooks/stripe for browser-friendly info response', () => {
    expect(src).toContain("router.get('/webhooks/stripe'");
  });

  it('registers GET /subscriptions/webhooks/stripe for browser-friendly info response', () => {
    expect(src).toContain("router.get('/subscriptions/webhooks/stripe'");
  });

  it('defines a named stripeWebhookHandler function', () => {
    expect(src).toContain('async function stripeWebhookHandler(req, res)');
  });
});

// ─── Checkout session config logic (inline unit) ─────────────────────────────

describe('Checkout session config logic', () => {
  /**
   * Mirrors the logic in routes/payments.js for building sessionConfig
   * for a subscription checkout.
   */
  function buildSessionConfig({ useIntroPricing, introCouponId }) {
    const sessionConfig = {
      customer: 'cus_test',
      mode: 'subscription',
      line_items: [{ price: 'price_test', quantity: 1 }],
    };

    if (useIntroPricing) {
      sessionConfig.discounts = [{ coupon: introCouponId }];
      sessionConfig.metadata = { introPricing: 'true' };
    } else {
      sessionConfig.allow_promotion_codes = true;
    }

    return sessionConfig;
  }

  it('includes allow_promotion_codes when no intro coupon is active', () => {
    const cfg = buildSessionConfig({ useIntroPricing: false });
    expect(cfg.allow_promotion_codes).toBe(true);
    expect(cfg.discounts).toBeUndefined();
  });

  it('does not include allow_promotion_codes when a discount is pre-applied', () => {
    const cfg = buildSessionConfig({ useIntroPricing: true, introCouponId: 'coup_abc' });
    expect(cfg.allow_promotion_codes).toBeUndefined();
    expect(cfg.discounts).toEqual([{ coupon: 'coup_abc' }]);
  });

  it('never sets both discounts and allow_promotion_codes simultaneously', () => {
    const withIntro = buildSessionConfig({ useIntroPricing: true, introCouponId: 'coup_abc' });
    const noIntro = buildSessionConfig({ useIntroPricing: false });

    // With intro: has discounts, no promo flag
    expect(withIntro.discounts).toBeDefined();
    expect(withIntro.allow_promotion_codes).toBeUndefined();

    // Without intro: has promo flag, no discounts
    expect(noIntro.allow_promotion_codes).toBe(true);
    expect(noIntro.discounts).toBeUndefined();
  });
});
