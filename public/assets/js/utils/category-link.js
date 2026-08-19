/**
 * Shared helper for turning a category record into the canonical `/suppliers`
 * link.
 *
 * The `/suppliers` directory page filters strictly by the canonical display
 * value stored on `supplier.category` (e.g. "Venues"), not by a category's
 * `slug` (e.g. "venues"). Category link generators used to point at
 * `/category?slug=<slug>`, which redirected to `/suppliers` but dropped the
 * filter — the directory page has never read a `slug` param. Every place
 * that builds a link to a category listing should go through
 * `EventFlowCategoryLink.categoryHref()` so the emitted URL always carries
 * the same canonical `category` value the filter UI, the search API and the
 * legacy `/category?slug=` redirect agree on (see
 * services/categoryLookup.service.js for the server-side counterpart).
 */
(function (global) {
  'use strict';

  function canonicalCategoryValue(category) {
    if (!category) {
      return '';
    }
    const value = (category.name || category.slug || '').toString().trim();
    return value;
  }

  function categoryHref(category) {
    const value = canonicalCategoryValue(category);
    return value ? `/suppliers?category=${encodeURIComponent(value)}` : '/suppliers';
  }

  global.EventFlowCategoryLink = { canonicalCategoryValue, categoryHref };
})(typeof window !== 'undefined' ? window : globalThis);
