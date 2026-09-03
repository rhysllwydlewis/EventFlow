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

  // Expose on window so non-module scripts can use EFTierIcon.resolve() / EFTierIcon.render()
  window.EFTierIcon = {
    resolve: resolveSupplierTier,
    render: renderTierIcon,
  };
})();
