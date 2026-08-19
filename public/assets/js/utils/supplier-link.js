/**
 * Shared helper for building internal links to a supplier's public profile.
 *
 * Every card/list/detail renderer that links to a supplier profile should use
 * `EventFlowSupplierLink.href(supplier)` instead of hand-building
 * `/supplier?id=...`. The server already resolves that legacy query URL with a
 * single 301 redirect to the clean canonical slug (see routes/static.js), but
 * Google Search Console flagged /suppliers as still *internally linking* to
 * the query form — every hop we skip client-side keeps the canonical slug the
 * only URL crawlers ever see for a given supplier.
 *
 * API responses that already resolved the canonical slug attach it as
 * `publicProfilePath` (see utils/publicSupplierProfilePath.js on the server).
 * When a supplier object carries that field we use it as-is. Only when it is
 * genuinely absent (an older endpoint that hasn't been updated yet) do we
 * fall back to the legacy `?id=` form — which still works, just costs one
 * extra redirect.
 */
(function (global) {
  'use strict';

  function supplierProfileHref(supplier) {
    if (!supplier) {
      return '/suppliers';
    }
    if (typeof supplier.publicProfilePath === 'string' && supplier.publicProfilePath) {
      return supplier.publicProfilePath;
    }
    const id = supplier.id || supplier.supplierId;
    if (!id) {
      return '/suppliers';
    }
    return `/supplier?id=${encodeURIComponent(id)}`;
  }

  global.EventFlowSupplierLink = { supplierProfileHref };
})(typeof window !== 'undefined' ? window : globalThis);
