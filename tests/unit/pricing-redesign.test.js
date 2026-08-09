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

  describe('the supplier photo strip', () => {
    it('pages through sets rather than refetching on every rotation', () => {
      expect(pricingScript).toContain('const SHOWCASE_PAGE_SIZE = 6');
      expect(pricingScript).toContain('const SHOWCASE_MAX_PAGES = 4');
      // One request covers every page the hero will show.
      expect(pricingScript).toContain('const wanted = SHOWCASE_PAGE_SIZE * SHOWCASE_MAX_PAGES');
      expect(pricingScript).toContain('limit=${wanted}');
    });

    it('only builds whole pages', () => {
      // A trailing set of one or two photos beside four empty slots reads as a
      // partial load rather than a design.
      expect(pricingScript).toContain(
        'Math.max(1, Math.floor(suppliers.length / SHOWCASE_PAGE_SIZE))'
      );
    });

    it('closes the hero to one centred column when the strip is given up on', () => {
      // Hiding the strip left the copy stranded beside an empty half-panel,
      // which is what a shadowed endpoint looked like in production. The
      // class is only applied on the failure paths, so it cannot shift the
      // layout while the photos are still arriving.
      expect(pricingScript).toContain('const giveUp = ');
      expect(pricingScript).toMatch(/classList\.add\('is-proofless'\)/);
      expect(pricingScript.match(/giveUp\(\);/g)).toHaveLength(3);
      expect(pricingStyles).toContain('.pricing-hero .container.is-proofless');
    });

    it('only claims there are more suppliers when the endpoint says so', () => {
      expect(pricingScript).toContain('more.hidden = !(Number(payload.total) > pages[0].length)');
      expect(pricingPage).toContain('id="pricing-proof-more"');
      // Hidden in the served markup, so it can never flash a claim that the
      // request then fails to support.
      expect(pricingPage).toMatch(/id="pricing-proof-more"[^>]*\shidden/);
      // "Many More" split over two lines is a visual device; screen readers
      // get the sentence instead, so they learn the same fact.
      expect(pricingPage).toContain('<span class="sr-only">And many more suppliers</span>');
    });

    it('keeps the sets reachable without waiting for the rotation', () => {
      // Under reduced motion nothing rotates, so the dots are the only way to
      // see the other sets — they have to be real buttons, not decoration.
      expect(pricingScript).toContain("dot.type = 'button'");
      expect(pricingScript).toContain("dot.setAttribute('aria-current', 'true')");
      expect(pricingScript).toContain('Show supplier set ${i + 1} of ${pages.length}');
      expect(pricingScript).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
    });

    it('pauses the rotation while the strip is hovered or focused', () => {
      // Swapping a photo out from under someone reading it is worse than a
      // strip that sits still.
      expect(pricingScript).toContain("host.addEventListener('mouseenter', stop)");
      expect(pricingScript).toContain("host.addEventListener('focusin', stop)");
    });

    it('sizes the discs so the row survives a narrow phone', () => {
      // Six discs plus the label on one row at 320px; a fixed width either
      // wraps the row or pushes the label out of its own circle. The floor
      // also has to keep the label clear of the ring.
      expect(pricingStyles).toContain('width: clamp(2.5rem, 10.5vw, 3.5rem)');
      // Two stacked words do not clear the ring at the small end, so the disc
      // drops to one word there while the sr-only sentence stays whole.
      expect(pricingStyles).toContain('.pricing-proof-more-line:first-child');
      expect(pricingPage).toContain('class="pricing-proof-more-line"');
    });

    it('centres the headline box, not just the text inside it', () => {
      // Below 980px the hero stacks and centres. The headline keeps a measure
      // cap, and a capped block is left-aligned by default — so the text
      // centred inside a box that sat 90px left of everything else.
      expect(pricingStyles).toMatch(/max-width: 22ch;\s*margin-inline: auto;/);
    });

    it('lets the grid own the space above the billing toggle', () => {
      // The toggle carries a margin-top from when it followed the copy in
      // normal flow; inside the grid that stacked with the row gap and left
      // 20px of dead space on a phone.
      expect(pricingStyles).toMatch(
        /\.pricing-hero \.pricing-billing-toggle \{[^}]*margin-top: 0;/
      );
    });

    it('gives the paging dots a real tap target without inflating the dot', () => {
      // Page-level `button { min-width: 44px }` rules would otherwise render
      // each dot as a disc the size of an avatar.
      expect(pricingStyles).toContain('max-width: 0.5rem !important');
      expect(pricingStyles).toContain('.pricing-proof-dot::before');
    });
  });

  describe('the "Unlimited" footnote', () => {
    // "Unlimited" is true of the daily cap and false of the hourly one. The
    // asterisk is what makes the claim honest, so it has to stay attached to
    // every unqualified use of the word, and the footnote has to keep quoting
    // the ceilings the messenger actually enforces.
    const { MESSAGE_LIMITS } = require('../../config/messagingLimits');

    it('marks every unlimited messaging claim with the footnote reference', () => {
      // Cards.
      expect(pricingPage).toContain('Unlimited enquiry replies*');
      expect(PLAN_PRESENTATION.pro.highlights.join('\n')).toContain('Unlimited enquiry replies*');
      // Comparison table: both messaging rows, both paid columns.
      const messagingRows = pricingPage
        .split('\n')
        .filter(line => /Enquiry replies a day|Conversations started a day/.test(line));
      expect(messagingRows).toHaveLength(2);
      messagingRows.forEach(row => {
        expect(row.match(/Unlimited\*/g)).toHaveLength(2);
        expect(row).not.toMatch(/Unlimited(?!\*)/);
      });
    });

    it('quotes the hourly ceilings the messenger actually enforces', () => {
      const footnote = pricingPage.match(/<p class="pricing-footnote"[\s\S]*?<\/p>/);
      expect(footnote).not.toBeNull();
      const text = footnote[0];
      expect(text).toContain('no daily limit');
      expect(text).toContain(`${MESSAGE_LIMITS.pro.messagesPerHour} messages an hour`);
      expect(text).toContain(
        `${MESSAGE_LIMITS.pro_plus.messagesPerHour.toLocaleString('en-GB')} an hour`
      );
    });

    it('points every asterisked claim at the footnote for screen readers', () => {
      // A bare "*" is announced as punctuation, so the qualification would be
      // visual-only without this — which is the failure mode the asterisk was
      // supposed to fix.
      expect(pricingPage).toContain('<p class="pricing-footnote" id="pricing-unlimited-footnote">');
      // Static markup: the card claim plus all four messaging table cells.
      expect(pricingPage.match(/aria-describedby="pricing-unlimited-footnote"/g)).toHaveLength(5);
      // And the same association survives hydration from the plans endpoint,
      // which rebuilds the feature list from scratch.
      expect(pricingScript).toContain("const UNLIMITED_FOOTNOTE_ID = 'pricing-unlimited-footnote'");
      expect(pricingScript).toContain(
        "item.setAttribute('aria-describedby', UNLIMITED_FOOTNOTE_ID)"
      );
    });

    it('does not asterisk the allowances that genuinely have no ceiling', () => {
      // Packages and photos are -1 in the entitlement matrix and are not
      // rate-limited anywhere, so qualifying them would invent a limit.
      expect(PLAN_FEATURES.pro_plus.features.maxPackages).toBe(-1);
      expect(PLAN_FEATURES.pro_plus.features.maxPhotos).toBe(-1);
      expect(pricingPage).toContain('Unlimited package listings</span>');
      expect(pricingPage).toContain('Unlimited portfolio photos</span>');
      expect(pricingPage).not.toContain('Unlimited package listings*');
      expect(pricingPage).not.toContain('Unlimited portfolio photos*');
    });
  });
});
