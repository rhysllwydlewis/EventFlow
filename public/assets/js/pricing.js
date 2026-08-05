/**
 * EventFlow supplier pricing page enhancement.
 * The HTML contains the complete first paint; this script hydrates canonical
 * public pricing, switches billing periods, applies auth state and starts checkout.
 */
(function () {
  'use strict';

  const BILLING_MONTH = 'month';
  const BILLING_YEAR = 'year';
  const PLAN_CONFIG = {
    starter: {
      apiPlanId: 'free',
      hrefPlan: 'starter',
      name: 'Starter',
      monthlyPrice: 0,
      annualMonthlyPrice: 0,
      annualTotal: 0,
      annualSaving: 0,
      annualDiscount: 0,
      ctaMonthly: 'Create a free profile',
      ctaAnnual: 'Create a free profile',
    },
    pro: {
      apiPlanId: 'pro',
      hrefPlan: 'pro',
      name: 'Professional',
      monthlyPrice: 19,
      annualMonthlyPrice: 16,
      annualTotal: 192,
      annualSaving: 36,
      annualDiscount: 16,
      ctaMonthly: 'Choose Professional — £19/month',
      ctaAnnual: 'Choose Professional — £192/year',
    },
    pro_plus: {
      apiPlanId: 'pro_plus',
      hrefPlan: 'pro_plus',
      name: 'Professional Plus',
      monthlyPrice: 159,
      annualMonthlyPrice: 129,
      annualTotal: 1548,
      annualSaving: 360,
      annualDiscount: 19,
      ctaMonthly: 'Choose Professional Plus — £159/month',
      ctaAnnual: 'Choose Professional Plus — £1,548/year',
    },
  };

  let activeBillingPeriod = BILLING_YEAR;
  let pricingAuthMode = 'unknown';

  /**
   * Escape a value for safe interpolation into markup.
   * @param {*} value Raw value; null and undefined become an empty string.
   * @returns {string} Escaped text.
   */
  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = value === null || value === undefined ? '' : String(value);
    return node.innerHTML;
  }

  /**
   * Format an amount as a whole-pound figure in UK grouping.
   * @param {number} value Amount in pounds.
   * @returns {string} Formatted number, without a currency symbol.
   */
  function formatMoney(value) {
    return new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value);
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
    stylesheet.href = '/assets/css/pricing-redesign.css?v=2.0.0';
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
   * Replace a card's server-rendered copy with canonical plan presentation.
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
    const name = card.querySelector('.pricing-name');
    const description = card.querySelector('.pricing-description');
    const audience = card.querySelector('.pricing-tier-label');
    const features = card.querySelector('.pricing-features');
    if (name) {
      name.textContent = plan.name;
    }
    if (description && presentation.description) {
      description.textContent = presentation.description;
    }
    if (audience && presentation.audience) {
      audience.textContent = presentation.audience;
    }
    if (features && Array.isArray(presentation.highlights)) {
      features.innerHTML = presentation.highlights
        .map(feature => `<li>${escapeHtml(feature)}</li>`)
        .join('');
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
        updateStaticPlanContent(key, byId.get(plan.apiPlanId)?.presentation);
      });
      setBillingPeriod(activeBillingPeriod);
    } catch (_error) {
      // Matching fallback prices and copy are already rendered in the HTML.
    }
  }

  /**
   * Build the checkout URL for a plan at a billing period.
   * @param {Object} plan Plan configuration.
   * @param {string} period Billing period.
   * @returns {string} Checkout URL.
   */
  function getDirectCheckoutHref(plan, period) {
    return `/checkout?plan=${encodeURIComponent(plan.hrefPlan)}&billingInterval=${period}`;
  }

  /**
   * Build the sign-in URL for a plan, returning to pricing afterwards.
   *
   * The chosen interval is carried through the round trip so a visitor who
   * picked annual does not come back to a monthly page.
   * @param {Object} plan Plan configuration.
   * @param {string} period Billing period.
   * @returns {string} Auth URL with an encoded redirect.
   */
  function getAuthHref(plan, period) {
    const redirect = `/pricing?plan=${encodeURIComponent(plan.hrefPlan)}&billingInterval=${period}`;
    return `/auth?redirect=${encodeURIComponent(redirect)}`;
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
    const price = annual ? plan.annualMonthlyPrice : plan.monthlyPrice;
    const priceElement = card.querySelector('[data-pricing-price]');
    const billedLine = card.querySelector('[data-pricing-billed-line]');
    const normallyLine = card.querySelector('[data-pricing-normally]');
    const savingsLine = card.querySelector('[data-pricing-savings]');
    const cta = card.querySelector('.pricing-cta');

    if (priceElement) {
      priceElement.textContent = `£${formatMoney(price)}`;
    }
    if (billedLine) {
      billedLine.textContent =
        planKey === 'starter'
          ? 'No card required'
          : annual
            ? `£${formatMoney(plan.annualTotal)} billed annually`
            : 'Billed monthly';
    }
    if (normallyLine) {
      const show = annual && plan.monthlyPrice > 0;
      normallyLine.hidden = !show;
      normallyLine.textContent = show ? `Normally £${formatMoney(plan.monthlyPrice)}/month` : '';
    }
    if (savingsLine) {
      const show = annual && plan.annualSaving > 0;
      savingsLine.hidden = !show;
      savingsLine.textContent = show
        ? `Save £${formatMoney(plan.annualSaving)} annually (${plan.annualDiscount}%)`
        : '';
    }
    if (cta && cta.getAttribute('aria-disabled') !== 'true') {
      cta.textContent = annual ? plan.ctaAnnual : plan.ctaMonthly;
      cta.href =
        pricingAuthMode === 'unauthenticated'
          ? getAuthHref(plan, period)
          : getDirectCheckoutHref(plan, period);
    }
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
   * Present the page to a signed-in customer, who does not buy supplier plans.
   * @returns {void} Nothing.
   */
  function updateButtonsForCustomer() {
    pricingAuthMode = 'customer';
    const notice = document.getElementById('pricing-customer-notice');
    if (notice) {
      notice.style.display = '';
      notice.innerHTML =
        '<div class="pricing-customer-notice-inner">' +
        '<span class="pricing-customer-notice-icon" aria-hidden="true">ℹ️</span>' +
        '<div><p class="pricing-customer-notice-title">EventFlow is free for customers</p>' +
        '<p class="pricing-customer-notice-body">These subscriptions are only for suppliers. You can continue planning events, finding suppliers and sending enquiries at no cost.</p></div></div>';
    }
    document.querySelectorAll('.pricing-cta').forEach(button => {
      button.textContent = 'Supplier plan';
      button.style.opacity = '0.55';
      button.style.cursor = 'not-allowed';
      button.style.pointerEvents = 'none';
      button.setAttribute('aria-disabled', 'true');
      button.removeAttribute('href');
    });
  }

  /**
   * Mark a plan's button as the member's current plan and make it inert.
   * @param {HTMLElement} button Call-to-action element.
   * @returns {void} Nothing.
   */
  function markAsCurrentPlan(button) {
    button.textContent = 'Your current plan';
    button.classList.remove('secondary');
    button.style.opacity = '0.65';
    button.style.cursor = 'default';
    button.style.pointerEvents = 'none';
    button.setAttribute('aria-disabled', 'true');
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
    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
      const button = card.querySelector('.pricing-cta');
      if (button && tiers[card.dataset.plan] === tier) {
        markAsCurrentPlan(button);
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
      updateButtonsForAuthenticatedUser(user);
      attachCheckoutHandlers();
    } catch (_error) {
      updateButtonsForUnauthenticatedUser();
    }
  }

  /**
   * Bind checkout to each active call to action, guarding double binding.
   * @returns {void} Nothing.
   */
  function attachCheckoutHandlers() {
    const successUrl = `${window.location.origin}/dashboard/supplier?billing=success`;
    const cancelUrl = `${window.location.origin}/pricing?checkout=cancelled`;
    document.querySelectorAll('.pricing-cta').forEach(button => {
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
    const options = {
      amber: { className: 'pricing-notice-banner--info', background: '#9a6700' },
      green: { className: 'pricing-notice-banner--success' },
      red: { className: 'pricing-notice-banner--error' },
    };
    const config = options[variant] || options.amber;
    document.getElementById('pricing-status-banner')?.remove();
    const banner = document.createElement('div');
    banner.id = 'pricing-status-banner';
    banner.setAttribute('role', 'status');
    banner.className = `pricing-notice-banner ${config.className}`;
    if (config.background) {
      banner.style.background = config.background;
    }
    banner.innerHTML =
      `<span class="pricing-banner-msg">${escapeHtml(message)}</span>` +
      '<button type="button" data-dismiss-pricing-banner aria-label="Dismiss">×</button>';
    document.body.appendChild(banner);
    const dismiss = () => banner.remove();
    window.setTimeout(dismiss, 8000);
    banner.querySelector('[data-dismiss-pricing-banner]')?.addEventListener('click', dismiss);
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
   * @returns {void} Nothing.
   */
  function init() {
    ensureRedesignStylesheet();
    document.body.classList.add('pricing-redesign');
    activeBillingPeriod = readInitialBillingPeriod();
    attachBillingToggle();
    setBillingPeriod(activeBillingPeriod);
    handleCheckoutRedirectParams();
    hydrateCanonicalPlanPresentation();
    checkAuthAndUpdateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
