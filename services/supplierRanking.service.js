/**
 * Canonical supplier quality and relevance ranking.
 *
 * Keeps eligibility, quality, customer relevance and commercial adjustments
 * separate so paid status cannot overpower a substantially better match.
 */

'use strict';

const { isPlaceholderImage, resolvePackageImage } = require('../utils/packageImageUtils');

const RANKING_VERSION = 'supplier-ranking-v1';
const DAY_MS = 86400000;
const PLACEHOLDER_TEXT = new Set([
  'test',
  'testing',
  'coming soon',
  'description',
  'n/a',
  'none',
  'tbc',
  'lorem ipsum',
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
// Returns the value paired with the first threshold the input meets or exceeds
// (tiers must be sorted highest-threshold-first). Avoids nested ternaries.
function atLeast(value, tiers, fallback) {
  for (const [threshold, result] of tiers) {
    if (value >= threshold) {
      return result;
    }
  }
  return fallback;
}
// Returns the value paired with the first threshold the input is within
// (tiers must be sorted lowest-threshold-first). Avoids nested ternaries.
function atMost(value, tiers, fallback) {
  for (const [threshold, result] of tiers) {
    if (value <= threshold) {
      return result;
    }
  }
  return fallback;
}
const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
};
const cleanText = value =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const lowerText = value => cleanText(value).toLowerCase();
const unique = values => [...new Set((values || []).map(cleanText).filter(Boolean))];

function isMeaningfulText(value, minimumLength) {
  const clean = lowerText(value);
  if (clean.length < minimumLength || PLACEHOLDER_TEXT.has(clean)) {
    return false;
  }
  const words = clean.split(/\s+/).filter(Boolean);
  return new Set(words).size >= Math.min(4, Math.max(2, Math.floor(minimumLength / 30)));
}

function isUsableImage(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const clean = value.trim();
  if (!clean || clean.startsWith('data:image/svg+xml')) {
    return false;
  }
  if (typeof isPlaceholderImage === 'function' && isPlaceholderImage(clean)) {
    return false;
  }
  return !/(?:placeholder|default[-_ ]?(?:image|avatar)|package-placeholder)/i.test(clean);
}

function effectiveImages(supplier) {
  const candidates = [
    ...(Array.isArray(supplier.images) ? supplier.images : []),
    ...(Array.isArray(supplier.photosGallery)
      ? supplier.photosGallery.map(photo => (typeof photo === 'string' ? photo : photo?.url))
      : []),
    ...(Array.isArray(supplier.gallery)
      ? supplier.gallery.map(photo => (typeof photo === 'string' ? photo : photo?.url))
      : []),
  ];
  return unique(candidates).filter(isUsableImage);
}

const effectiveRating = supplier => clamp(supplier.averageRating ?? supplier.rating ?? 0, 0, 5);
const effectiveReviewCount = supplier =>
  Math.max(0, Number(supplier.reviewCount ?? supplier.totalReviews ?? 0) || 0);
const effectiveShortDescription = supplier =>
  supplier.description_short || supplier.metaDescription || '';
const effectiveLongDescription = supplier =>
  supplier.description_long || supplier.description || '';
const effectivePriceRange = supplier => supplier.price_display || supplier.priceRange || '';
const effectiveVerified = supplier =>
  supplier.verified === true || supplier.verificationStatus === 'approved';
const effectiveFeatured = supplier =>
  supplier.featured === true || supplier.featuredSupplier === true;

function effectiveSubscriptionTier(supplier) {
  const tier = String(supplier.subscriptionTier || supplier.subscription?.tier || '').toLowerCase();
  if (supplier.isPro === false) {
    return 'free';
  }
  if (['pro_plus', 'pro-plus', 'proplus'].includes(tier)) {
    return 'pro_plus';
  }
  return tier === 'pro' || supplier.isPro === true ? 'pro' : 'free';
}

function isPubliclyEligibleSupplier(supplier, validOwnerIds = null) {
  if (!supplier || supplier.approved !== true || supplier.isTest === true) {
    return false;
  }
  const status = lowerText(supplier.status);
  const verificationStatus = lowerText(supplier.verificationStatus);
  if (
    status === 'suspended' ||
    verificationStatus === 'suspended' ||
    verificationStatus === 'rejected'
  ) {
    return false;
  }
  if (validOwnerIds instanceof Set) {
    return Boolean(supplier.ownerUserId && validOwnerIds.has(String(supplier.ownerUserId)));
  }
  return true;
}

const publicPackages = packages => (packages || []).filter(pkg => pkg && pkg.approved !== false);

function resolvedPackageImage(pkg) {
  const resolved = typeof resolvePackageImage === 'function' ? resolvePackageImage(pkg) : '';
  if (isUsableImage(resolved)) {
    return resolved;
  }
  return [pkg.image, ...(Array.isArray(pkg.images) ? pkg.images : [])].find(isUsableImage) || '';
}

function packageHasPrice(pkg) {
  if (typeof pkg.price === 'number') {
    return Number.isFinite(pkg.price) && pkg.price > 0;
  }
  const value = cleanText(pkg.price || pkg.price_display || pkg.startingPrice);
  return /\d/.test(value) && !/^(?:0|free|contact|quote|poa)$/i.test(value);
}

function calculateProfileQuality(supplier) {
  let score = 0;
  const missing = [];
  const images = effectiveImages(supplier);
  const checks = [
    [cleanText(supplier.name || supplier.businessName), 2, 'missing_name'],
    [cleanText(supplier.category), 2, 'missing_category'],
    [cleanText(supplier.location || supplier.postcode), 2, 'missing_location'],
    [
      [supplier.profilePhotoUrl, supplier.displayAvatarUrl, supplier.avatarUrl, supplier.logo].some(
        isUsableImage
      ),
      6,
      'missing_profile_image',
    ],
    [
      [supplier.coverImage, supplier.bannerImage, supplier.heroImage].some(isUsableImage),
      4,
      'missing_cover_image',
    ],
    [isMeaningfulText(effectiveShortDescription(supplier), 40), 5, 'short_description_too_short'],
    [isMeaningfulText(effectiveLongDescription(supplier), 150), 7, 'long_description_too_short'],
    [unique(supplier.tags).length > 0, 2, 'missing_tags'],
    [unique(supplier.amenities).length > 0, 2, 'missing_amenities'],
    [cleanText(effectivePriceRange(supplier)), 2, 'missing_price_range'],
  ];
  checks.forEach(([passes, points, code]) => {
    if (passes) {
      score += points;
    } else {
      missing.push(code);
    }
  });
  if (images.length >= 4) {
    score += 6;
  } else if (images.length >= 2) {
    score += 4;
  } else if (images.length === 1) {
    score += 2;
  } else {
    missing.push('insufficient_gallery');
  }
  return { score, max: 40, missing, imageCount: images.length };
}

function calculatePackageQuality(packages) {
  const available = publicPackages(packages);
  let score = 0;
  const missing = [];
  if (available.length) {
    score += 6;
  } else {
    missing.push('no_public_packages');
  }
  if (available.length >= 2) {
    score += 2;
  }
  if (available.length >= 3) {
    score += 2;
  }
  if (available.some(pkg => isMeaningfulText(pkg.description || pkg.description_short, 60))) {
    score += 4;
  } else if (available.length) {
    missing.push('package_description_too_short');
  }
  if (available.some(packageHasPrice)) {
    score += 4;
  } else if (available.length) {
    missing.push('package_missing_price');
  }
  if (available.some(pkg => Boolean(resolvedPackageImage(pkg)))) {
    score += 4;
  } else if (available.length) {
    missing.push('package_missing_image');
  }
  if (
    available.some(pkg =>
      [pkg.features, pkg.inclusions, pkg.amenities]
        .filter(Array.isArray)
        .flat()
        .some(value => cleanText(value).length >= 3)
    ) ||
    available.some(pkg => Number(pkg.maxGuests) > 0)
  ) {
    score += 3;
  } else if (available.length) {
    missing.push('package_missing_features');
  }
  return { score, max: 25, missing, packageCount: available.length };
}

function calculateReviewQuality(supplier) {
  const rating = effectiveRating(supplier);
  const reviewCount = effectiveReviewCount(supplier);
  const confidence = reviewCount ? Math.min(1, Math.log1p(reviewCount) / Math.log(11)) : 0;
  const ratingPoints = (rating / 5) * confidence * 15;
  const volumePoints = atLeast(
    reviewCount,
    [
      [10, 5],
      [7, 4],
      [4, 3],
      [2, 2],
      [1, 1],
    ],
    0
  );
  return {
    score: round(ratingPoints + volumePoints),
    max: 20,
    rating: round(rating, 1),
    reviewCount,
    confidenceAdjustedRating: round(rating * confidence, 3),
  };
}

function verificationFlag(container, key) {
  const value = container?.[key];
  return value === true || value?.verified === true || value?.status === 'verified';
}

function calculateTrustQuality(supplier) {
  const verifications = supplier.verifications || supplier.verification || {};
  const verified = effectiveVerified(supplier);
  const business = verificationFlag(verifications, 'business');
  const email = verificationFlag(verifications, 'email');
  const phone = verificationFlag(verifications, 'phone');
  const score = (verified ? 5 : 0) + (business ? 3 : 0) + (email ? 1 : 0) + (phone ? 1 : 0);
  return {
    score,
    max: 10,
    verified,
    business,
    email,
    phone,
    missing: [
      ...(!verified ? ['not_verified'] : []),
      ...(!business ? ['business_not_verified'] : []),
    ],
  };
}

function calculateFreshnessQuality(supplier, packages, now = new Date()) {
  const timestamps = [supplier.updatedAt, supplier.publishedAt, supplier.createdAt];
  publicPackages(packages).forEach(pkg => timestamps.push(pkg.updatedAt, pkg.createdAt));
  const latest = timestamps
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite)
    .reduce((maximum, value) => Math.max(maximum, value), 0);
  if (!latest) {
    return { score: 0, max: 5, ageDays: null, missing: ['stale_profile'] };
  }
  const ageDays = Math.max(0, (now.getTime() - latest) / DAY_MS);
  const score = atMost(
    ageDays,
    [
      [30, 5],
      [90, 3],
      [180, 1],
    ],
    0
  );
  return { score, max: 5, ageDays: Math.floor(ageDays), missing: score ? [] : ['stale_profile'] };
}

function calculateAdjustments(supplier, qualityScore, packageCount, searchMode, now) {
  const tier = effectiveSubscriptionTier(supplier);
  const subscription = { pro_plus: 5, pro: 3 }[tier] || 0;
  const featured = effectiveFeatured(supplier) ? 3 : 0;
  let newSupplier = 0;
  const createdAt = new Date(supplier.createdAt).getTime();
  if (Number.isFinite(createdAt) && qualityScore >= 55 && packageCount > 0) {
    const ageDays = Math.max(0, (now.getTime() - createdAt) / DAY_MS);
    newSupplier = atMost(
      ageDays,
      [
        [30, 3],
        [45, 2],
        [60, 1],
      ],
      0
    );
  }
  const cap = searchMode ? 5 : 8;
  return {
    tier,
    subscription,
    featured,
    newSupplier,
    cap,
    total: Math.min(cap, subscription + featured + newSupplier),
  };
}

const getQualityBand = score =>
  atLeast(
    score,
    [
      [80, 'excellent'],
      [65, 'strong'],
      [50, 'fair'],
      [30, 'weak'],
    ],
    'poor'
  );

function calculateSupplierRanking(supplier, packages = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const profile = calculateProfileQuality(supplier);
  const packageQuality = calculatePackageQuality(packages);
  const reviews = calculateReviewQuality(supplier);
  const trust = calculateTrustQuality(supplier);
  const freshness = calculateFreshnessQuality(supplier, packages, now);
  const qualityScore = round(
    profile.score + packageQuality.score + reviews.score + trust.score + freshness.score
  );
  const adjustments = calculateAdjustments(
    supplier,
    qualityScore,
    packageQuality.packageCount,
    options.searchMode === true,
    now
  );
  return {
    version: RANKING_VERSION,
    qualityScore,
    finalScore: round(clamp(qualityScore + adjustments.total, 0, 100)),
    qualityBand: getQualityBand(qualityScore),
    breakdown: { profile, packages: packageQuality, reviews, trust, freshness },
    adjustments,
    missing: unique([
      ...profile.missing,
      ...packageQuality.missing,
      ...trust.missing,
      ...freshness.missing,
    ]),
  };
}

const queryTokens = value => [
  ...new Set(
    lowerText(value)
      .split(/[^a-z0-9]+/)
      .filter(word => word.length > 1)
  ),
];
function fieldMatch(value, tokens, phrase) {
  const haystack = lowerText(value);
  if (!haystack || !tokens.length) {
    return 0;
  }
  let score = tokens.filter(token => haystack.includes(token)).length / tokens.length;
  if (haystack === phrase) {
    score = 1;
  } else if (haystack.startsWith(phrase)) {
    score = Math.max(score, 0.9);
  } else if (haystack.includes(phrase)) {
    score = Math.max(score, 0.8);
  }
  return clamp(score, 0, 1);
}
function packageMatch(packages, tokens, phrase) {
  return publicPackages(packages).reduce(
    (best, pkg) =>
      Math.max(
        best,
        fieldMatch(pkg.title || pkg.name, tokens, phrase),
        fieldMatch(pkg.description || pkg.description_short, tokens, phrase) * 0.8
      ),
    0
  );
}

function calculateSupplierRelevance(supplier, packages, query = {}) {
  const phrase = lowerText(query.q);
  const tokens = queryTokens(query.q);
  if (!tokens.length) {
    return { score: 0 };
  }
  const name = Math.max(
    fieldMatch(supplier.name, tokens, phrase),
    fieldMatch(supplier.businessName, tokens, phrase)
  );
  const category = fieldMatch(supplier.category, tokens, phrase);
  const descriptions = Math.max(
    fieldMatch(effectiveShortDescription(supplier), tokens, phrase),
    fieldMatch(effectiveLongDescription(supplier), tokens, phrase) * 0.85,
    (supplier.tags || []).reduce((best, tag) => Math.max(best, fieldMatch(tag, tokens, phrase)), 0)
  );
  const location = fieldMatch(
    `${supplier.location || ''} ${supplier.postcode || ''}`,
    tokens,
    phrase
  );
  const packagesScore = packageMatch(packages, tokens, phrase);
  return {
    score: round(
      clamp(
        name * 25 + category * 20 + location * 20 + descriptions * 15 + packagesScore * 20,
        0,
        100
      )
    ),
    components: { name, category, location, descriptions, packages: packagesScore },
  };
}

const calculateFinalSearchScore = (ranking, relevance) =>
  round(
    clamp(relevance.score * 0.7 + ranking.qualityScore * 0.3 + ranking.adjustments.total, 0, 100)
  );

const compareByRating = (a, b) =>
  (b.reviewConfidenceAdjustedRating || 0) - (a.reviewConfidenceAdjustedRating || 0) ||
  (b.reviewCount || 0) - (a.reviewCount || 0);
const compareByReviews = (a, b) => (b.reviewCount || 0) - (a.reviewCount || 0);
const compareByName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
const compareByNewest = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
const compareByDistance = (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
const compareByRanking = (a, b) => (b.finalRankingScore || 0) - (a.finalRankingScore || 0);
const rankedSupplierComparators = {
  rating: compareByRating,
  reviews: compareByReviews,
  name: compareByName,
  newest: compareByNewest,
};
const rankedSupplierTieBreak = (a, b) =>
  (b.qualityScore || 0) - (a.qualityScore || 0) ||
  String(a.id || '').localeCompare(String(b.id || ''));

function sortRankedSuppliers(results, sortBy, hasDistance) {
  const compare =
    sortBy === 'distance' && hasDistance
      ? compareByDistance
      : rankedSupplierComparators[sortBy] || compareByRanking;
  return [...results].sort((a, b) => compare(a, b) || rankedSupplierTieBreak(a, b));
}

module.exports = {
  RANKING_VERSION,
  isMeaningfulText,
  isUsableImage,
  effectiveImages,
  effectiveRating,
  effectiveReviewCount,
  effectiveVerified,
  effectiveFeatured,
  effectiveSubscriptionTier,
  isPubliclyEligibleSupplier,
  calculateProfileQuality,
  calculatePackageQuality,
  calculateReviewQuality,
  calculateTrustQuality,
  calculateFreshnessQuality,
  calculateSupplierRanking,
  calculateSupplierRelevance,
  calculateFinalSearchScore,
  getQualityBand,
  sortRankedSuppliers,
};
