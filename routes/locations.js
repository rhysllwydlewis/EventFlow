/**
 * EventFlow UK locations — server-rendered hub and city pages
 *
 * `/locations` and `/locations/:citySlug` are ordinary crawlable HTML pages.
 * Everything a visitor or a crawler needs — heading, introduction, breadcrumbs,
 * supplier links and their relationship labels — is in the initial response, so
 * the page is complete before any client script runs.
 *
 * Indexability is decided per page by the quality gate, never by the route:
 * a reachable page and an indexable page are different things here.
 */

'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { publicReadLimiter } = require('../middleware/rateLimits');
const registry = require('../services/locationRegistry.service');
const locationHeroImages = require('../services/locationHeroImage.service');
const locationPages = require('../services/locationPage.service');
const supplierLocation = require('../services/supplierLocation.service');
const {
  buildPublicSupplierSlug,
  isPublicSupplier,
} = require('../services/publicSupplierSeo.service');
const { PUBLICATION_STATES } = require('../models/LocationContent');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BASE_URL = process.env.BASE_URL || 'https://event-flow.co.uk';
const SHELL_CACHE_MS = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 0;
const DATA_CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 60 * 1000;

const shellCache = new Map();
let dataCache = null;
let dataCacheExpiresAt = 0;
let dataLoadPromise = null;

/**
 * Whether the reserved city-category routes are switched on.
 *
 * They stay off until a city-category combination has passed the quality gate
 * on its own evidence; the route exists so the URL contract is reserved, not so
 * the pages can be launched by accident.
 * @returns {boolean} True when the flag is enabled.
 */
function categoryPagesEnabled() {
  return String(process.env.LOCATION_CATEGORY_PAGES || '').toLowerCase() === 'true';
}

/**
 * Escape text for safe inclusion in HTML.
 * @param {string} value Raw value.
 * @returns {string} Escaped value.
 */
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialise JSON-LD so no value can close the script element.
 * @param {Object} value Structured data.
 * @returns {string} Escaped JSON.
 */
function serializeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Read an HTML shell from the public directory.
 * @param {string} fileName Shell file name.
 * @returns {Promise<string|null>} Shell HTML, or null when missing.
 */
async function readShell(fileName) {
  const cached = shellCache.get(fileName);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.html;
  }
  try {
    const html = await fs.readFile(path.join(PUBLIC_DIR, fileName), 'utf8');
    shellCache.set(fileName, { html, expiresAt: Date.now() + SHELL_CACHE_MS });
    return html;
  } catch (error) {
    logger.error(`Location shell missing: ${fileName}`, error.message);
    return null;
  }
}

/**
 * Apply page metadata to a shell.
 *
 * `noindex` is emitted both as a meta tag and as a header by the caller: a
 * pilot page must be unambiguous about its state to every crawler.
 * @param {string} html Shell HTML.
 * @param {Object} meta Metadata.
 * @returns {string} HTML with metadata applied.
 */
function applyMeta(html, meta) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const canonical = escapeHtml(meta.canonicalUrl);

  const tags = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<meta name="robots" content="${meta.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:site_name" content="EventFlow" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="ef-page-type" content="${escapeHtml(meta.pageType)}" />`,
  ];

  if (meta.locationSlug) {
    tags.push(`<meta name="ef-location-slug" content="${escapeHtml(meta.locationSlug)}" />`);
  }
  if (meta.categorySlug) {
    tags.push(`<meta name="ef-category-slug" content="${escapeHtml(meta.categorySlug)}" />`);
  }
  if (meta.imageUrl) {
    const imageUrl = escapeHtml(meta.imageUrl);
    tags.push(`<meta property="og:image" content="${imageUrl}" />`);
    tags.push(`<meta name="twitter:image" content="${imageUrl}" />`);
  }
  for (const data of meta.structuredData || []) {
    tags.push(`<script type="application/ld+json">${serializeJsonLd(data)}</script>`);
  }

  // The replacement is a function, not a string: `String.replace` treats `$&`,
  // `` $` `` and friends in a string replacement as back-references, and this
  // content carries editor-written copy that may legitimately contain a `$`.
  const block = tags.join('\n    ');
  return html.replace('<!--LOCATIONS_HEAD-->', () => block);
}

/**
 * Insert rendered content into a shell.
 * @param {string} html Shell HTML.
 * @param {string} content Rendered content.
 * @returns {string} Combined HTML.
 */
function applyContent(html, content) {
  return html.replace('<!--LOCATIONS_CONTENT-->', () => content || '');
}

/**
 * Render a breadcrumb trail.
 * @param {{name: string, url: string|null}[]} trail Crumbs, last one current.
 * @returns {string} Breadcrumb HTML.
 */
function renderBreadcrumbs(trail) {
  const items = trail
    .map((crumb, index) => {
      const isLast = index === trail.length - 1;
      const label = escapeHtml(crumb.name);
      return isLast || !crumb.url
        ? `<li><span aria-current="page">${label}</span></li>`
        : `<li><a href="${escapeHtml(crumb.url)}">${label}</a></li>`;
    })
    .join('');
  return `<nav class="efl-breadcrumbs efl-container" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

/**
 * Public profile URL for a supplier.
 * @param {Object} supplier Supplier record.
 * @returns {string} Path, or an empty string when the supplier has no slug.
 */
function supplierPath(supplier) {
  const slug = buildPublicSupplierSlug(supplier);
  return slug ? `/supplier/${slug}` : '';
}

/**
 * Load every collection the location pages read, with a short cache.
 *
 * These are indexable HTML pages that a crawler may request in bursts; reading
 * the same five collections per request would make a crawl expensive.
 * @returns {Promise<Object>} `{suppliers, validOwnerIds, packages, events, pageRecords}`.
 */
async function loadLocationData() {
  const [suppliers, users, supplierAnalytics, packages, events, pageRecords] = await Promise.all([
    dbUnified.read('suppliers'),
    dbUnified.read('users'),
    dbUnified.read('supplierAnalytics'),
    dbUnified.read('packages'),
    dbUnified.read('public_calendar_events'),
    locationPages.loadPageRecords(dbUnified),
  ]);

  const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
  const summaryBySupplierId = new Map(
    (supplierAnalytics || [])
      .filter(summary => summary && summary.supplierId)
      .map(summary => [String(summary.supplierId), summary])
  );

  const enrichedSuppliers = (suppliers || [])
    .filter(supplier => isPublicSupplier(supplier, validOwnerIds))
    .map(supplier => {
      const summary = summaryBySupplierId.get(String(supplier.id));
      return summary
        ? {
            ...supplier,
            approvedReviewSummary: {
              averageRating: summary.averageRating,
              reviewCount: summary.totalReviews,
            },
          }
        : supplier;
    });

  return {
    suppliers: enrichedSuppliers,
    validOwnerIds,
    packages: packages || [],
    events: events || [],
    pageRecords,
  };
}

/**
 * Cached wrapper around `loadLocationData`.
 * @returns {Promise<Object>} Location data.
 */
function readLocationData() {
  const now = Date.now();
  if (dataCache && now < dataCacheExpiresAt) {
    return Promise.resolve(dataCache);
  }
  if (dataLoadPromise) {
    return dataLoadPromise;
  }
  dataLoadPromise = loadLocationData()
    .then(data => {
      dataCache = data;
      dataCacheExpiresAt = Date.now() + DATA_CACHE_MS;
      return data;
    })
    .finally(() => {
      dataLoadPromise = null;
    });
  return dataLoadPromise;
}

/**
 * Drop the cached collections. Used by the admin API after a publish.
 * @returns {void} Nothing.
 */
function resetLocationDataCache() {
  dataCache = null;
  dataCacheExpiresAt = 0;
}

/**
 * The set of city slugs whose pages are published.
 *
 * Nearby-area links and the hub list are both built from this, so neither can
 * ever advertise a page that is not live.
 * @param {Map<string, Object>} pageRecords Stored records.
 * @returns {Set<string>} Published slugs.
 */
function publishedSlugs(pageRecords) {
  const slugs = new Set();
  for (const city of registry.listCities()) {
    const page = locationPages.normalisePageRecord(city, pageRecords.get(city.slug));
    if (page.status === PUBLICATION_STATES.published) {
      slugs.add(city.slug);
    }
  }
  return slugs;
}

/**
 * Send a rendered page.
 * @param {Object} res Express response.
 * @param {string} html Final HTML.
 * @param {Object} options Options.
 * @returns {Object} The response.
 */
function send(res, html, options = {}) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300');
  res.set(
    'X-Robots-Tag',
    options.indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow'
  );
  return res.status(options.status || 200).send(html);
}

// ─── Hub ─────────────────────────────────────────────────────────────────────

/**
 * Render the national hub's content.
 * @param {Object} input Inputs.
 * @returns {string} Hub HTML.
 */
function renderHub({ cities, counts }) {
  const nations = new Map();
  for (const city of cities) {
    if (!nations.has(city.nation)) {
      nations.set(city.nation, []);
    }
    nations.get(city.nation).push(city);
  }

  const nationBlocks = [...nations.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nation, nationCities]) => {
      const items = nationCities
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(city => {
          const count = counts.get(city.slug);
          // A count is shown only when it is a real, current number of eligible
          // suppliers. "0 suppliers" is not a useful fact to publish.
          const meta =
            count > 0
              ? `<p class="efl-card__meta">${count} ${count === 1 ? 'supplier' : 'suppliers'}</p>`
              : '';
          return `<li class="efl-card efl-city-card">
            <span class="efl-city-card__pin" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 5.5-8 12-8 12S4 15.5 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg></span>
            <div><h3><a href="/locations/${escapeHtml(city.slug)}">${escapeHtml(city.name)}</a></h3>
            <p>${escapeHtml(city.region || city.nation)}</p>${meta}</div>
            <span class="efl-city-card__arrow" aria-hidden="true">&#8594;</span>
          </li>`;
        })
        .join('\n');
      return `<div class="efl-nation">
        <h3>${escapeHtml(nation)}</h3>
        <ul class="efl-grid efl-grid--compact">${items}</ul>
      </div>`;
    })
    .join('\n');

  const body = cities.length
    ? `<section class="efl-section" aria-labelledby="efl-browse">
        <h2 id="efl-browse">Browse by nation</h2>
        ${nationBlocks}
      </section>`
    : `<section class="efl-section"><p>City pages are being prepared. In the meantime, <a href="/suppliers">browse every supplier</a>.</p></section>`;

  return `${renderBreadcrumbs([
    { name: 'Home', url: '/' },
    { name: 'UK locations', url: null },
  ])}
    <div class="efl-container">
      <section class="efl-hero efl-hero--hub">
        <div class="efl-hero__copy"><span class="efl-hero__kicker"><span aria-hidden="true">&#9679;</span> Plan anywhere in the UK</span>
        <h1>Event suppliers across the UK</h1>
        <p class="efl-hero__intro">Find event suppliers by city. See who is based locally and who genuinely travels to your area before you get in touch.</p>
        <form class="efl-search efl-search--hub" role="search" action="/suppliers" method="GET">
          <label class="efl-sr-only" for="efl-hub-search">Search by city or postcode</label>
          <span class="efl-search__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 5.5-8 12-8 12S4 15.5 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg></span>
          <input id="efl-hub-search" type="search" name="location" placeholder="Enter a city or postcode" autocomplete="address-level2" />
          <button type="submit">Search suppliers</button>
        </form></div>
        <div class="efl-hub-visual" aria-hidden="true"><span class="efl-hub-visual__orbit"></span><span class="efl-hub-visual__pin efl-hub-visual__pin--one"></span><span class="efl-hub-visual__pin efl-hub-visual__pin--two"></span><span class="efl-hub-visual__pin efl-hub-visual__pin--three"></span><p><strong>${cities.length}</strong><span>${cities.length === 1 ? 'city guide' : 'city guides'} ready to explore</span></p></div>
      </section>
      ${body}
      <section class="efl-section" aria-labelledby="efl-hub-cta">
        <h2 id="efl-hub-cta">Run an event business?</h2>
        <p class="efl-prose">Add your business to EventFlow and tell us the areas you cover, so you appear on the city pages that matter to you.</p>
        <p class="efl-actions"><a class="efl-btn efl-btn--solid" href="/for-suppliers">List your business</a></p>
      </section>
    </div>`;
}

router.get(['/locations', '/locations.html'], publicReadLimiter, async (req, res, next) => {
  try {
    const shell = await readShell('locations.html');
    if (!shell) {
      return next();
    }

    const data = await readLocationData();
    const published = publishedSlugs(data.pageRecords);
    const cities = registry.listCities().filter(city => published.has(city.slug));

    // Counts come from the same matcher the city pages use, so the hub can
    // never advertise a number the page itself will not show.
    const counts = new Map();
    for (const city of cities) {
      counts.set(
        city.slug,
        supplierLocation.rankSuppliersForCity(data.suppliers, city, {
          validOwnerIds: data.validOwnerIds,
        }).length
      );
    }

    const metadata = {
      title: 'Event Suppliers by UK City | EventFlow',
      description:
        'Browse event suppliers by UK city. Compare venues, catering, photography and more from suppliers based in or serving your area.',
      canonicalUrl: `${locationPages.safeBaseUrl(BASE_URL)}/locations`,
      // The hub is indexable once it has at least one published city to link to.
      indexable: cities.length > 0,
      pageType: 'locations_hub',
      structuredData: [locationPages.buildBreadcrumbStructuredData(null, BASE_URL)],
    };

    return send(res, applyContent(applyMeta(shell, metadata), renderHub({ cities, counts })), {
      indexable: metadata.indexable,
    });
  } catch (error) {
    logger.error('Could not render the locations hub:', error);
    return next(error);
  }
});

// ─── City page ───────────────────────────────────────────────────────────────

/**
 * Render one supplier card.
 * @param {Object} entry Ranked supplier entry.
 * @returns {string} Card HTML.
 */
function renderSupplierCard(entry) {
  const url = supplierPath(entry.supplier);
  const name = escapeHtml(entry.supplier.name || entry.supplier.businessName || 'Event supplier');
  const heading = url ? `<a href="${escapeHtml(url)}">${name}</a>` : name;
  const initials = String(entry.supplier.name || entry.supplier.businessName || 'Event supplier')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');
  const category = entry.supplier.category
    ? `<p class="efl-card__category">${escapeHtml(entry.supplier.category)}</p>`
    : '';
  const summary = entry.supplier.approvedReviewSummary || {};
  const rating =
    Number(summary.averageRating) > 0 && Number(summary.reviewCount) > 0
      ? `<span class="efl-card__rating"><span aria-hidden="true">&#9733;</span> ${Number(summary.averageRating).toFixed(1)} &middot; ${Number(summary.reviewCount)} reviews</span>`
      : '';

  return `<li class="efl-card" data-supplier-id="${escapeHtml(entry.supplier.id)}" data-relationship="${escapeHtml(entry.relationship)}">
    <div class="efl-card__top">
      <span class="efl-card__avatar" aria-hidden="true">${escapeHtml(initials || 'EF')}</span>
      <span class="efl-card__arrow" aria-hidden="true">&#8599;</span>
    </div>
    <div class="efl-card__body">${category}<h3>${heading}</h3></div>
    <p class="efl-card__meta"><span class="efl-relationship">${escapeHtml(entry.label)}</span>${rating}</p>
  </li>`;
}

/**
 * Render a city page's content.
 *
 * Every module is omitted entirely when it has nothing reliable to show; an
 * empty shelf is worse than no shelf.
 * @param {Object} model Page model from `buildCityPageModel`.
 * @returns {string} City page HTML.
 */
// skipcq: JS-R1005 -- The page is a flat sequence of independent modules.
function renderCityPage(model) {
  const { city, page, metadata, rankedSuppliers, categories, packages, events, nearby } = model;
  const sections = [];
  const heroSourceSuffix = /^https?:\/\/(?:www\.)?pexels\.com\//i.test(
    page.content.heroImageSourceUrl || ''
  )
    ? ' on Pexels'
    : '';
  const heroAttribution =
    page.content.heroImageCredit && page.content.heroImageSourceUrl
      ? `<p class="efl-hero__credit">Photo by <a href="${escapeHtml(page.content.heroImageSourceUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(page.content.heroImageCredit)}${heroSourceSuffix}</a></p>`
      : '';

  const heroImage = page.content.heroImageUrl
    ? `<img class="efl-hero__media" src="${escapeHtml(page.content.heroImageUrl)}" alt="${escapeHtml(
        page.content.heroImageAlt || `${city.name} city centre`
      )}" width="1160" height="420" loading="eager" decoding="async" />`
    : '';

  const heroVisual = heroImage
    ? `<div class="efl-hero__visual" data-city-name="${escapeHtml(city.name)}">${heroImage}${heroAttribution}<div class="efl-hero__image-note"><span aria-hidden="true">&#10003;</span><p><strong>Genuine local coverage</strong><small>Based here or happy to travel</small></p></div></div>`
    : `<div class="efl-hero__visual efl-hero__visual--placeholder" aria-hidden="true"><span class="efl-hero__map-pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 10c0 5.5-8 12-8 12S4 15.5 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg></span><strong>${escapeHtml(city.name)}</strong></div>`;

  sections.push(`<section class="efl-hero efl-hero--city">
    <div class="efl-hero__copy">
      <span class="efl-hero__kicker"><span aria-hidden="true">&#9679;</span> Plan locally with EventFlow</span>
      <h1>${escapeHtml(metadata.heading)}</h1>
      ${page.content.intro ? `<p class="efl-hero__intro">${escapeHtml(page.content.intro)}</p>` : ''}
      <form class="efl-search efl-search--city" role="search" action="/suppliers" method="GET">
        <label class="efl-sr-only" for="efl-city-search">Search suppliers in ${escapeHtml(city.name)}</label>
        <span class="efl-search__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg></span>
        <input id="efl-city-search" type="search" name="q" placeholder="Venue, caterer, photographer..." />
        <input type="hidden" name="location" value="${escapeHtml(city.name)}" />
        <button type="submit">Search suppliers</button>
      </form>
      <p class="efl-hero__trust"><span aria-hidden="true">&#10003;</span> Free to browse <span aria-hidden="true">&#183;</span> Message suppliers directly</p>
    </div>
    ${heroVisual}
  </section>`);

  if (rankedSuppliers.length) {
    const summary = [
      `<li><strong>${rankedSuppliers.length}</strong><span>${rankedSuppliers.length === 1 ? 'supplier' : 'suppliers'} covering ${escapeHtml(city.name)}</span></li>`,
      categories.length
        ? `<li><strong>${categories.length}</strong><span>${categories.length === 1 ? 'category' : 'categories'} represented</span></li>`
        : '',
      packages.length
        ? `<li><strong>${packages.length}</strong><span>${packages.length === 1 ? 'package' : 'packages'} available</span></li>`
        : '',
      events.length
        ? `<li><strong>${events.length}</strong><span>upcoming public ${events.length === 1 ? 'event' : 'events'}</span></li>`
        : '',
    ]
      .filter(Boolean)
      .join('');
    sections.push(`<ul class="efl-summary">${summary}</ul>`);
  }

  if (categories.length) {
    const chips = categories
      .map(
        category =>
          `<li><a href="/suppliers?category=${encodeURIComponent(category.name)}&location=${encodeURIComponent(city.name)}">${escapeHtml(category.name)} (${category.count})</a></li>`
      )
      .join('');
    sections.push(`<section class="efl-section" aria-labelledby="efl-categories">
      <h2 id="efl-categories">What you can book in ${escapeHtml(city.name)}</h2>
      <ul class="efl-chips">${chips}</ul>
    </section>`);
  }

  if (rankedSuppliers.length) {
    sections.push(`<section class="efl-section" aria-labelledby="efl-suppliers">
      <h2 id="efl-suppliers">Suppliers in and around ${escapeHtml(city.name)}</h2>
      <ul class="efl-grid">${rankedSuppliers.map(renderSupplierCard).join('\n')}</ul>
    </section>`);
  } else {
    sections.push(`<section class="efl-section">
      <p class="efl-prose">We are still building EventFlow's supplier network in ${escapeHtml(city.name)}. <a href="/suppliers">Browse every supplier</a> or <a href="/for-suppliers">add your business</a>.</p>
    </section>`);
  }

  if (packages.length) {
    const items = packages
      .slice(0, 6)
      .map(
        pkg => `<li class="efl-card">
          <h3>${escapeHtml(pkg.name || pkg.title || 'Package')}</h3>
          ${pkg.description ? `<p>${escapeHtml(String(pkg.description).slice(0, 160))}</p>` : ''}
        </li>`
      )
      .join('');
    sections.push(`<section class="efl-section" aria-labelledby="efl-packages">
      <h2 id="efl-packages">Packages from ${escapeHtml(city.name)} suppliers</h2>
      <ul class="efl-grid">${items}</ul>
    </section>`);
  }

  if (events.length) {
    const items = events
      .slice(0, 6)
      .map(
        event => `<li class="efl-card">
          <h3>${escapeHtml(event.title || event.name || 'Public event')}</h3>
          ${event.startDate ? `<p class="efl-card__meta"><time datetime="${escapeHtml(event.startDate)}">${escapeHtml(String(event.startDate).slice(0, 10))}</time></p>` : ''}
        </li>`
      )
      .join('');
    sections.push(`<section class="efl-section" aria-labelledby="efl-events">
      <h2 id="efl-events">Public events near ${escapeHtml(city.name)}</h2>
      <ul class="efl-grid">${items}</ul>
    </section>`);
  }

  if (page.content.planningSections.length) {
    const blocks = page.content.planningSections
      .filter(section => section && section.title && section.body)
      .map(section => {
        const sourceNote =
          section.sourceName && section.sourceUrl
            ? `<p class="efl-note">Source: <a href="${escapeHtml(section.sourceUrl)}" rel="nofollow noopener">${escapeHtml(section.sourceName)}</a>${section.sourceDate ? ` (${escapeHtml(section.sourceDate)})` : ''}</p>`
            : '';
        return `<article class="efl-planning__card"><span class="efl-planning__icon" aria-hidden="true">&#10022;</span><h3>${escapeHtml(section.title)}</h3>${String(
          section.body
        )
          .split(/\n{2,}/)
          .map(paragraph => `<p>${escapeHtml(paragraph.trim())}</p>`)
          .join('')}${sourceNote}</article>`;
      })
      .join('');
    if (blocks) {
      sections.push(`<section class="efl-section efl-prose efl-planning" aria-labelledby="efl-planning">
        <h2 id="efl-planning">Planning an event in ${escapeHtml(city.name)}</h2>
        <div class="efl-planning__grid">${blocks}</div>
      </section>`);
    }
  }

  if (page.content.faqs.length) {
    const faqs = page.content.faqs
      .filter(faq => faq && faq.question && faq.answer)
      .map(
        faq =>
          `<div class="efl-faq"><span class="efl-faq__icon" aria-hidden="true">?</span><div><h3>${escapeHtml(faq.question)}</h3><p>${escapeHtml(faq.answer)}</p></div></div>`
      )
      .join('');
    if (faqs) {
      sections.push(`<section class="efl-section" aria-labelledby="efl-faqs">
        <h2 id="efl-faqs">Common questions about ${escapeHtml(city.name)}</h2>
        ${faqs}
      </section>`);
    }
  }

  if (nearby.length) {
    const links = nearby
      .map(
        nearbyCity =>
          `<li><a href="/locations/${escapeHtml(nearbyCity.slug)}">${escapeHtml(nearbyCity.name)}</a></li>`
      )
      .join('');
    sections.push(`<section class="efl-section" aria-labelledby="efl-nearby">
      <h2 id="efl-nearby">Nearby areas</h2>
      <ul class="efl-chips">${links}</ul>
    </section>`);
  }

  sections.push(`<section class="efl-section efl-next" aria-labelledby="efl-next">
    <div><span class="efl-next__kicker">Ready when you are</span><h2 id="efl-next">Bring your ${escapeHtml(city.name)} event together</h2>
    <p>Shortlist the suppliers you like, message them through EventFlow and request quotes in one place.</p></div>
    <p class="efl-actions">
      <a class="efl-btn efl-btn--solid" href="/suppliers?location=${encodeURIComponent(city.name)}">Browse ${escapeHtml(city.name)} suppliers</a>
      <a class="efl-btn efl-btn--ghost" href="/for-suppliers">List your business</a>
    </p>
  </section>`);

  const reviewNote = page.lastReviewedAt
    ? `<p class="efl-note">Local information last reviewed ${escapeHtml(String(page.lastReviewedAt).slice(0, 10))}.</p>`
    : '';

  const pilotNote =
    page.status === PUBLICATION_STATES.pilot
      ? '<p class="efl-pilot">This city page is in pilot. It is live for review but is not listed in search engines yet.</p>'
      : '';

  return `${renderBreadcrumbs([
    { name: 'Home', url: '/' },
    { name: 'UK locations', url: '/locations' },
    { name: city.name, url: null },
  ])}
    <div class="efl-container">${pilotNote}${sections.join('\n')}${reviewNote}</div>`;
}

router.get('/locations/:citySlug', publicReadLimiter, async (req, res, next) => {
  try {
    const requested = String(req.params.citySlug || '');
    const resolved = registry.resolveCity(requested);

    // An unknown slug is a genuine 404, not a soft-404 city page with no city.
    if (!resolved) {
      res.set('X-Robots-Tag', 'noindex, follow');
      return next();
    }
    // Aliases — Caerdydd, "Brighton and Hove", a stray capital — are permanent
    // redirects to the one canonical URL.
    if (!resolved.canonical || requested !== resolved.city.slug) {
      return res.redirect(301, `/locations/${resolved.city.slug}`);
    }

    const city = resolved.city;
    const shell = await readShell('location.html');
    if (!shell) {
      return next();
    }

    const data = await readLocationData();
    let page = locationPages.normalisePageRecord(city, data.pageRecords.get(city.slug));

    // Draft, in-review and retired pages do not exist as far as the public is
    // concerned. Returning 404 keeps unfinished work out of the index entirely.
    if (!locationPages.isPubliclyVisible(page)) {
      res.set('X-Robots-Tag', 'noindex, follow');
      return next();
    }

    // Stored editorial media wins; otherwise every registry city gets a
    // server-rendered, cached result from its disambiguated Pexels search.
    page = await locationHeroImages.resolvePageHero(city, page);

    const model = locationPages.buildCityPageModel({
      city,
      page,
      suppliers: data.suppliers,
      validOwnerIds: data.validOwnerIds,
      packages: data.packages,
      events: data.events,
      publishedSlugs: publishedSlugs(data.pageRecords),
      baseUrl: BASE_URL,
    });

    const structuredData = [model.breadcrumbs];
    if (model.indexable) {
      structuredData.push(
        locationPages.buildCollectionStructuredData({
          city,
          metadata: model.metadata,
          rankedSuppliers: model.rankedSuppliers,
          baseUrl: BASE_URL,
          supplierUrlFor: supplier => {
            const suffix = supplierPath(supplier);
            return suffix ? `${locationPages.safeBaseUrl(BASE_URL)}${suffix}` : '';
          },
        })
      );
    }

    const html = applyContent(
      applyMeta(shell, {
        ...model.metadata,
        indexable: model.indexable,
        pageType: 'location_city',
        locationSlug: city.slug,
        structuredData,
      }),
      renderCityPage(model)
    );

    return send(res, html, { indexable: model.indexable });
  } catch (error) {
    logger.error('Could not render a city location page:', error);
    return next(error);
  }
});

// ─── Reserved city-category route ────────────────────────────────────────────

router.get('/locations/:citySlug/:categorySlug', publicReadLimiter, (req, res, next) => {
  // The URL shape is reserved so it cannot be claimed by anything else, but the
  // pages stay off until a combination earns its own launch.
  if (!categoryPagesEnabled()) {
    res.set('X-Robots-Tag', 'noindex, follow');
    return next();
  }

  const resolved = registry.resolveCity(req.params.citySlug);
  if (!resolved) {
    res.set('X-Robots-Tag', 'noindex, follow');
    return next();
  }
  return res.redirect(301, `/locations/${resolved.city.slug}`);
});

module.exports = router;
module.exports.__internal = {
  BASE_URL,
  applyContent,
  applyMeta,
  categoryPagesEnabled,
  escapeHtml,
  publishedSlugs,
  readLocationData,
  readShell,
  renderBreadcrumbs,
  renderCityPage,
  renderHub,
  renderSupplierCard,
  resetLocationDataCache,
  serializeJsonLd,
  supplierPath,
};
