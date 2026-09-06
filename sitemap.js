/**
 * Dynamic Sitemap Generator for EventFlow
 * Generates sitemap.xml dynamically from database
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dbUnified = require('./db-unified');
const logger = require('./utils/logger');
const { buildPublicSupplierSlug } = require('./services/publicSupplierSeo.service');
const {
  buildPublicEventSlug,
  buildPublicPackageSlug,
  isIndexablePublicEvent,
  validLastModified,
} = require('./services/publicListingSeo.service');
const seoEligibility = require('./services/seoEligibility.service');
const emptyStateIndexGate = require('./services/emptyStateIndexGate.service');
const locationPageService = require('./services/locationPage.service');
const locationCategoryPageService = require('./services/locationCategoryPage.service');
const categoryDirectoryPageService = require('./services/categoryDirectoryPage.service');
const locationRegistry = require('./services/locationRegistry.service');
const supplierLocationService = require('./services/supplierLocation.service');
const { PUBLICATION_STATES } = require('./models/LocationContent');

/**
 * Load guide slugs from the static guides.json data file.
 * Returns an array of objects { slug, lastmod } for all guides.
 * Falls back to an empty array if the file cannot be read.
 */
function loadGuideEntries() {
  try {
    const filePath = path.join(__dirname, 'public', 'assets', 'data', 'guides.json');
    const raw = fs.readFileSync(filePath, 'utf8');
    const guides = JSON.parse(raw);
    return guides.map(g => ({
      slug: (g.href || '').replace('/articles/', ''),
      lastmod: g.lastMaterialUpdate || g.lastUpdated || g.publishedDate || null,
    }));
  } catch (err) {
    logger.error('sitemap: could not load guides.json:', err);
    return [];
  }
}

/**
 * City pages that are genuinely published, index-requested and passing the
 * quality gate, with the date their content was last changed.
 *
 * A page leaves the sitemap the moment any one of those stops being true: the
 * sitemap is generated from the same gate the page itself uses, so it can never
 * advertise a URL that returns `noindex`.
 * @param {Object[]} suppliers Supplier records.
 * @param {Object[]} users User records.
 * @param {Object[]} packages Package records.
 * @param {Object[]} events Public calendar event records.
 * @returns {Promise<{slug: string, lastmod: string}[]>} Sitemap entries.
 */
async function loadIndexableCityEntries(suppliers, users, packages, events) {
  try {
    const rows = await readCollection('location_pages');
    const records = new Map();
    for (const row of rows) {
      if (row && row.locationSlug) {
        records.set(String(row.locationSlug), row);
      }
    }

    const validOwnerIds = new Set((users || []).map(user => user?.id).filter(Boolean));
    const eligibleSuppliers = (suppliers || []).filter(
      supplier => seoEligibility.canBeViewedPublicly(supplier, { validOwnerIds }).eligible
    );
    const publishedSlugs = new Set(
      locationRegistry
        .listCities()
        .filter(
          city =>
            locationPageService.normalisePageRecord(city, records.get(city.slug)).status ===
            PUBLICATION_STATES.published
        )
        .map(city => city.slug)
    );

    return locationPageService
      .indexableCities({
        records,
        gateFor: (city, page) =>
          locationPageService.buildCityPageModel({
            city,
            page,
            suppliers: eligibleSuppliers,
            validOwnerIds,
            packages,
            events,
            publishedSlugs,
          }).gate,
      })
      .map(({ city, page }) => ({
        slug: city.slug,
        lastmod: page.updatedAt || page.publishedAt || page.lastReviewedAt || '',
      }));
  } catch (error) {
    logger.error('sitemap: could not evaluate location pages:', error);
    return [];
  }
}

/**
 * City × category pages that are genuinely published, index-requested and
 * passing their own quality gate — never the parent city's.
 *
 * Only categories a city actually has suppliers in are ever evaluated, so a
 * city with no registered supplier depth costs nothing extra to consider here.
 * @param {Object[]} suppliers Supplier records.
 * @param {Object[]} users User records.
 * @param {Object[]} packages Package records.
 * @param {Object[]} events Public calendar event records.
 * @returns {Promise<{citySlug: string, categorySlug: string, lastmod: string}[]>} Sitemap entries.
 */
async function loadIndexableCategoryEntries(suppliers, users, packages, events) {
  try {
    const [cityRows, categoryRows] = await Promise.all([
      readCollection('location_pages'),
      readCollection('location_category_pages'),
    ]);
    const cityRecords = new Map();
    for (const row of cityRows) {
      if (row && row.locationSlug) {
        cityRecords.set(String(row.locationSlug), row);
      }
    }
    const categoryRecords = new Map();
    for (const row of categoryRows) {
      if (row && row.locationSlug && row.categorySlug) {
        categoryRecords.set(`${row.locationSlug}:${row.categorySlug}`, row);
      }
    }

    const validOwnerIds = new Set((users || []).map(user => user?.id).filter(Boolean));
    const eligibleSuppliers = (suppliers || []).filter(
      supplier => seoEligibility.canBeViewedPublicly(supplier, { validOwnerIds }).eligible
    );

    const publishedCitySlugs = new Set(
      locationRegistry
        .listCities()
        .filter(
          city =>
            locationPageService.normalisePageRecord(city, cityRecords.get(city.slug)).status ===
            PUBLICATION_STATES.published
        )
        .map(city => city.slug)
    );
    const publishedCategoryKeys = new Set();
    for (const [key, record] of categoryRecords) {
      if (record && record.status === PUBLICATION_STATES.published) {
        publishedCategoryKeys.add(key);
      }
    }

    const entries = [];
    for (const city of locationRegistry.listCities()) {
      // A category page's breadcrumb links back to its city page, so it never
      // belongs in the sitemap ahead of it — the same rule the public route
      // enforces for reachability, applied here to indexability.
      if (!publishedCitySlugs.has(city.slug)) {
        continue;
      }
      const rankedCitySuppliers = supplierLocationService.rankSuppliersForCity(
        eligibleSuppliers,
        city,
        { validOwnerIds }
      );
      const cityCategories = locationPageService.populatedCategories(rankedCitySuppliers);
      if (!cityCategories.length) {
        continue;
      }
      const nearby = locationRegistry.nearbyCities(city.slug, nearbyCity =>
        publishedCitySlugs.has(nearbyCity.slug)
      );

      for (const entry of cityCategories) {
        const category = locationCategoryPageService.resolveCategory(entry.name);
        if (!category) {
          continue;
        }
        const key = `${city.slug}:${category.slug}`;
        const page = locationCategoryPageService.normaliseCategoryPageRecord(
          city,
          category,
          categoryRecords.get(key)
        );
        if (page.status !== PUBLICATION_STATES.published || !page.indexingRequested) {
          continue;
        }
        const model = locationCategoryPageService.buildCategoryPageModel({
          city,
          category,
          page,
          rankedCitySuppliers,
          packages,
          events,
          cityCategories,
          publishedCategoryKeys,
          nearbyCities: nearby,
        });
        if (locationCategoryPageService.isIndexable(model.gate)) {
          entries.push({
            citySlug: city.slug,
            categorySlug: category.slug,
            lastmod: page.updatedAt || page.publishedAt || page.lastReviewedAt || '',
          });
        }
      }
    }
    return entries;
  } catch (error) {
    logger.error('sitemap: could not evaluate location category pages:', error);
    return [];
  }
}

/**
 * National category directory pages (`/categories/:categorySlug`) that
 * currently have enough real, eligible suppliers to be worth indexing.
 * @param {Object[]} suppliers Raw supplier records.
 * @param {Object[]} users User records, used to validate supplier owners.
 * @returns {Promise<{categorySlug: string}[]>} Indexable category slugs.
 */
function loadIndexableCategoryDirectoryEntries(suppliers, users) {
  try {
    const validOwnerIds = new Set((users || []).map(user => user?.id).filter(Boolean));
    const eligibleSuppliers = (suppliers || []).filter(
      supplier => seoEligibility.canBeViewedPublicly(supplier, { validOwnerIds }).eligible
    );
    return categoryDirectoryPageService
      .populatedCategories(eligibleSuppliers, validOwnerIds)
      .filter(entry => categoryDirectoryPageService.isIndexable(entry.rankedSuppliers))
      .map(entry => ({ categorySlug: entry.category.slug }));
  } catch (error) {
    logger.error('sitemap: could not evaluate category directory pages:', error);
    return [];
  }
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validLastModifiedOrFallback(value, fallback = '') {
  return validLastModified(value) || validLastModified(fallback);
}

function appendUrl(xmlParts, location, lastmod = '') {
  xmlParts.push('  <url>');
  xmlParts.push(`    <loc>${xmlEscape(location)}</loc>`);
  if (lastmod) {
    xmlParts.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
  }
  xmlParts.push('  </url>');
}

async function readCollection(collection) {
  try {
    const records = await dbUnified.read(collection);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    logger.error(`sitemap: could not load ${collection}:`, error);
    return [];
  }
}

/**
 * Generate sitemap XML.
 * Dates are emitted only when EventFlow has a genuine source timestamp. Static
 * pages intentionally omit lastmod rather than claiming that every request was
 * a content update.
 *
 * @param {string} baseUrl - Base URL of the site
 * @returns {Promise<string>} Sitemap XML
 */
// skipcq: JS-R1005 -- One linear sequence keeps every URL-type's eligibility
// gate, its sitemap membership and the summary count next to each other,
// which is exactly what SEO-005/SEO-007 need to stay consistent.
async function generateSitemap(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  const xmlParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  // CI-visible summary of what went into this sitemap, by URL type — logged
  // once at the end so an unexpected swing (a category vanishing, a whole
  // supplier batch dropping out) is reviewable from a build log rather than
  // only discoverable by diffing the XML by hand.
  const counts = {};
  const track = (type, included, excluded = 0) => {
    counts[type] = { included, excluded };
  };

  // Static routes that are always real, canonical destinations regardless of
  // inventory. Pages whose usefulness depends on how much content currently
  // backs them (the public calendar, the community discussion index) are
  // handled further down, once that inventory has been counted.
  const staticPages = [
    '/',
    '/suppliers',
    '/marketplace',
    '/guides',
    '/community',
    '/community/guidelines',
    '/community/help',
    '/start',
    '/pricing',
    '/for-suppliers',
    '/about',
    '/contact',
    '/faq',
    '/privacy',
    '/terms',
  ];
  staticPages.forEach(page => appendUrl(xmlParts, normalizedBaseUrl + page));
  track('static', staticPages.length);

  // Guides are repository-backed content and must remain available even when a
  // dynamic collection is temporarily unavailable.
  const guideEntries = loadGuideEntries().filter(entry => entry.slug);
  guideEntries.forEach(({ slug, lastmod }) => {
    appendUrl(
      xmlParts,
      `${normalizedBaseUrl}/articles/${slug}`,
      validLastModifiedOrFallback(lastmod)
    );
  });
  track('guides', guideEntries.length);

  const [suppliers, users, packages, events] = await Promise.all([
    readCollection('suppliers'),
    readCollection('users'),
    readCollection('packages'),
    readCollection('public_calendar_events'),
  ]);
  const validOwnerIds = new Set((users || []).map(user => user?.id).filter(Boolean));
  const supplierById = new Map((suppliers || []).map(supplier => [supplier.id, supplier]));

  let suppliersIncluded = 0;
  let suppliersExcluded = 0;
  suppliers
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach(supplier => {
      const canonicalSlug = buildPublicSupplierSlug(supplier);
      const decision = seoEligibility.canAppearInSitemap(supplier, {
        validOwnerIds,
        canonicalSlug,
      });
      if (!decision.eligible) {
        suppliersExcluded += 1;
        return;
      }
      suppliersIncluded += 1;
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/supplier/${canonicalSlug}`,
        validLastModifiedOrFallback(supplier.updatedAt || supplier.modifiedAt || supplier.createdAt)
      );
    });
  track('suppliers', suppliersIncluded, suppliersExcluded);

  let packagesIncluded = 0;
  let packagesExcluded = 0;
  packages
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach(pkg => {
      const canonicalSlug = buildPublicPackageSlug(pkg);
      const decision = seoEligibility.canAppearInSitemap(pkg, {
        type: 'package',
        supplier: supplierById.get(pkg.supplierId),
        validOwnerIds,
        canonicalSlug,
      });
      if (!decision.eligible) {
        packagesExcluded += 1;
        return;
      }
      packagesIncluded += 1;
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/package/${canonicalSlug}`,
        validLastModifiedOrFallback(pkg.updatedAt || pkg.modifiedAt || pkg.createdAt)
      );
    });
  track('packages', packagesIncluded, packagesExcluded);

  const now = new Date();
  const indexableEvents = events.filter(event => isIndexablePublicEvent(event, now));
  indexableEvents
    .slice()
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
    .forEach(event => {
      const slug = buildPublicEventSlug(event);
      if (!slug) {
        return;
      }
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/events/${slug}`,
        validLastModifiedOrFallback(
          event.updatedAt || event.publishedAt || event.modifiedAt || event.createdAt
        )
      );
    });
  track('events', indexableEvents.length, events.length - indexableEvents.length);

  // The public calendar hub itself is empty-state gated (SEO-005): with no
  // indexable events behind it, it is a shell with nothing to show, so it is
  // dropped from the sitemap exactly like a page returning noindex would be.
  const calendarInventory = emptyStateIndexGate.summariseIndexableEvents(events, now);
  if (emptyStateIndexGate.calendarIsIndexable(calendarInventory)) {
    appendUrl(xmlParts, `${normalizedBaseUrl}/public-calendar`);
    track('calendarHub', 1);
  } else {
    track('calendarHub', 0, 1);
  }

  // UK city pages. The hub is listed only when it has at least one published
  // city to link to, so the sitemap never advertises an empty index page.
  const cityEntries = await loadIndexableCityEntries(suppliers, users, packages, events);
  if (cityEntries.length) {
    appendUrl(xmlParts, `${normalizedBaseUrl}/locations`);
    cityEntries
      .slice()
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .forEach(({ slug, lastmod }) => {
        appendUrl(
          xmlParts,
          `${normalizedBaseUrl}/locations/${slug}`,
          validLastModifiedOrFallback(lastmod)
        );
      });
  }
  track('cities', cityEntries.length);

  // City × category pages. Each one is listed only once it passes its own
  // gate — a city being indexable overall never carries a category along
  // with it — and the hub/city URLs above are never duplicated here.
  const categoryEntries = await loadIndexableCategoryEntries(suppliers, users, packages, events);
  categoryEntries
    .slice()
    .sort(
      (a, b) => a.citySlug.localeCompare(b.citySlug) || a.categorySlug.localeCompare(b.categorySlug)
    )
    .forEach(({ citySlug, categorySlug, lastmod }) => {
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/locations/${citySlug}/${categorySlug}`,
        validLastModifiedOrFallback(lastmod)
      );
    });
  track('cityCategories', categoryEntries.length);

  // National category directory pages. The hub is listed only when it has
  // at least one indexable category to link to, mirroring the city hub above.
  const categoryDirectoryEntries = await loadIndexableCategoryDirectoryEntries(suppliers, users);
  if (categoryDirectoryEntries.length) {
    appendUrl(xmlParts, `${normalizedBaseUrl}/categories`);
    categoryDirectoryEntries
      .slice()
      .sort((a, b) => a.categorySlug.localeCompare(b.categorySlug))
      .forEach(({ categorySlug }) => {
        appendUrl(xmlParts, `${normalizedBaseUrl}/categories/${categorySlug}`);
      });
  }
  track('categoryDirectory', categoryDirectoryEntries.length);

  // Community categories and published discussions. Held, hidden, removed and
  // superseded content is excluded so the sitemap never advertises a URL that
  // returns a noindex page — and, per SEO-005, so is a category or the
  // discussion index that currently holds too little real content to be
  // worth indexing.
  const [communityCategories, communityDiscussions] = await Promise.all([
    readCollection('community_categories'),
    readCollection('community_discussions'),
  ]);
  const discussionCountByCategory =
    emptyStateIndexGate.countDiscussionsByCategory(communityDiscussions);
  const totalPublicDiscussions = emptyStateIndexGate.countPublicDiscussions(communityDiscussions);

  if (emptyStateIndexGate.communityDiscussionsIndexIsIndexable(totalPublicDiscussions)) {
    appendUrl(xmlParts, `${normalizedBaseUrl}/community/discussions`);
    track('communityDiscussionsIndex', 1);
  } else {
    track('communityDiscussionsIndex', 0, 1);
  }

  const eligibleCategories = communityCategories.filter(
    category => category && category.slug && category.visible !== false && !category.archived
  );
  let categoriesIncluded = 0;
  eligibleCategories
    .slice()
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
    .forEach(category => {
      const discussionCount = discussionCountByCategory.get(category.slug) || 0;
      if (!emptyStateIndexGate.communityCategoryIsIndexable(discussionCount)) {
        return;
      }
      categoriesIncluded += 1;
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/community/category/${category.slug}`,
        validLastModifiedOrFallback(category.updatedAt || category.createdAt)
      );
    });
  track('communityCategories', categoriesIncluded, communityCategories.length - categoriesIncluded);

  const eligibleDiscussions = communityDiscussions.filter(
    discussion =>
      discussion &&
      discussion.stableId &&
      (discussion.state === 'published' || discussion.state === 'archived')
  );
  eligibleDiscussions
    .slice()
    .sort((a, b) => String(a.stableId).localeCompare(String(b.stableId)))
    .forEach(discussion => {
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/community/discussion/${discussion.stableId}/${discussion.slug || 'discussion'}`,
        validLastModifiedOrFallback(discussion.lastActivityAt || discussion.createdAt)
      );
    });
  track(
    'communityDiscussions',
    eligibleDiscussions.length,
    communityDiscussions.length - eligibleDiscussions.length
  );

  xmlParts.push('</urlset>');

  if (typeof logger.info === 'function') {
    logger.info('sitemap: generated', {
      totalUrls: xmlParts.filter(part => part.trim().startsWith('<loc>')).length,
      byType: counts,
    });
  }

  return xmlParts.join('\n');
}

/**
 * Generate robots.txt content
 * @param {string} baseUrl - Base URL of the site
 * @returns {string} Robots.txt content
 */
function generateRobotsTxt(baseUrl) {
  return `# EventFlow Robots.txt
User-agent: *
Allow: /

# Disallow API endpoints and temporary files only
# Note: We don't Disallow HTML pages (auth, dashboard, etc.) because:
# - They use X-Robots-Tag: noindex, nofollow headers
# - Google needs to crawl them to see the noindex directive
# - Disallow prevents crawling and can leave URLs indexed by reference
Disallow: /api/
Disallow: /uploads/temp/
Disallow: /*.json$

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml

# Crawl-delay for specific bots
User-agent: Googlebot
Crawl-delay: 0

User-agent: Bingbot
Crawl-delay: 1
`;
}

module.exports = {
  appendUrl,
  generateSitemap,
  loadIndexableCategoryEntries,
  loadIndexableCategoryDirectoryEntries,
  loadIndexableCityEntries,
  generateRobotsTxt,
  loadGuideEntries,
  readCollection,
  validLastModified: validLastModifiedOrFallback,
  xmlEscape,
};
