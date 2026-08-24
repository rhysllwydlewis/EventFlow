/**
 * EventFlow UK category directory — server-rendered category pages
 *
 * `/categories` and `/categories/:categorySlug` are ordinary crawlable HTML
 * pages, the national counterpart to `/locations` and `/locations/:citySlug`
 * — everything a visitor or a crawler needs is in the initial response.
 *
 * Unlike the city × category pages, there is no per-page editorial content
 * to gate on: a canonical supplier category is a small, fixed set (see
 * `category-link.js`), and indexability is decided purely on whether the
 * category currently has enough real, eligible suppliers to be worth a
 * search result — see `categoryDirectoryPage.service.js`.
 */

'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const { publicReadLimiter } = require('../middleware/rateLimits');
const categoryDirectoryPages = require('../services/categoryDirectoryPage.service');
const {
  buildPublicSupplierSlug,
  isPublicSupplier,
} = require('../services/publicSupplierSeo.service');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const BASE_URL = process.env.BASE_URL || 'https://event-flow.co.uk';
const SHELL_CACHE_MS = process.env.NODE_ENV === 'production' ? 5 * 60 * 1000 : 0;
const DATA_CACHE_MS = process.env.NODE_ENV === 'test' ? 0 : 60 * 1000;

const shellCache = new Map();
let dataCache = null;
let dataCacheExpiresAt = 0;
let dataLoadPromise = null;

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
 * Serialize a value for safe inclusion in an inline `<script type="application/ld+json">`.
 * @param {Object} value Structured data.
 * @returns {string} Serialized, escaped JSON.
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
    logger.error(`Category directory shell missing: ${fileName}`, error.message);
    return null;
  }
}

/**
 * Apply page metadata to a shell.
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
  if (meta.categorySlug) {
    tags.push(`<meta name="ef-category-slug" content="${escapeHtml(meta.categorySlug)}" />`);
  }
  for (const data of meta.structuredData || []) {
    tags.push(`<script type="application/ld+json">${serializeJsonLd(data)}</script>`);
  }

  const block = tags.join('\n    ');
  return html.replace('<!--CATEGORY_DIRECTORY_HEAD-->', () => block);
}

/**
 * Insert rendered content into a shell.
 * @param {string} html Shell HTML.
 * @param {string} content Rendered content.
 * @returns {string} Combined HTML.
 */
function applyContent(html, content) {
  return html.replace('<!--CATEGORY_DIRECTORY_CONTENT-->', () => content || '');
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
 * Load every collection category pages read, with a short cache — these are
 * indexable HTML pages a crawler may request in bursts.
 * @returns {Promise<Object>} `{suppliers, validOwnerIds, packages}`.
 */
async function loadCategoryData() {
  const [suppliers, users, packages] = await Promise.all([
    dbUnified.read('suppliers'),
    dbUnified.read('users'),
    dbUnified.read('packages'),
  ]);
  const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
  return {
    suppliers: (suppliers || []).filter(supplier => isPublicSupplier(supplier, validOwnerIds)),
    validOwnerIds,
    packages: packages || [],
  };
}

/**
 * Cached wrapper around `loadCategoryData`.
 * @returns {Promise<Object>} Category data.
 */
function readCategoryData() {
  const now = Date.now();
  if (dataCache && now < dataCacheExpiresAt) {
    return Promise.resolve(dataCache);
  }
  if (dataLoadPromise) {
    return dataLoadPromise;
  }
  dataLoadPromise = loadCategoryData()
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
 * Render a supplier card.
 * @param {Object} entry Ranked entry `{supplier, score}`.
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
  const summary = entry.supplier.approvedReviewSummary || {};
  const rating =
    Number(summary.averageRating) > 0 && Number(summary.reviewCount) > 0
      ? `<span class="efl-card__rating"><span aria-hidden="true">&#9733;</span> ${Number(summary.averageRating).toFixed(1)} &middot; ${Number(summary.reviewCount)} reviews</span>`
      : '';
  const location = entry.supplier.city || entry.supplier.location || '';

  return `<li class="efl-card" data-supplier-id="${escapeHtml(entry.supplier.id)}">
    <div class="efl-card__top">
      <span class="efl-card__avatar" aria-hidden="true">${escapeHtml(initials || 'EF')}</span>
      <span class="efl-card__arrow" aria-hidden="true">&#8599;</span>
    </div>
    <div class="efl-card__body"><h3>${heading}</h3></div>
    <p class="efl-card__meta">${location ? `<span class="efl-relationship">${escapeHtml(location)}</span>` : ''}${rating}</p>
  </li>`;
}

/**
 * Render a category directory page's content.
 * @param {Object} model Page model from `buildCategoryDirectoryPageModel`.
 * @returns {string} Page HTML.
 */
function renderCategoryDirectoryPage(model) {
  const { category, metadata, intro, rankedSuppliers, packages, relatedCategories } = model;
  const sections = [];

  sections.push(`<section class="efl-hero">
    <div class="efl-hero__copy">
      <span class="efl-hero__kicker"><span aria-hidden="true">&#9679;</span> Browse by category</span>
      <h1>${escapeHtml(metadata.heading)}</h1>
      ${intro ? `<p class="efl-hero__intro">${escapeHtml(intro)}</p>` : ''}
      <form class="efl-search" role="search" action="/suppliers" method="GET">
        <label class="efl-sr-only" for="efl-category-search">Search ${escapeHtml(category.name.toLowerCase())}</label>
        <span class="efl-search__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg></span>
        <input id="efl-category-search" type="search" name="q" placeholder="Search ${escapeHtml(category.name.toLowerCase())}&hellip;" />
        <input type="hidden" name="category" value="${escapeHtml(category.name)}" />
        <button type="submit"><span class="efl-search-label--long">Search suppliers</span><span class="efl-search-label--short">Search</span></button>
      </form>
      <p class="efl-hero__trust"><span aria-hidden="true">&#10003;</span> Free to browse <span aria-hidden="true">&#183;</span> Message suppliers directly</p>
    </div>
  </section>`);

  if (rankedSuppliers.length) {
    const summary = [
      `<li><strong>${rankedSuppliers.length}</strong><span>${rankedSuppliers.length === 1 ? 'supplier' : 'suppliers'} nationwide</span></li>`,
      packages.length
        ? `<li><strong>${packages.length}</strong><span>${packages.length === 1 ? 'package' : 'packages'} available</span></li>`
        : '',
    ]
      .filter(Boolean)
      .join('');
    sections.push(`<ul class="efl-summary">${summary}</ul>`);
    sections.push(`<section class="efl-section" aria-labelledby="efl-suppliers">
      <h2 id="efl-suppliers">${escapeHtml(category.name)} suppliers</h2>
      <ul class="efl-grid">${rankedSuppliers.map(renderSupplierCard).join('\n')}</ul>
      <p class="efl-note"><a href="/suppliers?category=${encodeURIComponent(category.name)}">Filter and sort every ${escapeHtml(category.name.toLowerCase())} supplier on the live map &rarr;</a></p>
    </section>`);
  } else {
    sections.push(`<section class="efl-section">
      <p class="efl-prose">We are still building EventFlow's ${escapeHtml(category.name.toLowerCase())} network. <a href="/suppliers?category=${encodeURIComponent(category.name)}">See what's currently listed</a> or <a href="/for-suppliers">add your business</a>.</p>
    </section>`);
  }

  if (relatedCategories.length) {
    const links = relatedCategories
      .map(
        related =>
          `<li><a href="/categories/${escapeHtml(related.slug)}">${escapeHtml(related.name)}</a></li>`
      )
      .join('');
    sections.push(`<section class="efl-section" aria-labelledby="efl-related-categories">
      <h2 id="efl-related-categories">Other supplier categories</h2>
      <ul class="efl-linklist">${links}</ul>
    </section>`);
  }

  sections.push(
    `<p class="efl-note"><a href="/locations">Prefer to browse by city instead?</a></p>`
  );

  return sections.join('\n');
}

/**
 * Render the `/categories` hub content.
 * @param {{category: {name: string, slug: string}, rankedSuppliers: Object[]}[]} entries Populated categories.
 * @returns {string} Hub HTML.
 */
function renderHub(entries) {
  const cards = entries
    .map(
      entry => `<li class="efl-card">
      <h3><a href="/categories/${escapeHtml(entry.category.slug)}">${escapeHtml(entry.category.name)}</a></h3>
      <p class="efl-card__meta">${entry.rankedSuppliers.length} ${entry.rankedSuppliers.length === 1 ? 'supplier' : 'suppliers'}</p>
    </li>`
    )
    .join('');

  return `<section class="efl-hero">
    <div class="efl-hero__copy">
      <span class="efl-hero__kicker"><span aria-hidden="true">&#9679;</span> Browse EventFlow</span>
      <h1>Browse event suppliers by category</h1>
      <p class="efl-hero__intro">Compare venues, catering, photography and more from suppliers across the UK.</p>
    </div>
  </section>
  <section class="efl-section" aria-labelledby="efl-categories">
    <h2 id="efl-categories">Supplier categories</h2>
    <ul class="efl-grid">${cards}</ul>
  </section>`;
}

router.get('/categories', publicReadLimiter, async (req, res, next) => {
  try {
    const shell = await readShell('category-directory.html');
    if (!shell) {
      return next();
    }
    const data = await readCategoryData();
    const entries = categoryDirectoryPages
      .populatedCategories(data.suppliers, data.validOwnerIds)
      .sort((a, b) => b.rankedSuppliers.length - a.rankedSuppliers.length);
    // The hub itself is only worth indexing once it has at least one link to
    // a category page that is itself indexable — otherwise it would be a
    // real page pointing entirely at noindexed destinations.
    const indexable = entries.some(entry =>
      categoryDirectoryPages.isIndexable(entry.rankedSuppliers)
    );

    const origin = BASE_URL;
    const html = applyContent(
      applyMeta(shell, {
        title: 'Browse suppliers by category | EventFlow',
        description:
          'Compare venues, catering, photography and more from event suppliers across the UK on EventFlow.',
        canonicalUrl: `${origin}/categories`,
        indexable,
        pageType: 'category_hub',
        structuredData: [],
      }),
      renderHub(entries)
    );
    return send(res, html, { indexable });
  } catch (error) {
    logger.error('Could not render the category hub:', error);
    return next(error);
  }
});

router.get('/categories/:categorySlug', publicReadLimiter, async (req, res, next) => {
  try {
    const category = categoryDirectoryPages.resolveCategory(req.params.categorySlug);
    if (!category) {
      res.set('X-Robots-Tag', 'noindex, follow');
      return next();
    }
    if (req.params.categorySlug !== category.slug) {
      return res.redirect(301, `/categories/${category.slug}`);
    }

    const shell = await readShell('category-directory.html');
    if (!shell) {
      return next();
    }

    const data = await readCategoryData();
    const allPopulatedCategories = categoryDirectoryPages.populatedCategories(
      data.suppliers,
      data.validOwnerIds
    );

    const model = categoryDirectoryPages.buildCategoryDirectoryPageModel({
      category,
      suppliers: data.suppliers,
      packages: data.packages,
      validOwnerIds: data.validOwnerIds,
      allPopulatedCategories,
      baseUrl: BASE_URL,
    });

    const structuredData = [
      model.breadcrumbs,
      categoryDirectoryPages.buildCategoryDirectoryStructuredData({
        category,
        metadata: model.metadata,
        rankedSuppliers: model.rankedSuppliers,
        baseUrl: BASE_URL,
        supplierUrlFor: supplier => {
          const suffix = supplierPath(supplier);
          return suffix ? `${BASE_URL}${suffix}` : '';
        },
      }),
    ];

    const html = applyContent(
      applyMeta(shell, {
        ...model.metadata,
        indexable: model.indexable,
        pageType: 'category_directory',
        categorySlug: category.slug,
        structuredData,
      }),
      renderCategoryDirectoryPage(model)
    );

    return send(res, html, { indexable: model.indexable });
  } catch (error) {
    logger.error('Could not render a category directory page:', error);
    return next(error);
  }
});

module.exports = router;
module.exports.__internal = {
  applyContent,
  applyMeta,
  escapeHtml,
  loadCategoryData,
  readCategoryData,
  readShell,
  renderCategoryDirectoryPage,
  renderHub,
  renderSupplierCard,
  serializeJsonLd,
  supplierPath,
};
