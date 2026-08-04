'use strict';

describe('public billing plan presentation', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns safe public pricing metadata without exposing Stripe price IDs', () => {
    process.env.STRIPE_PRO_PRICE_ID = 'price_pro_month';
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_year';
    process.env.STRIPE_PRO_PLUS_PRICE_ID = 'price_plus_month';
    process.env.STRIPE_PRO_PLUS_YEARLY_PRICE_ID = 'price_plus_year';

    const { listPublicPlans } = require('../../config/billingPlans');
    const plans = listPublicPlans();
    const pro = plans.find(plan => plan.id === 'pro');
    const plus = plans.find(plan => plan.id === 'pro_plus');

    expect(pro.presentation.marketingName).toBe('Professional');
    expect(pro.presentation.pricing.month).toEqual({
      monthlyEquivalent: 19,
      total: 19,
      saving: 0,
      discountPercent: 0,
    });
    expect(pro.presentation.pricing.year).toEqual({
      monthlyEquivalent: 16,
      total: 192,
      saving: 36,
      discountPercent: 16,
    });
    expect(plus.presentation.pricing.year).toEqual({
      monthlyEquivalent: 129,
      total: 1548,
      saving: 360,
      discountPercent: 19,
    });
    expect(pro.intervals).toEqual({ month: true, year: true });
    expect(JSON.stringify(plans)).not.toContain('price_pro_month');
    expect(JSON.stringify(plans)).not.toContain('price_plus_year');
  });

  it('keeps annual totals and displayed monthly equivalents arithmetically aligned', () => {
    const { PLAN_PRESENTATION } = require('../../config/billingPlans');

    Object.values(PLAN_PRESENTATION).forEach(plan => {
      expect(plan.pricing.year.total).toBe(plan.pricing.year.monthlyEquivalent * 12);
      expect(plan.pricing.month.total).toBe(plan.pricing.month.monthlyEquivalent);
    });
  });

  it('keeps Starter free and normalises it to the canonical free tier', () => {
    const { listPublicPlans, normalisePlanRequest } = require('../../config/billingPlans');
    const starter = listPublicPlans().find(plan => plan.id === 'free');

    expect(starter.presentation.marketingName).toBe('Starter');
    expect(starter.presentation.pricing.year.total).toBe(0);
    expect(normalisePlanRequest('starter', 'year')).toEqual({
      planId: 'free',
      billingInterval: 'month',
    });
  });
});
