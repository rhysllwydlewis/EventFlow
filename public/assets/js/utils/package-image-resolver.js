/**
 * Package Image Resolver
 *
 * Shared utility for picking the best available image URL for a package card.
 * Used by Carousel, PackageList, and the homepage fallback renderer so that
 * every card uses the same "prefer real image over placeholder" strategy.
 *
 * Resolution order (O(gallery.length) worst case per call):
 *   1. pkg.image  — if present and not a known placeholder, use it (O(1)).
 *   2. pkg.gallery — first non-placeholder entry wins; supports both string
 *                    items and objects with url / src / path / image fields.
 *   3. Canonical placeholder path — used as the final fallback.
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
const KNOWN_PLACEHOLDERS = new Set(['/assets/images/placeholders/package-event.svg']);

/**
 * Return true when a URL is a known placeholder (or absent).
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') {
    return true;
  }
  return KNOWN_PLACEHOLDERS.has(url);
}

/**
 * Resolve the best available image URL for a package.
 *
 * @param {Object} pkg            - Package data object
 * @param {string}  [pkg.image]   - Primary image URL
 * @param {Array}   [pkg.gallery] - Gallery array (strings or objects)
 * @returns {string} Resolved image URL (always a non-empty string)
 */
function resolvePackageImage(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return PLACEHOLDER_PACKAGE_IMAGE;
  }

  // 1. Primary image field — use if present and not a known placeholder
  if (pkg.image && !isPlaceholderImage(pkg.image)) {
    return pkg.image;
  }

  // 2. Walk the gallery array for the first real image
  if (Array.isArray(pkg.gallery) && pkg.gallery.length > 0) {
    for (const img of pkg.gallery) {
      const url =
        typeof img === 'string'
          ? img
          : img.url || img.src || img.path || img.image || img.originalUrl || img.thumbnail;
      if (url && !isPlaceholderImage(url)) {
        return url;
      }
    }
  }

  // 3. Fall back to the canonical placeholder
  return PLACEHOLDER_PACKAGE_IMAGE;
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
