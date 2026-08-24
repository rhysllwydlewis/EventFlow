/**
 * EventFlow UK category directory — national, category-only landing pages
 *
 * `/suppliers?category=X` is a live, JS-driven filter view, and every one of
 * those URLs carries the same static self-canonical back to the bare
 * `/suppliers` page (see `public/suppliers.html`), so Google consolidates
 * every category filter combination into one generic listing regardless of
 * how much real inventory sits behind it. `/categories/:categorySlug` is the
 * server-rendered counterpart: a real page per canonical supplier category,
 * complete before any client script runs, with its own canonical, title and
 * description — the same architecture `locationCategoryPage.service.js`
 * already uses for city × category pages, one dimension simpler because a
 * national category has no city to also earn its place on.
 *
 * A category with too little real inventory is never indexed: the gate here
 * reuses `emptyStateIndexGate`'s existing supplier-count threshold rather
 * than inventing a second one, so a `/categories/x` page and the
 * `/suppliers?category=X` filter it complements agree on what counts as
 * "enough" to be worth a search result.
 */

'use strict';

const { resolveCategory } = require('./locationCategoryPage.service');
const supplierLocation = require('./supplierLocation.service');
const emptyStateIndexGate = require('./emptyStateIndexGate.service');
const locationPages = require('./locationPage.service');
const categoryRegistry = require('../public/assets/js/utils/category-link.js');

const { safeBaseUrl, truncate, stableChoice } = locationPages;

/** Registry-wide cap so a mega-category page never ships an unbounded grid. */
const MAX_SUPPLIERS_PER_PAGE = 60;
const MAX_RELATED_CATEGORIES = 6;

/**
 * Rank suppliers nationwide for a single canonical category, reusing the
 * same eligibility and quality/tier scoring already vetted for public
 * location pages — so a test fixture or an unapproved profile that cannot
 * appear on a city page cannot appear here either.
 * @param {Object[]} suppliers Raw supplier records.
 * @param {{name: string, slug: string}} category Canonical category.
 * @param {Object} [options] Options.
 * @param {Set<string>} [options.validOwnerIds] Valid owner user ids.
 * @param {number} [options.limit] Maximum entries to return.
 * @returns {Object[]} Ranked `{supplier, score}` entries, best first.
 */
function rankSuppliersForCategory(suppliers, category, options = {}) {
  if (!category) {
    return [];
  }
  const validOwnerIds = options.validOwnerIds instanceof Set ? options.validOwnerIds : new Set();
  const limit = Number.isFinite(Number(options.limit))
    ? Number(options.limit)
    : MAX_SUPPLIERS_PER_PAGE;

  const bestByIdentity = new Map();
  for (const supplier of suppliers || []) {
    if (!supplier || supplier.category !== category.name) {
      continue;
    }
    if (!supplierLocation.isEligibleForLocationPages(supplier, validOwnerIds)) {
      continue;
    }
    // Unlike the per-city ranking this mirrors, there is no `ownerUserId`
    // fallback here: one owner can legitimately run several distinct
    // supplier profiles (different businesses, different categories), and
    // collapsing on owner alone would silently drop real, separate listings
    // from a national category page.
    const identity = supplier.canonicalSupplierId || supplier.id;
    const score =
      Math.round(
        (supplierLocation.qualityScore(supplier) + supplierLocation.tierBoost(supplier)) * 100
      ) / 100;
    const entry = { supplier, score };
    const existing = bestByIdentity.get(identity);
    if (!existing || entry.score > existing.score) {
      bestByIdentity.set(identity, entry);
    }
  }

  return [...bestByIdentity.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Whether a category page has enough real inventory to be worth indexing —
 * the same threshold `emptyStateIndexGate` applies to the equivalent
 * `/suppliers?category=X` filter.
 * @param {Object[]} rankedSuppliers Ranked entries for the category.
 * @returns {boolean} True when the page should be `index, follow`.
 */
function isIndexable(rankedSuppliers) {
  return emptyStateIndexGate.supplierFilterResultsAreIndexable((rankedSuppliers || []).length);
}

/**
 * Build the metadata for a category directory page.
 * @param {Object} input Inputs.
 * @param {{name: string, slug: string}} input.category Canonical category.
 * @param {Object[]} input.rankedSuppliers Ranked suppliers for the category.
 * @param {string} input.baseUrl Base URL.
 * @returns {Object} `{title, description, canonicalUrl, heading, supplierCount}`.
 */
function buildCategoryDirectoryMetadata(input) {
  const { category, rankedSuppliers = [], baseUrl } = input || {};
  const origin = safeBaseUrl(baseUrl);
  const canonicalUrl = `${origin}/categories/${category.slug}`;
  const supplierCount = rankedSuppliers.length;
  const nameLower = category.name.toLowerCase();

  const title = truncate(`${category.name} suppliers | EventFlow`, 70);
  const description = truncate(
    supplierCount
      ? `Compare ${supplierCount} ${nameLower} ${supplierCount === 1 ? 'supplier' : 'suppliers'} across the UK on EventFlow. Browse profiles and message suppliers directly.`
      : `Find ${nameLower} suppliers across the UK on EventFlow. Browse profiles and message suppliers directly.`,
    160
  );

  return {
    title,
    description,
    canonicalUrl,
    heading: `${category.name} suppliers across the UK`,
    supplierCount,
  };
}

/**
 * Phrasings for an automatically composed category introduction, each built
 * only from real, current numbers — never an invented claim. Mirrors
 * `locationCategoryPage.service.js`'s `composeAutomaticCategoryIntro`.
 */
const AUTOMATIC_INTRO_TEMPLATES = [
  ({ category, supplierCount, supplierNoun, packageCount }) =>
    `EventFlow lists ${supplierCount} ${category.name.toLowerCase()} ${supplierNoun} across the UK${
      packageCount
        ? `, with ${packageCount} ${packageCount === 1 ? 'package' : 'packages'} you can book directly`
        : ''
    }. Compare profiles and message suppliers through EventFlow.`,
  ({ category, supplierCount, supplierNoun }) =>
    `Looking for ${category.name.toLowerCase()} for your event? EventFlow currently lists ${supplierCount} ${supplierNoun} from across the UK. Browse profiles and get in touch directly.`,
  ({ category, supplierCount, supplierNoun, packageCount }) =>
    `EventFlow connects you with ${supplierCount} ${category.name.toLowerCase()} ${supplierNoun}${
      packageCount
        ? `, including ${packageCount} ready-made ${packageCount === 1 ? 'package' : 'packages'}`
        : ''
    }. See who is available for your event and where they are based.`,
];

/**
 * Compose a factual introduction for a category page from real inventory.
 * @param {{name: string, slug: string}} category Canonical category.
 * @param {Object} input Real inventory for the category.
 * @param {Object[]} input.rankedSuppliers Ranked suppliers for the category.
 * @param {number} [input.packageCount] Genuine packages visible on the page.
 * @returns {string} Composed introduction, or an empty string with no suppliers.
 */
function composeCategoryDirectoryIntro(category, { rankedSuppliers = [], packageCount = 0 } = {}) {
  const supplierCount = rankedSuppliers.length;
  if (!supplierCount) {
    return '';
  }
  const template =
    AUTOMATIC_INTRO_TEMPLATES[stableChoice(category.slug, AUTOMATIC_INTRO_TEMPLATES.length)];
  return template({
    category,
    supplierCount,
    supplierNoun: supplierCount === 1 ? 'supplier' : 'suppliers',
    packageCount,
  });
}

/**
 * Breadcrumb JSON-LD for a category directory page.
 * @param {{name: string, slug: string}} category Canonical category.
 * @param {string} baseUrl Base URL.
 * @returns {Object} BreadcrumbList structured data.
 */
function buildCategoryDirectoryBreadcrumbs(category, baseUrl) {
  const origin = safeBaseUrl(baseUrl);
  const items = [
    { name: 'Home', item: `${origin}/` },
    { name: 'Suppliers', item: `${origin}/suppliers` },
    { name: category.name, item: `${origin}/categories/${category.slug}` },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((entry, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: entry.name,
      item: entry.item,
    })),
  };
}

/**
 * CollectionPage structured data for a category directory page.
 * @param {Object} input Inputs.
 * @param {{name: string, slug: string}} input.category Canonical category.
 * @param {Object} input.metadata Result of `buildCategoryDirectoryMetadata`.
 * @param {Object[]} input.rankedSuppliers Ranked suppliers for the category.
 * @param {string} input.baseUrl Base URL.
 * @param {Function} input.supplierUrlFor `(supplier) => string` resolving a public profile URL.
 * @returns {Object} CollectionPage structured data.
 */
function buildCategoryDirectoryStructuredData(input) {
  const { category, metadata, rankedSuppliers = [], baseUrl, supplierUrlFor } = input || {};
  const origin = safeBaseUrl(baseUrl);
  const elements = [];

  rankedSuppliers.forEach(entry => {
    const url = typeof supplierUrlFor === 'function' ? supplierUrlFor(entry.supplier) : '';
    if (!url) {
      return;
    }
    elements.push({
      '@type': 'ListItem',
      position: elements.length + 1,
      url,
      name: entry.supplier.name || entry.supplier.businessName || 'Event supplier',
    });
  });

  const data = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${origin}/categories/${category.slug}#collection`,
    name: metadata.title,
    description: metadata.description,
    url: metadata.canonicalUrl,
  };

  if (elements.length) {
    data.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: elements.length,
      itemListElement: elements,
    };
  }

  return data;
}

/**
 * Every canonical category with at least one eligible supplier nationwide,
 * ranked by supplier count — the source list for the `/categories` hub and
 * for sitemap membership.
 * @param {Object[]} suppliers Raw supplier records.
 * @param {Set<string>} validOwnerIds Valid owner user ids.
 * @returns {{category: {name: string, slug: string}, rankedSuppliers: Object[]}[]} Populated categories.
 */
function populatedCategories(suppliers, validOwnerIds) {
  return categoryRegistry.CATEGORY_DEFINITIONS.map(category => ({
    category,
    rankedSuppliers: rankSuppliersForCategory(suppliers, category, { validOwnerIds }),
  })).filter(entry => entry.rankedSuppliers.length > 0);
}

/**
 * Assemble everything a category directory page needs to render.
 * @param {Object} input Inputs.
 * @param {{name: string, slug: string}} input.category Canonical category.
 * @param {Object[]} input.suppliers All raw supplier records.
 * @param {Object[]} [input.packages] All package records.
 * @param {Set<string>} [input.validOwnerIds] Valid owner user ids.
 * @param {{category: {name:string,slug:string}, rankedSuppliers: Object[]}[]} [input.allPopulatedCategories] Result of `populatedCategories`, for related-category links.
 * @param {string} input.baseUrl Base URL.
 * @returns {Object} Category directory page model.
 */
function buildCategoryDirectoryPageModel(input) {
  const {
    category,
    suppliers = [],
    packages = [],
    validOwnerIds = new Set(),
    allPopulatedCategories = [],
    baseUrl,
  } = input || {};

  const rankedSuppliers = rankSuppliersForCategory(suppliers, category, { validOwnerIds });
  const supplierIds = new Set(rankedSuppliers.map(entry => String(entry.supplier.id)));
  const categoryPackages = (packages || []).filter(
    pkg => pkg && supplierIds.has(String(pkg.supplierId))
  );

  const metadata = buildCategoryDirectoryMetadata({ category, rankedSuppliers, baseUrl });
  const intro = composeCategoryDirectoryIntro(category, {
    rankedSuppliers,
    packageCount: categoryPackages.length,
  });

  const relatedCategories = allPopulatedCategories
    .filter(entry => entry.category.slug !== category.slug)
    .sort((a, b) => b.rankedSuppliers.length - a.rankedSuppliers.length)
    .slice(0, MAX_RELATED_CATEGORIES)
    .map(entry => entry.category);

  return {
    category,
    metadata,
    intro,
    rankedSuppliers,
    packages: categoryPackages,
    relatedCategories,
    indexable: isIndexable(rankedSuppliers),
    breadcrumbs: buildCategoryDirectoryBreadcrumbs(category, baseUrl),
  };
}

module.exports = {
  MAX_SUPPLIERS_PER_PAGE,
  buildCategoryDirectoryBreadcrumbs,
  buildCategoryDirectoryMetadata,
  buildCategoryDirectoryPageModel,
  buildCategoryDirectoryStructuredData,
  composeCategoryDirectoryIntro,
  isIndexable,
  populatedCategories,
  rankSuppliersForCategory,
  resolveCategory,
};
