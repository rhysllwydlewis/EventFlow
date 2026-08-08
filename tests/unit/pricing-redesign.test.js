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
    expect(pricingPage).toContain('Talking to customers');
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
  });

  it('promises only the photo allowances the upload route enforces', () => {
    // The uploader used to cap every tier at ten photos whatever the plan
    // said, which made "unlimited photos" on Professional false. The
    // allowance now comes from the matrix and routes/photos.js applies it.
    expect(PLAN_FEATURES.free.features.maxPhotos).toBe(10);
    expect(PLAN_FEATURES.pro.features.maxPhotos).toBe(500);
    expect(PLAN_FEATURES.pro_plus.features.maxPhotos).toBe(-1);

    const photos = readAsset('routes/photos.js');
    expect(photos).toContain('checkPhotoAllowance');
    expect(photos).toContain('PHOTO_LIMIT_REACHED');
    // Both upload paths are guarded, not just the single-file one.
    expect(photos.match(/await checkPhotoAllowance\(/g)).toHaveLength(2);

    // The browser reads its allowance rather than carrying its own ceiling.
    const gallery = readAsset('public/assets/js/supplier-gallery.js');
    expect(gallery).toContain('/api/v2/subscriptions/me');
    expect(gallery).not.toMatch(/const maxPhotos = \d+/);

    expect(pricingPage).toContain('Up to 10 portfolio photos');
    expect(pricingPage).toContain('Up to 500 portfolio photos');
    expect(pricingPage).toContain('Unlimited portfolio photos');
  });

  it('promises only the messaging allowances config/messagingLimits.js enforces', () => {
    const { getMessagingLimitsForTier } = require('../../config/messagingLimits');
    const free = getMessagingLimitsForTier('free');
    const pro = getMessagingLimitsForTier('pro');
    const plus = getMessagingLimitsForTier('pro_plus');

    expect(free.messagesPerDay).toBe(10);
    expect(pro.messagesPerDay).toBe(-1);
    expect(plus.messagesPerDay).toBe(-1);
    expect(free.maxMessageLength).toBe(500);
    expect(pro.maxMessageLength).toBe(5000);
    expect(plus.maxMessageLength).toBe(10000);

    expect(pricingPage).toContain('Up to 10 enquiry replies a day');
    expect(pricingPage).toContain('Unlimited enquiry replies');
    expect(pricingPage).toContain('5,000 characters');
    expect(pricingPage).toContain('500 characters');
    expect(pricingPage).toContain('10,000');
  });

  it('promises only the analytics history the supplier route allows', () => {
    expect(PLAN_FEATURES.free.features.analyticsWindowDays).toBe(7);
    expect(PLAN_FEATURES.pro.features.analyticsWindowDays).toBe(90);
    expect(PLAN_FEATURES.pro_plus.features.analyticsWindowDays).toBe(365);

    const supplierRoute = readAsset('routes/supplier.js');
    expect(supplierRoute).toContain('getAnalyticsWindowDays');
    expect(supplierRoute).toContain('Math.min(requestedDays, windowDays)');

    expect(pricingPage).toContain('7 days of profile analytics');
    expect(pricingPage).toContain('90 days of profile analytics');
    expect(pricingPage).toContain('A full year of profile analytics');
  });

  it('delivers the homepage placement Professional Plus is sold', () => {
    // Homepage featuring was driven only by an editorial flag someone had to
    // set by hand, so subscribing did not actually buy the benefit.
    expect(readAsset('routes/suppliers.js')).toContain('planFeaturedSupplierIds');
    expect(readAsset('utils/helpers.js')).toContain('async function supplierPlanTier');
    expect(PLAN_PRESENTATION.pro_plus.highlights.join(' ')).toContain(
      'Homepage featured placement'
    );
    expect(PLAN_PRESENTATION.pro.highlights.join(' ')).not.toContain('Homepage featured');
  });

  it('does not sell ungated features as though they were paid', () => {
    // Verification and response-time tracking apply to every supplier, so
    // listing them under Professional implied a difference that is not there.
    ['Email and phone verification', 'Response-time tracking'].forEach(claim => {
      expect(PLAN_PRESENTATION.pro.highlights.join(' ')).not.toContain(claim);
      expect(PLAN_PRESENTATION.pro_plus.highlights.join(' ')).not.toContain(claim);
    });
    // They are still shown, in the row that says every plan includes them.
    expect(pricingPage).toContain('Included on every plan');
    expect(pricingPage).toContain('Response-time tracking');
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
