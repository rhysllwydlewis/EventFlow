/**
 * P3-07: Annual Billing Discount Toggle
 * Toggle between monthly and annual pricing
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  const FREE_MONTHS = 2; // Number of free months with annual billing
  const MONTHS_IN_YEAR = 12;
  const ANNUAL_DISCOUNT_PERCENTAGE = (FREE_MONTHS / MONTHS_IN_YEAR) * 100; // Precise calculation: 16.666...%
  const ANNUAL_DISCOUNT_DISPLAY = Math.round(ANNUAL_DISCOUNT_PERCENTAGE); // 17% for display

  /**
   * Initialize billing toggle
   */
  function initBillingToggle() {
    const pricingContainer = document.querySelector('.pricing-plans, #pricing-container');
    if (!pricingContainer) {
      return;
    }

    createBillingToggle(pricingContainer);

    // Store original monthly prices
    storePrices();

    if (isDevelopment) {
      console.log('✓ Annual billing toggle initialized');
    }
  }

  /**
   * Create billing toggle UI
   */
  function createBillingToggle(container) {
    // Check if toggle already exists
    if (document.getElementById('billing-toggle')) {
      return;
    }

    const toggle = document.createElement('div');
    toggle.id = 'billing-toggle';
    toggle.className = 'billing-toggle';
    toggle.innerHTML = `
      <span class="billing-toggle-label active" id="monthly-label">Monthly</span>
      <label class="toggle-switch">
        <input type="checkbox" id="billing-period-toggle" role="switch" aria-checked="false" aria-label="Switch between monthly and annual billing">
        <span class="toggle-slider"></span>
      </label>
      <span class="billing-toggle-label" id="annual-label">
        Annual
        <span class="savings-badge">Save ${FREE_MONTHS} months (${ANNUAL_DISCOUNT_DISPLAY}% off)</span>
      </span>
    `;

    // Insert before pricing plans
    container.insertBefore(toggle, container.firstChild);

    // Add event listener
    const checkbox = document.getElementById('billing-period-toggle');
    checkbox.addEventListener('change', handleToggle);
  }

  /**
   * Store original monthly prices
   */
  function storePrices() {
    const priceElements = document.querySelectorAll('.price-amount, [data-monthly-price]');

    priceElements.forEach(el => {
      if (!el.dataset.monthlyPrice) {
        const priceText = el.textContent.replace(/[£$€,]/g, '');
        const price = parseFloat(priceText);
        if (!isNaN(price)) {
          el.dataset.monthlyPrice = price;
        }
      }
    });
  }

  /**
   * Handle toggle change
   */
  function handleToggle(e) {
    const isAnnual = e.target.checked;

    // Update labels
    const monthlyLabel = document.getElementById('monthly-label');
    const annualLabel = document.getElementById('annual-label');

    if (isAnnual) {
      monthlyLabel.classList.remove('active');
      annualLabel.classList.add('active');
      updatePrices('annual');
    } else {
      monthlyLabel.classList.add('active');
      annualLabel.classList.remove('active');
      updatePrices('monthly');
    }
  }

  /**
   * Update displayed prices
   */
  function updatePrices(period) {
    const priceElements = document.querySelectorAll('.price-amount, [data-monthly-price]');
    const periodLabels = document.querySelectorAll('.price-period, .billing-period');

    priceElements.forEach(el => {
      const monthlyPrice = parseFloat(el.dataset.monthlyPrice);
      if (isNaN(monthlyPrice)) {
        return;
      }

      let displayPrice;
      if (period === 'annual') {
        // Calculate annual price with discount
        const yearlyTotal = monthlyPrice * MONTHS_IN_YEAR;
        const discountedYearly = yearlyTotal * (1 - ANNUAL_DISCOUNT_PERCENTAGE / 100);
        displayPrice = (discountedYearly / MONTHS_IN_YEAR).toFixed(0);
      } else {
        displayPrice = monthlyPrice.toFixed(0);
      }

      // Update price display
      const currencySymbol = el.textContent.charAt(0);
      el.textContent = `${currencySymbol}${displayPrice}`;
    });

    // Update period labels
    periodLabels.forEach(label => {
      label.textContent = period === 'annual' ? '/mo (billed annually)' : '/month';
    });

    // Update checkout links
    updateCheckoutLinks(period);
  }

  /**
   * Update Stripe checkout links
   */
  function updateCheckoutLinks(period) {
    const checkoutButtons = document.querySelectorAll('[data-plan-link], .checkout-link');

    checkoutButtons.forEach(btn => {
      let href = btn.getAttribute('href') || btn.dataset.planLink;
      if (!href) {
        return;
      }

      // Remove existing period param
      href = href.replace(/[?&]period=(monthly|annual)/, '');

      // Add period param
      const separator = href.includes('?') ? '&' : '?';
      href = `${href}${separator}period=${period}`;

      if (btn.tagName === 'A') {
        btn.href = href;
      } else {
        btn.dataset.planLink = href;
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBillingToggle);
  } else {
    initBillingToggle();
  }

  // Export for use in other scripts
  if (typeof window !== 'undefined') {
    window.BillingToggle = {
      init: initBillingToggle,
    };
  }
})();
