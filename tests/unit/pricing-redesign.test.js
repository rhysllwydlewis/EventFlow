'use strict';

const fs = require('fs');
const path = require('path');

const readAsset = relativePath =>
  fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

describe('pricing page rebuild', () => {
  let checkoutScript;
  let pricingPage;
  let pricingScript;
  let pricingStyles;

  beforeAll(() => {
    checkoutScript = readAsset('public/assets/js/checkout.js');
    pricingPage = readAsset('public/pricing.html');
    pricingScript = readAsset('public/assets/js/pricing.js');
    pricingStyles = readAsset('public/assets/css/pricing-redesign.css');
  });

  it('ships a complete compact first paint instead of waiting for JavaScript', () => {
    expect(pricingPage).toContain('data-plan="starter"');
    expect(pricingPage).toContain('data-plan="pro"');
    expect(pricingPage).toContain('data-plan="pro_plus"');
    expect(pricingPage).toContain('Create a free profile');
    expect(pricingPage).toContain('Choose Professional');
    expect(pricingPage).toContain('£192 billed annually');
    expect(pricingPage).toContain('pricing-comparison');
  });

  it('uses one pricing-specific billing switch and removes the legacy duplicate toggle', () => {
    expect(pricingPage.match(/id="pricing-billing-switch"/g)).toHaveLength(1);
    expect(pricingPage).not.toContain('/assets/js/billing-toggle.js');
    expect(pricingScript).toContain('function setBillingPeriod(period)');
  });

  it('removes the install banner from the commercial pricing journey', () => {
    expect(pricingPage).not.toContain('/assets/js/pwa-install.js');
  });

  it('keeps the agreed monthly and annual prices in the interactive layer', () => {
    expect(pricingScript).toContain('monthlyPrice: 19');
    expect(pricingScript).toContain('annualMonthlyPrice: 16');
    expect(pricingScript).toContain('annualTotal: 192');
    expect(pricingScript).toContain('monthlyPrice: 159');
    expect(pricingScript).toContain('annualMonthlyPrice: 129');
    expect(pricingScript).toContain('annualTotal: 1548');
  });

  it('passes the selected billing interval into both checkout paths', () => {
    expect(pricingScript).toContain('billingInterval,');
    expect(pricingScript).toContain('billingInterval=${period}');
    expect(checkoutScript).toContain('function getRequestedBillingInterval()');
    expect(checkoutScript).toContain('data-billing-interval');
    expect(checkoutScript).toContain('billingInterval,');
  });

  it('derives every displayed figure from the plan record rather than hard-coded copy', () => {
    // A price baked into a button label goes stale the moment the billing
    // registry changes, because only the price element is hydrated.
    expect(pricingPage).not.toContain('Choose Professional — £192/year');
    expect(pricingScript).toContain('cta.textContent = getCtaLabel(plan)');
    expect(pricingScript).toContain('function updateComparisonPrices(period)');
    expect(pricingPage).toContain('data-comparison-price="pro"');
  });

  it('does not send the free plan through Stripe checkout', () => {
    expect(pricingScript).toContain('if (!plan || !plan.checkout)');
    expect(pricingScript).toContain("const SUPPLIER_DASHBOARD = '/dashboard/supplier'");
  });

  it('lines the three plan columns up on one row grid', () => {
    expect(pricingStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(pricingStyles).toContain('grid-template-rows: subgrid');
    expect(pricingStyles).toContain('@supports not (grid-template-rows: subgrid)');
    expect(pricingStyles).toContain('min-height: 0;');
    expect(pricingStyles).not.toContain('min-height: 590px');
    // Every card carries the same blocks in the same order, so a card can not
    // drop out of alignment by being missing one.
    ['starter', 'pro', 'pro_plus'].forEach(plan => {
      const card = pricingPage.split(`data-plan="${plan}"`)[1].split('</article>')[0];
      expect(card).toContain('pricing-card-heading');
      expect(card).toContain('pricing-price-block');
      expect(card).toContain('pricing-value-statement');
      expect(card).toContain('pricing-card-features');
      expect(card).toContain('pricing-card-actions');
    });
  });

  it('shows every listed feature rather than truncating the list', () => {
    expect(pricingStyles).not.toContain('.pricing-features li:nth-child(n + 6)');
    expect(pricingStyles).not.toContain('.pricing-features li:nth-child(n + 5)');
  });

  it('retains responsive and accessible interactions', () => {
    expect(pricingStyles).toContain('@media (max-width: 980px)');
    expect(pricingStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(pricingStyles).toContain('.pricing-billing-switch:focus-visible');
    expect(pricingPage).toContain('role="switch"');
    expect(pricingPage).toContain('aria-checked="true"');
    // The switch is a control in its own right; labelling it with both side
    // labels made screen readers announce "Monthly Annual switch".
    expect(pricingPage).toContain('aria-label="Pay annually"');
  });
});
