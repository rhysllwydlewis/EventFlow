/**
 * Subscription Management for EventFlow Suppliers
 *
 * Renders the same plan cards, pricing and billing toggle as /pricing (the
 * canonical presentation data comes from the same /api/v2/subscriptions/plans
 * endpoint pricing.js reads), then layers account-management state on top:
 * current-plan detection, upgrade/downgrade through the v2 subscription
 * endpoints instead of checkout, a manage-billing portal button, and the
 * downgrade-pending banner. Keeping this page on the same markup/CSS as
 * pricing.html (rather than a hand-styled lookalike) is what stops the two
 * from drifting apart the way the previous design did.
 */

// Debug logging is only enabled in local development environments
const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Error display timeout constant (10 seconds)
const ERROR_DISPLAY_TIMEOUT = 10000;

const BILLING_MONTH = 'month';
const BILLING_YEAR = 'year';

// Fallback plan data, matching the server-rendered first paint. The plans
// endpoint (loadCanonicalPlans) overwrites the price fields; this is what the
// page falls back to if that request fails.
const PLANS = {
  starter: {
    id: 'starter',
    apiPlanId: 'free',
    name: 'Starter',
    tier: 'free',
    checkout: false,
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    annualTotal: 0,
    annualSaving: 0,
  },
  pro: {
    id: 'pro',
    apiPlanId: 'pro',
    name: 'Pro',
    tier: 'pro',
    checkout: true,
    monthlyPrice: 19,
    annualMonthlyPrice: 16,
    annualTotal: 192,
    annualSaving: 36,
    trialDays: 14,
  },
  pro_plus: {
    id: 'pro_plus',
    apiPlanId: 'pro_plus',
    name: 'Pro Plus',
    tier: 'pro_plus',
    checkout: true,
    monthlyPrice: 159,
    annualMonthlyPrice: 129,
    annualTotal: 1548,
    annualSaving: 360,
    trialDays: 14,
  },
};

// Plan hierarchy for determining upgrade vs downgrade direction
const PLAN_HIERARCHY = ['free', 'pro', 'pro_plus'];

// Max active packages per tier (mirrors server models/Subscription.js PLAN_FEATURES)
const PLAN_MAX_PACKAGES = { free: 3, pro: 50, pro_plus: -1 };

// Helper: look up a PLANS entry by tier code
const planByTier = tier => Object.values(PLANS).find(p => p.tier === tier);

let currentUser = null;
let currentSubscription = null; // from /api/v2/subscriptions/me
let activeBillingPeriod = BILLING_MONTH;

/**
 * Format an amount as pounds sterling, no decimals.
 * @param {number} value Amount in pounds.
 * @returns {string} e.g. `£159`.
 */
function money(value) {
  return `£${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0)}`;
}

/**
 * Initialize subscription page
 */
async function initSubscriptionPage() {
  try {
    if (isDevelopment) {
      console.log('[Subscription] Initializing subscription page...');
    }

    // Check authentication with retry logic
    let user = await checkAuth();

    // Retry once if auth check fails (handles race conditions)
    if (!user) {
      if (isDevelopment) {
        console.log('[Subscription] First auth check failed, retrying...');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      user = await checkAuth();
    }

    if (!user) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth?redirect=${returnUrl}`;
      return;
    }

    currentUser = user;

    if (user.role !== 'supplier') {
      showError(
        'This page is only available to suppliers. Please register as a supplier to access subscription plans.'
      );
      return;
    }

    // Detect post-checkout return
    const urlParams = new URLSearchParams(window.location.search);
    const isBillingSuccess =
      urlParams.get('billing') === 'success' || urlParams.get('subscribed') === 'true';

    if (isBillingSuccess) {
      // Remove query params from URL without reload
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
      // Show a brief success notice and poll for updated tier
      showSuccess('Payment successful! Updating your plan…');
      await pollForTierUpdate(user.subscriptionTier || 'free');
      // Re-fetch user with updated tier
      const refreshed = await checkAuth();
      if (refreshed) {
        currentUser = refreshed;
      }
    }

    attachBillingToggle();

    // Load current subscription record and canonical pricing in parallel
    await Promise.all([loadSubscriptionStatus(), loadCanonicalPlans()]);

    // Default the toggle to whatever the supplier is actually billed on,
    // rather than always opening on monthly.
    if (currentSubscription?.billingInterval === BILLING_YEAR) {
      activeBillingPeriod = BILLING_YEAR;
    }
    setBillingPeriod(activeBillingPeriod);

    // Render pending downgrade banner (if applicable)
    renderDowngradeBanner();

    if (isDevelopment) {
      console.log('[Subscription] Initialization complete');
    }
  } catch (error) {
    console.error('[Subscription] Error initializing subscription page:', error);
    showError(
      'Failed to load subscription information. Please refresh the page or contact support.'
    );
  }
}

/**
 * Poll /api/v1/auth/me until subscriptionTier changes from the old value (or max attempts).
 * Used after a Stripe checkout redirect to sync the plan without requiring a manual refresh.
 * @param {string} previousTier - The tier before checkout (e.g. 'free')
 * @param {number} [maxAttempts=8] - Maximum polling attempts
 * @param {number} [delayMs=1500] - Milliseconds between each poll
 * @returns {Promise<string>} The new tier, or `previousTier` if it never changed
 */
async function pollForTierUpdate(previousTier, maxAttempts = 8, delayMs = 1500) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    try {
      const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const newTier = data.user?.subscriptionTier || 'free';
        if (newTier !== previousTier) {
          if (isDevelopment) {
            console.log(`[Subscription] Tier updated: ${previousTier} → ${newTier}`);
          }
          return newTier;
        }
      }
    } catch (_e) {
      // ignore and retry
    }
  }
  return previousTier;
}

/**
 * Check user authentication
 */
async function checkAuth() {
  try {
    const response = await fetch('/api/v1/auth/me', {
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data.user) {
      return null;
    }

    return data.user;
  } catch (error) {
    console.error('[Subscription] Auth check failed:', error);
    return null;
  }
}

/**
 * Load user's current subscription from the canonical v2 endpoint.
 */
async function loadSubscriptionStatus() {
  try {
    const response = await fetch('/api/v2/subscriptions/me', {
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      currentSubscription = data.subscription || null;

      // Sync subscriptionTier on currentUser from the canonical source
      if (currentUser && data.plan) {
        currentUser.subscriptionTier = data.plan;
      }

      if (isDevelopment) {
        console.log('[Subscription] Subscription loaded:', data.plan, currentSubscription?.id);
      }
    } else if (isDevelopment) {
      console.warn('[Subscription] Could not load subscription from v2 endpoint:', response.status);
    }
  } catch (error) {
    if (isDevelopment) {
      console.warn('[Subscription] Error loading subscription:', error.message);
    }
    // Non-fatal — fall back to subscriptionTier from auth/me
  }
}

/**
 * Refresh PLANS' price/audience/features from the canonical plans API — the
 * same /api/v2/subscriptions/plans "billing" data /pricing hydrates from.
 * Failure is non-fatal: the fallback figures above stay in place.
 */
async function loadCanonicalPlans() {
  try {
    const response = await fetch('/api/v2/subscriptions/plans', { credentials: 'include' });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const byTier = new Map((data.billing || []).map(entry => [entry.tier, entry]));
    Object.values(PLANS).forEach(plan => {
      const presentation = byTier.get(plan.tier)?.presentation;
      if (!presentation) {
        return;
      }
      const monthly = presentation.pricing?.month;
      const yearly = presentation.pricing?.year;
      if (monthly && Number.isFinite(monthly.monthlyEquivalent)) {
        plan.monthlyPrice = monthly.monthlyEquivalent;
      }
      if (yearly) {
        if (Number.isFinite(yearly.monthlyEquivalent)) {
          plan.annualMonthlyPrice = yearly.monthlyEquivalent;
        }
        if (Number.isFinite(yearly.total)) {
          plan.annualTotal = yearly.total;
        }
        if (Number.isFinite(yearly.saving)) {
          plan.annualSaving = yearly.saving;
        }
      }
      if (presentation.audience) {
        const el = document.querySelector(
          `.pricing-card[data-plan="${plan.id}"] .pricing-tier-label`
        );
        if (el) {
          el.textContent = presentation.audience;
        }
      }
      if (Array.isArray(presentation.highlights) && presentation.highlights.length) {
        const list = document.querySelector(
          `.pricing-card[data-plan="${plan.id}"] .pricing-features`
        );
        if (list) {
          list.innerHTML = presentation.highlights
            .map(highlight => {
              const match = String(highlight).match(/^(.*?)\s+[—–]\s+(.*)$/);
              const name = match ? match[1].trim() : highlight;
              const why = match ? match[2].trim() : '';
              return `<li><span class="pricing-feature-name">${escapeHtml(name)}</span>${why ? `<span class="pricing-feature-why">${escapeHtml(why.charAt(0).toUpperCase() + why.slice(1).replace(/\.?$/, '.'))}</span>` : ''}</li>`;
            })
            .join('');
        }
      }
    });
    setBillingPeriod(activeBillingPeriod);
  } catch (error) {
    if (isDevelopment) {
      console.warn('[Subscription] Could not load canonical plan pricing:', error.message);
    }
  }
}

/**
 * Wire the monthly/annual switch, guarding against double binding.
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
 * Switch the whole page to a billing period and re-render every card.
 * @param {string} period BILLING_MONTH or BILLING_YEAR
 */
function setBillingPeriod(period) {
  activeBillingPeriod = period === BILLING_YEAR ? BILLING_YEAR : BILLING_MONTH;
  const annual = activeBillingPeriod === BILLING_YEAR;
  const toggle = document.getElementById('pricing-billing-switch');
  if (toggle) {
    toggle.setAttribute('aria-checked', String(annual));
    toggle.classList.toggle('is-annual', annual);
  }
  document.getElementById('pricing-monthly-label')?.classList.toggle('is-active', !annual);
  document.getElementById('pricing-annual-label')?.classList.toggle('is-active', annual);
  renderSubscriptionPlans();
}

/**
 * Render a persistent banner when a downgrade is scheduled for the next billing period.
 */
async function renderDowngradeBanner() {
  const bannerContainer = document.getElementById('current-subscription-status');
  if (!bannerContainer) {
    return;
  }

  const pendingPlan = currentSubscription?.pendingPlan;
  if (!pendingPlan) {
    bannerContainer.innerHTML = '';
    return;
  }

  const currentTier = currentUser?.subscriptionTier || 'free';
  const currentPlanName = planByTier(currentTier)?.name || currentTier;
  const pendingPlanName = planByTier(pendingPlan)?.name || pendingPlan;

  const periodEnd = currentSubscription?.currentPeriodEnd;
  const dateStr = periodEnd
    ? new Date(periodEnd).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'the end of your billing period';

  // Compute auto-pause warning: if the target plan has a lower maxPackages, warn
  // how many active packages will be paused when the downgrade takes effect.
  let pauseWarningHtml = '';
  const targetMax = PLAN_MAX_PACKAGES[pendingPlan];
  if (targetMax !== undefined && targetMax >= 0) {
    try {
      const pkgResp = await fetch('/api/me/packages', { credentials: 'include' });
      if (pkgResp.ok) {
        const pkgData = await pkgResp.json();
        const activeCount = (pkgData.items || []).filter(p => !p.paused).length;
        const willPause = Math.max(0, activeCount - targetMax);
        if (willPause > 0) {
          pauseWarningHtml = `<p class="pricing-account-banner__warning">⚠️ When the downgrade takes effect, ${willPause} active package${willPause === 1 ? '' : 's'} will be automatically paused to stay within the ${escapeHtml(pendingPlanName)} plan limit of ${targetMax} active packages.</p>`;
        }
      }
    } catch (_) {
      // Non-fatal — omit the warning if packages can't be fetched
    }
  }

  bannerContainer.innerHTML = `
    <div class="pricing-account-banner" role="status" aria-live="polite">
      <span class="pricing-account-banner__icon" aria-hidden="true">📋</span>
      <div class="pricing-account-banner__body">
        <p class="pricing-account-banner__title">Downgrade to ${escapeHtml(pendingPlanName)} scheduled</p>
        <p class="pricing-account-banner__message">Your ${escapeHtml(currentPlanName)} plan remains active until ${dateStr}. You can upgrade at any time.</p>
        ${pauseWarningHtml}
      </div>
    </div>
  `;
}

/**
 * Render subscription plan cards: canonical pricing + management state
 * (current plan / upgrade / downgrade / manage billing) for the current period.
 */
function renderSubscriptionPlans() {
  const currentTier = currentUser?.subscriptionTier || 'free';
  const currentIndex = PLAN_HIERARCHY.indexOf(currentTier);
  const annual = activeBillingPeriod === BILLING_YEAR;

  Object.values(PLANS).forEach(plan => {
    const card = document.querySelector(`.pricing-card[data-plan="${plan.id}"]`);
    if (!card) {
      return;
    }

    const paid = plan.monthlyPrice > 0;
    const price = annual ? plan.annualMonthlyPrice : plan.monthlyPrice;
    const priceEl = card.querySelector('[data-pricing-price]');
    const billedLine = card.querySelector('[data-pricing-billed-line]');
    const normallyLine = card.querySelector('[data-pricing-normally]');
    const savingsLine = card.querySelector('[data-pricing-savings]');
    const cta = card.querySelector('.pricing-cta');
    const notice = card.querySelector('[data-pricing-account-notice]');

    if (priceEl) {
      priceEl.textContent = paid ? money(price) : 'Free';
    }
    if (billedLine) {
      billedLine.textContent = !paid
        ? 'No card required'
        : annual
          ? `${money(plan.annualTotal)} billed annually`
          : `${money(plan.monthlyPrice)} billed monthly`;
    }
    if (normallyLine) {
      const show = annual && paid && plan.annualMonthlyPrice < plan.monthlyPrice;
      normallyLine.hidden = !show;
      normallyLine.textContent = show ? `Normally ${money(plan.monthlyPrice)} per month` : '';
    }
    if (savingsLine) {
      const show = annual && plan.annualSaving > 0;
      savingsLine.hidden = !show;
      savingsLine.textContent = show ? `Save ${money(plan.annualSaving)} a year` : '';
    }

    applyCardState(card, cta, notice, plan, currentTier, currentIndex);
  });
}

/**
 * Set a card's call-to-action label, click behaviour and account notice,
 * based on how this plan relates to the supplier's current tier.
 * @param {HTMLElement} card
 * @param {HTMLElement|null} cta
 * @param {HTMLElement|null} notice
 * @param {Object} plan
 * @param {string} currentTier
 * @param {number} currentIndex
 */
function applyCardState(card, cta, notice, plan, currentTier, currentIndex) {
  if (!cta) {
    return;
  }
  // Reset to a fresh, clickable link each render — re-renders happen on
  // every billing-period toggle, so stale disabled/handler state must not
  // carry over from a previous pass.
  cta.classList.remove('is-inert', 'is-current', 'secondary');
  cta.removeAttribute('aria-disabled');
  cta.setAttribute('href', '#');
  if (notice) {
    notice.hidden = true;
    notice.textContent = '';
    notice.classList.remove('pricing-account-notice--warning');
  }

  const planIndex = PLAN_HIERARCHY.indexOf(plan.tier);
  const isCurrent = plan.tier === currentTier;

  if (isCurrent) {
    if (plan.tier === 'free') {
      cta.textContent = '✓ Current Plan';
      cta.classList.add('is-inert', 'is-current');
      cta.setAttribute('aria-disabled', 'true');
      cta.removeAttribute('href');
    } else {
      cta.textContent = 'Manage Billing';
      cta.dataset.action = 'manage-billing';
      if (notice && currentSubscription?.currentPeriodEnd) {
        const dateStr = new Date(currentSubscription.currentPeriodEnd).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const pendingPlan = currentSubscription.pendingPlan;
        if (currentSubscription.cancelAtPeriodEnd && pendingPlan) {
          notice.textContent = `📋 Downgrades to ${planByTier(pendingPlan)?.name || pendingPlan} on ${dateStr}`;
          notice.classList.add('pricing-account-notice--warning');
        } else if (currentSubscription.cancelAtPeriodEnd) {
          notice.textContent = `⚠️ Cancels on ${dateStr}`;
          notice.classList.add('pricing-account-notice--warning');
        } else {
          notice.textContent = `Renews ${dateStr}`;
        }
        notice.hidden = false;
      }
    }
    return;
  }

  if (planIndex > currentIndex) {
    // Upgrade target
    cta.textContent =
      currentTier === 'free' && plan.trialDays && !currentSubscription?.id
        ? 'Start Free Trial'
        : `Upgrade to ${plan.name}`;
    cta.dataset.action = 'upgrade';
    cta.dataset.planId = plan.id;
  } else {
    // Downgrade target
    cta.textContent = plan.tier === 'free' ? 'Downgrade to Starter' : `Downgrade to ${plan.name}`;
    cta.classList.add('secondary');
    cta.dataset.action = 'downgrade';
    cta.dataset.planId = plan.id;
  }
}

// Attach a single delegated click handler once — cards are re-rendered in
// place (never replaced), so this only needs to run once at load.
document.addEventListener('click', event => {
  const cta = event.target.closest('.pricing-cta[data-action]');
  if (!cta || cta.getAttribute('aria-disabled') === 'true') {
    return;
  }
  event.preventDefault();
  const action = cta.dataset.action;
  if (action === 'manage-billing') {
    openBillingPortal(event);
  } else if (action === 'upgrade' || action === 'downgrade') {
    handleSubscribe(cta.dataset.planId, cta);
  }
});

/**
 * Handle subscription button click (new subscription, upgrade, or downgrade)
 * @param {string} planId
 * @param {HTMLElement} button
 */
async function handleSubscribe(planId, button) {
  if (isDevelopment) {
    console.log('[Subscription] Handle subscribe clicked for plan:', planId);
  }

  const plan = PLANS[planId];
  if (!plan) {
    showError('Invalid plan selected');
    return;
  }

  const currentTier = currentUser?.subscriptionTier || 'free';
  const billingInterval = activeBillingPeriod;

  if (plan.tier === currentTier) {
    showError(`You are already on the ${plan.name} plan.`);
    return;
  }

  const originalText = button?.textContent;
  if (button) {
    button.setAttribute('aria-disabled', 'true');
    button.textContent = 'Processing…';
  }

  try {
    let csrfToken = window.__CSRF_TOKEN__ || '';
    if (!csrfToken) {
      try {
        const csrfResp = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (csrfResp.ok) {
          const csrfData = await csrfResp.json();
          csrfToken = csrfData.csrfToken || csrfData.token || '';
          window.__CSRF_TOKEN__ = csrfToken;
        }
      } catch (csrfErr) {
        console.warn('[Subscription] Could not fetch CSRF token:', csrfErr);
      }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    // ── Downgrade to Starter (free) ───────────────────────────────────────────
    if (plan.tier === 'free') {
      if (!currentSubscription?.id) {
        window.location.href = '/dashboard/supplier';
        return;
      }
      const response = await fetch(`/api/v2/subscriptions/${currentSubscription.id}/downgrade`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ newPlan: 'free', billingInterval }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to schedule downgrade');
      }
      showSuccess(
        'Downgrade to Starter scheduled. Your current plan remains active until the end of your billing period.'
      );
      await loadSubscriptionStatus();
      renderDowngradeBanner();
      renderSubscriptionPlans();
      return;
    }

    // ── Change between two paid plans while already subscribed ───────────────
    if (currentTier !== 'free' && currentSubscription?.id) {
      const currentIdx = PLAN_HIERARCHY.indexOf(currentTier);
      const newIdx = PLAN_HIERARCHY.indexOf(plan.tier);

      if (newIdx > currentIdx) {
        const response = await fetch(`/api/v2/subscriptions/${currentSubscription.id}/upgrade`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ newPlan: plan.tier, billingInterval }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to upgrade subscription');
        }
        showSuccess(`Successfully upgraded to ${plan.name}!`);
        const refreshed = await checkAuth();
        if (refreshed) {
          currentUser = refreshed;
        }
        await loadSubscriptionStatus();
        renderDowngradeBanner();
        renderSubscriptionPlans();
        return;
      }
      const response = await fetch(`/api/v2/subscriptions/${currentSubscription.id}/downgrade`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ newPlan: plan.tier, billingInterval }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to schedule downgrade');
      }
      showSuccess(
        `Downgrade to ${plan.name} scheduled. Your current plan remains active until the end of your billing period.`
      );
      await loadSubscriptionStatus();
      renderDowngradeBanner();
      renderSubscriptionPlans();
      return;
    }

    // ── New subscription (from Starter/free, or no subscription record yet) ──
    const successUrl = `${window.location.origin}/supplier/subscription?billing=success`;
    const response = await fetch('/api/v2/subscriptions/create-checkout-session', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        planId: plan.id,
        billingInterval,
        successUrl,
        cancelUrl: `${window.location.origin}/supplier/subscription?billing=cancelled`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to create checkout session');
    }

    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error('No checkout URL returned');
    }
  } catch (error) {
    console.error('[Subscription] Subscription error:', error);
    showError(error.message || 'Failed to process subscription request. Please try again.');

    if (button) {
      button.removeAttribute('aria-disabled');
      button.textContent = originalText;
    }
  }
}

/**
 * Open Stripe billing portal
 */
async function openBillingPortal(event) {
  const button = event?.target?.closest('.pricing-cta');
  const originalText = button?.textContent;
  try {
    if (button) {
      button.setAttribute('aria-disabled', 'true');
      button.textContent = 'Loading…';
    }

    let csrfToken = window.__CSRF_TOKEN__ || '';
    if (!csrfToken) {
      try {
        const csrfResp = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (csrfResp.ok) {
          const csrfData = await csrfResp.json();
          csrfToken = csrfData.csrfToken || csrfData.token || '';
          window.__CSRF_TOKEN__ = csrfToken;
        }
      } catch (csrfErr) {
        console.warn('[Subscription] Could not fetch CSRF token:', csrfErr);
      }
    }

    const portalHeaders = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      portalHeaders['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch('/api/payments/create-portal-session', {
      method: 'POST',
      headers: portalHeaders,
      credentials: 'include',
      body: JSON.stringify({ returnUrl: window.location.href }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to open billing portal');
    }

    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error('No portal URL returned');
    }
  } catch (error) {
    console.error('[Subscription] Billing portal error:', error);
    showError(error.message || 'Failed to open billing portal. Please try again.');

    if (button) {
      button.removeAttribute('aria-disabled');
      button.textContent = originalText;
    }
  }
}

/**
 * Show error message
 */
function showError(message) {
  const errorContainer = document.getElementById('error-message');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.hidden = false;
    errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      errorContainer.hidden = true;
    }, ERROR_DISPLAY_TIMEOUT);
  } else {
    alert(message);
  }
}

/**
 * Show success message
 */
function showSuccess(message) {
  const successContainer = document.getElementById('success-message');
  if (successContainer) {
    successContainer.textContent = message;
    successContainer.hidden = false;
    successContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      successContainer.hidden = true;
    }, ERROR_DISPLAY_TIMEOUT);
  }
}

/**
 * Minimal HTML escaping for text interpolated into innerHTML.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value === null || value === undefined ? '' : value);
  return div.innerHTML;
}

// Make functions available globally (used by inline handlers elsewhere, if any)
window.handleSubscribe = handleSubscribe;
window.openBillingPortal = openBillingPortal;

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubscriptionPage);
} else {
  initSubscriptionPage();
}
