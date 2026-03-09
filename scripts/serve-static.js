#!/usr/bin/env node

/**
 * Lightweight static server for E2E tests
 * Serves the /public directory with a stub /api/health endpoint
 *
 * NOTE: This server mirrors routing behavior from main server.js to ensure
 * E2E tests can verify canonical URL redirects. Express.static alone won't
 * provide 301 redirects - it would serve files directly without redirection.
 */

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Basic rate limiter — limits abusive hammering of the test server
// (server only listens on 127.0.0.1 so this is defence-in-depth)
const staticLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // generous limit — E2E test suites issue many requests
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(staticLimiter);

// Disable caching for development/testing
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Add X-Robots-Tag: noindex, nofollow for private/authenticated pages
// This mirrors the behavior of middleware/seo.js in the main server
const noindexPatterns = [
  /^\/(auth|reset-password|dashboard|dashboard-customer|dashboard-supplier|messages|guests|checkout|my-marketplace-listings)(\.html)?($|\?)/,
  /^\/(admin)([-/].+)?(\.html)?($|\?)/,
  /^\/(messenger|chat)(\/.*)?($|\?)/,
];
app.use((req, res, next) => {
  const isNoindex = noindexPatterns.some(pattern => pattern.test(req.path));
  if (isNoindex) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

// Stub /api/health endpoint for Playwright health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mode: 'static' });
});

// Canonical URL redirects (matching server.js behavior)
// These redirects are needed because express.static serves files directly without redirection
app.get('/index.html', (req, res) => {
  res.redirect(301, '/');
});

app.get('/marketplace', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'marketplace.html'));
});

app.get('/marketplace.html', (req, res) => {
  res.redirect(301, '/marketplace');
});

app.get('/suppliers', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'suppliers.html'));
});

app.get('/suppliers.html', (req, res) => {
  res.redirect(301, '/suppliers');
});

app.get('/messenger', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'messenger', 'index.html'));
});

app.get('/messenger/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'messenger', 'index.html'));
});

app.get('/chat', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat', 'index.html'));
});

app.get('/chat/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat', 'index.html'));
});

// Canonical routes for other pages (matching server.js behavior)
const canonicalPages = [
  'start',
  'blog',
  'pricing',
  'faq',
  'for-suppliers',
  'auth',
  'contact',
  'legal',
  'credits',
  'checkout',
  'privacy',
  'terms',
  'payment-success',
  'payment-cancel',
  'my-marketplace-listings',
  'budget',
  'plan',
  'settings',
  'timeline',
  'notifications',
  'guests',
  'messages',
  'category',
  'package',
];

canonicalPages.forEach(page => {
  // Serve the page at canonical URL
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${page}.html`));
  });
  // Redirect .html to canonical, preserving any query string
  app.get(`/${page}.html`, (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, `/${page}${qs}`);
  });
});

// Admin pages — serve clean URLs (matching server.js canonical redirect behavior)
// Both /<page> and /<page>.html serve the same file so static-mode E2E tests
// can navigate via clean URLs (matching production redirects) or via .html paths.
const adminPages = [
  'admin',
  'admin-audit',
  'admin-content',
  'admin-content-dates',
  'admin-homepage',
  'admin-marketplace',
  'admin-messenger',
  'admin-packages',
  'admin-payments',
  'admin-pexels',
  'admin-photos',
  'admin-reports',
  'admin-settings',
  'admin-supplier-detail',
  'admin-suppliers',
  'admin-tickets',
  'admin-user-detail',
  'admin-users',
];

adminPages.forEach(page => {
  // Serve admin page at clean URL (rate limiter applied globally via app.use above)
  app.get(`/${page}`, staticLimiter, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${page}.html`));
  });
  // In static-mode we keep .html paths working too (no redirect) so that
  // existing E2E tests that navigate to /<page>.html are not broken.
});

// Article pages — serve clean URLs and redirect .html to canonical
app.get('/articles/:slug', (req, res, next) => {
  const slug = req.params.slug;
  // Validate slug: only lowercase alphanumerics and hyphens — prevents path traversal
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'articles', `${slug}.html`), err => {
    if (err) {
      next();
    }
  });
});
app.get('/articles/:slug.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(301, `/articles/${req.params.slug}${qs}`);
});

// Serve static files from public directory
app.use(express.static(PUBLIC_DIR));

// Fallback to index.html for client-side routing
app.get('*', staticLimiter, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Static server running at http://127.0.0.1:${PORT}`);
  console.log(`Serving directory: ${PUBLIC_DIR}`);
});
