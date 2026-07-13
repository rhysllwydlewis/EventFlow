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
 *      supports the same field order as the server resolver.
 *   3. pkg.images — legacy plural image array used by package.service.js.
 *   4. Canonical placeholder path — used as the final fallback.
 */

/** Canonical placeholder shown when a package has no uploaded photo. */
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

function sanitizeCandidateValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasHtmlOrScriptPayload(value) {
  return /<\s*\/?\s*(script|img|svg|iframe|object|embed|html|body|video|source|a)\b/i.test(value);
}

function isPackagePlaceholderPath(pathname) {
  return /^\/assets\/images\/placeholders\/.*package.*\.(svg|png|jpe?g|webp)$/i.test(
    String(pathname || '')
  );
}

function isKnownPlaceholderPath(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value, 'https://event-flow.local');
    return KNOWN_PLACEHOLDERS.has(parsed.pathname) || isPackagePlaceholderPath(parsed.pathname);
  } catch (_err) {
    const pathname = value.split(/[?#]/)[0];
    return KNOWN_PLACEHOLDERS.has(pathname) || isPackagePlaceholderPath(pathname);
  }
}

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
 * Return true when a URL is a known placeholder (or absent/unusable).
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isPlaceholderImage(url) {
  return !classifyPackageImageCandidate(url).usable;
}

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
  const chosen = getBestPackageImageCandidate(pkg);
  return chosen ? chosen.value : PLACEHOLDER_PACKAGE_IMAGE;
}

/**
 * Log image resolution details for a package when debug mode is active.
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

  const chosen = getBestPackageImageCandidate(pkg);
  // eslint-disable-next-line no-console
  console.debug('[PackageImage]', {
    slug: pkg.slug || pkg.id || '(unknown)',
    chosenUrl,
    chosenImageSource: chosen ? chosen.source : 'fallback.placeholder',
    resolverCandidates: listPackageImageCandidates(pkg),
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
    extractGalleryItemUrl,
    listPackageImageCandidates,
    getBestPackageImageCandidate,
    classifyPackageImageCandidate,
    PACKAGE_IMAGE_URL_FIELDS,
    PLACEHOLDER_PACKAGE_IMAGE,
  };
} else if (typeof window !== 'undefined') {
  window.resolvePackageImage = resolvePackageImage;
  window.debugPackageImage = debugPackageImage;
  window.isPlaceholderImage = isPlaceholderImage;
  window.extractPackageGalleryItemUrl = extractGalleryItemUrl;
  window.listPackageImageCandidates = listPackageImageCandidates;
  window.getBestPackageImageCandidate = getBestPackageImageCandidate;
  window.PLACEHOLDER_PACKAGE_IMAGE = PLACEHOLDER_PACKAGE_IMAGE;
}
