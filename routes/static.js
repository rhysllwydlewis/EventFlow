/**
 * Static & SEO Routes
 * Handles verify page, sitemap.xml, robots.txt, and HTML redirects
 */

'use strict';

const express = require('express');
const path = require('path');
const { generateSitemap, generateRobotsTxt } = require('../sitemap');
const { authLimiter, apiLimiter } = require('../middleware/rateLimits');
const logger = require('../utils/logger');
const sentry = require('../utils/sentry');

const router = express.Router();

/**
 * GET /verify
 * Serve the verification HTML page
 * The page will extract the token from the query string and call /api/auth/verify
 * Rate limiting applied to prevent abuse
 */
router.get('/verify', authLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'verify.html'));
});

/**
 * GET /sitemap.xml
 * Dynamic sitemap generation
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const sitemap = await generateSitemap(baseUrl);
    res.header('Content-Type', 'application/xml');
    res.send(sitemap);
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
