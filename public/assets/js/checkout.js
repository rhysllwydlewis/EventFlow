/**
 * Checkout Page JavaScript
 * Handles plan selection and Stripe checkout session creation.
 */

'use strict';
(function () {
  const BILLING_MONTH = 'month';
  const BILLING_YEAR = 'year';
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  let stripe = null;
  let stripeConfig = null;

  const PLANS = {
    free: {
      name: 'Free',
      monthlyPrice: 0,
      annualMonthlyPrice: 0,
      annualTotal: 0,
      features: [
        'Basic supplier profile',
        'Up to 3 packages',
        'Up to 10 bookings per month',
        'Standard listing in search',
        'Email support',
      ],
      isFree: true,
    },
    pro: {
      name: 'Professional',
      monthlyPrice: 19,
      annualMonthlyPrice: 16,
      annualTotal: 192,
      annualSaving: 36,
      annualDiscount: 16,
      earlyAccess: true,
      normallyPrice: 19,
      earlyAccessEndDate: '31 December 2026',
      features: [
        'Everything in Free',
        'Unlimited photos',
        'Lead quality scoring (High/Medium/Low)',
        'Priority listing in search results',
        'Email & phone verification badges',
        'Response time tracking',
        'Profile analytics dashboard',
        'Priority support',
      ],
    },
    pro_plus: {
      name: 'Professional Plus',
      monthlyPrice: 159,
      annualMonthlyPrice: 129,
      annualTotal: 1548,
      annualSaving: 360,
      annualDiscount: 19,
      features: [
        'Everything in Pro',
        'Homepage featured placement',
        'Top of category pages',
        'Business verification badge',
        'Dedicated onboarding call',
        'Monthly performance review',
        'Export analytics to CSV',
        'VIP support',
      ],
      featured: true,
    },
  };

  function normalizePlanKey(value) {
    return value === 'starter' ? 'free' : value;
  }

  function getRequestedBillingInterval() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('billingInterval') || params.get('period');
    return requested === BILLING_YEAR || requested === 'annual' ? BILLING_YEAR : BILLING_MONTH;
  }

  function getPlanBilling(plan, billingInterval) {
    const annual = billingInterval === BILLING_YEAR && !plan.isFree;
    return {
      billingInterval: annual ? BILLING_YEAR : BILLING_MONTH,
      displayPrice: annual ? plan.annualMonthlyPrice : plan.monthlyPrice,
      billedLine: annual ? `£${formatMoney(plan.annualTotal)} billed annually` : '',
      savingLine:
        annual && plan.annualSaving
          ? `Save £${formatMoney(plan.annualSaving)} annually (${plan.annualDiscount}%)`
          : '',
    };
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value);
  }

  async function initializeStripe() {
    try {
      if (typeof Stripe === 'undefined') {
        console.error('Stripe.js not loaded');
        showError('Payment system not available. Please refresh the page.');
        return false;
      }

      const response = await fetch('/api/v1/payments/config', {
        credentials: 'include',
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          console.error('Failed to get Stripe config:', data);

          if (response.status === 500) {
            showError('Payment system temporarily unavailable. Please try again in a few moments.');
          } else if (response.status === 503) {
            showError('Payment processing is not currently available. Please contact support.');
          } else {
            showError(data.message || 'Failed to initialize payment system.');
          }
        } else {
          console.error('Failed to get Stripe config: Non-JSON response');
          showError('Payment system error. Please try again later.');
        }
        return false;
      }

      const config = await response.json();
      if (!config.publishableKey) {
        console.error('No Stripe publishable key received');
        showError('Payment configuration error. Please contact support.');
        return false;
      }

      stripeConfig = config;
      stripe = Stripe(config.publishableKey);
      if (isDevelopment) {
        console.log('✅ Stripe.js initialized');
      }
      return true;
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
      showError('Unable to connect to payment system. Please check your connection and try again.');
      return false;
    }
  }

  async function checkAuth() {
    try {
      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
      });
      const data = await response.json();

      if (!response.ok || !data.user) {
        const urlParams = new URLSearchParams(window.location.search);
        const plan = normalizePlanKey(urlParams.get('plan'));

        if (plan === 'free') {
          return 'unauthenticated_free';
        }

        window.location.href = `/auth?redirect=${encodeURIComponent(
          `${window.location.pathname}${window.location.search}`
        )}`;
        return false;
      }

      return true;
    } catch (error) {
      console.error('Auth check failed:', error);
      showError('Failed to verify authentication');
      return false;
    }
  }

  function showError(message) {
    const errorContainer = document.getElementById('error-container');
    if (!errorContainer) {
      return;
    }

    errorContainer.innerHTML = `
      <div class="error-message">
        <strong>Error:</strong> ${escapeHtml(message)}
      </div>
    `;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderPricingCards() {
    const content = document.getElementById('checkout-content');
    if (!content) {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const selectedPlan = normalizePlanKey(urlParams.get('plan'));
    const billingInterval = getRequestedBillingInterval();
    const plansToShow =
      selectedPlan && PLANS[selectedPlan] ? { [selectedPlan]: PLANS[selectedPlan] } : PLANS;

    content.className = '';
    content.innerHTML = `
      <div class="pricing-cards">
        ${Object.entries(plansToShow)
          .map(([key, plan]) => {
            const billing = getPlanBilling(plan, billingInterval);
            const showNormally = billing.billingInterval === BILLING_YEAR && plan.normallyPrice;
            return `
          <div class="pricing-card ${plan.featured ? 'featured' : ''}">
            ${plan.earlyAccess ? '<div class="plan-badge-early-access">Early Access Offer</div>' : ''}
            ${
              plan.featured && !plan.earlyAccess
                ? '<div class="plan-badge-popular">MOST POPULAR</div>'
                : ''
            }
            ${plan.isFree ? '<div class="plan-badge-free">FREE FOREVER</div>' : ''}
            <h3>${escapeHtml(plan.name)}</h3>
            <div class="price">
              £${formatMoney(billing.displayPrice)}
              <small>/month</small>
            </div>
            ${billing.billedLine ? `<div class="plan-early-note">${escapeHtml(billing.billedLine)}</div>` : ''}
            ${
              showNormally
                ? `<div class="plan-early-was">Normally £${formatMoney(plan.normallyPrice)} / month</div>`
                : ''
            }
            ${
              plan.earlyAccess
                ? '<div class="plan-early-note">Early access pricing while EventFlow is in development.</div>'
                : ''
            }
            <ul class="features">
              ${plan.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}
            </ul>
            <button
              class="ef-cta btn-checkout"
              data-plan="${escapeHtml(key)}"
              data-billing-interval="${billing.billingInterval}">
              ${plan.isFree ? 'Get Started Free' : `Choose ${escapeHtml(plan.name)}`}
            </button>
            ${billing.savingLine ? `<p class="plan-early-fine-print">${escapeHtml(billing.savingLine)}</p>` : ''}
            ${
              plan.earlyAccess
                ? `
              <p class="plan-early-fine-print">Offer ends ${escapeHtml(plan.earlyAccessEndDate)}. After this date, standard pricing applies. Cancel anytime.</p>
              <p class="plan-early-disclaimer"><span class="plan-info-icon" title="Early Access pricing is available for subscriptions started before 31 December 2026. Standard pricing will apply from 1 January 2027." aria-label="Important note">i</span>
                <small>Early Access pricing is available for subscriptions started before 31 December 2026. Standard pricing will apply from 1 January 2027.</small>
              </p>
            `
                : ''
            }
          </div>
        `;
          })
          .join('')}
      </div>

      ${
        !selectedPlan
          ? `
      <div class="security-notice">
        <h3>🔒 Secure Payment Processing</h3>
        <p>All payments are processed securely through Stripe.</p>
        <p>Your payment information is encrypted and never stored on our servers.</p>
        <div class="icons">🔐 💳 ✓</div>
      </div>
      `
          : ''
      }
    `;

    content.querySelectorAll('.btn-checkout').forEach(button => {
      button.addEventListener('click', function () {
        const planKey = this.getAttribute('data-plan');
        const selectedInterval = this.getAttribute('data-billing-interval');
        handleCheckout(planKey, selectedInterval);
      });
    });
  }

  async function handleCheckout(planKey, requestedInterval) {
    const normalizedPlanKey = normalizePlanKey(planKey);
    const plan = PLANS[normalizedPlanKey];
    const button = document.querySelector(`button[data-plan="${normalizedPlanKey}"]`);

    if (!button || !plan) {
      return;
    }

    const billing = getPlanBilling(
      plan,
      requestedInterval === BILLING_YEAR ? BILLING_YEAR : BILLING_MONTH
    );

    button.disabled = true;
    button.textContent = 'Processing...';

    try {
      if (plan.isFree) {
        window.location.href = '/auth?plan=free';
        return;
      }

      if (!stripe) {
        const initialized = await initializeStripe();
        if (!initialized) {
          throw new Error('Payment system unavailable. Please try again later.');
        }
      }

      if (!window.__CSRF_TOKEN__) {
        try {
          const csrfResponse = await fetch('/api/v1/csrf-token', { credentials: 'include' });
          const csrfData = await csrfResponse.json();
          if (csrfData && csrfData.csrfToken) {
            window.__CSRF_TOKEN__ = csrfData.csrfToken;
          }
        } catch (err) {
          console.warn('Could not fetch CSRF token:', err);
        }
      }

      const headers = {
        'Content-Type': 'application/json',
      };
      if (window.__CSRF_TOKEN__) {
        headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
      }

      const configuredPlan = stripeConfig?.plans?.find(({ id }) => id === normalizedPlanKey);
      const configuredInterval = configuredPlan?.billingInterval;
      const billingInterval =
        billing.billingInterval ||
        (configuredInterval === BILLING_YEAR ? BILLING_YEAR : BILLING_MONTH);
      const requestBody = {
        type: 'subscription',
        planId: normalizedPlanKey,
        billingInterval,
        successUrl: `${window.location.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/payment-cancel`,
      };

      if (isDevelopment) {
        console.log(
          `[Checkout] Mode: subscription for plan: ${normalizedPlanKey}, interval: ${billingInterval}`
        );
      }

      const response = await fetch('/api/v1/payments/create-checkout-session', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.message || data.error || 'Failed to create checkout session';
        if (response.status === 500) {
          errorMsg = data.message || 'Payment system temporarily unavailable. Please try again.';
        } else if (response.status === 503) {
          errorMsg = 'Payment processing is not currently available. Please contact support.';
        }
        throw new Error(errorMsg);
      }

      if (data.url) {
        window.location.href = data.url;
      } else if (data.sessionId) {
        const result = await stripe.redirectToCheckout({ sessionId: data.sessionId });
        if (result.error) {
          throw new Error(result.error.message);
        }
      } else {
        throw new Error('No checkout session returned');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      showError(error.message);
      button.disabled = false;
      button.textContent = `Choose ${plan.name}`;
    }
  }

  async function init() {
    const authStatus = await checkAuth();
    if (authStatus === true || authStatus === 'unauthenticated_free') {
      renderPricingCards();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
