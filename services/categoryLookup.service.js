'use strict';

/**
 * Category identifier resolution.
 *
 * Category records store two representations: a URL-friendly `slug`
 * (e.g. "venues") and a canonical display `name` (e.g. "Venues") — the exact
 * string stored on `supplier.category`, shown in the /suppliers filter UI,
 * and expected by the supplier search API's `category` query parameter.
 *
 * `resolveCategoryName` is the single place that turns any incoming category
 * identifier — a slug, the canonical name itself, or a case/whitespace
 * variant of either — into that canonical display name. The legacy
 * `/category?slug=` redirect uses it so old links land on a correctly
 * filtered `/suppliers?category=<name>` URL instead of silently losing the
 * filter. See public/assets/js/utils/category-link.js for the client-side
 * counterpart used by category link generators.
 */

function normaliseToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {Array<{slug?: string, name?: string}>} categories
 * @param {string} rawValue - a slug, a canonical name, or a case variant of either
 * @returns {string} the canonical display name, or '' if nothing matches
 */
function resolveCategoryName(categories, rawValue) {
  const token = normaliseToken(rawValue);
  if (!token) {
    return '';
  }

  const list = Array.isArray(categories) ? categories : [];

  const bySlug = list.find(category => normaliseToken(category && category.slug) === token);
  if (bySlug && bySlug.name) {
    return bySlug.name;
  }

  const byName = list.find(category => normaliseToken(category && category.name) === token);
  if (byName && byName.name) {
    return byName.name;
  }

  return '';
}

module.exports = {
  normaliseToken,
  resolveCategoryName,
};
