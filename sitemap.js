/**
 * Dynamic Sitemap Generator for EventFlow
 * Generates sitemap.xml dynamically from database
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dbUnified = require('./db-unified');
const logger = require('./utils/logger');
const {
  buildPublicSupplierSlug,
  isPublicSupplier,
} = require('./services/publicSupplierSeo.service');
const {
  buildPublicEventSlug,
  buildPublicPackageSlug,
  isIndexablePublicEvent,
  isPublicPackage,
  publicSupplierIds,
  validLastModified,
} = require('./services/publicListingSeo.service');

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
      lastmod: g.lastUpdated || g.publishedDate || null,
    }));
  } catch (err) {
    logger.error('sitemap: could not load guides.json:', err);
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
  if (lastmod) xmlParts.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
  xmlParts.push('  </url>');
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
async function generateSitemap(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/$/, '');
  const xmlParts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  const staticPages = [
    '/',
    '/suppliers',
    '/marketplace',
    '/public-calendar',
    '/guides',
    '/blog',
    '/start',
    '/pricing',
    '/for-suppliers',
    '/contact',
    '/faq',
    '/privacy',
    '/terms',
  ];
  staticPages.forEach(page => appendUrl(xmlParts, normalizedBaseUrl + page));

  try {
    const [suppliers, users, packages, events] = await Promise.all([
      dbUnified.read('suppliers'),
      dbUnified.read('users'),
      dbUnified.read('packages'),
      dbUnified.read('public_calendar_events'),
    ]);
    const validOwnerIds = new Set((users || []).map(user => user?.id).filter(Boolean));
    const supplierIds = publicSupplierIds(suppliers, users);

    (suppliers || [])
      .filter(supplier => isPublicSupplier(supplier, validOwnerIds))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .forEach(supplier => {
        const slug = buildPublicSupplierSlug(supplier);
        if (!slug) return;
        appendUrl(
          xmlParts,
          `${normalizedBaseUrl}/supplier/${slug}`,
          validLastModifiedOrFallback(
            supplier.updatedAt || supplier.modifiedAt || supplier.createdAt
          )
        );
      });

    (packages || [])
      .filter(pkg => isPublicPackage(pkg, supplierIds))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .forEach(pkg => {
        const slug = buildPublicPackageSlug(pkg);
        if (!slug) return;
        appendUrl(
          xmlParts,
          `${normalizedBaseUrl}/package/${slug}`,
          validLastModifiedOrFallback(pkg.updatedAt || pkg.modifiedAt || pkg.createdAt)
        );
      });

    const now = new Date();
    (events || [])
      .filter(event => isIndexablePublicEvent(event, now))
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
      .forEach(event => {
        const slug = buildPublicEventSlug(event);
        if (!slug) return;
        appendUrl(
          xmlParts,
          `${normalizedBaseUrl}/events/${slug}`,
          validLastModifiedOrFallback(
            event.updatedAt || event.publishedAt || event.modifiedAt || event.createdAt
          )
        );
      });

    loadGuideEntries().forEach(({ slug, lastmod }) => {
      if (!slug) return;
      appendUrl(
        xmlParts,
        `${normalizedBaseUrl}/articles/${slug}`,
        validLastModifiedOrFallback(lastmod)
      );
    });
  } catch (error) {
    logger.error('Error generating dynamic sitemap entries:', error);
  }

  xmlParts.push('</urlset>');
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
  generateRobotsTxt,
  loadGuideEntries,
  validLastModified: validLastModifiedOrFallback,
  xmlEscape,
};
