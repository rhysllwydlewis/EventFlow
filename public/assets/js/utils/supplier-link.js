/**
 * Shared helper for building internal links to a supplier's public profile.
 *
 * Every card/list/detail renderer that links to a supplier profile should use
 * `EventFlowSupplierLink.supplierProfileHref(supplier)`. The server resolves
 * and returns the canonical path; clients never reconstruct it from an id.
 *
 * API responses that already resolved the canonical slug attach it as
 * `publicProfilePath` (see utils/publicSupplierProfilePath.js on the server).
 * The helper validates that field before using it and falls back to the
 * supplier directory when it is absent or malformed.
 */
(function (global) {
  'use strict';

  function supplierProfileHref(supplier) {
    if (!supplier) {
      return '/suppliers';
    }
    const path = String(supplier.publicProfilePath || '').trim();
    return /^\/supplier\/[a-z0-9-]+--[a-f0-9]{16}$/.test(path) ? path : '/suppliers';
  }

  global.EventFlowSupplierLink = { supplierProfileHref };
})(typeof window !== 'undefined' ? window : globalThis);
