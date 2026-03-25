/**
 * Pricing Page JavaScript
 * Handles authentication state and dynamic button text updates.
 * Owns all pricing CTA click handling (single authoritative handler).
 */

(function () {
  'use strict';

  // Check authentication and get user info
  async function checkAuthAndUpdateButtons() {
    try {
      let user = null;

      // Prefer the centralised auth state manager to avoid duplicate API calls
      if (window.AuthStateManager) {
        const authState = await window.AuthStateManager.init();
        user = authState && authState.user;
      } else {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          // Handle both wrapped ({user: ...}) and unwrapped response formats
          user = data.user || data;
        }
      }

      if (user) {
        if (user.role === 'customer') {
          // Customers cannot purchase supplier subscriptions
          updateButtonsForCustomer();
        } else {
          // Supplier (or admin) – update button labels and attach checkout handlers
          updateButtonsForAuthenticatedUser(user);
          attachCheckoutHandlers();
        }
      } else {
        // User is not authenticated – rewrite CTAs to go via auth first
        updateButtonsForUnauthenticatedUser();
      }
    } catch (error) {
      // Network error - fail silently and show default state
      updateButtonsForUnauthenticatedUser();
    }
  }

  // Resolve the user's active subscription tier.
  // Uses subscriptionTier from auth/me (most accurate) with isPro/proExpiresAt as fallback.
  function getActiveTier(user) {
    if (!user) {
      return 'free';
    }
    // Prefer the explicit tier field now returned by auth/me
    const tier = user.subscriptionTier || 'free';
    if (tier !== 'free') {
      // Honour proExpiresAt when tier is elevated via legacy isPro field
      if (user.proExpiresAt) {
        const expiryTime = Date.parse(user.proExpiresAt);
        if (!isNaN(expiryTime) && expiryTime <= Date.now()) {
          return 'free';
        }
      }
      return tier;
    }
    // Fallback: legacy isPro boolean
    if (user.isPro) {
      if (user.proExpiresAt) {
        const expiryTime = Date.parse(user.proExpiresAt);
        if (!isNaN(expiryTime) && expiryTime <= Date.now()) {
          return 'free';
        }
      }
      return 'pro';
    }
    return 'free';
  }

  /**
   * Show a professional notice to customers explaining that subscriptions
   * are intended for suppliers, and that customers already have full access.
   */
  function updateButtonsForCustomer() {
    // Inject an info banner above the pricing grid
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

    // Disable all plan buttons and replace their labels
    const allPricingButtons = document.querySelectorAll('.pricing-cta, #pricing-bottom-cta');
    allPricingButtons.forEach(button => {
      button.textContent = 'For Suppliers Only';
      button.style.opacity = '0.5';
      button.style.cursor = 'not-allowed';
      button.style.pointerEvents = 'none';
      button.setAttribute('aria-disabled', 'true');
      button.removeAttribute('href');
    });
  }

  // Disable a button in place and label it "Your Current Plan"
  function markAsCurrentPlan(button) {
    button.textContent = 'Your Current Plan';
    button.classList.remove('secondary');
    button.style.opacity = '0.6';
    button.style.cursor = 'default';
    button.style.pointerEvents = 'none';
    button.setAttribute('aria-disabled', 'true');
  }

  // Update button labels for authenticated supplier/admin users
  function updateButtonsForAuthenticatedUser(user) {
    const tier = getActiveTier(user);

    // Map plan query-string keys to their subscription tier
    const PLAN_TIERS = {
      starter: 'free',
      free: 'free',
      pro: 'pro',
      pro_plus: 'pro_plus',
    };

    // Mark the current-plan button as inactive; offer upgrades/downgrades appropriately
    document.querySelectorAll('a[href*="/checkout?plan="]').forEach(button => {
      const href = button.getAttribute('href') || '';
      const match = href.match(/plan=(\w+)/);
      if (!match) {
        return;
      }
      const planKey = match[1];
      const planTier = PLAN_TIERS[planKey] || planKey;

      if (planTier === tier) {
        markAsCurrentPlan(button);
      }
    });

    // Also update the bottom CTA when user is on the Starter (free) tier
    const bottomCta = document.getElementById('pricing-bottom-cta');
    if (bottomCta && tier === 'free') {
      markAsCurrentPlan(bottomCta);
    } else if (bottomCta) {
      // On a paid plan – hide the bottom CTA (it links to starter plan checkout)
      bottomCta.style.display = 'none';
    }
  }

  // Attach direct checkout click handlers for authenticated users.
  // This replaces the (now-removed) inline script in pricing.html.
  function attachCheckoutHandlers() {
    const returnUrl = `${window.location.origin}/dashboard/supplier`;

    const pricingButtons = document.querySelectorAll('.pricing-cta');
    pricingButtons.forEach(button => {
      // Skip buttons that are already disabled (e.g. "Your Current Plan")
      if (button.getAttribute('aria-disabled') === 'true') {
        return;
      }

      button.setAttribute('data-original-text', button.textContent);

      button.addEventListener('click', async function (e) {
        const href = this.getAttribute('href');
        const planMatch = href && href.match(/plan=(\w+)/);

        if (!planMatch) {
          // No plan in href – allow default navigation
          return;
        }

        e.preventDefault();
        const planId = planMatch[1];

        try {
          this.disabled = true;
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
              planId: planId,
              returnUrl: returnUrl,
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
            alert(error.message || 'Failed to start checkout. Please try again.');
          }
          this.disabled = false;
          this.textContent = this.getAttribute('data-original-text') || 'Upgrade';
        }
      });
    });
  }

  // Rewrite CTAs for unauthenticated users to go via the auth page first.
  // Uses canonical (extensionless) paths in the redirect parameter.
  function updateButtonsForUnauthenticatedUser() {
    const allPricingButtons = document.querySelectorAll('a[href*="/checkout?plan="]');
    allPricingButtons.forEach(button => {
      const originalHref = button.getAttribute('href');
      if (originalHref) {
        const url = new URL(originalHref, window.location.origin);
        const plan = url.searchParams.get('plan');

        if (plan) {
          // Use canonical extensionless redirect path so auth page can send user
          // back to pricing (not auth) after login, avoiding the loop.
          button.setAttribute(
            'href',
            `/auth?redirect=${encodeURIComponent(`/pricing?plan=${plan}`)}`
          );
        }
      }
    });
  }

  /**
   * Show a dismissible toast banner at the bottom-right of the screen.
   * Uses event delegation on document for the dismiss button — no inline handlers.
   * @param {string} message - Text content (HTML-escaped before insertion)
   * @param {'amber'|'green'|'red'} variant - Colour variant key
   */
  function showBanner(message, variant) {
    // Safe colour map — never interpolate untrusted values into style strings
    const COLORS = { amber: '#f59e0b', green: '#10b981', red: '#ef4444' };
    const bg = COLORS[variant] || COLORS.amber;

    // Remove any existing pricing banner
    const existing = document.getElementById('pricing-status-banner');
    if (existing) {
      existing.remove();
    }

    const banner = document.createElement('div');
    banner.id = 'pricing-status-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText =
      `position:fixed;bottom:1.25rem;right:1.25rem;background:${bg};color:#fff;` +
      `padding:0.875rem 1.25rem;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.18);` +
      `z-index:10000;font-size:.9375rem;font-weight:500;max-width:360px;line-height:1.5;` +
      `display:flex;align-items:flex-start;gap:0.625rem;`;
    banner.innerHTML =
      `<span style="flex:1;">${message}</span>` +
      `<button data-dismiss-pricing-banner aria-label="Dismiss" ` +
      `style="background:none;border:none;color:#fff;cursor:pointer;font-size:1.25rem;` +
      `line-height:1;padding:0;margin-left:0.25rem;flex-shrink:0;">&#x00D7;</button>`;

    document.body.appendChild(banner);

    const dismiss = () => {
      if (banner.parentNode) {
        banner.remove();
      }
    };
    setTimeout(dismiss, 8000);

    // Dismiss on button click — delegated so no inline handler needed
    banner.querySelector('[data-dismiss-pricing-banner]').addEventListener('click', dismiss);
  }

  /**
   * Handle URL query params set by Stripe checkout redirects.
   * - checkout=cancelled → user cancelled before paying
   * (billing=success is handled by app.js on the supplier dashboard)
   */
  function handleCheckoutRedirectParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'cancelled') {
      // Clean URL without a reload
      const clean = new URL(window.location.href);
      clean.searchParams.delete('checkout');
      window.history.replaceState({}, '', clean.toString());

      showBanner("ℹ️ No charge was made. You can subscribe whenever you're ready.", 'amber');
    }
  }

  // Initialize
  function init() {
    handleCheckoutRedirectParams();
    checkAuthAndUpdateButtons();
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
