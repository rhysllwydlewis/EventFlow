/**
 * Ranked supplier-search adapter.
 *
 * Preserves the established search service for filtering, geocoding, facets and
 * package projection, then applies the canonical supplier-ranking model across
 * the complete result set before pagination.
 */

'use strict';

const dbUnified = require('../db-unified');
const catalogCache = require('./catalogCache');
const baseSearchService = require('./searchService');
const logger = require('../utils/logger');
const {
  RANKING_VERSION,
  effectiveImages,
  effectiveRating,
  effectiveReviewCount,
  effectiveVerified,
  effectiveFeatured,
  effectiveSubscriptionTier,
  isPubliclyEligibleSupplier,
  calculateSupplierRanking,
  calculateSupplierRelevance,
  calculateFinalSearchScore,
  sortRankedSuppliers,
} = require('./supplierRanking.service');

const MAX_BATCH_SIZE = 100;

async function getCachedCollection(cacheKey, collectionName) {
  const cached = await catalogCache.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  const records = (await dbUnified.read(collectionName)) || [];
  await catalogCache.set(cacheKey, records);
  return records;
}

function groupPackages(packages) {
  const grouped = new Map();
  (packages || []).forEach(pkg => {
    if (!pkg?.supplierId || pkg.approved === false) {
      return;
    }
    const key = String(pkg.supplierId);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(pkg);
  });
  return grouped;
}

function indexSuppliers(suppliers) {
  const indexed = new Map();
  (suppliers || []).forEach(supplier => {
    [supplier?.id, supplier?._id].filter(Boolean).forEach(id => indexed.set(String(id), supplier));
  });
  return indexed;
}

async function getValidOwnerIds() {
  try {
    const users = (await dbUnified.read('users')) || [];
    return new Set(
      users
        .flatMap(user => [user?.id, user?._id])
        .filter(Boolean)
        .map(id => String(id))
    );
  } catch (error) {
    // Owner validation must not take the public marketplace offline when the
    // user collection cannot be read. Eligibility remains strict otherwise.
    logger.error('Failed to load valid owner IDs for ranked supplier search:', error);
    return null;
  }
}

async function collectFilteredSuppliers(rawQuery) {
  const query = {
    ...rawQuery,
    q: undefined,
    minRating: undefined,
    sortBy: 'relevance',
    page: 1,
    limit: MAX_BATCH_SIZE,
  };
  const firstPage = await baseSearchService.searchSuppliers(query);
  const results = [...firstPage.results];
  const pages = Math.max(1, Number(firstPage.pagination?.pages) || 1);
  for (let page = 2; page <= pages; page += 1) {
    const next = await baseSearchService.searchSuppliers({ ...query, page });
    results.push(...next.results);
  }
  return { results, metadata: firstPage };
}

function effectiveDescriptions(supplier) {
  return {
    description_short: supplier.description_short || supplier.metaDescription || '',
    description_long: supplier.description_long || supplier.description || '',
  };
}

const effectivePrice = supplier => supplier.price_display || supplier.priceRange || '';

function rankingReason(ranking, relevance) {
  const reasons = [];
  if (relevance?.score >= 65) {
    reasons.push('Strong match');
  }
  if (ranking.breakdown.profile.score >= 32) {
    reasons.push('Complete profile');
  }
  if (ranking.breakdown.packages.packageCount > 0) {
    reasons.push('Packages available');
  }
  if (ranking.breakdown.reviews.reviewCount >= 3) {
    reasons.push('Established reviews');
  }
  if (ranking.breakdown.trust.verified) {
    reasons.push('Verified supplier');
  }
  if (ranking.adjustments.tier === 'pro_plus') {
    reasons.push('Pro Plus');
  } else if (ranking.adjustments.tier === 'pro') {
    reasons.push('Pro');
  }
  return reasons.slice(0, 3).join(' · ') || 'Supplier match';
}

function priceValue(supplier) {
  const value = String(supplier.startingPrice || supplier.price_display || '').trim();
  if (!value) {
    return null;
  }

  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const symbols = value.match(/[£$]/g);
  return symbols ? symbols.length : null;
}

function sortPriceResults(results, sortBy) {
  const direction = sortBy === 'priceAsc' ? 1 : -1;
  return [...results].sort((a, b) => {
    const aPrice = priceValue(a);
    const bPrice = priceValue(b);
    const aMissing = aPrice === null;
    const bMissing = bPrice === null;

    if (aMissing !== bMissing) {
      return aMissing ? 1 : -1;
    }

    const difference = aMissing ? 0 : (aPrice - bPrice) * direction;
    return (
      difference ||
      (b.qualityScore || 0) - (a.qualityScore || 0) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );
  });
}

function sortResults(results, sortBy, hasDistance) {
  if (sortBy === 'priceAsc' || sortBy === 'priceDesc') {
    return sortPriceResults(results, sortBy);
  }
  return sortRankedSuppliers(results, sortBy, hasDistance);
}

function projectRankedSupplier(supplier) {
  const safe = baseSearchService.projectPublicSupplierFields(supplier);
  return {
    ...safe,
    ...effectiveDescriptions(supplier),
    images: effectiveImages(supplier),
    price_display: effectivePrice(supplier),
    rating: supplier.rating,
    averageRating: supplier.averageRating,
    reviewCount: supplier.reviewCount,
    verified: supplier.verified,
    featured: supplier.featured,
    featuredSupplier: supplier.featuredSupplier,
    subscriptionTier: supplier.subscriptionTier,
    isPro: supplier.isPro,
    // Public search results are eligible by definition. Omitting the raw
    // approval flag prevents the card from confusing approval with verification.
    approved: undefined,
    ...(Number.isFinite(supplier.distanceMiles) ? { distanceMiles: supplier.distanceMiles } : {}),
    ...(Array.isArray(supplier.topPackages) ? { topPackages: supplier.topPackages } : {}),
    ...(supplier.match ? { match: supplier.match } : {}),
    qualityScore: supplier.qualityScore,
    finalRankingScore: supplier.finalRankingScore,
    relevanceScore: supplier.relevanceScore,
    textRelevanceScore: supplier.textRelevanceScore,
    qualityBand: supplier.qualityBand,
    rankingVersion: supplier.rankingVersion,
    rankingReason: supplier.rankingReason,
    reviewConfidenceAdjustedRating: supplier.reviewConfidenceAdjustedRating,
    rankingImprovementCodes: supplier.rankingImprovementCodes,
  };
}

function rankSupplier(supplier, supplierPackages, normalized, searchMode) {
  const ranking = calculateSupplierRanking(supplier, supplierPackages, { searchMode });
  const relevance = searchMode
    ? calculateSupplierRelevance(supplier, supplierPackages, normalized)
    : { score: 0 };
  const finalRankingScore = searchMode
    ? calculateFinalSearchScore(ranking, relevance)
    : ranking.finalScore;
  const tier = effectiveSubscriptionTier(supplier);

  return {
    ...supplier,
    ...effectiveDescriptions(supplier),
    images: effectiveImages(supplier),
    price_display: effectivePrice(supplier),
    rating: effectiveRating(supplier),
    averageRating: effectiveRating(supplier),
    reviewCount: effectiveReviewCount(supplier),
    verified: effectiveVerified(supplier),
    featured: effectiveFeatured(supplier),
    featuredSupplier: effectiveFeatured(supplier),
    subscriptionTier: tier,
    isPro: tier !== 'free',
    qualityScore: ranking.qualityScore,
    finalRankingScore,
    relevanceScore: finalRankingScore,
    textRelevanceScore: relevance.score,
    qualityBand: ranking.qualityBand,
    rankingVersion: RANKING_VERSION,
    rankingReason: rankingReason(ranking, relevance),
    reviewConfidenceAdjustedRating: ranking.breakdown.reviews.confidenceAdjustedRating,
    rankingImprovementCodes: ranking.missing,
  };
}

function buildSafeFallback(fallback, suppliersById, packagesBySupplier, validOwnerIds, normalized) {
  if (!fallback || !Array.isArray(fallback.suggestions)) {
    return null;
  }

  const suggestions = fallback.suggestions
    .map(projected => {
      const raw = suppliersById.get(String(projected.id)) || {};
      return { ...raw, ...projected };
    })
    .filter(supplier => isPubliclyEligibleSupplier(supplier, validOwnerIds))
    .map(supplier =>
      projectRankedSupplier(
        rankSupplier(
          supplier,
          packagesBySupplier.get(String(supplier.id || supplier._id)) || [],
          normalized,
          false
        )
      )
    );

  return suggestions.length ? { ...fallback, suggestions } : null;
}

async function searchSuppliers(rawQuery = {}) {
  const startedAt = Date.now();
  const normalized = baseSearchService.normalizeSupplierQuery(rawQuery);

  // Run the established search first so it owns cache population and filter
  // semantics. Reading the same cache afterwards avoids bypassing stale-until-
  // invalidated behaviour and keeps search results internally consistent.
  const { results: filteredResults, metadata } = await collectFilteredSuppliers(rawQuery);
  const [rawSuppliers, packages, validOwnerIds] = await Promise.all([
    getCachedCollection('suppliers:all', 'suppliers'),
    getCachedCollection('packages:all', 'packages'),
    getValidOwnerIds(),
  ]);

  const suppliersById = indexSuppliers(rawSuppliers);
  const packagesBySupplier = groupPackages(packages);
  const searchMode = Boolean(normalized.q);

  let ranked = filteredResults
    .map(projected => {
      const raw = suppliersById.get(String(projected.id || projected._id)) || {};
      return { ...raw, ...projected };
    })
    .filter(supplier => isPubliclyEligibleSupplier(supplier, validOwnerIds))
    .filter(
      supplier =>
        normalized.minRating === undefined || effectiveRating(supplier) >= normalized.minRating
    )
    .map(supplier =>
      rankSupplier(
        supplier,
        packagesBySupplier.get(String(supplier.id || supplier._id)) || [],
        normalized,
        searchMode
      )
    );

  if (searchMode) {
    ranked = ranked.filter(supplier => supplier.textRelevanceScore > 0);
  }

  const hasDistance = ranked.some(supplier => Number.isFinite(supplier.distanceMiles));
  const appliedSort =
    normalized.sortBy === 'distance' && !hasDistance ? 'relevance' : normalized.sortBy;
  ranked = sortResults(ranked, appliedSort, hasDistance);

  const total = ranked.length;
  const skip = (normalized.page - 1) * normalized.limit;
  const results = ranked
    .slice(skip, skip + normalized.limit)
    .map(supplier => projectRankedSupplier(supplier));

  let fallback = null;
  if (total === 0 && normalized.page === 1) {
    const legacy = await baseSearchService.searchSuppliers(rawQuery);
    fallback = buildSafeFallback(
      legacy.fallback,
      suppliersById,
      packagesBySupplier,
      validOwnerIds,
      normalized
    );
  }

  return {
    results,
    pagination: {
      total,
      page: normalized.page,
      limit: normalized.limit,
      pages: Math.ceil(total / normalized.limit),
    },
    appliedSort,
    facets: metadata.facets,
    rankingVersion: RANKING_VERSION,
    ...(fallback ? { fallback } : {}),
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  ...baseSearchService,
  RANKING_VERSION,
  searchSuppliers,
  getCachedCollection,
  projectRankedSupplier,
  sortPriceResults,
};
