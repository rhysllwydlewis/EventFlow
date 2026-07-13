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
const PLACEHOLDER_PACKAGE_IMAGE = '/assets/images/package-placeholder.webp';

/**
 * All known placeholder image paths.
 * Extend this set if additional placeholder variants are added to the repo.
 * @type {Set<string>}
 */
const KNOWN_PLACEHOLDERS = new Set([
  '/assets/images/package-placeholder.webp',
  '/assets/images/placeholders/package-event.svg',
  '/assets/images/placeholder-package.jpg',
]);

/** Field names that can hold image URLs, in package-card display preference order. */
const PACKAGE_IMAGE_URL_FIELDS = Object.freeze([
  'url',
  'optimized',
  'large',
  'original',
  'src',
  'path',
  'image',
  'imageUrl',
  'photoUrl',
  'secureUrl',
  'cdnUrl',
  'originalUrl',
  'thumbnail',
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

function sanitizeCandidateValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasHtmlOrScriptPayload(value) {
  return /<\s*\/?\s*(script|img|svg|iframe|object|embed|html|body|video|source|a)\b/i.test(value);
}

function isKnownPlaceholderPath(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value, 'https://event-flow.local');
    return KNOWN_PLACEHOLDERS.has(parsed.pathname);
  } catch (_err) {
    return KNOWN_PLACEHOLDERS.has(value.split(/[?#]/)[0]);
  }
}

/**
 * Classify whether an image candidate is safe and usable for public API output.
 *
 * @param {*} value
 * @returns {{value: string|null, usable: boolean, reason: string, isDataUri: boolean, isApiPhoto: boolean, isPlaceholder: boolean}}
 */
function classifyPackageImageCandidate(value) {
  const trimmed = sanitizeCandidateValue(value);
  const isDataUri = /^data:/i.test(trimmed);
  const isApiPhoto = /^\/api\/photos\//i.test(trimmed);
  if (typeof value !== 'string') {
    return {
      value: null,
      usable: false,
      reason: 'non-string',
      isDataUri: false,
      isApiPhoto: false,
      isPlaceholder: true,
    };
  }
  if (!trimmed) {
    return {
      value: null,
      usable: false,
      reason: 'empty',
      isDataUri: false,
      isApiPhoto: false,
      isPlaceholder: true,
    };
  }
  if (isKnownPlaceholderPath(trimmed)) {
    return {
      value: trimmed,
      usable: false,
      reason: 'placeholder',
      isDataUri: false,
      isApiPhoto,
      isPlaceholder: true,
    };
  }
  if (isDataUri) {
    return {
      value: trimmed,
      usable: false,
      reason: 'data-uri',
      isDataUri: true,
      isApiPhoto: false,
      isPlaceholder: true,
    };
  }
  if (/^javascript:/i.test(trimmed)) {
    return {
      value: trimmed,
      usable: false,
      reason: 'javascript-url',
      isDataUri: false,
      isApiPhoto: false,
      isPlaceholder: false,
    };
  }
  if (hasHtmlOrScriptPayload(trimmed)) {
    return {
      value: trimmed,
      usable: false,
      reason: 'html-payload',
      isDataUri: false,
      isApiPhoto: false,
      isPlaceholder: false,
    };
  }
  return {
    value: trimmed,
    usable: true,
    reason: 'usable',
    isDataUri: false,
    isApiPhoto,
    isPlaceholder: false,
  };
}

/**
 * Return true when a URL represents a placeholder, is absent, empty, or a
 * data: URI that should not be stored / returned in public API responses.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isPlaceholderImage(url) {
  return !classifyPackageImageCandidate(url).usable;
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
    const classification = classifyPackageImageCandidate(img);
    return classification.usable ? classification.value : '';
  }
  for (const field of PACKAGE_IMAGE_URL_FIELDS) {
    const classification = classifyPackageImageCandidate(img[field]);
    if (classification.usable) {
      return classification.value;
    }
  }
  return '';
}

function pushCandidate(candidates, source, value) {
  const classification = classifyPackageImageCandidate(value);
  candidates.push({
    source,
    value: classification.value,
    usable: classification.usable,
    reason: classification.reason,
  });
}

function pushRejectedCandidate(candidates, source, reason) {
  candidates.push({
    source,
    value: null,
    usable: false,
    reason,
  });
}

function addGalleryCandidates(candidates, source, gallery) {
  if (gallery === undefined || gallery === null) {
    pushRejectedCandidate(candidates, source, 'empty');
    return;
  }
  if (!Array.isArray(gallery)) {
    pushRejectedCandidate(candidates, source, 'non-array');
    return;
  }
  gallery.forEach((img, index) => {
    if (typeof img === 'string') {
      pushCandidate(candidates, `${source}[${index}]`, img);
      return;
    }
    if (!img || typeof img !== 'object') {
      pushCandidate(candidates, `${source}[${index}]`, img);
      return;
    }
    PACKAGE_IMAGE_URL_FIELDS.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(img, field)) {
        pushCandidate(candidates, `${source}[${index}].${field}`, img[field]);
      }
    });
  });
}

/**
 * List every package image candidate considered by the public resolver, with
 * source paths and rejection reasons for diagnostics.
 *
 * @param {Object} pkg
 * @returns {Array<{source: string, value: string|null, usable: boolean, reason: string}>}
 */
function listPackageImageCandidates(pkg) {
  const candidates = [];
  if (!pkg || typeof pkg !== 'object') {
    pushRejectedCandidate(candidates, 'pkg', 'invalid-package');
    return candidates;
  }

  pushCandidate(candidates, 'pkg.resolvedImage', pkg.resolvedImage);
  pushCandidate(candidates, 'pkg.image', pkg.image);
  PACKAGE_IMAGE_URL_FIELDS.forEach(field => {
    if (field !== 'image' && Object.prototype.hasOwnProperty.call(pkg, field)) {
      pushCandidate(candidates, `pkg.${field}`, pkg[field]);
    }
  });
  addGalleryCandidates(candidates, 'pkg.resolvedGallery', pkg.resolvedGallery);
  addGalleryCandidates(candidates, 'pkg.gallery', pkg.gallery);
  addGalleryCandidates(candidates, 'pkg.images', pkg.images);

  return candidates;
}

function getBestPackageImageCandidate(pkg) {
  return listPackageImageCandidates(pkg).find(candidate => candidate.usable) || null;
}

/**
 * Return structured facts about an image-like value for diagnostics.
 *
 * @param {string|null|undefined} url
 * @returns {{value: string|null, isDataUri: boolean, isApiPhoto: boolean, isPlaceholder: boolean}}
 */
function classifyPackageImageValue(url) {
  const classification = classifyPackageImageCandidate(url);
  return {
    value: classification.value,
    isDataUri: classification.isDataUri,
    isApiPhoto: classification.isApiPhoto,
    isPlaceholder: classification.isPlaceholder,
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
    if (PACKAGE_IMAGE_URL_FIELDS.includes(key) || INSPECTED_PACKAGE_IMAGE_FIELDS.includes(key)) {
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
 * Resolve the best available image URL for a package.
 *
 * @param {Object} pkg
 * @returns {string}
 */
function resolvePackageImage(pkg) {
  const chosen = getBestPackageImageCandidate(pkg);
  return chosen ? chosen.value : PLACEHOLDER_PACKAGE_IMAGE;
}

/**
 * Normalise a raw gallery array into a consistent array of objects, each with
 * a guaranteed `url` field set to the best available URL for that entry.
 * Items with no usable URL or a placeholder URL are excluded from the result.
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
    // Legacy field coverage: extractGalleryItemUrl handles img.originalUrl and img.thumbnail
    // through PACKAGE_IMAGE_URL_FIELDS without allowing either to outrank optimized/large.
    const url = extractGalleryItemUrl(img);
    if (url && !isPlaceholderImage(url)) {
      normalized.push(typeof img === 'string' ? { url } : { ...img, url });
    }
  }
  return normalized;
}

/**
 * Build a complete audit record for package image investigation.
 *
 * @param {Object} pkg
 * @returns {Object}
 */
function buildPackageImageAudit(pkg, opts = {}) {
  const resolvedImage = resolvePackageImage(pkg);
  const chosen = getBestPackageImageCandidate(pkg);
  const resolvedGallery = normalizeGallery(pkg && pkg.gallery);
  const imageFacts = classifyPackageImageValue(pkg && pkg.image);
  const publicImageFacts = classifyPackageImageValue(resolvedImage);
  return {
    id: pkg && pkg.id,
    title: pkg && (pkg.title || pkg.name),
    approved: pkg && pkg.approved,
    supplierId: pkg && (pkg.supplierId || pkg.supplier_id),

    imageRaw: (pkg && pkg.image) || null,
    imageRawIsEmpty: !(pkg && pkg.image),
    imageRawIsDataUri: imageFacts.isDataUri,
    imageRawIsApiPhoto: imageFacts.isApiPhoto,
    imageRawIsPlaceholder: imageFacts.isPlaceholder,
    galleryRaw: pkg && Array.isArray(pkg.gallery) ? pkg.gallery : null,
    imagesRaw: pkg && Array.isArray(pkg.images) ? pkg.images : null,
    namedImageFields: collectNamedPackageImageFields(pkg),
    resolverCandidates: listPackageImageCandidates(pkg),
    chosenImageSource: chosen ? chosen.source : 'fallback.placeholder',
    duplicateTitleCountForSupplier: opts.duplicateTitleCountForSupplier,

    image: resolvedImage,
    resolvedImage,
    resolvedImageIsDataUri: publicImageFacts.isDataUri,
    resolvedImageIsApiPhoto: publicImageFacts.isApiPhoto,
    isPlaceholder: publicImageFacts.isPlaceholder,
    resolvedGallery,

    galleryLength: Array.isArray(pkg && pkg.gallery) ? pkg.gallery.length : 0,
    imagesLength: Array.isArray(pkg && pkg.images) ? pkg.images.length : 0,
    resolvedGalleryLength: resolvedGallery.length,
    firstGalleryUrl: resolvedGallery.length > 0 ? resolvedGallery[0].url : null,
    firstRawGalleryItem:
      Array.isArray(pkg && pkg.gallery) && pkg.gallery.length > 0 ? pkg.gallery[0] : null,
  };
}

module.exports = {
  PLACEHOLDER_PACKAGE_IMAGE,
  KNOWN_PLACEHOLDERS,
  PACKAGE_IMAGE_URL_FIELDS,
  INSPECTED_PACKAGE_IMAGE_FIELDS,
  classifyPackageImageCandidate,
  isPlaceholderImage,
  extractGalleryItemUrl,
  listPackageImageCandidates,
  getBestPackageImageCandidate,
  classifyPackageImageValue,
  collectNamedPackageImageFields,
  buildPackageImageAudit,
  resolvePackageImage,
  normalizeGallery,
};
