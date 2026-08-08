'use strict';

const fs = require('fs');
const path = require('path');

const { PLAN_FEATURES } = require('../../models/Subscription');
const { PLAN_PRESENTATION } = require('../../config/billingPlans');

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

  it('ships a complete first paint instead of waiting for JavaScript', () => {
    expect(pricingPage).toContain('data-plan="starter"');
    expect(pricingPage).toContain('data-plan="pro"');
    expect(pricingPage).toContain('data-plan="pro_plus"');
    expect(pricingPage).toContain('Create a free profile');
    expect(pricingPage).toContain('Choose Professional');
    expect(pricingPage).toContain('billed annually');
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

  it('gives every plan column the same head so the three line up', () => {
    expect(pricingStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(pricingStyles).toContain('grid-template-rows: subgrid');
    expect(pricingStyles).toContain('min-height: 0;');
    expect(pricingStyles).not.toContain('min-height: 590px');
    ['starter', 'pro', 'pro_plus'].forEach(plan => {
      const card = pricingPage.split(`data-plan="${plan}"`)[1].split('</article>')[0];
      expect(card).toContain('pricing-card-heading');
      expect(card).toContain('pricing-price-block');
      expect(card).toContain('pricing-card-actions');
      expect(card).toContain('pricing-card-features');
    });
  });

  it('drops the decorative layer that was doing the work the layout should do', () => {
    // Blurred brand blobs, a frosted hero and drop shadows on everything left
    // the page with no hierarchy: when every element is emphasised none is.
    expect(pricingPage).not.toContain('pricing-blob');
    expect(pricingPage).not.toContain('pricing-decor');
    expect(pricingStyles).not.toContain('backdrop-filter');
    expect(pricingStyles).toContain('box-shadow: none !important');
    // The plan surfaces are separated by hairlines, not lifted off the page.
    // A floating status banner still gets one shadow; nothing gets two.
    expect(pricingStyles).not.toMatch(/box-shadow:[^;]*rgba[^;]*,[^;]*rgba/);
  });

  it('says what each feature does, not just what it is called', () => {
    // A feature name on its own does not tell a supplier whether a plan is
    // worth paying for, which is the only question this page has to answer.
    expect(pricingPage).toContain('pricing-feature-name');
    expect(pricingPage).toContain('pricing-feature-why');
    expect(pricingScript).toContain('function splitHighlight(highlight)');
    Object.values(PLAN_PRESENTATION).forEach(plan => {
      plan.highlights.forEach(highlight => {
        expect(highlight).toMatch(/\s—\s/);
      });
    });
  });

  it('renders the upgrade prompt the registry has always served', () => {
    expect(pricingPage).toContain('pricing-upsell');
    expect(pricingScript).toContain("card.querySelector('.pricing-upsell')");
    // The top plan has nowhere to upgrade to, so it carries no prompt.
    const plusCard = pricingPage.split('data-plan="pro_plus"')[1].split('</article>')[0];
    expect(plusCard).not.toContain('pricing-upsell');
  });

  it('groups the comparison table by what a supplier is actually buying', () => {
    expect(pricingPage).toContain('comparison-group');
    expect(pricingPage).toContain('Getting found');
    expect(pricingPage).toContain('Earning trust');
    expect(pricingPage).toContain('scope="row"');
  });

  it('promises only the package limits the platform actually enforces', () => {
    // routes/packages.js blocks publishing past maxPackages and
    // subscriptionService pauses the excess on downgrade, so these numbers are
    // a real difference between the plans. Marketing copy that drifts from
    // them is a promise the product does not keep.
    expect(PLAN_FEATURES.free.features.maxPackages).toBe(3);
    expect(PLAN_FEATURES.pro.features.maxPackages).toBe(50);
    expect(PLAN_FEATURES.pro_plus.features.maxPackages).toBe(-1);

    expect(PLAN_PRESENTATION.free.highlights.join(' ')).toContain('Up to 3 package listings');
    expect(PLAN_PRESENTATION.pro.highlights.join(' ')).toContain('Up to 50 package listings');
    expect(PLAN_PRESENTATION.pro_plus.highlights.join(' ')).toContain('Unlimited package listings');

    expect(pricingPage).toContain('Up to 3 package listings');
    expect(pricingPage).toContain('Up to 50 package listings');
    expect(pricingPage).toContain('Unlimited package listings');
  });

  it('does not claim photo allowances the uploader does not grant', () => {
    // supplier-gallery.js and supplier-photo-upload.js cap every tier at ten
    // photos regardless of plan, so "unlimited photos" on a paid plan was a
    // claim the product did not honour.
    const gallery = readAsset('public/assets/js/supplier-gallery.js');
    expect(gallery).toContain('const maxPhotos = 10');
    expect(pricingPage).not.toContain('Unlimited photos');
    expect(PLAN_PRESENTATION.pro.highlights.join(' ')).not.toContain('Unlimited photos');
  });

  it('retains responsive and accessible interactions', () => {
    expect(pricingStyles).toContain('@media (max-width: 980px)');
    expect(pricingStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(pricingStyles).toContain('.pricing-billing-switch:focus-visible');
    expect(pricingPage).toContain('role="switch"');
    expect(pricingPage).toContain('aria-checked="true"');
    expect(pricingPage).toContain('aria-label="Pay annually instead of monthly"');
  });
});
