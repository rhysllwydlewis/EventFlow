/**
 * Tier Icon Helpers
 * Lightweight standalone script (no ES6 imports) exposing helpers used by
 * non-module scripts (supplier-card.js, package-list.js, suppliers-init.js, supplier-profile.js).
 * Loaded via a plain <script> tag; mirrors the logic in verification-badges.js.
 */

'use strict';
(function () {
  /**
   * Resolve the active subscription tier for a supplier object.
   * @param {Object|null} supplier
   * @returns {'pro_plus'|'pro'|'free'}
   */
  function resolveSupplierTier(supplier) {
    if (!supplier) {
      return 'free';
    }
    const tier =
      supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');
    return tier === 'pro_plus' ? 'pro_plus' : tier === 'pro' ? 'pro' : 'free';
  }

  /**
   * Render a small inline tier icon (⭐ or 💎) for placement next to a supplier name.
   * Returns an empty string for free-tier suppliers.
   * @param {Object|null} supplier
   * @returns {string} HTML string
   */
  function renderTierIcon(supplier) {
    const tier = resolveSupplierTier(supplier);
    if (tier === 'pro_plus') {
      return `<span class="tier-icon tier-icon-pro-plus" title="Professional Plus subscriber" aria-label="Pro Plus">💎</span>`;
    }
    if (tier === 'pro') {
      return `<span class="tier-icon tier-icon-pro" title="Professional subscriber" aria-label="Pro">⭐</span>`;
    }
    return '';
  }

  /**
   * Render the full "Starter" / "Pro" / "Pro Plus" tier badge shown on
   * supplier cards and profiles. Previously reimplemented near-identically
   * in app.js, lead-quality-helper.js, package-list.js, supplier-profile.js
   * and admin-suppliers-init.js -- kept in one place so the label and the
   * tier it corresponds to can't drift apart between them again.
   * @param {Object|null} supplier
   * @param {Object} [options]
   * @param {string} [options.style] - extra inline style attribute value
   * @param {string} [options.ariaLabelSuffix] - appended to the aria-label, e.g. " plan"
   * @returns {string} HTML string -- a single <span>
   */
  function renderTierBadge(supplier, options = {}) {
    const tier = resolveSupplierTier(supplier);
    const styleAttr = options.style ? ` style="${options.style}"` : '';
    const labelSuffix = options.ariaLabelSuffix || '';
    if (tier === 'pro_plus') {
      return `<span class="badge badge-pro-plus"${styleAttr} aria-label="Pro Plus${labelSuffix}">Pro Plus</span>`;
    }
    if (tier === 'pro') {
      return `<span class="badge badge-pro"${styleAttr} aria-label="Pro${labelSuffix}">Pro</span>`;
    }
    return `<span class="badge badge-starter"${styleAttr} aria-label="Starter${labelSuffix}">Starter</span>`;
  }

  // Expose on window so non-module scripts can use EFTierIcon.resolve() / EFTierIcon.render()
  window.EFTierIcon = {
    resolve: resolveSupplierTier,
    render: renderTierIcon,
    renderBadge: renderTierBadge,
  };
})();
