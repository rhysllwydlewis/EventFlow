'use strict';

const { PLACEHOLDER_PACKAGE_IMAGE } = require('../utils/constants');

const ENDPOINT_META = 'supplier-profile-package-cards-v2';

const KNOWN_PLACEHOLDERS = new Set([
  PLACEHOLDER_PACKAGE_IMAGE,
  '/assets/images/placeholders/package.svg',
  '/assets/images/package-placeholder.svg',
  '/assets/images/placeholder-package.jpg',
  'placeholder',
  'null',
  'undefined',
]);

const ROOT_PRIORITY_FIELDS = Object.freeze(['image', 'imageUrl']);
const OTHER_ROOT_FIELDS = Object.freeze([
  'photoUrl',
  'coverImage',
  'mainImage',
  'thumbnail',
  'original',
  'optimized',
  'large',
  'cdnUrl',
  'secureUrl',
  'originalUrl',
]);
const ARRAY_CARD_FIELDS = Object.freeze([
  'url',
  'optimized',
  'large',
  'original',
  'imageUrl',
  'photoUrl',
]);
const ARRAY_OTHER_FIELDS = Object.freeze([
  'src',
  'path',
  'image',
  'coverImage',
  'mainImage',
  'thumbnail',
  'originalUrl',
  'secureUrl',
  'cdnUrl',
]);
const IMAGE_OBJECT_FIELDS = Object.freeze([...ARRAY_CARD_FIELDS, ...ARRAY_OTHER_FIELDS]);

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeDuplicateKey(pkg) {
  return slugify(pkg && (pkg.title || pkg.name || pkg.slug || pkg.id));
}

function previewValue(value) {
  if (typeof value !== 'string') {
    return value === null || value === undefined ? null : String(value).slice(0, 160);
  }
  const trimmed = value.trim();
  if (/^data:image\//i.test(trimmed)) {
    const mime = trimmed.match(/^data:([^;,]+)/i)?.[1] || 'image/*';
    return `data:${mime} length=${trimmed.length}`;
  }
  return trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
}

function isKnownPlaceholder(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (KNOWN_PLACEHOLDERS.has(lower) || KNOWN_PLACEHOLDERS.has(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed, 'https://event-flow.local');
    const pathname = parsed.pathname;
    return (
      KNOWN_PLACEHOLDERS.has(pathname) ||
      KNOWN_PLACEHOLDERS.has(pathname.toLowerCase()) ||
      isPackagePlaceholderPath(pathname)
    );
  } catch (_err) {
    const pathname = trimmed.split(/[?#]/)[0];
    return KNOWN_PLACEHOLDERS.has(pathname) || isPackagePlaceholderPath(pathname);
  }
}

function isPackagePlaceholderPath(pathname) {
  return /^\/assets\/images\/placeholders\/.*package.*\.(svg|png|jpe?g|webp)$/i.test(
    String(pathname || '')
  );
}

function classifyImageUrl(value) {
  if (typeof value !== 'string') {
    return { value: '', usable: false, rejectedReason: 'non-string' };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: '', usable: false, rejectedReason: 'empty' };
  }
  if (isKnownPlaceholder(trimmed)) {
    return { value: trimmed, usable: false, rejectedReason: 'placeholder' };
  }
  if (/^data:image\//i.test(trimmed)) {
    return { value: trimmed, usable: false, rejectedReason: 'data-uri-public-card' };
  }
  if (/^(javascript|vbscript|file|blob):/i.test(trimmed)) {
    return { value: trimmed, usable: false, rejectedReason: 'unsafe-protocol' };
  }
  if (/^data:/i.test(trimmed)) {
    return { value: trimmed, usable: false, rejectedReason: 'data-uri-public-card' };
  }
  if (
    /[<>]/.test(trimmed) ||
    /<\s*\/?\s*(script|img|svg|iframe|object|embed|html|body)\b/i.test(trimmed)
  ) {
    return { value: trimmed, usable: false, rejectedReason: 'html-payload' };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { value: trimmed, usable: true, rejectedReason: null };
  }
  if (/^\/\//.test(trimmed)) {
    return { value: trimmed, usable: false, rejectedReason: 'protocol-relative-url' };
  }
  const safeRelativePrefixes = ['/api/photos/', '/api/v1/photos/', '/uploads/', '/assets/images/'];
  if (trimmed.startsWith('/')) {
    if (safeRelativePrefixes.some(prefix => trimmed.startsWith(prefix))) {
      return { value: trimmed, usable: true, rejectedReason: null };
    }
    if (trimmed.startsWith('/admin/') || trimmed.startsWith('/api/private/')) {
      return { value: trimmed, usable: false, rejectedReason: 'private-path' };
    }
    return { value: trimmed, usable: false, rejectedReason: 'unknown-relative-path' };
  }
  return { value: trimmed, usable: false, rejectedReason: 'unknown-url-shape' };
}

function addCandidate(candidates, source, value) {
  const classified = classifyImageUrl(value);
  candidates.push({
    source,
    value: classified.value,
    valuePreview: previewValue(classified.value || value),
    usable: classified.usable,
    rejectedReason: classified.rejectedReason,
  });
}

function addImageValueCandidates(candidates, source, value, fields = IMAGE_OBJECT_FIELDS) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    let foundImageField = false;
    fields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        foundImageField = true;
        addCandidate(candidates, `${source}.${field}`, value[field]);
      }
    });
    if (!foundImageField) {
      candidates.push({
        source,
        value: '',
        valuePreview: `object keys=${Object.keys(value).slice(0, 8).join(',')}`,
        usable: false,
        rejectedReason: 'object-without-url-field',
      });
    }
    return;
  }
  addCandidate(candidates, source, value);
}

function addArrayCandidates(candidates, pkg, arrayField, fields) {
  const collection = pkg && pkg[arrayField];
  if (!Array.isArray(collection)) {
    return;
  }
  collection.forEach((entry, index) => {
    if (typeof entry === 'string') {
      addCandidate(candidates, `pkg.${arrayField}[${index}]`, entry);
      return;
    }
    if (!entry || typeof entry !== 'object') {
      addCandidate(candidates, `pkg.${arrayField}[${index}]`, entry);
      return;
    }
    fields.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(entry, field)) {
        addCandidate(candidates, `pkg.${arrayField}[${index}].${field}`, entry[field]);
      }
    });
  });
}

function listSupplierProfilePackageImageCandidates(pkg) {
  const candidates = [];
  if (!pkg || typeof pkg !== 'object') {
    addCandidate(candidates, 'pkg', null);
    return candidates;
  }

  ROOT_PRIORITY_FIELDS.forEach(field =>
    addImageValueCandidates(candidates, `pkg.${field}`, pkg[field])
  );

  // Prefer card-sized gallery/media/photos variants before thumbnails and before legacy images[].
  ['gallery', 'media', 'photos'].forEach(arrayField => {
    ARRAY_CARD_FIELDS.forEach(field => addArrayCandidates(candidates, pkg, arrayField, [field]));
  });

  // Legacy images[] is still considered, but only after richer gallery/media/photos sources.
  ['images'].forEach(arrayField => {
    ARRAY_CARD_FIELDS.concat(ARRAY_OTHER_FIELDS).forEach(field => {
      addArrayCandidates(candidates, pkg, arrayField, [field]);
    });
  });

  OTHER_ROOT_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(pkg, field)) {
      addImageValueCandidates(candidates, `pkg.${field}`, pkg[field]);
    }
  });

  ['gallery', 'media', 'photos'].forEach(arrayField => {
    ARRAY_OTHER_FIELDS.forEach(field => addArrayCandidates(candidates, pkg, arrayField, [field]));
  });

  return candidates;
}

function resolveSupplierProfilePackageImage(pkg, options = {}) {
  const candidates = listSupplierProfilePackageImageCandidates(pkg);
  const chosen = candidates.find(candidate => candidate.usable);
  const imageUrl = chosen ? chosen.value : PLACEHOLDER_PACKAGE_IMAGE;
  const result = {
    imageUrl,
    imageSource: chosen ? chosen.source.replace(/^pkg\./, '') : 'placeholder',
    candidateCount: candidates.length,
  };
  if (options.debug) {
    result.candidates = candidates.map(candidate => ({
      source: candidate.source.replace(/^pkg\./, ''),
      valuePreview: candidate.valuePreview,
      usable: candidate.usable,
      rejectedReason: candidate.rejectedReason,
    }));
    result.rejectedCandidates = result.candidates.filter(candidate => !candidate.usable);
  }
  return result;
}

function rawFieldSummary(pkg) {
  return {
    hasImage: Boolean(pkg && pkg.image),
    hasGallery: Array.isArray(pkg && pkg.gallery),
    galleryLength: Array.isArray(pkg && pkg.gallery) ? pkg.gallery.length : 0,
    hasImages: Array.isArray(pkg && pkg.images),
    imagesLength: Array.isArray(pkg && pkg.images) ? pkg.images.length : 0,
    hasMedia: Array.isArray(pkg && pkg.media),
    mediaLength: Array.isArray(pkg && pkg.media) ? pkg.media.length : 0,
    hasPhotos: Array.isArray(pkg && pkg.photos),
    photosLength: Array.isArray(pkg && pkg.photos) ? pkg.photos.length : 0,
  };
}

function buildDuplicateIndex(packages) {
  const index = new Map();
  (packages || []).forEach(pkg => {
    const key = normalizeDuplicateKey(pkg);
    if (!key) {
      return;
    }
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(pkg);
  });
  return index;
}

function formatPriceDisplay(pkg) {
  if (pkg && typeof pkg.priceDisplay === 'string' && pkg.priceDisplay.trim()) {
    return pkg.priceDisplay.trim();
  }
  const raw = pkg && (pkg.priceFrom ?? pkg.price ?? pkg.basePrice ?? pkg.startingPrice);
  if (raw === null || raw === undefined || raw === '') {
    return '';
  }
  const numeric = Number(raw);
  const amount = Number.isFinite(numeric) ? numeric.toLocaleString('en-GB') : String(raw).trim();
  const prefix = pkg.pricePrefix || (pkg.priceFrom || pkg.startingPrice ? 'From ' : '');
  const suffix = pkg.priceSuffix || (pkg.priceFrom || pkg.startingPrice ? '+' : '');
  return `${prefix}£${amount}${suffix}`;
}

function toSupplierProfilePackageCard(pkg, options = {}) {
  const image = resolveSupplierProfilePackageImage(pkg, { debug: options.debug });
  const id = String(pkg.id || pkg._id || '');
  const slug = String(pkg.slug || slugify(pkg.title || pkg.name || id));
  const title = String(pkg.title || pkg.name || 'Untitled package');
  const card = {
    id,
    slug,
    supplierId: String(pkg.supplierId || pkg.supplier_id || ''),
    title,
    description: String(pkg.description || pkg.shortDescription || pkg.summary || ''),
    priceDisplay: formatPriceDisplay(pkg),
    imageUrl: image.imageUrl,
    imageAlt: String(pkg.imageAlt || `${title} package image`),
    detailUrl: slug
      ? `/package/${encodeURIComponent(slug)}`
      : `/package?id=${encodeURIComponent(id)}`,
  };

  if (options.debug) {
    const duplicateIndex = options.duplicateIndex || new Map();
    const duplicateKey = normalizeDuplicateKey(pkg);
    const duplicates = duplicateIndex.get(duplicateKey) || [pkg];
    card.debug = {
      packageId: id,
      title,
      approved: Boolean(pkg.approved),
      imageUrl: image.imageUrl,
      imageSource: image.imageSource,
      candidateCount: image.candidateCount,
      candidates: image.candidates,
      rejectedCandidates: image.rejectedCandidates,
      duplicateTitleCount: duplicates.length,
      duplicatePackageIds: duplicates.map(item => item.id || item._id).filter(Boolean),
      duplicateApprovedStates: duplicates.map(item => ({
        id: item.id || item._id,
        approved: Boolean(item.approved),
        displayed: String(item.id || item._id || '') === id,
      })),
      rawFieldSummary: rawFieldSummary(pkg),
    };
  }

  return card;
}

async function readSupplierPackages(db, supplierId) {
  if (typeof db.find === 'function') {
    try {
      const bySupplierId = await db.find('packages', { supplierId });
      const byLegacySupplierId = await db.find('packages', { supplier_id: supplierId });
      const merged = new Map();
      [...(bySupplierId || []), ...(byLegacySupplierId || [])].forEach((pkg, index) => {
        const identifier = pkg && (pkg.id || pkg._id);
        const key = identifier ? `id:${identifier}` : `row:${index}`;
        merged.set(key, pkg);
      });
      return Array.from(merged.values()).filter(
        pkg => String(pkg.supplierId || pkg.supplier_id) === String(supplierId)
      );
    } catch (_err) {
      // Some test doubles only implement read().
    }
  }
  const packages = (await db.read('packages')) || [];
  return packages.filter(pkg => String(pkg.supplierId || pkg.supplier_id) === String(supplierId));
}

async function getSupplierProfilePackageCards(supplierId, options = {}) {
  const db = options.db || options.dbUnified;
  if (!db) {
    throw new Error('getSupplierProfilePackageCards requires options.db');
  }
  const supplierPackages = await readSupplierPackages(db, supplierId);
  const includeUnapproved = Boolean(options.includeUnapproved || options.preview);
  const publicPackages = supplierPackages.filter(pkg => includeUnapproved || pkg.approved === true);
  const duplicateIndex = buildDuplicateIndex(supplierPackages);
  const items = publicPackages.map(pkg =>
    toSupplierProfilePackageCard(pkg, {
      debug: options.debug,
      duplicateIndex,
    })
  );
  return {
    supplierId: String(supplierId),
    count: items.length,
    items,
    meta: {
      endpoint: ENDPOINT_META,
      renderer: 'v2',
    },
  };
}

module.exports = {
  ENDPOINT_META,
  PLACEHOLDER_PACKAGE_IMAGE,
  classifyImageUrl,
  getSupplierProfilePackageCards,
  listSupplierProfilePackageImageCandidates,
  resolveSupplierProfilePackageImage,
  toSupplierProfilePackageCard,
  buildDuplicateIndex,
};
