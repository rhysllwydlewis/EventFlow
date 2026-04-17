/**
 * Legacy API Deprecation Middleware
 *
 * Emits RFC 8594 / RFC 9745 `Deprecation` and `Sunset` headers on unversioned
 * `/api/...` endpoints that have a `/api/v1/...` replacement. Also logs the
 * deprecation once per route (per process) to avoid log spam.
 *
 * Effort 3.2 — route structure cleanup.
 *
 * Removal policy: the unversioned `/api/...` aliases are scheduled for removal
 * in **EventFlow v20.0.0**. Downstream callers should migrate to `/api/v1/...`.
 */

'use strict';

const logger = require('../utils/logger');

// ISO-8601 date (HTTP Sunset header allows an HTTP-date OR a date-time in
// any form a client can parse; RFC 9745 clarifies the canonical form is a
// HTTP-date IMF-fixdate). Using toUTCString() produces that format.
const SUNSET_DATE = new Date('2026-12-31T23:59:59Z');
const DEPRECATION_VERSION = 'v20.0.0';

// Track which routes we've already logged a deprecation warning for,
// to avoid log spam across many requests.
const _loggedRoutes = new Set();

/**
 * Build a middleware that marks responses as deprecated.
 *
 * Usage:
 *   app.use('/api/foo', legacyApiDeprecation('/api/foo', '/api/v1/foo'), fooRouter);
 *
 * @param {string} oldPath - The unversioned mount path, e.g. '/api/foo'.
 * @param {string} newPath - The canonical replacement, e.g. '/api/v1/foo'.
 * @returns {import('express').RequestHandler}
 */
function legacyApiDeprecation(oldPath, newPath) {
  return function legacyApiDeprecationMiddleware(req, res, next) {
    // Express mounts `/api` as a prefix, which means `/api/v1/foo`, `/api/v2/foo`,
    // etc. are ALSO routed through here. We must only flag genuinely unversioned
    // calls — if the originalUrl is a versioned path, do nothing.
    //
    // `req.originalUrl` is the full requested path including query string.
    // `req.baseUrl` is the mount point, so stripping it off gives the
    // remainder the downstream router will see. If the remainder starts with
    // `/vN/` (any digit), the client is already on a versioned path and
    // should NOT be told they're deprecated.
    const remainder = req.originalUrl.slice(req.baseUrl.length).split('?')[0];
    if (/^\/v\d+\//.test(remainder)) {
      return next();
    }

    // RFC 9745: Deprecation header indicates this resource is deprecated.
    // Value "true" (a sh-boolean in structured-headers syntax) is RFC-compliant.
    res.setHeader('Deprecation', 'true');
    // RFC 8594: Sunset header indicates when the resource will be removed.
    res.setHeader('Sunset', SUNSET_DATE.toUTCString());
    // Point clients at the canonical replacement and a human-readable policy doc.
    res.setHeader(
      'Link',
      `<${newPath}>; rel="successor-version", ` +
        `<https://github.com/rhysllwydlewis/EventFlow/blob/main/docs/api-deprecation.md>; rel="deprecation"; type="text/html"`
    );

    if (!_loggedRoutes.has(oldPath)) {
      _loggedRoutes.add(oldPath);
      logger.warn(
        `[deprecation] Legacy API in use: ${oldPath} → use ${newPath} instead. ` +
          `Scheduled for removal in ${DEPRECATION_VERSION} (${SUNSET_DATE.toISOString().slice(0, 10)}).`
      );
    }

    next();
  };
}

module.exports = {
  legacyApiDeprecation,
  SUNSET_DATE,
  DEPRECATION_VERSION,
  // Exported for tests: reset the seen-route cache between runs
  _resetLoggedRoutesForTests() {
    _loggedRoutes.clear();
  },
};
