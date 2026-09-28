#!/usr/bin/env node

/**
 * Static Sitemap Generator for EventFlow.
 * Mirrors sitemap.js for static deployments and includes the guide index plus
 * every guide article from public/assets/data/guides.json with per-guide lastmod.
 *
 * The file this writes (public/sitemap.xml) is NOT the sitemap production
 * serves — the live app's /sitemap.xml route (routes/static.js) generates one
 * dynamically from the database via sitemap.js, and that route is mounted
 * ahead of express.static() so it always wins. This static file is only ever
 * actually served by the E2E "static mode" preview server
 * (scripts/serve-static.js, used by CI), which has no database and falls
 * through to express.static() for anything without an explicit route. Keep
 * this list limited to pages that are genuinely public and indexable —
 * anything behind server-side auth (see protectedHtmlPages in server.js)
 * does not belong here.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://event-flow.co.uk';
const OUTPUT_FILE = path.join(__dirname, '../public/sitemap.xml');
const GUIDES_FILE = path.join(__dirname, '../public/assets/data/guides.json');

const STATIC_PAGES = [
  { url: '/', changefreq: 'weekly', priority: '1.0' },
  { url: '/about', changefreq: 'yearly', priority: '0.5' },
  { url: '/start', changefreq: 'weekly', priority: '0.9' },
  { url: '/suppliers', changefreq: 'daily', priority: '0.9' },
  { url: '/marketplace', changefreq: 'daily', priority: '0.9' },
  { url: '/pricing', changefreq: 'monthly', priority: '0.8' },
  { url: '/guides', changefreq: 'weekly', priority: '0.8' },
  { url: '/faq', changefreq: 'monthly', priority: '0.7' },
  { url: '/contact', changefreq: 'monthly', priority: '0.6' },
  { url: '/for-suppliers', changefreq: 'monthly', priority: '0.7' },
  { url: '/legal', changefreq: 'monthly', priority: '0.4' },
  { url: '/privacy', changefreq: 'monthly', priority: '0.4' },
  { url: '/terms', changefreq: 'monthly', priority: '0.4' },
  { url: '/credits', changefreq: 'yearly', priority: '0.3' },
];

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().split('T')[0];
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateUrlEntry(url, changefreq = 'monthly', priority = '0.5', lastmod = null) {
  const fullUrl = `${BASE_URL}${url}`;
  const lastmodLine = formatDate(lastmod) ? `\n    <lastmod>${formatDate(lastmod)}</lastmod>` : '';
  return `  <url>\n    <loc>${xmlEscape(fullUrl)}</loc>${lastmodLine}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function loadGuidePages() {
  const guides = JSON.parse(fs.readFileSync(GUIDES_FILE, 'utf8'));
  return guides
    .filter(guide => guide.href && guide.href.startsWith('/articles/'))
    .map(guide => ({
      url: guide.href,
      changefreq: 'monthly',
      priority: '0.7',
      lastmod: guide.lastMaterialUpdate || guide.lastUpdated || guide.publishedDate,
    }));
}

function generateSitemap() {
  const pages = [...STATIC_PAGES, ...loadGuidePages()];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map(page => generateUrlEntry(page.url, page.changefreq, page.priority, page.lastmod))
    .join('\n')}\n</urlset>`;
}

function writeSitemap() {
  const sitemap = generateSitemap();
  fs.writeFileSync(OUTPUT_FILE, `${sitemap}\n`, 'utf8');
  console.log(`Sitemap generated: ${OUTPUT_FILE}`);
}

if (require.main === module) {
  writeSitemap();
}

module.exports = { formatDate, generateSitemap, generateUrlEntry, loadGuidePages };
