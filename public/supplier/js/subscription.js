/**
 * Subscription Management for EventFlow Suppliers
 * Handles subscription plan selection and Stripe integration
 * Replaces Google Pay/Firebase with Stripe implementation
 */

// Debug logging is only enabled in local development environments
const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Error display timeout constant (10 seconds)
const ERROR_DISPLAY_TIMEOUT = 10000;

// Subscription plans - aligned with updated pricing
const PLANS = {
  pro_monthly: {
    id: 'pro_monthly',
    name: 'Professional',
    tier: 'pro',
    price: 19.0,
    billingCycle: 'monthly',
    trialDays: 14,
    earlyAccess: true,
    normallyPrice: 69.0,
    earlyAccessEndDate: '31 December 2026',
    features: [
      'Pro supplier badge on profile',
      'Priority listing in search results',
      'Up to 50 event bookings per month',
      'Email support',
    ],
  },
  pro_plus_monthly: {
    id: 'pro_plus_monthly',
    name: 'Professional Plus',
    tier: 'pro_plus',
    price: 199.0,
    billingCycle: 'monthly',
    trialDays: 14,
    introductoryPrice: null,
    regularPrice: null,
    introductoryMonths: null,
    features: [
      'Premium Pro+ badge on profile',
      'All Pro features included',
      'Unlimited event bookings',
      'Advanced analytics dashboard',
      'Priority phone support',
      'Custom branding options',
      'Featured in homepage carousel',
    ],
  },
  pro_yearly: {
    id: 'pro_yearly',
    name: 'Professional Yearly',
    tier: 'pro',
    price: 468.0,
    billingCycle: 'yearly',
    trialDays: 28,
    introductoryPrice: null,
    regularPrice: null,
    introductoryMonths: null,
    features: [
      'Pro supplier badge on profile',
      'Priority listing in search results',
      'Up to 50 event bookings per month',
      'Email support',
      'Save £240 vs monthly',
    ],
  },
  pro_plus_yearly: {
    id: 'pro_plus_yearly',
    name: 'Professional Plus Yearly',
    tier: 'pro_plus',
    price: 2388.0,
    billingCycle: 'yearly',
    trialDays: 28,
    introductoryPrice: null,
    regularPrice: null,
    introductoryMonths: null,
    features: [
      'Premium Pro+ badge on profile',
      'All Pro features included',
      'Unlimited event bookings',
      'Advanced analytics dashboard',
      'Priority phone support',
      'Custom branding options',
      'Featured in homepage carousel',
      'Save vs monthly',
    ],
  },
};

// eslint-disable-next-line no-unused-vars
let currentUser = null;
let currentSubscription = null;
let stripeConfig = null; // Store Stripe configuration

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
      console.error('[Subscription] Authentication required - redirecting to login');
      // Preserve the current URL to return after login
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth?redirect=${returnUrl}`;
      return;
    }

    if (isDevelopment) {
      console.log('[Subscription] User authenticated:', user.email, 'Role:', user.role);
    }
    currentUser = user;

    // Verify user is a supplier
    if (user.role !== 'supplier') {
      console.error('[Subscription] User role is not supplier:', user.role);
      showError(
        'This page is only available to suppliers. Please register as a supplier to access subscription plans.'
      );
      return;
    }

    // Load current subscription status
    if (isDevelopment) {
      console.log('[Subscription] Loading subscription status...');
    }
    await loadSubscriptionStatus();

    // Load Stripe configuration
    if (isDevelopment) {
      console.log('[Subscription] Loading Stripe configuration...');
    }
    await loadStripeConfig();

    // Render subscription plans
    if (isDevelopment) {
      console.log('[Subscription] Rendering subscription plans...');
    }
    renderSubscriptionPlans();

    // Set up manage billing button
    if (isDevelopment) {
      console.log('[Subscription] Setting up billing portal...');
    }
    setupBillingPortal();

    if (isDevelopment) {
      console.log('[Subscription] Initialization complete');
    }
  } catch (error) {
    console.error('[Subscription] Error initializing subscription page:', error);
    console.error('[Subscription] Error stack:', error.stack);
    showError(
      'Failed to load subscription information. Please refresh the page or contact support.'
    );
  }
}

/**
 * Check user authentication
 */
async function checkAuth() {
  try {
    if (isDevelopment) {
      console.log('[Subscription] Checking authentication...');
    }
    const response = await fetch('/api/v1/auth/me', {
      credentials: 'include',
    });

    if (isDevelopment) {
      console.log('[Subscription] Auth check response status:', response.status);
    }

    if (!response.ok) {
      console.error('[Subscription] Auth check failed with status:', response.status);
      return null;
    }

    const data = await response.json();
    if (isDevelopment) {
      console.log('[Subscription] Auth check successful, user:', data.user?.email);
    }

    // Verify user has supplier role
    if (!data.user) {
      console.error('[Subscription] No user data in response');
      return null;
    }

    return data.user;
  } catch (error) {
    console.error('[Subscription] Auth check failed:', error);
    console.error('[Subscription] Error stack:', error.stack);
    return null;
  }
}

/**
 * Load user's current subscription status
 */
async function loadSubscriptionStatus() {
  try {
    if (isDevelopment) {
      console.log('[Subscription] Fetching subscription status from API...');
    }
    const response = await fetch('/api/payments', {
      credentials: 'include',
    });

    if (isDevelopment) {
      console.log('[Subscription] Subscription status response:', response.status);
    }

    if (!response.ok) {
      console.error('[Subscription] Failed to load subscription status:', response.status);
      throw new Error('Failed to load subscription status');
    }

    const data = await response.json();
    if (isDevelopment) {
      console.log('[Subscription] Payments data received:', data.payments?.length, 'payments');
    }

    // Find active subscription
    const activeSubscription = data.payments.find(
      p =>
        p.type === 'subscription' &&
        p.status === 'succeeded' &&
        p.subscriptionDetails &&
        !p.subscriptionDetails.cancelAtPeriodEnd
    );

    if (activeSubscription) {
      if (isDevelopment) {
        console.log(
          '[Subscription] Active subscription found:',
          activeSubscription.subscriptionDetails?.planId
        );
      }
    } else {
      if (isDevelopment) {
        console.log('[Subscription] No active subscription found');
      }
    }

    currentSubscription = activeSubscription;
    displaySubscriptionStatus(activeSubscription);
  } catch (error) {
    console.error('[Subscription] Error loading subscription:', error);
    console.error('[Subscription] Error stack:', error.stack);
    // Don't show error - user might not have subscription yet
  }
}

/**
 * Load Stripe configuration
 */
async function loadStripeConfig() {
  try {
    if (isDevelopment) {
      console.log('[Subscription] Fetching Stripe configuration from API...');
    }
    const response = await fetch('/api/payments/config', {
      credentials: 'include',
    });

    if (isDevelopment) {
      console.log('[Subscription] Stripe config response:', response.status);
    }

    if (!response.ok) {
      console.error('[Subscription] Failed to load Stripe config:', response.status);
      return;
    }

    const data = await response.json();
    if (isDevelopment) {
      console.log(
        '[Subscription] Stripe config loaded, intro pricing enabled:',
        data.introPricingEnabled
      );
    }

    stripeConfig = data;
  } catch (error) {
    console.error('[Subscription] Error loading Stripe config:', error);
    console.error('[Subscription] Error stack:', error.stack);
  }
}

/**
 * Display current subscription status
 * Status is now embedded directly within the matching pricing card,
 * so this section is intentionally left empty.
 */
function displaySubscriptionStatus(subscription) {
  const statusContainer = document.getElementById('current-subscription-status');
  if (!statusContainer) {
    return;
  }
  // Clear and hide — status is shown inline within the plan cards
  statusContainer.innerHTML = '';
  statusContainer.style.display = 'none';
}

/**
 * Render subscription plans
 */
function renderSubscriptionPlans() {
  const plansContainer = document.getElementById('subscription-plans');
  if (!plansContainer) {
    return;
  }

  const plansHtml = Object.values(PLANS)
    .map(plan => {
      // Match by tier (from auth/me subscriptionTier) or by Stripe planId in subscription record
      const currentTier = currentUser?.subscriptionTier || 'free';
      const isCurrentPlan =
        plan.tier === currentTier ||
        (currentSubscription && currentSubscription.subscriptionDetails?.planId?.includes(plan.id));
      const isFeatured = plan.tier === 'pro_plus';

      return `
      <div class="pricing-card ${isFeatured ? 'featured' : ''}">
        ${isFeatured ? '<div class="popular-badge">PREMIUM</div>' : ''}
        <h3>${plan.name}</h3>
        <div class="price">
          £${plan.price.toFixed(2)}
          <span class="period">/month</span>
        </div>
        ${
          plan.earlyAccess
            ? `
          <div class="early-access-label">Early Access Offer</div>
        `
            : ''
        }
        ${
          plan.introductoryPrice && plan.regularPrice && plan.introductoryMonths
            ? `
          <div class="price-note">First ${plan.introductoryMonths} months, then £${plan.regularPrice}/month</div>
        `
            : plan.earlyAccess
              ? `
          <div class="price-note">Early access pricing while EventFlow is in development.</div>
          <div class="price-note" style="text-decoration:line-through;">Normally £${plan.normallyPrice}/month</div>
        `
              : ''
        }
        <div class="trial-badge">
          ${plan.trialDays}-day free trial
        </div>
        <ul class="features">
          ${plan.features.map(feature => `<li>${feature}</li>`).join('')}
        </ul>
        ${
          isCurrentPlan
            ? `
          <div class="plan-action">
            <div class="current-plan-indicator">✓ Current Plan</div>
            ${
              currentSubscription
                ? `
              <button class="btn-manage" onclick="openBillingPortal(event)">Manage Subscription</button>
              ${
                currentSubscription.subscriptionDetails?.cancelAtPeriodEnd
                  ? `<p class="card-cancellation-notice">⚠️ Cancels on ${new Date(currentSubscription.subscriptionDetails.currentPeriodEnd).toLocaleDateString('en-GB')}</p>`
                  : ''
              }
            `
                : ''
            }
          </div>
        `
            : `
          <div class="plan-action">
            <button class="btn-select" 
                    data-plan-id="${plan.id}"
                    onclick="handleSubscribe('${plan.id}')">
              ${currentSubscription && currentTier !== 'free' ? 'Switch Plan' : 'Start Free Trial'}
            </button>
          </div>
        `
        }
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
 * Handle subscription button click
 */
async function handleSubscribe(planId) {
  if (isDevelopment) {
    console.log('[Subscription] Handle subscribe clicked for plan:', planId);
  }

  const plan = PLANS[planId];
  if (!plan) {
    console.error('[Subscription] Invalid plan selected:', planId);
    showError('Invalid plan selected');
    return;
  }

  // Guard: prevent purchasing a plan the user already has
  const currentTier = currentUser?.subscriptionTier || 'free';
  if (plan.tier === currentTier) {
    showError(`You are already subscribed to the ${plan.name} plan.`);
    return;
  }

  if (isDevelopment) {
    console.log('[Subscription] Selected plan:', plan.name, 'Price:', plan.price);
  }

  const button = document.querySelector(`button[data-plan-id="${planId}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = 'Processing...';
  }

  try {
    // Fetch CSRF token before POST (required by server CSRF protection)
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

    // Check if this is the Professional plan and intro pricing is enabled
    const isProfessionalPlan =
      (plan.name.toLowerCase().includes('professional') ||
        plan.name.toLowerCase().includes('pro')) &&
      !plan.name.toLowerCase().includes('plus');
    if (stripeConfig?.proPriceId && isProfessionalPlan) {
      // Use subscription mode — prefer server-configured priceId
      if (isDevelopment) {
        console.log('[Subscription] Using subscription mode with server priceId');
      }
      requestBody = {
        type: 'subscription',
        priceId: stripeConfig.proPriceId,
        planName: plan.name,
      };
    } else if (plan.tier && plan.tier !== 'free') {
      // Generic subscription fallback: let the server derive the priceId from planId/planName
      if (isDevelopment) {
        console.log('[Subscription] Using subscription mode (generic fallback)');
      }
      requestBody = {
        type: 'subscription',
        planName: plan.name,
      };
    } else {
      // Free plan — nothing to charge
      window.location.href = '/dashboard/supplier';
      return;
    }

    if (isDevelopment) {
      console.log('[Subscription] Creating checkout session with:', requestBody);
    }

    const headers = {
      'Content-Type': 'application/json',
    };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch('/api/v1/payments/create-checkout-session', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(requestBody),
    });

    if (isDevelopment) {
      console.log('[Subscription] Checkout session response status:', response.status);
    }

    const data = await response.json();
    if (isDevelopment) {
      console.log('[Subscription] Checkout session response data:', data);
    }

    if (!response.ok) {
      console.error('[Subscription] API error:', data.error || 'Unknown error');
      console.error('[Subscription] Full response:', data);
      throw new Error(data.message || data.error || 'Failed to create checkout session');
    }

    // Redirect to Stripe checkout
    if (data.url) {
      if (isDevelopment) {
        console.log('[Subscription] Redirecting to Stripe checkout:', data.url);
      }
      window.location.href = data.url;
    } else if (data.sessionId) {
      console.error('[Subscription] No URL, falling back to sessionId redirect');
      throw new Error('No checkout URL returned');
    } else {
      console.error('[Subscription] No checkout URL in response');
      throw new Error('No checkout URL returned');
    }
  } catch (error) {
    console.error('[Subscription] Subscription error:', error);
    console.error('[Subscription] Error stack:', error.stack);
    showError(error.message || 'Failed to start subscription. Please try again.');

    if (button) {
      button.disabled = false;
      button.textContent = currentSubscription ? 'Switch Plan' : 'Start Free Trial';
    }
  }
}

/**
 * Set up billing portal
 * Buttons are rendered inside plan cards with inline onclick, so this
 * function is kept as a no-op guard for any legacy manage-billing-btn.
 */
function setupBillingPortal() {
  // Legacy button (retained for safety — primary handler is inline onclick in plan cards)
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
    if (isDevelopment) {
      console.log('[Subscription] Opening billing portal...');
    }

    const button = event.target;
    button.disabled = true;
    button.textContent = 'Loading...';

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

    if (isDevelopment) {
      console.log('[Subscription] Portal session response status:', response.status);
    }

    const data = await response.json();
    if (isDevelopment) {
      console.log('[Subscription] Portal session response data:', data);
    }

    if (!response.ok) {
      console.error('[Subscription] API error:', data.error || 'Unknown error');
      console.error('[Subscription] Full response:', data);
      throw new Error(data.error || 'Failed to open billing portal');
    }

    // Redirect to Stripe billing portal
    if (data.url) {
      if (isDevelopment) {
        console.log('[Subscription] Redirecting to billing portal:', data.url);
      }
      window.location.href = data.url;
    } else {
      console.error('[Subscription] No portal URL in response');
      throw new Error('No portal URL returned');
    }
  } catch (error) {
    console.error('[Subscription] Billing portal error:', error);
    console.error('[Subscription] Error stack:', error.stack);
    showError(error.message || 'Failed to open billing portal. Please try again.');

    if (event && event.target) {
      const button = event.target;
      button.disabled = false;
      button.textContent = 'Manage Subscription';
    }
  }
}

/**
 * Show error message
 */
function showError(message) {
  if (isDevelopment) {
    console.log('[Subscription] Showing error:', message);
  }

  const errorContainer = document.getElementById('error-message');
  if (errorContainer) {
    errorContainer.innerHTML = `
      <div class="alert alert-error alert-error-styled">
        <strong>Error:</strong> ${message}
      </div>
    `;
    errorContainer.style.display = 'block';

    // Auto-scroll to error message
    errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Auto-hide after ERROR_DISPLAY_TIMEOUT (10 seconds)
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
  if (isDevelopment) {
    console.log('[Subscription] Showing success:', message);
  }

  const successContainer = document.getElementById('success-message');
  if (successContainer) {
    successContainer.innerHTML = `
      <div class="alert alert-success">
        ${message}
      </div>
    `;
    successContainer.style.display = 'block';

    // Auto-scroll to success message
    successContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Auto-hide after ERROR_DISPLAY_TIMEOUT (10 seconds)
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
