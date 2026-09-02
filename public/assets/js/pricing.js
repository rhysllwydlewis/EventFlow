/**
 * EventFlow supplier pricing page enhancement.
 *
 * The HTML ships a complete first paint. This script hydrates the canonical
 * plan presentation from the billing registry, switches billing periods,
 * applies the viewer's auth state and starts Stripe checkout.
 *
 * Every price the page shows — card price, billed line, saving, comparison
 * table — is derived from one plan record, so the figures cannot drift apart
 * when the registry changes.
 */
'use strict';
(function () {
  const BILLING_MONTH = 'month';
  const BILLING_YEAR = 'year';

  /**
   * Fallback plan data, matching the server-rendered first paint. The plans
   * endpoint overwrites these; they are what the page falls back to when the
   * request fails.
   */
  const PLAN_CONFIG = {
    starter: {
      apiPlanId: 'free',
      hrefPlan: 'starter',
      name: 'Starter',
      /* The free plan has no Stripe price, so its button is a plain link
         rather than a checkout trigger. */
      checkout: false,
      monthlyPrice: 0,
      annualMonthlyPrice: 0,
      annualTotal: 0,
      annualSaving: 0,
      annualDiscount: 0,
      cta: 'Create a free profile',
    },
    pro: {
      apiPlanId: 'pro',
      hrefPlan: 'pro',
      name: 'Professional',
      checkout: true,
      monthlyPrice: 19,
      annualMonthlyPrice: 16,
      annualTotal: 192,
      annualSaving: 36,
      annualDiscount: 16,
      cta: 'Choose Professional',
    },
    pro_plus: {
      apiPlanId: 'pro_plus',
      hrefPlan: 'pro_plus',
      name: 'Professional Plus',
      checkout: true,
      monthlyPrice: 159,
      annualMonthlyPrice: 129,
      annualTotal: 1548,
      annualSaving: 360,
      annualDiscount: 19,
      cta: 'Choose Professional Plus',
    },
  };

  /** Where a signed-in supplier manages the plan they already have. */
  const SUPPLIER_DASHBOARD = '/dashboard/supplier';
  /** Where an existing subscriber changes plan or billing — never checkout,
   * see hasLiveSubscription below for why. */
  const SUPPLIER_SUBSCRIPTION_PAGE = '/supplier/subscription';

  let activeBillingPeriod = BILLING_YEAR;
  let pricingAuthMode = 'unknown';
  /**
   * Whether the signed-in supplier already has a live, paid Stripe
   * subscription. When true, every card's call to action must route to the
   * subscription management page instead of checkout: Stripe Checkout has no
   * knowledge of an existing subscription, so posting a second checkout
   * session for a different tier would create a second Stripe subscription
   * and double-bill the supplier rather than upgrading/downgrading the one
   * they already have.
   */
  let hasLiveSubscription = false;

  /**
   * Format an amount as a whole-pound figure in UK grouping.
   * @param {number} value Amount in pounds.
   * @returns {string} Formatted number, without a currency symbol.
   */
  function formatMoney(value) {
    return new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);
  }

  /**
   * Format an amount as pounds sterling.
   * @param {number} value Amount in pounds.
   * @returns {string} e.g. `£1,548`.
   */
  function money(value) {
    return `£${formatMoney(value)}`;
  }

  /** How many supplier photos the hero shows at once. */
  const SHOWCASE_PAGE_SIZE = 6;
  /** Most sets the hero will page through, so the dots stay countable. */
  const SHOWCASE_MAX_PAGES = 4;
  /** How long a set of supplier photos holds before the next fades in. */
  const SHOWCASE_INTERVAL_MS = 4200;
  /** Footnote defining what "Unlimited" means, for asterisked claims. */
  const UNLIMITED_FOOTNOTE_ID = 'pricing-unlimited-footnote';

  /**
   * Derive initials the shared way, so a supplier with no photo looks the
   * same here as everywhere else on EventFlow — see
   * public/assets/js/utils/supplier-avatar.js.
   * @param {string} name Business name.
   * @returns {string} One or two initials.
   */
  function getInitials(name) {
    return window.EFSupplierAvatar.getSupplierInitials(name);
  }

  /**
   * Build one circle in the social-proof strip.
   *
   * The image is only attached when the supplier has one; otherwise the
   * initials stand on their own, which is the existing fallback rather than a
   * placeholder invented for this page. A supplier is never skipped for having
   * no photo — the point of the strip is that these are a real sample.
   * @param {Object} supplier Supplier summary from the showcase endpoint.
   * @returns {HTMLLIElement} List item.
   */
  function buildProofItem(supplier) {
    const item = document.createElement('li');
    item.className = 'pricing-proof-item';

    const avatar = document.createElement('span');
    avatar.className = 'pricing-proof-avatar';
    // Same per-supplier colour as everywhere else on the site (suppliers
    // directory, profile hero, package cards) — see
    // public/assets/js/utils/supplier-avatar.js. Set unconditionally so it
    // is already correct behind a photo that later fails to load.
    avatar.style.background = window.EFSupplierAvatar.getSupplierAvatarGradient(supplier);
    avatar.style.color = '#fff';

    if (supplier.profilePhotoUrl) {
      const img = document.createElement('img');
      img.alt = supplier.name || 'EventFlow supplier';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 52;
      img.height = 52;
      // Bound before `src` is assigned: a URL that fails from cache can error
      // before a listener attached afterwards would ever hear it, leaving a
      // broken-image glyph in the strip.
      img.addEventListener('error', () => {
        img.remove();
        avatar.textContent = getInitials(supplier.name);
        avatar.setAttribute('role', 'img');
        avatar.setAttribute('aria-label', supplier.name || 'EventFlow supplier');
      });
      img.src = supplier.profilePhotoUrl;
      avatar.appendChild(img);
    } else {
      avatar.textContent = getInitials(supplier.name);
      avatar.setAttribute('role', 'img');
      avatar.setAttribute('aria-label', supplier.name || 'EventFlow supplier');
    }

    item.appendChild(avatar);
    return item;
  }

  /**
   * Fill the hero with supplier profile photos, paged six at a time.
   *
   * The suppliers are drawn at random per page view and then held: the strip
   * pages through fixed sets rather than reshuffling, so someone reading the
   * prices is not watching the photos churn. It stays hidden until it has
   * something real to show, so a failed request leaves the hero looking
   * deliberate rather than broken.
   * @returns {Promise<void>} Resolves once the strip is populated.
   */
  async function renderSupplierProof() {
    const container = document.getElementById('pricing-hero-proof');
    const strip = document.getElementById('pricing-proof-strip');
    const note = document.getElementById('pricing-proof-note');
    const more = document.getElementById('pricing-proof-more');
    const dots = document.getElementById('pricing-proof-dots');
    if (!container || !strip) {
      return;
    }

    // Applied only when the strip is given up on, so the hero closes to a
    // single centred column instead of leaving the copy stranded beside an
    // empty half-panel. Never applied on the happy path, so it cannot shift
    // the layout while the photos are still arriving.
    const giveUp = () => {
      document.querySelector('.pricing-hero .container')?.classList.add('is-proofless');
    };

    try {
      const wanted = SHOWCASE_PAGE_SIZE * SHOWCASE_MAX_PAGES;
      const response = await fetch(`/api/suppliers/showcase?limit=${wanted}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        giveUp();
        return;
      }
      const payload = await response.json();
      const suppliers = Array.isArray(payload.items) ? payload.items : [];
      if (!suppliers.length) {
        giveUp();
        return;
      }

      // Only whole pages: a final set of one or two photos beside four empty
      // slots looks like something failed to load.
      const pageCount = Math.max(1, Math.floor(suppliers.length / SHOWCASE_PAGE_SIZE));
      const pages = [];
      for (let i = 0; i < pageCount; i += 1) {
        pages.push(suppliers.slice(i * SHOWCASE_PAGE_SIZE, (i + 1) * SHOWCASE_PAGE_SIZE));
      }
      // Fewer suppliers than a full page: show what there is rather than none.
      if (pages.length === 1 && suppliers.length < SHOWCASE_PAGE_SIZE) {
        pages[0] = suppliers;
      }

      renderProofPage(strip, pages[0]);

      if (more) {
        // Only claim there are more when the endpoint says so.
        more.hidden = !(Number(payload.total) > pages[0].length);
      }
      if (note) {
        note.textContent = 'Real suppliers already listed on EventFlow';
      }

      container.hidden = false;
      startProofPaging({ strip, dots, pages });
    } catch (_error) {
      // The strip is social proof, not function. Hiding it is fine; the hero
      // just has to still look deliberate without it.
      giveUp();
    }
  }

  /**
   * Swap the strip to one set of suppliers.
   * @param {HTMLElement} strip Strip element.
   * @param {Array<Object>} page Suppliers to show.
   * @returns {void} Nothing.
   */
  function renderProofPage(strip, page) {
    strip.replaceChildren(...page.map(buildProofItem));
  }

  /**
   * Page the strip through its sets, with dots to jump between them.
   *
   * The dots are real buttons, so the sets are reachable without waiting for
   * the rotation — which matters under reduced motion, where nothing rotates
   * on its own. Rotation also pauses while the strip is hovered or focused,
   * so it cannot swap a photo out from under someone looking at it.
   * @param {Object} refs Strip, dots container and the pages to cycle.
   * @returns {void} Nothing.
   */
  function startProofPaging({ strip, dots, pages }) {
    if (pages.length < 2) {
      return;
    }

    let index = 0;
    let timer = null;

    const buttons = pages.map((_page, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `pricing-proof-dot${i === 0 ? ' is-active' : ''}`;
      // aria-current marks the set on show; aria-selected belongs to tabs.
      if (i === 0) {
        dot.setAttribute('aria-current', 'true');
      }
      dot.setAttribute('aria-label', `Show supplier set ${i + 1} of ${pages.length}`);
      dot.addEventListener('click', () => {
        stop();
        show(i);
      });
      return dot;
    });

    if (dots) {
      dots.replaceChildren(...buttons);
      dots.hidden = false;
    }

    /**
     * Show one set and mark its dot.
     * @param {number} next Index of the set to show.
     * @returns {void} Nothing.
     */
    function show(next) {
      index = next;
      strip.classList.add('is-swapping');
      window.setTimeout(() => {
        renderProofPage(strip, pages[index]);
        strip.classList.remove('is-swapping');
      }, 200);
      buttons.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
        if (i === index) {
          dot.setAttribute('aria-current', 'true');
        } else {
          dot.removeAttribute('aria-current');
        }
      });
    }

    /**
     * Stop the rotation.
     * @returns {void} Nothing.
     */
    function stop() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    /**
     * Start the rotation, unless the visitor asked for reduced motion.
     * @returns {void} Nothing.
     */
    function start() {
      if (timer !== null || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        return;
      }
      timer = window.setInterval(() => show((index + 1) % pages.length), SHOWCASE_INTERVAL_MS);
    }

    const host = strip.closest('.pricing-hero-proof') || strip;
    host.addEventListener('mouseenter', stop);
    host.addEventListener('mouseleave', start);
    host.addEventListener('focusin', stop);
    host.addEventListener('focusout', start);

    start();
  }

  /**
   * Attach the redesign stylesheet once, if the page did not already ship it.
   * @returns {void} Nothing.
   */
  function ensureRedesignStylesheet() {
    if (document.getElementById('pricing-redesign-styles')) {
      return;
    }
    const stylesheet = document.createElement('link');
    stylesheet.id = 'pricing-redesign-styles';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/assets/css/pricing-redesign.css?v=3.0.0';
    document.head.appendChild(stylesheet);
  }

  /**
   * Read the billing period the visitor arrived with.
   *
   * Annual is the default, so a link that carries no interval — or an interval
   * this page does not recognise — lands on the same view as a cold visit.
   * @returns {string} `BILLING_MONTH` or `BILLING_YEAR`.
   */
  function readInitialBillingPeriod() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('billingInterval') || params.get('period');
    if (requested === BILLING_MONTH || requested === 'monthly') {
      return BILLING_MONTH;
    }
    return BILLING_YEAR;
  }

  /**
   * Split a merchandising highlight into its feature and its benefit.
   *
   * The registry writes highlights as "Feature — what it does for you". The
   * card sets the first half as the feature and the second beneath it, because
   * a feature name on its own does not tell a supplier whether the plan is
   * worth paying for.
   * @param {string} highlight Highlight copy from the plans endpoint.
   * @returns {{name: string, why: string}} The two halves; `why` may be empty.
   */
  function splitHighlight(highlight) {
    const text = String(highlight);
    const match = text.match(/^(.*?)\s+[—–]\s+(.*)$/);
    if (!match) {
      return { name: text.trim(), why: '' };
    }
    const why = match[2].trim();
    return {
      name: match[1].trim(),
      // The registry writes the benefit as a lower-case clause; on the card it
      // is set as its own sentence.
      why: why ? why.charAt(0).toUpperCase() + why.slice(1).replace(/\.?$/, '.') : '',
    };
  }

  /**
   * Build one feature list item: the feature, then what it does for you.
   * @param {string} highlight Highlight copy from the plans endpoint.
   * @returns {HTMLLIElement} List item.
   */
  function buildFeatureItem(highlight) {
    const { name, why } = splitHighlight(highlight);
    const item = document.createElement('li');
    const nameEl = document.createElement('span');
    nameEl.className = 'pricing-feature-name';
    nameEl.textContent = name;
    item.appendChild(nameEl);
    // A bare asterisk is announced as punctuation and sends nobody anywhere.
    // Pointing the item at the footnote means the qualification is read out
    // with the claim, which is the only reason the asterisk is there.
    if (name.endsWith('*')) {
      item.setAttribute('aria-describedby', UNLIMITED_FOOTNOTE_ID);
    }
    if (why) {
      const whyEl = document.createElement('span');
      whyEl.className = 'pricing-feature-why';
      whyEl.textContent = why;
      item.appendChild(whyEl);
    }
    return item;
  }

  /**
   * Replace a card's server-rendered copy with canonical plan presentation.
   *
   * Elements are updated in place and never added or removed: the three cards
   * share one row grid, so a card with an extra or missing block would drop
   * out of alignment with its neighbours.
   * @param {string} planKey Plan key, matching `data-plan` on the card.
   * @param {Object} presentation Presentation metadata from the plans endpoint.
   * @returns {void} Nothing.
   */
  function updateStaticPlanContent(planKey, presentation) {
    const plan = PLAN_CONFIG[planKey];
    const card = document.querySelector(`.pricing-card[data-plan="${planKey}"]`);
    if (!plan || !card || !presentation) {
      return;
    }

    const monthly = presentation.pricing?.month;
    const yearly = presentation.pricing?.year;
    if (monthly) {
      plan.monthlyPrice = Number(monthly.monthlyEquivalent ?? plan.monthlyPrice);
    }
    if (yearly) {
      plan.annualMonthlyPrice = Number(yearly.monthlyEquivalent ?? plan.annualMonthlyPrice);
      plan.annualTotal = Number(yearly.total ?? plan.annualTotal);
      plan.annualSaving = Number(yearly.saving ?? plan.annualSaving);
      plan.annualDiscount = Number(yearly.discountPercent ?? plan.annualDiscount);
    }

    plan.name = presentation.marketingName || plan.name;
    plan.cta = presentation.cta || plan.cta;

    setText(card.querySelector('.pricing-name'), plan.name);
    setText(card.querySelector('.pricing-description'), presentation.description);
    setText(card.querySelector('.pricing-tier-label'), presentation.audience);
    setText(card.querySelector('.pricing-early-access-label'), presentation.badge);
    // `valueStatement` is the one line that says what the plan does for the
    // supplier rather than what it contains, so it is worth showing even
    // though the feature list already lists the contents.
    setText(card.querySelector('.pricing-value-statement'), presentation.valueStatement);
    // Only the plans that have somewhere to upgrade to carry this element.
    setText(card.querySelector('.pricing-upsell'), presentation.upgradePrompt);

    const features = card.querySelector('.pricing-features');
    if (features && Array.isArray(presentation.highlights) && presentation.highlights.length) {
      features.replaceChildren(...presentation.highlights.map(buildFeatureItem));
    }
  }

  /**
   * Write text into an element, leaving the server-rendered copy alone when
   * the endpoint has nothing to say.
   * @param {HTMLElement|null} element Target element.
   * @param {string} [value] Replacement text.
   * @returns {void} Nothing.
   */
  function setText(element, value) {
    if (element && value) {
      element.textContent = value;
    }
  }

  /**
   * Refresh the cards from the canonical plan metadata.
   *
   * The markup already carries a complete first paint, so a failure here is
   * silent by design: the visitor keeps the server-rendered prices rather than
   * seeing the page empty itself out.
   * @returns {Promise<void>} Resolves once the cards have been updated.
   */
  async function hydrateCanonicalPlanPresentation() {
    try {
      const response = await fetch('/api/v2/subscriptions/plans', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      const publicPlans = Array.isArray(payload.billing) ? payload.billing : [];
      const byId = new Map(publicPlans.map(plan => [plan.id, plan]));
      Object.entries(PLAN_CONFIG).forEach(([key, plan]) => {
        const record = byId.get(plan.apiPlanId);
        if (record && typeof record.checkout === 'boolean') {
          plan.checkout = record.checkout;
        }
        updateStaticPlanContent(key, record?.presentation);
      });
      setBillingPeriod(activeBillingPeriod);
      // A plan the registry has just marked purchasable needs its handler.
      if (pricingAuthMode === 'authenticated') {
        attachCheckoutHandlers();
      }
    } catch (_error) {
      // Matching fallback prices and copy are already rendered in the HTML.
    }
  }

  /**
   * Build the destination for a plan's call to action at a billing period.
   *
   * A signed-out visitor is sent to sign in first, carrying the plan and
   * interval they picked so they come back to the same view. The free plan
   * has nothing to buy, so a supplier who already has it goes straight to
   * the dashboard rather than through checkout.
   * @param {Object} plan Plan configuration.
   * @param {string} period Billing period.
   * @returns {string} Destination URL.
   */
  function getCtaHref(plan, period) {
    if (pricingAuthMode === 'unauthenticated') {
      const redirect = plan.checkout
        ? `/pricing?plan=${encodeURIComponent(plan.hrefPlan)}&billingInterval=${period}`
        : `/pricing?plan=${encodeURIComponent(plan.hrefPlan)}`;
      return `/auth?redirect=${encodeURIComponent(redirect)}`;
    }
    // Already subscribed: every other card is a change to that existing
    // subscription, not a new purchase, so it goes to the management page
    // rather than checkout (see hasLiveSubscription).
    if (hasLiveSubscription) {
      return SUPPLIER_SUBSCRIPTION_PAGE;
    }
    if (!plan.checkout) {
      return SUPPLIER_DASHBOARD;
    }
    return `/checkout?plan=${encodeURIComponent(plan.hrefPlan)}&billingInterval=${period}`;
  }

  /**
   * Label a plan's call to action for the viewer.
   *
   * "Create a free profile" is only true for someone who has not got one. A
   * signed-in supplier looking at the free plan already has a profile — for
   * them the free card is where their subscription lands if they cancel, so
   * it points at the dashboard and says so.
   * @param {Object} plan Plan configuration.
   * @returns {string} Button label.
   */
  function getCtaLabel(plan) {
    if (hasLiveSubscription) {
      return plan.checkout ? `Switch to ${plan.name}` : 'Manage your plan';
    }
    if (!plan.checkout && pricingAuthMode === 'authenticated') {
      return 'Manage your plan';
    }
    return plan.cta;
  }

  /**
   * Apply a billing period to one plan card: price, billed line, saving and
   * the destination its call to action points at.
   * @param {HTMLElement} card Plan card element.
   * @param {string} period Billing period.
   * @returns {void} Nothing.
   */
  function updateCardBilling(card, period) {
    const planKey = card.dataset.plan;
    const plan = PLAN_CONFIG[planKey];
    if (!plan) {
      return;
    }

    const annual = period === BILLING_YEAR;
    const paid = plan.monthlyPrice > 0;
    const price = annual ? plan.annualMonthlyPrice : plan.monthlyPrice;
    const priceElement = card.querySelector('[data-pricing-price]');
    const billedLine = card.querySelector('[data-pricing-billed-line]');
    const normallyLine = card.querySelector('[data-pricing-normally]');
    const savingsLine = card.querySelector('[data-pricing-savings]');
    const cta = card.querySelector('.pricing-cta');

    if (priceElement) {
      priceElement.textContent = money(price);
    }
    if (billedLine) {
      if (!paid) {
        billedLine.textContent = 'No card required';
      } else {
        billedLine.textContent = annual
          ? `${money(plan.annualTotal)} billed annually`
          : `${money(plan.monthlyPrice)} billed monthly`;
      }
    }
    if (normallyLine) {
      // Only meaningful where the annual rate undercuts the monthly one.
      const show = annual && paid && plan.annualMonthlyPrice < plan.monthlyPrice;
      normallyLine.hidden = !show;
      normallyLine.textContent = show ? `Normally ${money(plan.monthlyPrice)} per month` : '';
    }
    if (savingsLine) {
      const show = annual && plan.annualSaving > 0;
      savingsLine.hidden = !show;
      // The percentage is already stated once, beside the billing control.
      savingsLine.textContent = show ? `Save ${money(plan.annualSaving)} a year` : '';
    }
    if (cta && cta.getAttribute('aria-disabled') !== 'true') {
      cta.textContent = getCtaLabel(plan);
      // Until the viewer is known the server-rendered destination stands:
      // guessing here would briefly aim a signed-out visitor at checkout, or
      // a signed-in supplier at the sign-in page.
      if (pricingAuthMode !== 'unknown') {
        cta.href = getCtaHref(plan, period);
      }
    }
  }

  /**
   * Keep the comparison table's price row on the same figures as the cards.
   * @param {string} period Billing period.
   * @returns {void} Nothing.
   */
  function updateComparisonPrices(period) {
    const annual = period === BILLING_YEAR;
    document.querySelectorAll('[data-comparison-price]').forEach(cell => {
      const plan = PLAN_CONFIG[cell.dataset.comparisonPrice];
      if (!plan) {
        return;
      }
      if (plan.monthlyPrice <= 0) {
        cell.textContent = 'Free';
        return;
      }
      cell.textContent = annual
        ? `${money(plan.annualTotal)}/year`
        : `${money(plan.monthlyPrice)}/month`;
    });
  }

  /**
   * Switch the whole page to a billing period and reflect it in the toggle.
   * @param {string} period Billing period; anything but monthly means annual.
   * @returns {void} Nothing.
   */
  function setBillingPeriod(period) {
    activeBillingPeriod = period === BILLING_MONTH ? BILLING_MONTH : BILLING_YEAR;
    const annual = activeBillingPeriod === BILLING_YEAR;
    const toggle = document.getElementById('pricing-billing-switch');
    document.body.dataset.pricingBilling = activeBillingPeriod;
    if (toggle) {
      toggle.setAttribute('aria-checked', String(annual));
      toggle.classList.toggle('is-annual', annual);
    }
    document.getElementById('pricing-monthly-label')?.classList.toggle('is-active', !annual);
    document.getElementById('pricing-annual-label')?.classList.toggle('is-active', annual);
    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
      updateCardBilling(card, activeBillingPeriod);
    });
    updateComparisonPrices(activeBillingPeriod);
  }

  /**
   * Wire the monthly/annual switch, guarding against double binding.
   * @returns {void} Nothing.
   */
  function attachBillingToggle() {
    const toggle = document.getElementById('pricing-billing-switch');
    if (!toggle || toggle.dataset.pricingToggleAttached) {
      return;
    }
    toggle.dataset.pricingToggleAttached = 'true';
    toggle.addEventListener('click', () => {
      setBillingPeriod(activeBillingPeriod === BILLING_YEAR ? BILLING_MONTH : BILLING_YEAR);
    });
  }

  /**
   * Resolve the tier a member is actually entitled to right now.
   *
   * An expired subscription reads as free: the stored tier alone would keep
   * showing a lapsed member their old plan as current.
   * @param {Object|null} user User record, or null when signed out.
   * @returns {string} Tier key.
   */
  function getActiveTier(user) {
    if (!user) {
      return 'free';
    }
    const expiry = user.proExpiresAt ? Date.parse(user.proExpiresAt) : null;
    if (expiry !== null && !Number.isNaN(expiry) && expiry <= Date.now()) {
      return 'free';
    }
    if (user.subscriptionTier && user.subscriptionTier !== 'free') {
      return user.subscriptionTier;
    }
    return user.isPro ? 'pro' : 'free';
  }

  /**
   * Make a call to action inert, keeping the styling in the stylesheet rather
   * than as inline attributes so the state survives a later re-render.
   * @param {HTMLElement} button Call-to-action element.
   * @param {string} label Replacement label.
   * @param {string} [variant] Extra class describing the reason.
   * @returns {void} Nothing.
   */
  function makeInert(button, label, variant) {
    button.textContent = label;
    button.classList.remove('secondary');
    button.classList.add('is-inert');
    if (variant) {
      button.classList.add(variant);
    }
    button.setAttribute('aria-disabled', 'true');
    // Dropping `href` is what makes the link inert, but it also drops it out
    // of the tab order, so the state is never announced. `tabindex` puts it
    // back without making it activatable.
    button.setAttribute('role', 'link');
    button.setAttribute('tabindex', '0');
    button.removeAttribute('href');
  }

  /**
   * Present the page to a signed-in customer, who does not buy supplier plans.
   * @returns {void} Nothing.
   */
  function updateButtonsForCustomer() {
    pricingAuthMode = 'customer';
    const notice = document.getElementById('pricing-customer-notice');
    if (notice) {
      notice.hidden = false;
      notice.style.display = '';
      notice.replaceChildren(buildCustomerNotice());
    }
    document.querySelectorAll('.pricing-cta').forEach(button => {
      makeInert(button, 'Supplier plan');
    });
  }

  /**
   * Build the "EventFlow is free for customers" notice.
   * @returns {HTMLElement} Notice element.
   */
  function buildCustomerNotice() {
    const inner = document.createElement('div');
    inner.className = 'pricing-customer-notice-inner';

    const icon = document.createElement('span');
    icon.className = 'pricing-customer-notice-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'ℹ️';

    const title = document.createElement('p');
    title.className = 'pricing-customer-notice-title';
    title.textContent = 'EventFlow is free for customers';

    const body = document.createElement('p');
    body.className = 'pricing-customer-notice-body';
    body.textContent =
      'These subscriptions are only for suppliers. You can continue planning events, finding suppliers and sending enquiries at no cost.';

    const text = document.createElement('div');
    text.append(title, body);
    inner.append(icon, text);
    return inner;
  }

  /**
   * Present the page to a signed-in supplier, flagging their current plan.
   * @param {Object} user User record.
   * @returns {void} Nothing.
   */
  function updateButtonsForAuthenticatedUser(user) {
    pricingAuthMode = 'authenticated';
    const tier = getActiveTier(user);
    const tiers = { starter: 'free', pro: 'pro', pro_plus: 'pro_plus' };
    setBillingPeriod(activeBillingPeriod);
    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
      const button = card.querySelector('.pricing-cta');
      if (button && tiers[card.dataset.plan] === tier) {
        makeInert(button, 'Your current plan', 'is-current');
      }
    });
  }

  /**
   * Present the page to a signed-out visitor.
   * @returns {void} Nothing.
   */
  function updateButtonsForUnauthenticatedUser() {
    pricingAuthMode = 'unauthenticated';
    setBillingPeriod(activeBillingPeriod);
  }

  /**
   * Find out whether the signed-in supplier already has a live, paid
   * subscription — the canonical /me endpoint (not the auth record, which
   * only carries a denormalised tier) is what upgrade/downgrade also key
   * off, so this stays consistent with what those endpoints will actually do.
   * @returns {Promise<void>} Resolves once hasLiveSubscription is current.
   */
  async function checkLiveSubscription() {
    try {
      const response = await fetch('/api/v2/subscriptions/me', { credentials: 'include' });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      hasLiveSubscription = Boolean(data.plan && data.plan !== 'free' && data.subscription?.id);
    } catch (_error) {
      // Leave hasLiveSubscription at its default (false) — worst case a
      // subscriber briefly sees checkout-styled buttons rather than the
      // reverse, which is the direction that matters for correctness.
    }
  }

  /**
   * Resolve the viewer and adjust the calls to action to match.
   *
   * A failure falls back to the signed-out presentation, which is the view
   * that works for everyone.
   * @returns {Promise<void>} Resolves once the buttons reflect the viewer.
   */
  async function checkAuthAndUpdateButtons() {
    try {
      let user = null;
      if (window.AuthStateManager) {
        const state = await window.AuthStateManager.init();
        user = state && state.user;
      } else {
        const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          user = data.user || data;
        }
      }
      if (!user) {
        return updateButtonsForUnauthenticatedUser();
      }
      if (user.role === 'customer') {
        return updateButtonsForCustomer();
      }
      await checkLiveSubscription();
      updateButtonsForAuthenticatedUser(user);
      attachCheckoutHandlers();
    } catch (_error) {
      updateButtonsForUnauthenticatedUser();
    }
  }

  /**
   * Bind checkout to each purchasable call to action, guarding double binding.
   *
   * Plans with no Stripe price are skipped: posting one to the checkout
   * endpoint only to be redirected back is a round trip with nothing at the
   * end of it.
   * @returns {void} Nothing.
   */
  function attachCheckoutHandlers() {
    // An existing subscriber's cards already point at the subscription
    // management page (see getCtaHref) and must navigate there normally —
    // intercepting the click and posting to checkout here would create a
    // second Stripe subscription alongside the one they already have.
    if (hasLiveSubscription) {
      return;
    }
    const successUrl = `${window.location.origin}${SUPPLIER_DASHBOARD}?billing=success`;
    const cancelUrl = `${window.location.origin}/pricing?checkout=cancelled`;
    document.querySelectorAll('.pricing-cta[data-pricing-plan]').forEach(button => {
      const plan = PLAN_CONFIG[button.dataset.pricingPlan];
      if (!plan || !plan.checkout) {
        return;
      }
      if (button.getAttribute('aria-disabled') === 'true' || button.dataset.checkoutHandler) {
        return;
      }
      button.dataset.checkoutHandler = 'attached';
      button.addEventListener('click', async function (event) {
        let checkoutUrl = null;
        try {
          checkoutUrl = new URL(this.href, window.location.origin);
        } catch (_error) {
          return;
        }
        const planId = checkoutUrl.searchParams.get('plan');
        const billingInterval =
          checkoutUrl.searchParams.get('billingInterval') === BILLING_MONTH
            ? BILLING_MONTH
            : BILLING_YEAR;
        if (!planId) {
          return;
        }

        event.preventDefault();
        const originalText = this.textContent;
        try {
          this.setAttribute('aria-disabled', 'true');
          this.textContent = 'Opening secure checkout…';
          const csrfResponse = await fetch('/api/csrf-token', { credentials: 'include' });
          if (!csrfResponse.ok) {
            throw new Error('Failed to get CSRF token');
          }
          const csrfData = await csrfResponse.json();
          const csrfToken = csrfData.token || csrfData.csrfToken;
          const response = await fetch('/api/v2/subscriptions/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            credentials: 'include',
            body: JSON.stringify({ planId, billingInterval, successUrl, cancelUrl }),
          });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              errorData.error || errorData.message || 'Failed to create checkout session'
            );
          }
          const data = await response.json();
          const target = data.url || data.checkoutUrl;
          if (!target) {
            throw new Error('No checkout URL returned');
          }
          window.location.href = target;
        } catch (error) {
          console.error('Checkout error:', error);
          const message = error.message || 'Failed to start checkout. Please try again.';
          if (window.showNotification) {
            window.showNotification(message, 'error');
          } else {
            window.alert(message);
          }
          this.removeAttribute('aria-disabled');
          this.textContent = originalText;
        }
      });
    });
  }

  /**
   * Show a page-level notice.
   * @param {string} message Message text.
   * @param {string} variant One of 'amber', 'green' or 'red'.
   * @returns {void} Nothing.
   */
  function showBanner(message, variant) {
    const classNames = {
      amber: 'pricing-notice-banner--info',
      green: 'pricing-notice-banner--success',
      red: 'pricing-notice-banner--error',
    };
    document.getElementById('pricing-status-banner')?.remove();
    const banner = document.createElement('div');
    banner.id = 'pricing-status-banner';
    banner.setAttribute('role', 'status');
    banner.className = `pricing-notice-banner ${classNames[variant] || classNames.amber}`;

    const text = document.createElement('span');
    text.className = 'pricing-banner-msg';
    text.textContent = message;

    const dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.setAttribute('aria-label', 'Dismiss');
    dismissButton.textContent = '×';

    banner.append(text, dismissButton);
    document.body.appendChild(banner);

    const dismiss = () => banner.remove();
    window.setTimeout(dismiss, 8000);
    dismissButton.addEventListener('click', dismiss);
  }

  /**
   * Report a cancelled checkout and strip the marker from the address bar so a
   * refresh does not announce it again.
   * @returns {void} Nothing.
   */
  function handleCheckoutRedirectParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'cancelled') {
      return;
    }
    const clean = new URL(window.location.href);
    clean.searchParams.delete('checkout');
    window.history.replaceState({}, '', clean.toString());
    showBanner("No charge was made. You can subscribe whenever you're ready.", 'amber');
  }

  /**
   * Start the pricing page enhancements.
   *
   * Auth is resolved before the plan copy is hydrated so the calls to action
   * are only ever written once, with the viewer already known: hydrating
   * first would briefly point a signed-out visitor's button at checkout.
   * @returns {Promise<void>} Resolves once the page is hydrated.
   */
  async function init() {
    ensureRedesignStylesheet();
    document.body.classList.add('pricing-redesign');
    activeBillingPeriod = readInitialBillingPeriod();
    attachBillingToggle();
    setBillingPeriod(activeBillingPeriod);
    handleCheckoutRedirectParams();
    // Independent of the plan data, and not worth delaying the prices for.
    renderSupplierProof();
    await checkAuthAndUpdateButtons();
    await hydrateCanonicalPlanPresentation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
