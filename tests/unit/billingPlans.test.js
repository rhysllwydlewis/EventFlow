'use strict';

function loadBillingPlansWithEnv(env = {}) {
  jest.resetModules();
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...env };
  const billingPlans = require('../../config/billingPlans');
  process.env = originalEnv;
  return billingPlans;
}

describe('billingPlans canonical registry', () => {
  it('resolves pro_plus to its own Stripe price instead of falling back to pro', () => {
    const { resolvePriceIdForRequest } = loadBillingPlansWithEnv({
      STRIPE_PRO_PRICE_ID: 'price_pro_monthly',
      STRIPE_PRO_PLUS_PRICE_ID: 'price_pro_plus_monthly',
    });

    expect(resolvePriceIdForRequest('pro_plus')).toEqual(
      expect.objectContaining({
        planId: 'pro_plus',
        billingInterval: 'month',
        priceId: 'price_pro_plus_monthly',
      })
    );
  });

  it('normalises yearly aliases without trusting client supplied price IDs', () => {
    const { resolvePriceIdForRequest } = loadBillingPlansWithEnv({
      STRIPE_PRO_YEARLY_PRICE_ID: 'price_pro_yearly',
    });

    expect(resolvePriceIdForRequest('pro_yearly')).toEqual(
      expect.objectContaining({
        planId: 'pro',
        billingInterval: 'year',
        priceId: 'price_pro_yearly',
      })
    );
  });

  it('honours explicit billingInterval for generic canonical plan identifiers', () => {
    const { resolvePriceIdForRequest } = loadBillingPlansWithEnv({
      STRIPE_PRO_PRICE_ID: 'price_pro_monthly',
      STRIPE_PRO_YEARLY_PRICE_ID: 'price_pro_yearly',
      STRIPE_PRO_PLUS_PRICE_ID: 'price_pro_plus_monthly',
      STRIPE_PRO_PLUS_YEARLY_PRICE_ID: 'price_pro_plus_yearly',
    });

    expect(resolvePriceIdForRequest('pro', 'year')).toEqual(
      expect.objectContaining({
        planId: 'pro',
        billingInterval: 'year',
        priceId: 'price_pro_yearly',
      })
    );
    expect(resolvePriceIdForRequest('pro_plus', 'year')).toEqual(
      expect.objectContaining({
        planId: 'pro_plus',
        billingInterval: 'year',
        priceId: 'price_pro_plus_yearly',
      })
    );
  });

  it('rejects unknown plan identifiers', () => {
    const { resolvePriceIdForRequest } = loadBillingPlansWithEnv();
    expect(resolvePriceIdForRequest('enterprise_plus_unapproved')).toBeNull();
  });

  it('keeps checkout return URLs on the configured EventFlow origin', () => {
    const { normaliseReturnUrl } = loadBillingPlansWithEnv({
      BASE_URL: 'https://event-flow.co.uk',
    });

    expect(normaliseReturnUrl('https://evil.example/steal', '/pricing')).toBe(
      'https://event-flow.co.uk/pricing'
    );
    expect(normaliseReturnUrl('/dashboard/supplier?billing=success', '/pricing')).toBe(
      'https://event-flow.co.uk/dashboard/supplier?billing=success'
    );
  });
});
