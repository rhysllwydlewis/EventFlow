/**
 * EventFlow location pages — publication state, quality gate and metadata
 *
 * The registry says which cities exist. This service says which of them
 * EventFlow is willing to show, and which of those it is willing to let a
 * search engine index.
 *
 * Indexability is earned by measurable signals — real inventory, category
 * spread, human-written local copy, proof of activity, internal links and a
 * recent editorial review — not by a hard-coded supplier count.
 */

'use strict';

const registry = require('./locationRegistry.service');
const supplierLocation = require('./supplierLocation.service');
const {
  COLLECTIONS,
  CONTENT_REVIEW_MAX_AGE_DAYS,
  LIMITS,
  PUBLICATION_STATES,
  PUBLICATION_STATE_VALUES,
  PUBLIC_STATES,
  QUALITY_PASS_SCORE,
  QUALITY_SIGNALS,
} = require('../models/LocationContent');

const DEFAULT_BASE_URL = 'https://event-flow.co.uk';

/**
 * The stored editorial record for a city, with defaults applied.
 *
 * A city with no record at all is a draft: new registry entries are never
 * published by the act of adding them to the file.
 * @param {Object} city Registry city record.
 * @param {Object|null} stored Record from the `location_pages` collection.
 * @returns {Object} Normalised page record.
 */
function normalisePageRecord(city, stored) {
  const record = stored && typeof stored === 'object' ? stored : {};
  const state = PUBLICATION_STATE_VALUES.includes(record.status)
    ? record.status
    : PUBLICATION_STATES.draft;
  const content = record.content && typeof record.content === 'object' ? record.content : {};

  return {
    locationSlug: city.slug,
    status: state,
    // Indexing is opt-in and additionally gated on quality, so flipping this
    // flag alone can never index a thin page.
    indexingRequested: record.indexingRequested === true,
    publishedAt: record.publishedAt || null,
    lastReviewedAt: record.lastReviewedAt || null,
    reviewedBy: record.reviewedBy || null,
    seo: {
      title: (record.seo && record.seo.title) || '',
      metaDescription: (record.seo && record.seo.metaDescription) || '',
    },
    content: {
      heroImageUrl: content.heroImageUrl || null,
      heroImageAlt: content.heroImageAlt || null,
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
 * Load every location page record, keyed by slug.
 * @param {Object} db Database handle exposing `read`.
 * @returns {Promise<Map<string, Object>>} Stored records by slug.
 */
async function loadPageRecords(db) {
  const rows = await db.read(COLLECTIONS.locationPages);
  const map = new Map();
  for (const row of rows || []) {
    if (row && row.locationSlug) {
      map.set(String(row.locationSlug), row);
    }
  }
  return map;
}

/**
 * Whether a page is reachable by the public at all.
 * @param {Object} page Normalised page record.
 * @returns {boolean} True for pilot and published pages.
 */
function isPubliclyVisible(page) {
  return Boolean(page) && PUBLIC_STATES.includes(page.status);
}

/**
 * Age of a date in whole days.
 * @param {string|Date} value Date value.
 * @param {Date} [now] Current time.
 * @returns {number|null} Age in days, or null when unparseable.
 */
function ageInDays(value, now = new Date()) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.floor((now.getTime() - parsed.getTime()) / 86400000);
}

/**
 * Score one quality signal against its target, as a 0–1 ratio.
 * @param {number} value Observed value.
 * @param {number} target Value that earns full marks.
 * @returns {number} Ratio between 0 and 1.
 */
function signalRatio(value, target) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (!Number.isFinite(target) || target <= 0) {
    return 1;
  }
  return Math.min(1, value / target);
}

/**
 * Evaluate the indexability quality gate for a city page.
 *
 * Returns the score, the per-signal detail behind it and the specific reasons a
 * page is being held back, so the admin area can explain a refusal rather than
 * just showing a red light.
 * @param {Object} input Gate inputs.
 * @param {Object} input.city Registry city record.
 * @param {Object} input.page Normalised page record.
 * @param {Object[]} input.rankedSuppliers Ranked supplier entries for the city.
 * @param {number} [input.packageCount] Genuine packages visible on the page.
 * @param {number} [input.eventCount] Genuine public events visible on the page.
 * @param {number} [input.reviewCount] Approved reviews visible on the page.
 * @param {number} [input.nearbyPublishedCount] Published nearby pages to link.
 * @param {Date} [input.now] Current time.
 * @returns {Object} `{score, passes, signals, blockers}`.
 */
function evaluateQualityGate(input) {
  const {
    city,
    page,
    rankedSuppliers = [],
    packageCount = 0,
    eventCount = 0,
    reviewCount = 0,
    nearbyPublishedCount = 0,
    now = new Date(),
  } = input || {};

  const categories = new Set(
    rankedSuppliers
      .map(entry => entry.supplier?.category)
      .filter(Boolean)
      .map(String)
  );
  const localSections =
    (page && page.content.intro ? 1 : 0) + (page ? page.content.planningSections.length : 0);
  const reviewAge = page ? ageInDays(page.lastReviewedAt, now) : null;
  const reviewIsFresh = reviewAge !== null && reviewAge <= CONTENT_REVIEW_MAX_AGE_DAYS;

  const signals = {
    supplierDepth: {
      value: rankedSuppliers.length,
      target: QUALITY_SIGNALS.supplierDepth.target,
      weight: QUALITY_SIGNALS.supplierDepth.weight,
    },
    categoryDiversity: {
      value: categories.size,
      target: QUALITY_SIGNALS.categoryDiversity.target,
      weight: QUALITY_SIGNALS.categoryDiversity.weight,
    },
    localContent: {
      value: localSections,
      target: QUALITY_SIGNALS.localContent.target,
      weight: QUALITY_SIGNALS.localContent.weight,
    },
    proofOfActivity: {
      value: packageCount + eventCount + reviewCount,
      target: QUALITY_SIGNALS.proofOfActivity.target,
      weight: QUALITY_SIGNALS.proofOfActivity.weight,
    },
    internalLinks: {
      value: nearbyPublishedCount,
      target: QUALITY_SIGNALS.internalLinks.target,
      weight: QUALITY_SIGNALS.internalLinks.weight,
    },
    reviewFreshness: {
      value: reviewIsFresh ? 1 : 0,
      target: QUALITY_SIGNALS.reviewFreshness.target,
      weight: QUALITY_SIGNALS.reviewFreshness.weight,
    },
  };

  let score = 0;
  for (const signal of Object.values(signals)) {
    signal.ratio = signalRatio(signal.value, signal.target);
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
  if (score < QUALITY_PASS_SCORE) {
    blockers.push(`quality score ${score} is below the pass mark of ${QUALITY_PASS_SCORE}`);
  }

  return {
    citySlug: city ? city.slug : null,
    score,
    passMark: QUALITY_PASS_SCORE,
    passes: blockers.length === 0,
    signals,
    blockers,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Whether a page should be served with `index, follow`.
 * @param {Object} gate Result of `evaluateQualityGate`.
 * @returns {boolean} True when the page may be indexed.
 */
function isIndexable(gate) {
  return Boolean(gate && gate.passes);
}

/**
 * Normalise a base URL, refusing anything that is not EventFlow over HTTPS.
 * @param {string} value Candidate base URL.
 * @returns {string} Safe origin.
 */
function safeBaseUrl(value) {
  try {
    const parsed = new URL(value || DEFAULT_BASE_URL);
    if (parsed.protocol !== 'https:') {
      return DEFAULT_BASE_URL;
    }
    return parsed.origin;
  } catch (_error) {
    return DEFAULT_BASE_URL;
  }
}

/**
 * Trim text to a maximum length on a whole word where possible.
 * @param {string} value Text.
 * @param {number} maxLength Maximum length.
 * @returns {string} Trimmed text.
 */
function truncate(value, maxLength) {
  const clean = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLength) {
    return clean;
  }
  const cut = clean.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Build the metadata for a city page.
 *
 * Editor-supplied title and description win; the generated fallback describes
 * the inventory that is actually on the page rather than asserting a claim the
 * page cannot support.
 * @param {Object} input Metadata inputs.
 * @returns {Object} `{title, description, canonicalUrl, heading}`.
 */
function buildCityMetadata(input) {
  const { city, page, rankedSuppliers = [], baseUrl } = input || {};
  const origin = safeBaseUrl(baseUrl);
  const canonicalUrl = `${origin}/locations/${city.slug}`;

  const topCategories = [];
  for (const entry of rankedSuppliers) {
    const category = entry.supplier?.category;
    if (category && !topCategories.includes(category)) {
      topCategories.push(category);
    }
    if (topCategories.length === 3) {
      break;
    }
  }

  const title = truncate(
    (page && page.seo.title) ||
      [
        `Event Suppliers in ${city.name}`,
        topCategories.length ? topCategories.join(', ') : null,
        'EventFlow',
      ]
        .filter(Boolean)
        .join(' | '),
    70
  );

  const description = truncate(
    (page && page.seo.metaDescription) ||
      (page && page.content.intro) ||
      `Find event suppliers based in or serving ${city.name}, ${city.nation}. Compare profiles, packages and reviews, then contact suppliers through EventFlow.`,
    160
  );

  return {
    title,
    description,
    canonicalUrl,
    heading: `Event suppliers in ${city.name}`,
  };
}

/**
 * Breadcrumb JSON-LD for a city page.
 * @param {Object} city Registry city record.
 * @param {string} baseUrl Base URL.
 * @returns {Object} BreadcrumbList structured data.
 */
function buildBreadcrumbStructuredData(city, baseUrl) {
  const origin = safeBaseUrl(baseUrl);
  const items = [
    { name: 'Home', item: `${origin}/` },
    { name: 'UK locations', item: `${origin}/locations` },
  ];
  if (city) {
    items.push({ name: city.name, item: `${origin}/locations/${city.slug}` });
  }
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
 * CollectionPage structured data for a city page.
 *
 * Deliberately a CollectionPage over an ItemList of supplier profiles.
 * EventFlow has no branch in the city, so nothing here claims a LocalBusiness —
 * that markup belongs only on an individual supplier's own page.
 * @param {Object} input Inputs.
 * @returns {Object} CollectionPage structured data.
 */
function buildCollectionStructuredData(input) {
  const { city, metadata, rankedSuppliers = [], baseUrl, supplierUrlFor } = input || {};
  const origin = safeBaseUrl(baseUrl);
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
    '@id': `${origin}/locations/${city.slug}#collection`,
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
 * The cities eligible for the sitemap: published, index-requested and passing.
 * @param {Object} input Inputs.
 * @param {Map<string, Object>} input.records Stored page records by slug.
 * @param {Function} input.gateFor Callback returning the gate for a city.
 * @returns {Object[]} `{city, page, gate}` for each indexable city.
 */
function indexableCities({ records, gateFor }) {
  const output = [];
  for (const city of registry.listCities()) {
    const page = normalisePageRecord(city, records.get(city.slug));
    if (page.status !== PUBLICATION_STATES.published || !page.indexingRequested) {
      continue;
    }
    const gate = gateFor(city, page);
    if (isIndexable(gate)) {
      output.push({ city, page, gate });
    }
  }
  return output;
}

/**
 * Count the categories represented by a ranked supplier list.
 * @param {Object[]} rankedSuppliers Ranked entries.
 * @returns {{name: string, count: number}[]} Populated categories only.
 */
function populatedCategories(rankedSuppliers) {
  const counts = new Map();
  for (const entry of rankedSuppliers || []) {
    const name = entry.supplier?.category;
    if (!name) {
      continue;
    }
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Assemble everything a city page needs to render.
 * @param {Object} input Inputs.
 * @returns {Object} Page model.
 */
function buildCityPageModel(input) {
  const {
    city,
    page,
    suppliers = [],
    validOwnerIds = new Set(),
    packages = [],
    events = [],
    reviewCount = 0,
    publishedSlugs = new Set(),
    baseUrl,
    now = new Date(),
  } = input || {};

  const rankedSuppliers = supplierLocation.rankSuppliersForCity(suppliers, city, {
    validOwnerIds,
    limit: LIMITS.maxSuppliersPerPage,
  });
  const supplierIds = new Set(rankedSuppliers.map(entry => String(entry.supplier.id)));

  const cityPackages = (packages || []).filter(
    pkg => pkg && supplierIds.has(String(pkg.supplierId))
  );
  const cityEvents = (events || []).filter(
    event => event && supplierIds.has(String(event.supplierId))
  );
  const nearby = registry
    .nearbyCities(city.slug, nearbyCity => publishedSlugs.has(nearbyCity.slug))
    .slice(0, LIMITS.maxNearbyLinks);

  const gate = evaluateQualityGate({
    city,
    page,
    rankedSuppliers,
    packageCount: cityPackages.length,
    eventCount: cityEvents.length,
    reviewCount,
    nearbyPublishedCount: nearby.length,
    now,
  });

  const metadata = buildCityMetadata({ city, page, rankedSuppliers, baseUrl });

  return {
    city,
    page,
    metadata,
    gate,
    indexable: isIndexable(gate),
    rankedSuppliers,
    categories: populatedCategories(rankedSuppliers),
    packages: cityPackages,
    events: cityEvents,
    nearby,
    breadcrumbs: buildBreadcrumbStructuredData(city, baseUrl),
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  ageInDays,
  buildBreadcrumbStructuredData,
  buildCityMetadata,
  buildCityPageModel,
  buildCollectionStructuredData,
  evaluateQualityGate,
  indexableCities,
  isIndexable,
  isPubliclyVisible,
  loadPageRecords,
  normalisePageRecord,
  populatedCategories,
  safeBaseUrl,
  truncate,
};
