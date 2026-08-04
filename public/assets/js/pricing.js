/**
 * Pricing Page JavaScript
 * Handles the pricing redesign, billing-period toggle, authentication state,
 * and checkout CTA behaviour.
 */

(function () {
  'use strict';

  const BILLING_MONTH = 'month';
  const BILLING_YEAR = 'year';

  const PLAN_CONFIG = {
    starter: {
      name: 'Starter',
      description: 'Perfect for getting started on EventFlow.',
      monthlyPrice: 0,
      annualMonthlyPrice: 0,
      annualTotal: 0,
      annualSaving: 0,
      annualDiscount: 0,
      features: [
        'Basic supplier profile',
        'Up to 5 photos',
        'Receive enquiries',
        'Standard listing in search',
        'Email support',
      ],
      ctaMonthly: 'Get Started for Free',
      ctaAnnual: 'Get Started for Free',
      hrefPlan: 'starter',
      secondary: true,
    },
    pro: {
      name: 'Professional',
      description: 'For serious suppliers who want to grow their business.',
      monthlyPrice: 19,
      annualMonthlyPrice: 16,
      annualTotal: 192,
      annualSaving: 36,
      annualDiscount: 16,
      features: [
        'Everything in Free',
        'Unlimited photos',
        'Lead quality scoring (High/Medium/Low)',
        'Priority placement in search results',
        'Email & phone verification badges',
        'Response time tracking',
        'Profile analytics dashboard',
        'Priority support',
      ],
      ctaMonthly: 'Get Started — £19/month',
      ctaAnnual: 'Get Started — £192/year',
      hrefPlan: 'pro',
      featured: true,
      earlyAccess: true,
    },
    pro_plus: {
      name: 'Professional Plus',
      description: 'Maximum visibility and premium features.',
      monthlyPrice: 159,
      annualMonthlyPrice: 129,
      annualTotal: 1548,
      annualSaving: 360,
      annualDiscount: 19,
      features: [
        'Everything in Professional',
        'Homepage featured placement',
        'Top of category pages',
        'Business verification badge',
        'Dedicated onboarding call',
        'Monthly performance review',
        'Export analytics to CSV',
        'VIP support',
      ],
      ctaMonthly: 'Get Professional Plus',
      ctaAnnual: 'Get Professional Plus',
      hrefPlan: 'pro_plus',
    },
  };

  // Annual is deliberately the default because it is the promoted best-value view.
  // A billingInterval/period URL parameter can still explicitly select monthly.
  let activeBillingPeriod = BILLING_YEAR;
  let pricingAuthMode = 'unknown';

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    const node = document.createElement('div');
    node.textContent = String(value);
    return node.innerHTML;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value);
  }

  function ensureRedesignStylesheet() {
    if (document.getElementById('pricing-redesign-styles')) {
      return;
    }

    const stylesheet = document.createElement('link');
    stylesheet.id = 'pricing-redesign-styles';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/assets/css/pricing-redesign.css?v=1.0.0';
    document.head.appendChild(stylesheet);
  }

  function getPlanKeyForCard(card, index) {
    const link = card.querySelector('a[href*="plan="]');
    if (link) {
      try {
        const plan = new URL(link.href, window.location.origin).searchParams.get('plan');
        if (plan === 'starter' || plan === 'free') {
          return 'starter';
        }
        if (plan === 'pro') {
          return 'pro';
        }
        if (plan === 'pro_plus') {
          return 'pro_plus';
        }
      } catch (_error) {
        // Fall through to the stable card order below.
      }
    }

    return ['starter', 'pro', 'pro_plus'][index] || null;
  }

  function renderCard(card, planKey) {
    const plan = PLAN_CONFIG[planKey];
    if (!plan) {
      return;
    }

    card.dataset.plan = planKey;
    card.classList.toggle('featured', Boolean(plan.featured));

    const popularRibbon = plan.featured
      ? '<div class="pricing-popular-ribbon">Most Popular</div>'
      : '';
    const earlyAccessLabel = plan.earlyAccess
      ? '<span class="pricing-early-access-label">Early Access Offer</span>'
      : '';
    const earlyAccessDescription = plan.earlyAccess
      ? '<p class="pricing-early-access-desc">Early access pricing while EventFlow is in development.</p>'
      : '';
    const offerTerms = plan.earlyAccess
      ? '<p class="pricing-offer-terms">Offer ends 31 December 2026. After this date, standard pricing applies. Cancel anytime.</p>'
      : '';
    const secondaryClass = plan.secondary ? ' secondary' : '';
    const features = plan.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('');
    const initialAnnual = activeBillingPeriod === BILLING_YEAR;
    const initialPrice = initialAnnual ? plan.annualMonthlyPrice : plan.monthlyPrice;
    const initialBilledLine = initialAnnual
      ? `£${formatMoney(plan.annualTotal)} billed annually`
      : `£${formatMoney(plan.monthlyPrice)} billed monthly`;
    const initialNormally =
      initialAnnual && plan.monthlyPrice > 0
        ? `Normally £${formatMoney(plan.monthlyPrice)}/month`
        : '';
    const initialSaving =
      initialAnnual && plan.annualSaving > 0
        ? `Save £${formatMoney(plan.annualSaving)} annually (${plan.annualDiscount}%)`
        : '';
    const initialCta = initialAnnual ? plan.ctaAnnual : plan.ctaMonthly;

    card.innerHTML = `
      ${popularRibbon}
      <div class="pricing-card-content">
        ${earlyAccessLabel}
        <div class="pricing-card-heading">
          <h2 class="pricing-name">${escapeHtml(plan.name)}</h2>
          <p class="pricing-description">${escapeHtml(plan.description)}</p>
        </div>

        <div class="pricing-price-row">
          <span class="pricing-price" data-pricing-price>£${formatMoney(initialPrice)}</span>
          <span class="pricing-period">/month</span>
        </div>
        <p class="pricing-billed-line" data-pricing-billed-line>${escapeHtml(initialBilledLine)}</p>
        <p class="pricing-normally" data-pricing-normally${initialNormally ? '' : ' hidden'}>${escapeHtml(initialNormally)}</p>
        ${earlyAccessDescription}

        <div class="pricing-card-divider" aria-hidden="true"></div>
        <ul class="pricing-features">${features}</ul>

        <a
          href="/checkout?plan=${encodeURIComponent(plan.hrefPlan)}&billingInterval=${activeBillingPeriod}"
          class="pricing-cta${secondaryClass}"
          data-pricing-plan="${escapeHtml(plan.hrefPlan)}"
        >${escapeHtml(initialCta)}</a>
        <p class="pricing-savings" data-pricing-savings${initialSaving ? '' : ' hidden'}>${escapeHtml(initialSaving)}</p>
        ${offerTerms}
      </div>
    `;
  }

  function renderHero() {
    const hero = document.querySelector('.pricing-hero');
    const heroInner = hero?.querySelector('.container');
    if (!hero || !heroInner) {
      return;
    }

    heroInner.innerHTML = `
      <p class="pricing-eyebrow">Pricing</p>
      <h1>Simple, transparent pricing</h1>
      <p class="subtitle">Choose the plan that's right for your business.<br>Upgrade or downgrade at any time.</p>
      <div class="pricing-billing-toggle" role="group" aria-label="Choose billing frequency">
        <span id="pricing-monthly-label" class="pricing-billing-label">Billed monthly</span>
        <button
          id="pricing-billing-switch"
          class="pricing-billing-switch is-annual"
          type="button"
          role="switch"
          aria-checked="true"
          aria-labelledby="pricing-monthly-label pricing-annual-label"
        >
          <span class="pricing-billing-switch-thumb" aria-hidden="true"></span>
        </button>
        <span id="pricing-annual-label" class="pricing-billing-label is-active">Billed annually</span>
        <span class="pricing-billing-saving">Save up to 19%</span>
      </div>
    `;
  }

  function renderSecurityNote() {
    const grid = document.getElementById('pricing-grid');
    if (!grid || document.getElementById('pricing-security-note')) {
      return;
    }

    const note = document.createElement('div');
    note.id = 'pricing-security-note';
    note.className = 'pricing-security-note';
    note.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M12 3 5.5 6v5.2c0 4.4 2.7 7.8 6.5 9.8 3.8-2 6.5-5.4 6.5-9.8V6L12 3Z"></path>
        <path d="m9.4 12 1.7 1.7 3.6-3.8"></path>
      </svg>
      <span>Secure payments. Cancel anytime.</span>
    `;
    grid.insertAdjacentElement('afterend', note);
  }

  function readInitialBillingPeriod() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('billingInterval') || params.get('period');
    if (requested === BILLING_MONTH || requested === 'monthly') {
      return BILLING_MONTH;
    }
    if (requested === BILLING_YEAR || requested === 'annual') {
      return BILLING_YEAR;
    }
    return BILLING_YEAR;
  }

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
      billedLine.textContent = annual
        ? `£${formatMoney(plan.annualTotal)} billed annually`
        : `£${formatMoney(plan.monthlyPrice)} billed monthly`;
    }

    if (normallyLine) {
      const showNormally = annual && plan.monthlyPrice > 0;
      normallyLine.hidden = !showNormally;
      normallyLine.textContent = showNormally
        ? `Normally £${formatMoney(plan.monthlyPrice)}/month`
        : '';
    }

    if (savingsLine) {
      const showSaving = annual && plan.annualSaving > 0;
      savingsLine.hidden = !showSaving;
      savingsLine.textContent = showSaving
        ? `Save £${formatMoney(plan.annualSaving)} annually (${plan.annualDiscount}%)`
        : '';
    }

    if (cta && cta.getAttribute('aria-disabled') !== 'true') {
      cta.textContent = annual ? plan.ctaAnnual : plan.ctaMonthly;
      const directHref = `/checkout?plan=${encodeURIComponent(
        plan.hrefPlan
      )}&billingInterval=${period}`;

      if (pricingAuthMode === 'unauthenticated') {
        const redirect = `/pricing?plan=${encodeURIComponent(
          plan.hrefPlan
        )}&billingInterval=${period}`;
        cta.setAttribute('href', `/auth?redirect=${encodeURIComponent(redirect)}`);
      } else {
        cta.setAttribute('href', directHref);
      }
    }
  }

  function setBillingPeriod(period) {
    activeBillingPeriod = period === BILLING_MONTH ? BILLING_MONTH : BILLING_YEAR;
    const annual = activeBillingPeriod === BILLING_YEAR;
    const toggle = document.getElementById('pricing-billing-switch');
    const monthlyLabel = document.getElementById('pricing-monthly-label');
    const annualLabel = document.getElementById('pricing-annual-label');

    document.body.dataset.pricingBilling = activeBillingPeriod;

    if (toggle) {
      toggle.setAttribute('aria-checked', String(annual));
      toggle.classList.toggle('is-annual', annual);
    }
    monthlyLabel?.classList.toggle('is-active', !annual);
    annualLabel?.classList.toggle('is-active', annual);

    document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
      updateCardBilling(card, activeBillingPeriod);
    });
  }

  function attachBillingToggle() {
    const toggle = document.getElementById('pricing-billing-switch');
    if (!toggle) {
      return;
    }

    toggle.addEventListener('click', () => {
      setBillingPeriod(activeBillingPeriod === BILLING_YEAR ? BILLING_MONTH : BILLING_YEAR);
    });
  }

  function buildPricingRedesign() {
    ensureRedesignStylesheet();
    document.body.classList.add('pricing-redesign');
    renderHero();

    document.querySelectorAll('#pricing-grid .pricing-card').forEach((card, index) => {
      const planKey = getPlanKeyForCard(card, index);
      if (planKey) {
        renderCard(card, planKey);
      }
    });

    renderSecurityNote();
    attachBillingToggle();
    setBillingPeriod(readInitialBillingPeriod());
  }

  async function checkAuthAndUpdateButtons() {
    try {
      let user = null;

      if (window.AuthStateManager) {
        const authState = await window.AuthStateManager.init();
        user = authState && authState.user;
      } else {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          user = data.user || data;
        }
      }

      if (user) {
        if (user.role === 'customer') {
          updateButtonsForCustomer();
        } else {
          updateButtonsForAuthenticatedUser(user);
          attachCheckoutHandlers();
        }
      } else {
        updateButtonsForUnauthenticatedUser();
      }
    } catch (_error) {
      updateButtonsForUnauthenticatedUser();
    }
  }

  function getActiveTier(user) {
    if (!user) {
      return 'free';
    }

    const tier = user.subscriptionTier || 'free';
    if (tier !== 'free') {
      if (user.proExpiresAt) {
        const expiryTime = Date.parse(user.proExpiresAt);
        if (!Number.isNaN(expiryTime) && expiryTime <= Date.now()) {
          return 'free';
        }
      }
      return tier;
    }

    if (user.isPro) {
      if (user.proExpiresAt) {
        const expiryTime = Date.parse(user.proExpiresAt);
        if (!Number.isNaN(expiryTime) && expiryTime <= Date.now()) {
          return 'free';
        }
      }
      return 'pro';
    }

    return 'free';
  }

  function updateButtonsForCustomer() {
    pricingAuthMode = 'customer';
    const notice = document.getElementById('pricing-customer-notice');
    if (notice) {
      notice.style.display = '';
      notice.innerHTML =
        '<div class="pricing-customer-notice-inner">' +
        '<span class="pricing-customer-notice-icon" aria-hidden="true">ℹ️</span>' +
        '<div>' +
        '<p class="pricing-customer-notice-title">These plans are for suppliers only</p>' +
        '<p class="pricing-customer-notice-body">As a customer, you already have full access to EventFlow at no cost — browse suppliers, send enquiries, and manage your event planning for free. Subscriptions unlock premium features for suppliers looking to grow their business on the platform.</p>' +
        '</div>' +
        '</div>';
    }

    document.querySelectorAll('.pricing-cta, #pricing-bottom-cta').forEach(button => {
      button.textContent = 'For Suppliers Only';
      button.style.opacity = '0.5';
      button.style.cursor = 'not-allowed';
      button.style.pointerEvents = 'none';
      button.setAttribute('aria-disabled', 'true');
      button.removeAttribute('href');
    });
  }

  function markAsCurrentPlan(button) {
    button.textContent = 'Your Current Plan';
    button.classList.remove('secondary');
    button.style.opacity = '0.6';
    button.style.cursor = 'default';
    button.style.pointerEvents = 'none';
    button.setAttribute('aria-disabled', 'true');
  }

  function getPlanFromHref(button) {
    const href = button.getAttribute('href');
    if (!href) {
      return null;
    }

    try {
      return new URL(href, window.location.origin).searchParams.get('plan');
    } catch (_error) {
      return null;
    }
  }

  function updateButtonsForAuthenticatedUser(user) {
    pricingAuthMode = 'authenticated';
    const tier = getActiveTier(user);
    const planTiers = {
      starter: 'free',
      free: 'free',
      pro: 'pro',
      pro_plus: 'pro_plus',
    };

    document.querySelectorAll('a[href*="/checkout?plan="]').forEach(button => {
      const planKey = getPlanFromHref(button);
      const planTier = planTiers[planKey] || planKey;
      if (planTier === tier) {
        markAsCurrentPlan(button);
      }
    });

    const bottomCta = document.getElementById('pricing-bottom-cta');
    if (bottomCta && tier === 'free') {
      markAsCurrentPlan(bottomCta);
    } else if (bottomCta) {
      bottomCta.style.display = 'none';
    }
  }

  function attachCheckoutHandlers() {
    const successUrl = `${window.location.origin}/dashboard/supplier?billing=success`;
    const cancelUrl = `${window.location.origin}/pricing?checkout=cancelled`;

    document.querySelectorAll('.pricing-cta').forEach(button => {
      if (button.getAttribute('aria-disabled') === 'true' || button.dataset.checkoutHandler) {
        return;
      }

      button.dataset.checkoutHandler = 'attached';
      button.addEventListener('click', async function (event) {
        const href = this.getAttribute('href');
        let checkoutUrl;

        try {
          checkoutUrl = href ? new URL(href, window.location.origin) : null;
        } catch (_error) {
          checkoutUrl = null;
        }

        const planId = checkoutUrl?.searchParams.get('plan');
        const billingInterval =
          checkoutUrl?.searchParams.get('billingInterval') === BILLING_MONTH
            ? BILLING_MONTH
            : BILLING_YEAR;

        if (!planId) {
          return;
        }

        event.preventDefault();
        const originalText = this.textContent;

        try {
          this.setAttribute('aria-disabled', 'true');
          this.textContent = 'Processing...';

          const csrfResponse = await fetch('/api/csrf-token', { credentials: 'include' });
          if (!csrfResponse.ok) {
            throw new Error('Failed to get CSRF token');
          }
          const csrfData = await csrfResponse.json();
          const csrfToken = csrfData.token || csrfData.csrfToken;

          const response = await fetch('/api/v2/subscriptions/create-checkout-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken,
            },
            credentials: 'include',
            body: JSON.stringify({
              planId,
              billingInterval,
              successUrl,
              cancelUrl,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
              errorData.error || errorData.message || 'Failed to create checkout session'
            );
          }

          const data = await response.json();
          if (data.url || data.checkoutUrl) {
            window.location.href = data.url || data.checkoutUrl;
          } else {
            throw new Error('No checkout URL returned');
          }
        } catch (error) {
          console.error('Checkout error:', error);
          if (window.showNotification) {
            window.showNotification(
              error.message || 'Failed to start checkout. Please try again.',
              'error'
            );
          } else {
            window.alert(error.message || 'Failed to start checkout. Please try again.');
          }
          this.removeAttribute('aria-disabled');
          this.textContent = originalText;
        }
      });
    });
  }

  function updateButtonsForUnauthenticatedUser() {
    pricingAuthMode = 'unauthenticated';
    document.querySelectorAll('a[href*="/checkout?plan="]').forEach(button => {
      const originalHref = button.getAttribute('href');
      if (!originalHref) {
        return;
      }

      try {
        const url = new URL(originalHref, window.location.origin);
        const plan = url.searchParams.get('plan');
        const billingInterval =
          url.searchParams.get('billingInterval') === BILLING_MONTH ? BILLING_MONTH : BILLING_YEAR;

        if (plan) {
          const redirect = `/pricing?plan=${encodeURIComponent(
            plan
          )}&billingInterval=${billingInterval}`;
          button.setAttribute('href', `/auth?redirect=${encodeURIComponent(redirect)}`);
        }
      } catch (_error) {
        // Leave malformed links unchanged rather than breaking the page.
      }
    });
  }

  function showBanner(message, variant) {
    const variantConfig = {
      amber: { className: 'pricing-notice-banner--info', background: '#f59e0b' },
      green: { className: 'pricing-notice-banner--success' },
      red: { className: 'pricing-notice-banner--error' },
    };
    const config = variantConfig[variant] || variantConfig.amber;
    const existing = document.getElementById('pricing-status-banner');
    if (existing) {
      existing.remove();
    }

    const banner = document.createElement('div');
    banner.id = 'pricing-status-banner';
    banner.setAttribute('role', 'status');
    banner.className = `pricing-notice-banner ${config.className}`;
    banner.style.display = 'flex';
    banner.style.alignItems = 'flex-start';
    banner.style.gap = '0.625rem';
    banner.style.lineHeight = '1.5';
    if (config.background) {
      banner.style.background = config.background;
    }
    banner.innerHTML =
      `<span class="pricing-banner-msg">${escapeHtml(message)}</span>` +
      '<button data-dismiss-pricing-banner aria-label="Dismiss" ' +
      'style="background:none;border:none;color:#fff;cursor:pointer;font-size:1.25rem;' +
      'line-height:1;padding:0;margin-left:0.25rem;flex-shrink:0;">&#x00D7;</button>';

    document.body.appendChild(banner);

    const dismiss = () => {
      if (banner.parentNode) {
        banner.remove();
      }
    };
    window.setTimeout(dismiss, 8000);
    banner.querySelector('[data-dismiss-pricing-banner]').addEventListener('click', dismiss);
  }

  function handleCheckoutRedirectParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'cancelled') {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('checkout');
      window.history.replaceState({}, '', clean.toString());
      showBanner("ℹ️ No charge was made. You can subscribe whenever you're ready.", 'amber');
    }
  }

  function init() {
    buildPricingRedesign();
    handleCheckoutRedirectParams();
    checkAuthAndUpdateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
