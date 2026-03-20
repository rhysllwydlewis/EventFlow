/**
 * Package Image Utilities (server-side)
 *
 * Shared helpers for resolving the best displayable image for a package.
 * Mirrors the client-side logic in public/assets/js/utils/package-image-resolver.js
 * so that every API endpoint returns consistent, pre-resolved image URLs.
 *
 * Used by:
 *   - routes/suppliers.js  (featured, spotlight, detail, supplier packages)
 *   - services/searchService.js  (topPackages embedded in supplier search results)
 */

'use strict';

/** Canonical placeholder path served when a package has no usable photo. */
const PLACEHOLDER_PACKAGE_IMAGE = '/assets/images/placeholders/package-event.svg';

/**
 * All known placeholder image paths.
 * Extend this set if additional placeholder variants are added to the repo.
 * @type {Set<string>}
 */
const KNOWN_PLACEHOLDERS = new Set([
  '/assets/images/placeholders/package-event.svg',
  '/assets/images/placeholder-package.jpg',
]);

/**
 * Return true when a URL represents a placeholder, is absent, empty, or a
 * data: URI that should not be stored / returned in public API responses.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') {
    return true;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return true;
  }
  // data: URIs are not usable as public image URLs; treat as "no image".
  if (/^data:/i.test(trimmed)) {
    return true;
  }
  return KNOWN_PLACEHOLDERS.has(trimmed);
}

/**
 * Extract the raw URL string from a gallery item that may be a string or an
 * object with various field names used by different API versions.
 *
 * @param {string|Object} img
 * @returns {string}
 */
function extractGalleryItemUrl(img) {
  if (!img) {
    return '';
  }
  if (typeof img === 'string') {
    return img;
  }
  return img.url || img.src || img.path || img.image || img.originalUrl || img.thumbnail || '';
}

/**
 * Resolve the best available image URL for a package.
 *
 * Resolution order:
 *   1. pkg.image  — if present and not a known placeholder.
 *   2. pkg.gallery — first non-placeholder entry wins.
 *   3. Canonical placeholder path — always returns a non-empty string.
 *
 * @param {Object} pkg
 * @returns {string}
 */
function resolvePackageImage(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return PLACEHOLDER_PACKAGE_IMAGE;
  }

  if (pkg.image && !isPlaceholderImage(pkg.image)) {
    return pkg.image;
  }

  if (Array.isArray(pkg.gallery) && pkg.gallery.length > 0) {
    for (const img of pkg.gallery) {
      const url = extractGalleryItemUrl(img);
      if (url && !isPlaceholderImage(url)) {
        return url;
      }
    }
  }

  return PLACEHOLDER_PACKAGE_IMAGE;
}

/**
 * Normalise a raw gallery array into a consistent array of objects, each with
 * a guaranteed `url` field set to the best available URL for that entry.
 * Items with no usable URL or a placeholder URL are excluded from the result.
 *
 * Returned as `resolvedGallery` in the package detail API response so clients
 * never need to guess which field name holds the URL.
 *
 * @param {Array} gallery  Raw gallery array (strings or mixed-schema objects)
 * @returns {Array<{url: string, [key: string]: any}>}
 */
function normalizeGallery(gallery) {
  if (!Array.isArray(gallery) || gallery.length === 0) {
    return [];
  }
  const normalized = [];
  for (const img of gallery) {
    if (!img) {
      continue;
    }
    const url = extractGalleryItemUrl(img);
    if (url && !isPlaceholderImage(url)) {
      normalized.push(typeof img === 'string' ? { url } : { ...img, url });
    }
  }
  return normalized;
}

module.exports = {
  PLACEHOLDER_PACKAGE_IMAGE,
  KNOWN_PLACEHOLDERS,
  isPlaceholderImage,
  extractGalleryItemUrl,
  resolvePackageImage,
  normalizeGallery,
};
