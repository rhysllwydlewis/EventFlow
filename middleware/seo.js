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
  // List of non-public pages that should not be indexed
  const noindexPaths = [
    '/auth.html',
    '/reset-password.html',
    '/dashboard.html',
    '/dashboard-customer.html',
    '/dashboard-supplier.html',
    '/messages.html',
    '/guests.html',
    '/checkout.html',
    '/my-marketplace-listings.html',
    '/budget.html',
  ];

  // Root prefixes for non-public SPA directories.
  // A path is matched if it equals the prefix exactly, equals it with a trailing slash,
  // or starts with the prefix followed by a slash (sub-paths like /messenger/index.html).
  const noindexPrefixes = ['/messenger', '/chat', '/partner'];

  return (req, res, next) => {
    const p = req.path;

    const isLegacyPage = noindexPaths.includes(p);
    const isSpaPath = noindexPrefixes.some(
      prefix => p === prefix || p === `${prefix}/` || p.startsWith(`${prefix}/`)
    );
    const isAdminPage = p.startsWith('/admin') && p.endsWith('.html');

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
