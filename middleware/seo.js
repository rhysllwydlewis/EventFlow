/**
 * SEO Middleware
 * Handles noindex headers and other SEO-related concerns
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Noindex Middleware for Non-Public Pages
 * Adds X-Robots-Tag header to prevent indexing of authenticated/private pages
 * CRITICAL: Must come before express.static() so it intercepts HTML file requests
 * @returns {Function} Express middleware
 */
function noindexMiddleware() {
  // List of non-public pages that should not be indexed. These are requested
  // at extensionless canonical URLs (e.g. /checkout) which templateMiddleware
  // maps internally to `${page}.html` further down the middleware chain — a
  // direct `/checkout.html` request 301s to `/checkout` before it ever reaches
  // a client. So this list (and the admin check below) must match on the path
  // with any trailing ".html" stripped, not the legacy suffixed form, or the
  // header never reaches real traffic. See scripts/serve-static.js, which
  // already does this correctly for the E2E preview server.
  const noindexPages = [
    'auth',
    'reset-password',
    'dashboard',
    'dashboard-customer',
    'dashboard-supplier',
    'messages',
    'guests',
    'checkout',
    'my-marketplace-listings',
    'budget',
    'gallery',
  ];

  // Root prefixes for non-public SPA directories.
  // A path is matched if it equals the prefix exactly, equals it with a trailing slash,
  // or starts with the prefix followed by a slash (sub-paths like /messenger/index.html).
  const noindexPrefixes = ['/messenger', '/chat', '/partner'];

  return (req, res, next) => {
    const p = req.path;
    const bare = p.endsWith('.html') ? p.slice(0, -'.html'.length) : p;

    const isLegacyPage = noindexPages.includes(bare.replace(/^\//, ''));
    const isSpaPath = noindexPrefixes.some(
      prefix => p === prefix || p === `${prefix}/` || p.startsWith(`${prefix}/`)
    );
    const isAdminPage = bare.startsWith('/admin');

    if (isLegacyPage || isSpaPath || isAdminPage) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (isLegacyPage) {
        logger.info(`X-Robots-Tag noindex applied to ${p}`);
      }
    }

    next();
  };
}

module.exports = {
  noindexMiddleware,
};
