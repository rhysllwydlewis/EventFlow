'use strict';

const logger = require('../utils/logger');

function noindexMiddleware() {
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
    '/home-v2-preview',
    '/home-v2-preview.html',
  ];

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
