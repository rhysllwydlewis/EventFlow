'use strict';

const fs = require('fs');
const path = require('path');

function readSource(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
}

describe('pricing page reference redesign', () => {
  const pricingScript = readSource('public', 'assets', 'js', 'pricing.js');
  const pricingStyles = readSource('public', 'assets', 'css', 'pricing-redesign.css');

  it('loads the dedicated pricing redesign stylesheet', () => {
    expect(pricingScript).toContain('/assets/css/pricing-redesign.css?v=1.0.0');
    expect(pricingStyles).toContain('body.pricing-redesign .pricing-billing-toggle');
  });

  it('renders exactly one accessible monthly/annual switch', () => {
    const switchIdMatches = pricingScript.match(/id="pricing-billing-switch"/g) || [];
    expect(switchIdMatches).toHaveLength(1);
    expect(pricingScript).toContain('role="switch"');
    expect(pricingScript).toContain('aria-checked="false"');
  });

  it('uses the agreed monthly and annual display prices', () => {
    expect(pricingScript).toContain('monthlyPrice: 19');
    expect(pricingScript).toContain('annualMonthlyPrice: 16');
    expect(pricingScript).toContain('annualTotal: 192');
    expect(pricingScript).toContain('monthlyPrice: 159');
    expect(pricingScript).toContain('annualMonthlyPrice: 129');
    expect(pricingScript).toContain('annualTotal: 1548');
  });

  it('passes the selected billing interval into checkout', () => {
    expect(pricingScript).toContain('billingInterval,');
    expect(pricingScript).toContain('&billingInterval=${period}');
  });

  it('keeps the mobile cards compact while retaining the comparison section', () => {
    expect(pricingStyles).toContain('body.pricing-redesign .pricing-features');
    expect(pricingStyles).toContain('display: none !important;');
    expect(pricingStyles).toContain('body.pricing-redesign .pricing-comparison');
  });
});
