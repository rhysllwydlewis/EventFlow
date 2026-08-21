/**
 * EventFlow UK locations — city × category pages
 *
 * The city-level equivalents in `locationPage.service.js` decide which cities
 * EventFlow is willing to show and index. This module makes the same decision
 * one level deeper, for a single category within a single city — "wedding
 * venues in Cardiff" rather than "Cardiff" — because a city can look ready
 * overall while one specific category is still thin. A combination earns its
 * own launch on its own evidence; it never inherits its parent city's score.
 */

'use strict';

const locationPages = require('./locationPage.service');
const categoryRegistry = require('../public/assets/js/utils/category-link.js');
const {
  CATEGORY_QUALITY_PASS_SCORE,
  CATEGORY_QUALITY_SIGNALS,
  COLLECTIONS,
  CONTENT_REVIEW_MAX_AGE_DAYS,
  LIMITS,
  PUBLICATION_STATES,
  PUBLICATION_STATE_VALUES,
  PUBLIC_STATES,
} = require('../models/LocationContent');

/**
 * Resolve any recognised category spelling — slug, canonical name, or a
 * case/whitespace variant of either — to its canonical `{name, slug}` pair.
 * @param {string} value Candidate category identifier.
 * @returns {{name: string, slug: string}|null} Canonical category, or null.
 */
function resolveCategory(value) {
  const name = categoryRegistry.canonicalCategoryValue(value);
  if (!name) {
    return null;
  }
  const match = categoryRegistry.CATEGORY_DEFINITIONS.find(category => category.name === name);
  return match ? { name: match.name, slug: match.slug } : null;
}

/**
 * The composite key a category page is stored and looked up under.
 * @param {string} citySlug Registry city slug.
 * @param {string} categorySlug Canonical category slug.
 * @returns {string} Composite key.
 */
function categoryPageKey(citySlug, categorySlug) {
  return `${citySlug}:${categorySlug}`;
}

/**
 * The stored editorial record for a city × category page, with defaults
 * applied. A combination with no record at all is a draft — exactly like a
 * city with no `location_pages` record — so adding a category to the shared
 * registry never publishes anything by itself.
 * @param {Object} city Registry city record.
 * @param {{name: string, slug: string}} category Canonical category.
 * @param {Object|null} stored Record from `location_category_pages`.
 * @returns {Object} Normalised page record.
 */
function normaliseCategoryPageRecord(city, category, stored) {
  const record = stored && typeof stored === 'object' ? stored : {};
  const state = PUBLICATION_STATE_VALUES.includes(record.status)
    ? record.status
    : PUBLICATION_STATES.draft;
  const content = record.content && typeof record.content === 'object' ? record.content : {};

  return {
    locationSlug: city.slug,
    categorySlug: category.slug,
    status: state,
    indexingRequested: record.indexingRequested === true,
    managedBy: record.managedBy === 'automation' ? 'automation' : record.managedBy ? 'admin' : null,
    publishedAt: record.publishedAt || null,
    lastReviewedAt: record.lastReviewedAt || null,
    reviewedBy: record.reviewedBy || null,
    seo: {
      title: (record.seo && record.seo.title) || '',
      metaDescription: (record.seo && record.seo.metaDescription) || '',
    },
    content: {
      intro: content.intro || '',
      planningSections: Array.isArray(content.planningSections)
        ? content.planningSections.slice(0, LIMITS.maxSections)
        : [],
      faqs: Array.isArray(content.faqs) ? content.faqs.slice(0, LIMITS.maxFaqs) : [],
    },
    updatedAt: record.updatedAt || null,
  };
}

/**
 * Load every category page record, keyed by `citySlug:categorySlug`.
 * @param {Object} db Database handle exposing `read`.
 * @returns {Promise<Map<string, Object>>} Stored records by composite key.
 */
async function loadCategoryPageRecords(db) {
  const rows = await db.read(COLLECTIONS.locationCategoryPages);
  const map = new Map();
  for (const row of rows || []) {
    if (row && row.locationSlug && row.categorySlug) {
      map.set(categoryPageKey(row.locationSlug, row.categorySlug), row);
    }
  }
  return map;
}

/**
 * Evaluate the indexability quality gate for a city × category page.
 *
 * There is no category-diversity signal here — a page about one category has
 * nothing to diversify — so the weight it carries at city level is spread
 * across the remaining five signals in `CATEGORY_QUALITY_SIGNALS`, each with a
 * target sized for a single category's inventory rather than a whole city's.
 * @param {Object} input Gate inputs.
 * @param {Object} input.city Registry city record.
 * @param {{name: string, slug: string}} input.category Canonical category.
 * @param {Object} input.page Normalised page record.
 * @param {Object[]} input.rankedSuppliers Ranked, category-filtered suppliers.
 * @param {number} [input.packageCount] Genuine packages visible on the page.
 * @param {number} [input.eventCount] Genuine public events visible on the page.
 * @param {number} [input.reviewCount] Approved reviews visible on the page.
 * @param {number} [input.internalLinksCount] Other published pages this page can link to.
 * @param {Date} [input.now] Current time.
 * @returns {Object} `{score, passes, signals, blockers}`.
 */
function evaluateCategoryQualityGate(input) {
  const {
    city,
    category,
    page,
    rankedSuppliers = [],
    packageCount = 0,
    eventCount = 0,
    reviewCount = 0,
    internalLinksCount = 0,
    now = new Date(),
  } = input || {};

  const localSections =
    (page && page.content.intro ? 1 : 0) + (page ? page.content.planningSections.length : 0);
  const reviewAge = page ? locationPages.ageInDays(page.lastReviewedAt, now) : null;
  const reviewIsFresh = reviewAge !== null && reviewAge <= CONTENT_REVIEW_MAX_AGE_DAYS;

  const signals = {
    supplierDepth: {
      value: rankedSuppliers.length,
      target: CATEGORY_QUALITY_SIGNALS.supplierDepth.target,
      weight: CATEGORY_QUALITY_SIGNALS.supplierDepth.weight,
    },
    localContent: {
      value: localSections,
      target: CATEGORY_QUALITY_SIGNALS.localContent.target,
      weight: CATEGORY_QUALITY_SIGNALS.localContent.weight,
    },
    proofOfActivity: {
      value: packageCount + eventCount + reviewCount,
      target: CATEGORY_QUALITY_SIGNALS.proofOfActivity.target,
      weight: CATEGORY_QUALITY_SIGNALS.proofOfActivity.weight,
    },
    internalLinks: {
      value: internalLinksCount,
      target: CATEGORY_QUALITY_SIGNALS.internalLinks.target,
      weight: CATEGORY_QUALITY_SIGNALS.internalLinks.weight,
    },
    reviewFreshness: {
      value: reviewIsFresh ? 1 : 0,
      target: CATEGORY_QUALITY_SIGNALS.reviewFreshness.target,
      weight: CATEGORY_QUALITY_SIGNALS.reviewFreshness.weight,
    },
  };

  let score = 0;
  for (const signal of Object.values(signals)) {
    signal.ratio = locationPages.signalRatio(signal.value, signal.target);
    signal.points = Math.round(signal.ratio * signal.weight * 100) / 100;
    score += signal.points;
  }
  score = Math.round(score * 100) / 100;

  const blockers = [];
  if (!page || page.status !== PUBLICATION_STATES.published) {
    blockers.push('page is not published');
  }
  if (!page || !page.indexingRequested) {
    blockers.push('indexing has not been requested by an editor');
  }
  if (!page || !page.content.intro.trim()) {
    blockers.push('page has no local introduction');
  }
  if (!reviewIsFresh) {
    blockers.push(
      reviewAge === null
        ? 'page has never been reviewed by a human'
        : `local copy was last reviewed ${reviewAge} days ago`
    );
  }
  if (score < CATEGORY_QUALITY_PASS_SCORE) {
    blockers.push(
      `quality score ${score} is below the pass mark of ${CATEGORY_QUALITY_PASS_SCORE}`
    );
  }

  return {
    citySlug: city ? city.slug : null,
    categorySlug: category ? category.slug : null,
    score,
    passMark: CATEGORY_QUALITY_PASS_SCORE,
    passes: blockers.length === 0,
    signals,
    blockers,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Whether a page should be served with `index, follow`.
 * @param {Object} gate Result of `evaluateCategoryQualityGate`.
 * @returns {boolean} True when the page may be indexed.
 */
function isIndexable(gate) {
  return Boolean(gate && gate.passes);
}

/**
 * Whether a category page is reachable by the public at all.
 * @param {Object} page Normalised page record.
 * @returns {boolean} True for pilot and published pages.
 */
function isPubliclyVisible(page) {
  return Boolean(page) && PUBLIC_STATES.includes(page.status);
}

/**
 * Build the metadata for a city × category page.
 * @param {Object} input Metadata inputs.
 * @returns {Object} `{title, description, canonicalUrl, heading}`.
 */
function buildCategoryMetadata(input) {
  const { city, category, page, rankedSuppliers = [], baseUrl } = input || {};
  const origin = locationPages.safeBaseUrl(baseUrl);
  const canonicalUrl = `${origin}/locations/${city.slug}/${category.slug}`;
  const supplierCount = rankedSuppliers.length;

  const title = locationPages.truncate(
    (page && page.seo.title) || `${category.name} in ${city.name} | EventFlow`,
    70
  );

  const description = locationPages.truncate(
    (page && page.seo.metaDescription) ||
      (page && page.content.intro) ||
      `Find ${category.name.toLowerCase()} suppliers based in or serving ${city.name}, ${
        city.nation
      }. Compare profiles and message suppliers directly through EventFlow.`,
    160
  );

  return {
    title,
    description,
    canonicalUrl,
    heading: `${category.name} in ${city.name}`,
    imageUrl: null,
    supplierCount,
  };
}

/**
 * Breadcrumb JSON-LD for a city × category page.
 * @param {Object} city Registry city record.
 * @param {{name: string, slug: string}} category Canonical category.
 * @param {string} baseUrl Base URL.
 * @returns {Object} BreadcrumbList structured data.
 */
function buildCategoryBreadcrumbStructuredData(city, category, baseUrl) {
  const origin = locationPages.safeBaseUrl(baseUrl);
  const items = [
    { name: 'Home', item: `${origin}/` },
    { name: 'UK locations', item: `${origin}/locations` },
    { name: city.name, item: `${origin}/locations/${city.slug}` },
    { name: category.name, item: `${origin}/locations/${city.slug}/${category.slug}` },
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
 * CollectionPage structured data for a city × category page.
 *
 * A distinct `@id` from the parent city page's own CollectionPage — reusing
 * one would tell a crawler two different pages are the same entity.
 * @param {Object} input Inputs.
 * @returns {Object} CollectionPage structured data.
 */
function buildCategoryCollectionStructuredData(input) {
  const { city, category, metadata, rankedSuppliers = [], baseUrl, supplierUrlFor } = input || {};
  const origin = locationPages.safeBaseUrl(baseUrl);
  const elements = [];

  rankedSuppliers.forEach((entry, index) => {
    const url = typeof supplierUrlFor === 'function' ? supplierUrlFor(entry.supplier) : '';
    if (!url) {
      return;
    }
    elements.push({
      '@type': 'ListItem',
      position: index + 1,
      url,
      name: entry.supplier.name || entry.supplier.businessName || 'Event supplier',
    });
  });

  const data = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${origin}/locations/${city.slug}/${category.slug}#collection`,
    name: metadata.title,
    description: metadata.description,
    url: metadata.canonicalUrl,
    about: {
      '@type': 'Place',
      name: city.name,
      address: {
        '@type': 'PostalAddress',
        addressLocality: city.name,
        addressRegion: city.region || undefined,
        addressCountry: 'GB',
      },
      geo: {
        '@type': 'GeoCoordinates',
        latitude: city.centre.latitude,
        longitude: city.centre.longitude,
      },
    },
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
 * Phrasings for an automatically composed category introduction, each built
 * only from real, current numbers — never an invented local claim.
 */
const AUTOMATIC_CATEGORY_INTRO_TEMPLATES = [
  ({ city, category, supplierCount, supplierNoun, packageCount }) =>
    `EventFlow lists ${supplierCount} ${category.name.toLowerCase()} ${supplierNoun} in ${city.name}${
      packageCount
        ? `, with ${packageCount} ${packageCount === 1 ? 'package' : 'packages'} you can book directly`
        : ''
    }. Compare profiles and message suppliers through EventFlow.`,
  ({ city, category, supplierCount, supplierNoun }) =>
    `Looking for ${category.name.toLowerCase()} in ${city.name}? EventFlow currently lists ${supplierCount} ${supplierNoun}. Browse profiles and get in touch directly.`,
  ({ city, category, supplierCount, supplierNoun, packageCount }) =>
    `${city.name} has ${supplierCount} ${category.name.toLowerCase()} ${supplierNoun} on EventFlow${
      packageCount
        ? `, with ${packageCount} ready-made ${packageCount === 1 ? 'package' : 'packages'}`
        : ''
    }. See who is based locally and who travels to your event.`,
  ({ city, category, supplierCount, supplierNoun }) =>
    `Planning an event in ${city.name}? EventFlow connects you with ${supplierCount} ${category.name.toLowerCase()} ${supplierNoun}, each contactable directly through the platform.`,
];

/**
 * Compose a factual introduction for a category page from real inventory.
 * @param {Object} city Registry city record.
 * @param {{name: string, slug: string}} category Canonical category.
 * @param {Object} input Real inventory for the combination.
 * @param {Object[]} input.rankedSuppliers Ranked, category-filtered suppliers.
 * @param {number} input.packageCount Genuine packages on the page.
 * @returns {string} Composed introduction, or an empty string.
 */
function composeAutomaticCategoryIntro(
  city,
  category,
  { rankedSuppliers = [], packageCount = 0 } = {}
) {
  const supplierCount = rankedSuppliers.length;
  if (!supplierCount) {
    return '';
  }
  const template =
    AUTOMATIC_CATEGORY_INTRO_TEMPLATES[
      locationPages.stableChoice(
        categoryPageKey(city.slug, category.slug),
        AUTOMATIC_CATEGORY_INTRO_TEMPLATES.length
      )
    ];
  return template({
    city,
    category,
    supplierCount,
    supplierNoun: supplierCount === 1 ? 'supplier' : 'suppliers',
    packageCount,
  });
}

/**
 * Assemble everything a city × category page needs to render.
 * @param {Object} input Inputs.
 * @param {Object} input.city Registry city record.
 * @param {{name: string, slug: string}} input.category Canonical category.
 * @param {Object} input.page Normalised category page record.
 * @param {Object[]} input.rankedCitySuppliers Every ranked supplier for the city (unfiltered).
 * @param {Object[]} input.packages All package records.
 * @param {Object[]} input.events All public calendar event records.
 * @param {{name: string, count: number}[]} input.cityCategories Populated categories for the city.
 * @param {Set<string>} input.publishedCategoryKeys `citySlug:categorySlug` keys that are published.
 * @param {Object[]} input.nearbyCities Published nearby city records.
 * @param {string} input.baseUrl Base URL.
 * @param {Date} [input.now] Current time.
 * @returns {Object} Category page model.
 */
function buildCategoryPageModel(input) {
  const {
    city,
    category,
    page,
    rankedCitySuppliers = [],
    packages = [],
    events = [],
    cityCategories = [],
    publishedCategoryKeys = new Set(),
    nearbyCities = [],
    baseUrl,
    now = new Date(),
  } = input || {};

  // Ranked once for the whole city, then filtered to this category and capped
  // — never the other way round, or a city with many categories could crowd
  // this one's own suppliers out of an early, city-wide cap.
  const rankedSuppliers = rankedCitySuppliers
    .filter(entry => entry.supplier && entry.supplier.category === category.name)
    .slice(0, LIMITS.maxSuppliersPerPage);
  const supplierIds = new Set(rankedSuppliers.map(entry => String(entry.supplier.id)));

  const categoryPackages = (packages || []).filter(
    pkg => pkg && supplierIds.has(String(pkg.supplierId))
  );
  const categoryEvents = (events || []).filter(
    event => event && supplierIds.has(String(event.supplierId))
  );

  // Cross-links to the other categories this city genuinely has suppliers in,
  // and to the same category in nearby published cities — the internal-links
  // signal the gate below reads, and real navigation for a visitor besides.
  const siblingCategories = cityCategories.filter(entry => entry.name !== category.name);
  const publishedSiblingCategories = siblingCategories.filter(entry => {
    const sibling = resolveCategory(entry.name);
    return sibling && publishedCategoryKeys.has(categoryPageKey(city.slug, sibling.slug));
  });
  const nearbySameCategory = nearbyCities.filter(nearby =>
    publishedCategoryKeys.has(categoryPageKey(nearby.slug, category.slug))
  );

  const effectivePage =
    page && !page.content.intro
      ? {
          ...page,
          content: {
            ...page.content,
            intro:
              composeAutomaticCategoryIntro(city, category, {
                rankedSuppliers,
                packageCount: categoryPackages.length,
              }) || page.content.intro,
          },
        }
      : page;

  const gate = evaluateCategoryQualityGate({
    city,
    category,
    page: effectivePage,
    rankedSuppliers,
    packageCount: categoryPackages.length,
    eventCount: categoryEvents.length,
    internalLinksCount: publishedSiblingCategories.length + nearbySameCategory.length,
    now,
  });

  const metadata = buildCategoryMetadata({
    city,
    category,
    page: effectivePage,
    rankedSuppliers,
    baseUrl,
  });

  return {
    city,
    category,
    page: effectivePage,
    metadata,
    gate,
    indexable: isIndexable(gate),
    rankedSuppliers,
    packages: categoryPackages,
    events: categoryEvents,
    siblingCategories: publishedSiblingCategories,
    nearbySameCategory,
    breadcrumbs: buildCategoryBreadcrumbStructuredData(city, category, baseUrl),
  };
}

module.exports = {
  buildCategoryBreadcrumbStructuredData,
  buildCategoryCollectionStructuredData,
  buildCategoryMetadata,
  buildCategoryPageModel,
  categoryPageKey,
  composeAutomaticCategoryIntro,
  evaluateCategoryQualityGate,
  isIndexable,
  isPubliclyVisible,
  loadCategoryPageRecords,
  normaliseCategoryPageRecord,
  resolveCategory,
};
