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
    expect(pricingPage).toContain('Choose Professional — £192/year');
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
    expect(pricingScript).toContain('&billingInterval=${period}');
    expect(checkoutScript).toContain('function getRequestedBillingInterval()');
    expect(checkoutScript).toContain('data-billing-interval');
    expect(checkoutScript).toContain('billingInterval,');
  });

  it('uses compact cards without the old forced 590px blank space', () => {
    expect(pricingStyles).toContain('min-height: 0;');
    expect(pricingStyles).not.toContain('min-height: 590px');
    expect(pricingStyles).toContain('.pricing-features li:nth-child(n + 6)');
    expect(pricingStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });

  it('retains responsive and accessible interactions', () => {
    expect(pricingStyles).toContain('@media (max-width: 980px)');
    expect(pricingStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(pricingStyles).toContain('.pricing-billing-switch:focus-visible');
    expect(pricingPage).toContain('role="switch"');
    expect(pricingPage).toContain('aria-checked="true"');
  });
});
