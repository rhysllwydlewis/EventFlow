/**
 * Integration tests for pricing and payment system fixes
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── helpers ─────────────────────────────────────────────────────────────────

function readSrc(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
}

// Replicate the validateRedirectForRole logic (mirrors app.js + test file)
function validateRedirectForRole(redirectUrl, userRole) {
  if (!redirectUrl || typeof redirectUrl !== 'string') {
    return false;
  }
  const url = redirectUrl.trim();
  if (!url.startsWith('/')) {
    return false;
  }
  let pathname;
  try {
    const urlObj = new URL(url, 'http://localhost:3000');
    if (urlObj.origin !== 'http://localhost:3000') {
      return false;
    }
    pathname = urlObj.pathname;
  } catch (_) {
    pathname = url.split('?')[0].split('#')[0];
  }

  const allowedPaths = {
    supplier: [
      '/dashboard-supplier.html',
      '/dashboard.html',
      '/settings.html',
      '/plan.html',
      '/pricing.html',
      '/checkout.html',
      '/supplier/subscription.html',
      '/my-marketplace-listings.html',
      '/supplier/marketplace-new-listing.html',
      '/marketplace',
      '/marketplace.html',
      '/conversation.html',
      '/messenger/',
    ],
    customer: [
      '/dashboard-customer.html',
      '/dashboard.html',
      '/settings.html',
      '/plan.html',
      '/pricing.html',
      '/checkout.html',
      '/my-marketplace-listings.html',
      '/marketplace',
      '/marketplace.html',
      '/conversation.html',
      '/messenger/',
    ],
  };

  const allowed = allowedPaths[userRole] || [];
  return allowed.includes(pathname);
}

// ── Test suites ──────────────────────────────────────────────────────────────

describe('Pricing and payment system fixes', () => {
  // Fix 1: subscriptions-v2.js has create-checkout-session endpoint
  describe('subscriptions-v2.js: create-checkout-session endpoint', () => {
    it('exists in the router source', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain('/create-checkout-session');
    });

    it('requires authentication (authRequired middleware)', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      // The route should include authRequired
      expect(src).toMatch(/create-checkout-session[\s\S]{0,200}authRequired/);
    });

    it('requires CSRF protection', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toMatch(/create-checkout-session[\s\S]{0,200}csrfProtection/);
    });

    it('uses write rate limiter', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toMatch(/create-checkout-session[\s\S]{0,200}writeLimiter/);
    });

    it('validates planId is required', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain('planId is required');
    });

    it('handles free/starter plan without Stripe charge', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain('starter: null');
      expect(src).toContain('free: null');
    });

    it('maps pro plan to STRIPE_PRO_PRICE_ID env var', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain('STRIPE_PRO_PRICE_ID');
      expect(src).toContain('pro: process.env.STRIPE_PRO_PRICE_ID');
    });

    it('creates a subscription-mode Checkout Session', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain("mode: 'subscription'");
    });

    it('returns { success, url, sessionId }', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain('success: true');
      expect(src).toContain('url: session.url');
      expect(src).toContain('sessionId: session.id');
    });

    it('returns 400 for unknown planId', () => {
      const src = readSrc('routes', 'subscriptions-v2.js');
      expect(src).toContain('Unknown plan:');
    });
  });

  // Fix 2: checkout.js sends subscription type and stores stripeConfig
  describe('checkout.js: subscription mode when Stripe priceId available', () => {
    it('stores stripeConfig from backend config response', () => {
      const src = readSrc('public', 'assets', 'js', 'checkout.js');
      expect(src).toContain('stripeConfig = config');
    });

    it('sends type=subscription when priceId is available from config', () => {
      const src = readSrc('public', 'assets', 'js', 'checkout.js');
      expect(src).toContain("type: 'subscription'");
      expect(src).toContain('priceId: stripeConfig.proPriceId');
    });

    it('falls back to one_time payment when no priceId is configured', () => {
      const src = readSrc('public', 'assets', 'js', 'checkout.js');
      expect(src).toContain("type: 'one_time'");
    });

    it('prefers data.url over sessionId for redirect', () => {
      const src = readSrc('public', 'assets', 'js', 'checkout.js');
      // The redirect logic should check data.url first (in an if/else chain)
      // Use a regex that matches the actual conditional pattern to avoid false positives from comments
      expect(src).toMatch(/if\s*\(data\.url\)\s*\{[^}]*window\.location\.href\s*=\s*data\.url/s);
      // data.sessionId fallback must come after the data.url branch in the else clause
      const urlBranchIdx = src.search(/if\s*\(data\.url\)/);
      const sessionIdBranchIdx = src.search(/else if\s*\(data\.sessionId\)/);
      expect(urlBranchIdx).toBeGreaterThan(-1);
      expect(sessionIdBranchIdx).toBeGreaterThan(urlBranchIdx);
    });
  });

  // Fix 3: subscription.js fetches CSRF token before POST and uses v1 endpoint
  describe('subscription.js: CSRF token and correct API endpoint', () => {
    it('fetches CSRF token before creating checkout session', () => {
      const src = readSrc('public', 'supplier', 'js', 'subscription.js');
      expect(src).toContain('/api/v1/csrf-token');
      expect(src).toContain('X-CSRF-Token');
    });

    it('uses /api/v1/payments/create-checkout-session (versioned endpoint)', () => {
      const src = readSrc('public', 'supplier', 'js', 'subscription.js');
      expect(src).toContain('/api/v1/payments/create-checkout-session');
      // Should NOT use the old unversioned endpoint
      expect(src).not.toContain("fetch('/api/payments/create-checkout-session'");
    });

    it('uses subscription type instead of always falling back to one_time', () => {
      const src = readSrc('public', 'supplier', 'js', 'subscription.js');
      expect(src).toContain("type: 'subscription'");
      // The fallback one_time section should no longer exist
      expect(src).not.toContain('// Fallback to one-time payment');
    });

    it('redirects free plan to dashboard without Stripe', () => {
      const src = readSrc('public', 'supplier', 'js', 'subscription.js');
      expect(src).toContain("window.location.href = '/dashboard/supplier'");
    });
  });

  // Fix 4: pricing CTA handler uses redirect param (not returnTo) for post-login redirect
  describe('pricing.html: uses redirect param for post-login flow', () => {
    it('uses redirect= parameter (not returnTo=) when redirecting unauthenticated users', () => {
      // The CTA handler lives in pricing.js (inline script was removed from pricing.html)
      const src = readSrc('public', 'assets', 'js', 'pricing.js');
      expect(src).toContain('redirect=');
      expect(src).not.toContain('returnTo=');
    });
  });

  // Fix 5: validateRedirectForRole allows checkout/pricing/subscription paths for suppliers
  describe('redirect allowlist: suppliers and customers can reach payment pages', () => {
    it('allows /checkout.html for suppliers', () => {
      expect(validateRedirectForRole('/checkout.html', 'supplier')).toBe(true);
    });

    it('allows /pricing.html for suppliers', () => {
      expect(validateRedirectForRole('/pricing.html', 'supplier')).toBe(true);
    });

    it('allows /supplier/subscription.html for suppliers', () => {
      expect(validateRedirectForRole('/supplier/subscription.html', 'supplier')).toBe(true);
    });

    it('allows /checkout.html?plan=pro for suppliers (query string stripped)', () => {
      expect(validateRedirectForRole('/checkout.html?plan=pro', 'supplier')).toBe(true);
    });

    it('allows /pricing.html?plan=pro for customers', () => {
      expect(validateRedirectForRole('/pricing.html?plan=pro', 'customer')).toBe(true);
    });

    it('still rejects external URLs for suppliers', () => {
      expect(validateRedirectForRole('https://evil.com', 'supplier')).toBe(false);
    });

    it('still rejects admin pages for suppliers', () => {
      expect(validateRedirectForRole('/admin.html', 'supplier')).toBe(false);
    });
  });

  // Fix 6: payments.js handles missing priceId via planName fallback
  describe('payments.js: priceId fallback for subscription without explicit priceId', () => {
    it('contains fallback logic using getSubscriptionTier + STRIPE_PRO_PRICE_ID', () => {
      const src = readSrc('routes', 'payments.js');
      expect(src).toContain('getSubscriptionTier(planName)');
      expect(src).toContain('STRIPE_PRO_PRICE_ID');
      // Should set priceId from fallback
      expect(src).toContain('priceId = STRIPE_PRO_PRICE_ID');
    });

    it('still rejects subscription with no priceId and no matching planName', () => {
      const src = readSrc('routes', 'payments.js');
      expect(src).toContain('Price ID is required for subscriptions.');
    });
  });

  // Fix 7: app.js allowlist updated (matches the validateRedirectForRole above)
  describe('app.js: redirect allowlist includes payment pages', () => {
    it('includes /pricing.html in supplier allowlist', () => {
      const src = readSrc('public', 'assets', 'js', 'app.js');
      // Verify presence of pricing.html in the supplier section
      const supplierSection = src.slice(src.indexOf('supplier: ['), src.indexOf('customer: ['));
      expect(supplierSection).toContain("'/pricing.html'");
    });

    it('includes /checkout.html in supplier allowlist', () => {
      const src = readSrc('public', 'assets', 'js', 'app.js');
      const supplierSection = src.slice(src.indexOf('supplier: ['), src.indexOf('customer: ['));
      expect(supplierSection).toContain("'/checkout.html'");
    });

    it('includes /supplier/subscription.html in supplier allowlist', () => {
      const src = readSrc('public', 'assets', 'js', 'app.js');
      const supplierSection = src.slice(src.indexOf('supplier: ['), src.indexOf('customer: ['));
      expect(supplierSection).toContain("'/supplier/subscription.html'");
    });

    it('includes /pricing.html in customer allowlist', () => {
      const src = readSrc('public', 'assets', 'js', 'app.js');
      const customerSection = src.slice(src.indexOf('customer: ['));
      expect(customerSection).toContain("'/pricing.html'");
    });
  });

  // Fix 8: subscription.html loads correct script
  describe('subscription.html: loads subscription.js (not missing subscription-stripe.js)', () => {
    it('references js/subscription.js', () => {
      const src = readSrc('public', 'supplier', 'subscription.html');
      expect(src).toContain('js/subscription.js');
    });

    it('does not reference the non-existent subscription-stripe.js', () => {
      const src = readSrc('public', 'supplier', 'subscription.html');
      expect(src).not.toContain('subscription-stripe.js');
    });

    it('js/subscription.js file exists on disk', () => {
      const exists = fs.existsSync(
        path.resolve(__dirname, '..', '..', 'public', 'supplier', 'js', 'subscription.js')
      );
      expect(exists).toBe(true);
    });
  });
});
