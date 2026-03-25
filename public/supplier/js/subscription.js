/**
 * Subscription Management for EventFlow Suppliers
 * Handles subscription plan selection and Stripe integration
 */

// Debug logging is only enabled in local development environments
const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Error display timeout constant (10 seconds)
const ERROR_DISPLAY_TIMEOUT = 10000;

// Subscription plans — exactly 3: Starter, Pro, Pro Plus
const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tier: 'free',
    price: 0,
    features: [
      '1 supplier profile',
      'Up to 2 packages',
      'Basic enquiry inbox',
      'Standard listing position',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tier: 'pro',
    price: 19.0,
    trialDays: 14,
    earlyAccess: true,
    normallyPrice: 69.0,
    earlyAccessEndDate: '31 December 2026',
    features: [
      'Pro badge on profile',
      'Priority listing in search results',
      'Unlimited packages',
      'Advanced analytics',
      'Email support',
    ],
  },
  pro_plus: {
    id: 'pro_plus',
    name: 'Pro Plus',
    tier: 'pro_plus',
    price: 199.0,
    trialDays: 14,
    features: [
      'Pro Plus badge on profile',
      'All Pro features included',
      'Priority phone support',
      'Custom branding options',
      'Featured in homepage carousel',
    ],
  },
};

// Plan hierarchy for determining upgrade vs downgrade direction
const PLAN_HIERARCHY = ['free', 'pro', 'pro_plus'];

let currentUser = null;
let currentSubscription = null; // from /api/v2/subscriptions/me

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

    // Load current subscription record
    await loadSubscriptionStatus();

    // Render plans
    renderSubscriptionPlans();

    // Set up legacy billing portal button (if present)
    setupBillingPortal();

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
 * Also supplements with billing details from the payments API.
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
 * Render subscription plans
 */
function renderSubscriptionPlans() {
  const plansContainer = document.getElementById('subscription-plans');
  if (!plansContainer) {
    return;
  }

  const currentTier = currentUser?.subscriptionTier || 'free';
  const currentHierarchyIndex = PLAN_HIERARCHY.indexOf(currentTier);

  const plansHtml = Object.values(PLANS)
    .map(plan => {
      const isCurrentPlan = plan.tier === currentTier;
      const planHierarchyIndex = PLAN_HIERARCHY.indexOf(plan.tier);
      const isUpgrade = planHierarchyIndex > currentHierarchyIndex;
      const isDowngrade = planHierarchyIndex < currentHierarchyIndex;
      const isFeatured = plan.tier === 'pro_plus';

      let actionHtml = '';
      if (isCurrentPlan) {
        // Current plan — show indicator + manage button if paid
        let manageHtml = '';
        if (currentSubscription && plan.tier !== 'free') {
          const cancelNotice =
            currentSubscription.cancelAtPeriodEnd && currentSubscription.currentPeriodEnd
              ? `<p class="card-cancellation-notice">⚠️ Cancels on ${new Date(currentSubscription.currentPeriodEnd).toLocaleDateString('en-GB')}</p>`
              : '';
          const renewalNotice =
            !currentSubscription.cancelAtPeriodEnd && currentSubscription.currentPeriodEnd
              ? `<p class="card-renewal-notice">Renews ${new Date(currentSubscription.currentPeriodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>`
              : '';
          manageHtml = `
            <button class="btn-manage" onclick="openBillingPortal(event)">Manage Subscription</button>
            ${cancelNotice}
            ${renewalNotice}
          `;
        }
        actionHtml = `
          <div class="plan-action">
            <div class="current-plan-indicator">✓ Current Plan</div>
            ${manageHtml}
          </div>
        `;
      } else if (plan.tier === 'free') {
        // Downgrade to Starter (cancel paid subscription)
        actionHtml = `
          <div class="plan-action">
            <button class="btn-downgrade"
                    data-plan-id="${plan.id}"
                    onclick="handleSubscribe('${plan.id}')">
              Downgrade to Starter
            </button>
          </div>
        `;
      } else if (isUpgrade) {
        const label = currentTier === 'free' ? `Start Free Trial` : `Upgrade to ${plan.name}`;
        actionHtml = `
          <div class="plan-action">
            <button class="btn-select"
                    data-plan-id="${plan.id}"
                    onclick="handleSubscribe('${plan.id}')">
              ${label}
            </button>
            ${plan.trialDays && currentTier === 'free' ? `<p class="trial-note">${plan.trialDays}-day free trial</p>` : ''}
          </div>
        `;
      } else if (isDowngrade) {
        actionHtml = `
          <div class="plan-action">
            <button class="btn-downgrade"
                    data-plan-id="${plan.id}"
                    onclick="handleSubscribe('${plan.id}')">
              Downgrade to ${plan.name}
            </button>
          </div>
        `;
      } else {
        // Fallback
        actionHtml = `
          <div class="plan-action">
            <button class="btn-select"
                    data-plan-id="${plan.id}"
                    onclick="handleSubscribe('${plan.id}')">
              Select Plan
            </button>
          </div>
        `;
      }

      return `
        <div class="pricing-card ${isFeatured ? 'featured' : ''} ${isCurrentPlan ? 'current' : ''}">
          ${isFeatured ? '<div class="popular-badge">PREMIUM</div>' : ''}
          ${isCurrentPlan ? '<div class="current-plan-badge">Current Plan</div>' : ''}
          <h3>${plan.name}</h3>
          <div class="price">
            ${plan.price === 0 ? '<span class="price-free">Free</span>' : `£${plan.price.toFixed(2)}<span class="period">/month</span>`}
          </div>
          ${
            plan.earlyAccess
              ? `
            <div class="early-access-label">Early Access Pricing</div>
            <div class="price-note" style="text-decoration:line-through;">Normally £${plan.normallyPrice}/month</div>
          `
              : ''
          }
          <ul class="features">
            ${plan.features.map(feature => `<li>${feature}</li>`).join('')}
          </ul>
          ${actionHtml}
        </div>
      `;
    })
    .join('');

  plansContainer.innerHTML = `
    <div class="pricing-grid">
      ${plansHtml}
    </div>
  `;
}

/**
 * Handle subscription button click (new subscription, upgrade, or downgrade)
 */
async function handleSubscribe(planId) {
  if (isDevelopment) {
    console.log('[Subscription] Handle subscribe clicked for plan:', planId);
  }

  const plan = PLANS[planId];
  if (!plan) {
    showError('Invalid plan selected');
    return;
  }

  const currentTier = currentUser?.subscriptionTier || 'free';

  // Guard: prevent selecting the same plan
  if (plan.tier === currentTier) {
    showError(`You are already on the ${plan.name} plan.`);
    return;
  }

  const button = document.querySelector(`button[data-plan-id="${planId}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = 'Processing…';
  }

  try {
    // Fetch CSRF token
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

    const headers = {
      'Content-Type': 'application/json',
    };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    // ── Downgrade to Starter (free) ───────────────────────────────────────────
    if (plan.tier === 'free') {
      if (!currentSubscription?.id) {
        // Already on free, just redirect
        window.location.href = '/dashboard/supplier';
        return;
      }
      const response = await fetch(`/api/v2/subscriptions/${currentSubscription.id}/downgrade`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ newPlan: 'free' }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to schedule downgrade');
      }
      showSuccess(
        'Downgrade to Starter scheduled. Your current plan remains active until the end of your billing period.'
      );
      await loadSubscriptionStatus();
      renderSubscriptionPlans();
      return;
    }

    // ── Upgrade from paid plan to higher paid plan ────────────────────────────
    if (currentTier !== 'free' && currentSubscription?.id) {
      const currentIdx = PLAN_HIERARCHY.indexOf(currentTier);
      const newIdx = PLAN_HIERARCHY.indexOf(plan.tier);

      if (newIdx > currentIdx) {
        // Upgrade
        const response = await fetch(`/api/v2/subscriptions/${currentSubscription.id}/upgrade`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ newPlan: plan.tier }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to upgrade subscription');
        }
        showSuccess(`Successfully upgraded to ${plan.name}!`);
        // Re-fetch auth to pick up new tier
        const refreshed = await checkAuth();
        if (refreshed) {
          currentUser = refreshed;
        }
        await loadSubscriptionStatus();
        renderSubscriptionPlans();
        return;
      } else {
        // Downgrade from paid to lower paid plan
        const response = await fetch(`/api/v2/subscriptions/${currentSubscription.id}/downgrade`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ newPlan: plan.tier }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || data.error || 'Failed to schedule downgrade');
        }
        showSuccess(
          `Downgrade to ${plan.name} scheduled. Your current plan remains active until the end of your billing period.`
        );
        await loadSubscriptionStatus();
        renderSubscriptionPlans();
        return;
      }
    }

    // ── New subscription (from Starter/free) ─────────────────────────────────
    const successUrl = `${window.location.origin}/supplier/subscription?billing=success`;
    const response = await fetch('/api/v2/subscriptions/create-checkout-session', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        planId: plan.id,
        returnUrl: successUrl,
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
      button.disabled = false;
      // Restore original button label
      const plan = PLANS[planId];
      const currentTier = currentUser?.subscriptionTier || 'free';
      const currentIdx = PLAN_HIERARCHY.indexOf(currentTier);
      const planIdx = PLAN_HIERARCHY.indexOf(plan?.tier || 'free');
      button.textContent =
        planIdx > currentIdx
          ? currentTier === 'free'
            ? 'Start Free Trial'
            : `Upgrade to ${plan.name}`
          : `Downgrade to ${plan.name}`;
    }
  }
}

/**
 * Set up billing portal
 */
function setupBillingPortal() {
  const manageBillingBtn = document.getElementById('manage-billing-btn');
  if (manageBillingBtn) {
    manageBillingBtn.addEventListener('click', openBillingPortal);
  }
}

/**
 * Open Stripe billing portal
 */
async function openBillingPortal(event) {
  try {
    const button = event.target;
    button.disabled = true;
    button.textContent = 'Loading…';

    const response = await fetch('/api/payments/create-portal-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        returnUrl: window.location.href,
      }),
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

    if (event && event.target) {
      event.target.disabled = false;
      event.target.textContent = 'Manage Subscription';
    }
  }
}

/**
 * Show error message
 */
function showError(message) {
  const errorContainer = document.getElementById('error-message');
  if (errorContainer) {
    errorContainer.innerHTML = `
      <div class="alert alert-error alert-error-styled">
        <strong>Error:</strong> ${message}
      </div>
    `;
    errorContainer.style.display = 'block';
    errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      errorContainer.style.display = 'none';
    }, ERROR_DISPLAY_TIMEOUT);
  } else {
    alert(message);
  }
}

/**
 * Show success message
 */
// eslint-disable-next-line no-unused-vars
function showSuccess(message) {
  const successContainer = document.getElementById('success-message');
  if (successContainer) {
    successContainer.innerHTML = `
      <div class="alert alert-success">
        ${message}
      </div>
    `;
    successContainer.style.display = 'block';
    successContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      successContainer.style.display = 'none';
    }, ERROR_DISPLAY_TIMEOUT);
  }
}

// Make functions available globally
window.handleSubscribe = handleSubscribe;
window.openBillingPortal = openBillingPortal;

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubscriptionPage);
} else {
  initSubscriptionPage();
}
