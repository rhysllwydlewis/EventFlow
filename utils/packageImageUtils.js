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

/** Field names that have appeared in package image payloads or upload results. */
const INSPECTED_PACKAGE_IMAGE_FIELDS = Object.freeze([
  'original',
  'optimized',
  'large',
  'thumbnail',
  'photoUrl',
  'imageUrl',
  'secureUrl',
  'cdnUrl',
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
 * Return structured facts about an image-like value for diagnostics.
 *
 * @param {string|null|undefined} url
 * @returns {{value: string|null, isDataUri: boolean, isApiPhoto: boolean, isPlaceholder: boolean}}
 */
function classifyPackageImageValue(url) {
  const value = typeof url === 'string' ? url.trim() : '';
  return {
    value: value || null,
    isDataUri: /^data:/i.test(value),
    isApiPhoto: /^\/api\/photos\//i.test(value),
    isPlaceholder: isPlaceholderImage(value),
  };
}

/**
 * Collect known image field names anywhere in a package payload. The path makes
 * it clear whether a value came from the root package document, gallery item,
 * nested upload result, etc.
 *
 * @param {*} value
 * @param {Object} [opts]
 * @param {string} [opts.path]
 * @param {number} [opts.depth]
 * @param {Set<*>} [opts.seen]
 * @returns {Array<{path: string, field: string, value: *}>}
 */
function collectNamedPackageImageFields(value, opts = {}) {
  const path = opts.path || 'pkg';
  const depth = opts.depth || 0;
  const seen = opts.seen || new Set();
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) {
    return [];
  }
  seen.add(value);

  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(
        ...collectNamedPackageImageFields(item, {
          path: `${path}[${index}]`,
          depth: depth + 1,
          seen,
        })
      );
    });
    return found;
  }

  Object.entries(value).forEach(([key, child]) => {
    const childPath = `${path}.${key}`;
    if (INSPECTED_PACKAGE_IMAGE_FIELDS.includes(key)) {
      found.push({ path: childPath, field: key, value: child });
    }
    if (child && typeof child === 'object') {
      found.push(
        ...collectNamedPackageImageFields(child, {
          path: childPath,
          depth: depth + 1,
          seen,
        })
      );
    }
  });
  return found;
}

/**
 * Build a complete audit record for package image investigation.
 *
 * @param {Object} pkg
 * @returns {Object}
 */
function buildPackageImageAudit(pkg) {
  const resolvedImage = resolvePackageImage(pkg);
  const resolvedGallery = normalizeGallery(pkg && pkg.gallery);
  const imageFacts = classifyPackageImageValue(pkg && pkg.image);
  const publicImageFacts = classifyPackageImageValue(resolvedImage);
  return {
    id: pkg && pkg.id,
    title: pkg && (pkg.title || pkg.name),
    approved: pkg && pkg.approved,
    supplierId: pkg && (pkg.supplierId || pkg.supplier_id),

    // Raw stored fields from the package document.
    imageRaw: (pkg && pkg.image) || null,
    imageRawIsEmpty: !(pkg && pkg.image),
    imageRawIsDataUri: imageFacts.isDataUri,
    imageRawIsApiPhoto: imageFacts.isApiPhoto,
    imageRawIsPlaceholder: imageFacts.isPlaceholder,
    galleryRaw: pkg && Array.isArray(pkg.gallery) ? pkg.gallery : null,
    imagesRaw: pkg && Array.isArray(pkg.images) ? pkg.images : null,
    namedImageFields: collectNamedPackageImageFields(pkg),

    // Public API shape returned by supplier package endpoints.
    image: resolvedImage,
    resolvedImage,
    resolvedImageIsDataUri: publicImageFacts.isDataUri,
    resolvedImageIsApiPhoto: publicImageFacts.isApiPhoto,
    isPlaceholder: publicImageFacts.isPlaceholder,
    resolvedGallery,

    // Compact counters / first item for easier scanning in admin tables.
    galleryLength: Array.isArray(pkg && pkg.gallery) ? pkg.gallery.length : 0,
    imagesLength: Array.isArray(pkg && pkg.images) ? pkg.images.length : 0,
    resolvedGalleryLength: resolvedGallery.length,
    firstGalleryUrl: resolvedGallery.length > 0 ? resolvedGallery[0].url : null,
    firstRawGalleryItem:
      Array.isArray(pkg && pkg.gallery) && pkg.gallery.length > 0 ? pkg.gallery[0] : null,
  };
}

function firstRealScalarImage(...urls) {
  for (const url of urls) {
    if (url && !isPlaceholderImage(url)) {
      return url;
    }
  }
  return '';
}

function firstRealGalleryImage(...galleries) {
  for (const gallery of galleries) {
    if (!Array.isArray(gallery) || gallery.length === 0) {
      continue;
    }
    for (const img of gallery) {
      const url = extractGalleryItemUrl(img);
      if (url && !isPlaceholderImage(url)) {
        return url;
      }
    }
  }
  return '';
}

/**
 * Resolve the best available image URL for a package.
 *
 * Resolution order:
 *   1. pkg.resolvedImage / pkg.image — first real non-placeholder scalar URL.
 *   2. pkg.resolvedGallery / pkg.gallery — first non-placeholder gallery entry.
 *   3. pkg.images — legacy plural array used by package.service.js path.
 *   4. Canonical placeholder path — always returns a non-empty string.
 *
 * @param {Object} pkg
 * @returns {string}
 */
function resolvePackageImage(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return PLACEHOLDER_PACKAGE_IMAGE;
  }

  return (
    firstRealScalarImage(pkg.resolvedImage, pkg.image) ||
    firstRealGalleryImage(pkg.resolvedGallery, pkg.gallery, pkg.images) ||
    PLACEHOLDER_PACKAGE_IMAGE
  );
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
  INSPECTED_PACKAGE_IMAGE_FIELDS,
  isPlaceholderImage,
  extractGalleryItemUrl,
  classifyPackageImageValue,
  collectNamedPackageImageFields,
  buildPackageImageAudit,
  resolvePackageImage,
  normalizeGallery,
};
