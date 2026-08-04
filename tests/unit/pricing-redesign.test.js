'use strict';

const fs = require('fs');
const path = require('path');

const readAsset = relativePath =>
  fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');

describe('pricing page redesign', () => {
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

  it('loads the redesign assets and exposes one billing toggle', () => {
    expect(pricingPage).toContain('/assets/css/pricing-redesign.css');
    expect(pricingPage).toContain('/assets/js/pricing.js');
    expect(pricingScript).toContain('id="pricing-billing-switch"');
    expect(pricingScript).toContain('function setBillingPeriod(period)');
  });

  it('starts on annual pricing while retaining monthly pricing', () => {
    expect(pricingScript).toContain('let activeBillingPeriod = BILLING_YEAR');
    expect(pricingScript).toContain('aria-checked="true"');
    expect(pricingScript).toContain('monthlyPrice: 19');
    expect(pricingScript).toContain('annualMonthlyPrice: 16');
    expect(pricingScript).toContain('annualTotal: 192');
    expect(pricingScript).toContain('monthlyPrice: 159');
    expect(pricingScript).toContain('annualMonthlyPrice: 129');
    expect(pricingScript).toContain('annualTotal: 1548');
  });

  it('does not persist the billing choice in browser storage', () => {
    expect(pricingScript).not.toContain('localStorage');
    expect(pricingScript).not.toContain('BILLING_STORAGE_KEY');
  });

  it('passes the selected billing interval into both checkout paths', () => {
    expect(pricingScript).toContain('billingInterval,');
    expect(pricingScript).toContain('&billingInterval=${period}');
    expect(checkoutScript).toContain('function getRequestedBillingInterval()');
    expect(checkoutScript).toContain('data-billing-interval');
    expect(checkoutScript).toContain('billingInterval,');
    expect(checkoutScript).toContain('annualMonthlyPrice: 16');
    expect(checkoutScript).toContain('annualMonthlyPrice: 129');
  });

  it('defers payment initialisation until an authenticated user starts checkout', () => {
    const initBlock = checkoutScript.slice(checkoutScript.indexOf('async function init()'));

    expect(initBlock).toContain('const authStatus = await checkAuth();');
    expect(initBlock).not.toContain('initializeStripe().catch');
    expect(checkoutScript).toContain('if (!stripe) {');
    expect(checkoutScript).toContain('const initialized = await initializeStripe();');
  });

  it('normalises the Starter checkout link to the free plan', () => {
    expect(checkoutScript).toContain("return value === 'starter' ? 'free' : value");
  });

  it('keeps the mobile cards compact while retaining the comparison section', () => {
    expect(pricingStyles).toContain('body.pricing-redesign .pricing-features');
    expect(pricingStyles).toContain('display: none !important;');
    expect(pricingPage).toContain('pricing-comparison');
  });
});
