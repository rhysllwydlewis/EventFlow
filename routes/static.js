/**
 * Static & SEO Routes
 * Handles verify page, sitemap.xml, robots.txt, and HTML redirects
 */

'use strict';

const express = require('express');
const path = require('path');
const dbUnified = require('../db-unified');
const { generateSitemap, generateRobotsTxt } = require('../sitemap');
const { authLimiter, apiLimiter } = require('../middleware/rateLimits');
const {
  buildCampaignQuery,
  buildPublicSupplierSlug,
  isPublicSupplier,
} = require('../services/publicSupplierSeo.service');
const createPublicListingSeoRouter = require('./public-listing-seo');
const logger = require('../utils/logger');
const sentry = require('../utils/sentry');

const router = express.Router();
const SITEMAP_CACHE_CONTROL = 'public, max-age=300, s-maxage=900, stale-while-revalidate=300';
let sitemapCache = null;
let sitemapCacheBaseUrl = '';
let sitemapCacheExpiresAt = 0;

// Deterministic Mongo-backed fixtures for the real-server Playwright suite.
// The module is loaded only for the explicit full backend browser mode, and the
// router itself additionally requires a private fixed test header per request.
if (process.env.NODE_ENV === 'test' && process.env.E2E_MODE === 'full') {
  router.use('/__e2e', require('./e2e-test-support'));
}

// Crawlable package and public-event pages are mounted before static HTML fallbacks.
// This changes only document metadata, canonical handling and response headers; the
// existing page body, CSS and client-side behaviour remain unchanged.
router.use(
  createPublicListingSeoRouter({
    dbUnified,
    logger,
    baseUrl: process.env.BASE_URL || 'https://event-flow.co.uk',
    cacheTtlMs: process.env.E2E_MODE === 'full' ? 0 : undefined,
  })
);

/**
 * GET /verify
 * Serve the verification HTML page
 * The page will extract the token from the query string and call /api/auth/verify
 * Rate limiting applied to prevent abuse
 */
router.get('/verify', authLimiter, (req, res, next) => {
  // Railway production runs server.js, whose templateMiddleware sanitizes
  // anonymous public HTML before express.static. Do not send raw verify.html
  // here or it bypasses the production public sanitizer.
  next();
});

/**
 * Redirect existing public supplier query URLs to their clean canonical URL.
 * Preview and non-public profiles continue through the existing legacy route.
 * This redirect is deliberately outside the JSON API request bucket so historical
 * links and crawler recrawls cannot be interrupted after 100 shared-IP requests.
 */
router.get(['/supplier', '/supplier.html'], async (req, res, next) => {
  const supplierId = String(req.query.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(supplierId) || req.query.preview === 'true') {
    return next();
  }

  try {
    const [suppliers, users] = await Promise.all([
      dbUnified.read('suppliers'),
      dbUnified.read('users'),
    ]);
    const validOwnerIds = new Set((users || []).map(user => user && user.id).filter(Boolean));
    const supplier = (suppliers || []).find(
      item => String(item && item.id) === supplierId && isPublicSupplier(item, validOwnerIds)
    );

    if (!supplier) {
      return next();
    }

    const campaignQuery = buildCampaignQuery(req.query);
    const canonicalPath = `/supplier/${buildPublicSupplierSlug(supplier)}`;
    return res.redirect(301, `${canonicalPath}${campaignQuery ? `?${campaignQuery}` : ''}`);
  } catch (error) {
    logger.warn('Could not resolve legacy supplier URL to its canonical profile', {
      supplierId,
      error: error.message,
    });
    return next();
  }
});

/**
 * GET /sitemap.xml
 * Dynamic sitemap generation
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const now = Date.now();
    if (!sitemapCache || sitemapCacheBaseUrl !== baseUrl || now >= sitemapCacheExpiresAt) {
      sitemapCache = await generateSitemap(baseUrl);
      sitemapCacheBaseUrl = baseUrl;
      sitemapCacheExpiresAt = now + 5 * 60 * 1000;
    }
    res.header('Content-Type', 'application/xml');
    res.header('Cache-Control', SITEMAP_CACHE_CONTROL);
    res.send(sitemapCache);
  } catch (error) {
    logger.error('Error generating sitemap:', error);
    sentry.captureException(error);
    res.status(500).send('Error generating sitemap');
  }
});

/**
 * GET /robots.txt
 * Dynamic robots.txt generation
 */
router.get('/robots.txt', (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const robotsTxt = generateRobotsTxt(baseUrl);
    res.header('Content-Type', 'text/plain');
    res.send(robotsTxt);
  } catch (error) {
    logger.error('Error generating robots.txt:', error);
    sentry.captureException(error);
    res.status(500).send('Error generating robots.txt');
  }
});

/**
 * GET /index.html
 * Redirect to homepage
 */
router.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

/**
 * GET /marketplace.html
 * Redirect to canonical marketplace URL
 */
router.get('/marketplace.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/marketplace${qs}`);
});

/**
 * GET /suppliers.html
 * Redirect to canonical suppliers URL
 */
router.get('/suppliers.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/suppliers${qs}`);
});

/**
 * GET /newsletter/confirmed
 * Serve the newsletter subscription confirmed page
 */
router.get('/newsletter/confirmed', apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'newsletter', 'confirmed.html'));
});

/**
 * GET /newsletter/expired
 * Serve the newsletter link-expired page
 */
router.get('/newsletter/expired', apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'newsletter', 'expired.html'));
});

module.exports = router;
