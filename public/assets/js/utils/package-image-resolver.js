/**
 * Package Image Resolver
 *
 * Shared utility for picking the best available image URL for a package card.
 * Used by Carousel, PackageList, and the homepage fallback renderer so that
 * every card uses the same "prefer real image over placeholder" strategy.
 *
 * Resolution order (O(gallery.length) worst case per call):
 *   1. pkg.resolvedImage / pkg.image — first real non-placeholder scalar URL.
 *   2. pkg.resolvedGallery / pkg.gallery — first non-placeholder gallery entry;
 *                    supports strings and objects with url / src / path / image fields.
 *   3. pkg.images — legacy plural image array used by package.service.js.
 *   4. Canonical placeholder path — used as the final fallback.
 *
 * Debug instrumentation:
 *   Enable by appending ?debugImages=1 to the page URL, or by running:
 *     localStorage.setItem('debugImages', '1')
 *   This logs slug/id, chosen URL, whether pkg.image was a placeholder, and
 *   gallery length to the browser console — no noise by default.
 */

/** Canonical placeholder shown when a package has no uploaded photo. */
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
 * Return true when a URL is a known placeholder (or absent).
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
  // data: URLs cannot be displayed in public homepage carousels — client-side
  // sanitizers block them to prevent XSS, and they are too large for API
  // responses.  Treat them as "no usable image" so the gallery fallback fires.
  if (/^data:/i.test(trimmed)) {
    return true;
  }
  return KNOWN_PLACEHOLDERS.has(trimmed);
}

function extractGalleryItemUrl(img) {
  if (!img) {
    return '';
  }
  if (typeof img === 'string') {
    return img;
  }
  return img.url || img.src || img.path || img.image || img.originalUrl || img.thumbnail || '';
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
 * @param {Object} pkg                    - Package data object
 * @param {string}  [pkg.resolvedImage]   - Server-resolved image URL
 * @param {string}  [pkg.image]           - Primary image URL
 * @param {Array}   [pkg.resolvedGallery] - Server-normalised gallery array
 * @param {Array}   [pkg.gallery]         - Gallery array (strings or objects)
 * @param {Array}   [pkg.images]          - Legacy plural image array (package.service.js path)
 * @returns {string} Resolved image URL (always a non-empty string)
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
 * Log image resolution details for a package when debug mode is active.
 *
 * Debug mode is enabled by either:
 *   - ?debugImages=1 query parameter in the page URL, OR
 *   - localStorage.setItem('debugImages', '1')
 *
 * No output is produced unless one of those conditions is met.
 *
 * @param {Object} pkg       - Package data object
 * @param {string} chosenUrl - The URL ultimately chosen for the card image
 */
function debugPackageImage(pkg, chosenUrl) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const storageFlag = window.localStorage && window.localStorage.getItem('debugImages') === '1';
    if (params.get('debugImages') !== '1' && !storageFlag) {
      return;
    }
  } catch (_e) {
    return;
  }

  // eslint-disable-next-line no-console
  console.debug('[PackageImage]', {
    slug: pkg.slug || pkg.id || '(unknown)',
    chosenUrl,
    imageWasPlaceholder: isPlaceholderImage(pkg.image),
    galleryLength: Array.isArray(pkg.gallery) ? pkg.gallery.length : 0,
    resolvedGalleryLength: Array.isArray(pkg.resolvedGallery) ? pkg.resolvedGallery.length : 0,
  });
}

// Support both Node.js (unit tests) and browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolvePackageImage,
    debugPackageImage,
    isPlaceholderImage,
    PLACEHOLDER_PACKAGE_IMAGE,
  };
} else if (typeof window !== 'undefined') {
  window.resolvePackageImage = resolvePackageImage;
  window.debugPackageImage = debugPackageImage;
  window.isPlaceholderImage = isPlaceholderImage;
  window.PLACEHOLDER_PACKAGE_IMAGE = PLACEHOLDER_PACKAGE_IMAGE;
}
