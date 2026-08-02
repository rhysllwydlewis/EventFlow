/**
 * Ranked supplier-search adapter.
 *
 * Preserves the established search service for filtering, geocoding, facets and
 * package projection, then applies the canonical supplier-ranking model across
 * the complete result set before pagination.
 */

'use strict';

const dbUnified = require('../db-unified');
const baseSearchService = require('./searchService');
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

function groupPackages(packages) {
  const grouped = new Map();
  (packages || []).forEach(pkg => {
    if (!pkg?.supplierId || pkg.approved === false) return;
    if (!grouped.has(pkg.supplierId)) grouped.set(pkg.supplierId, []);
    grouped.get(pkg.supplierId).push(pkg);
  });
  return grouped;
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
  if (relevance?.score >= 65) reasons.push('Strong match');
  if (ranking.breakdown.profile.score >= 32) reasons.push('Complete profile');
  if (ranking.breakdown.packages.packageCount > 0) reasons.push('Packages available');
  if (ranking.breakdown.reviews.reviewCount >= 3) reasons.push('Established reviews');
  if (ranking.breakdown.trust.verified) reasons.push('Verified supplier');
  if (ranking.adjustments.tier === 'pro_plus') reasons.push('Pro Plus');
  else if (ranking.adjustments.tier === 'pro') reasons.push('Pro');
  return reasons.slice(0, 3).join(' · ') || 'Supplier match';
}

function priceValue(supplier) {
  const value = String(supplier.startingPrice || supplier.price_display || '').trim();
  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const symbols = value.match(/[£$]/g);
  return symbols ? symbols.length : Number.POSITIVE_INFINITY;
}

function sortResults(results, sortBy, hasDistance) {
  if (sortBy === 'priceAsc' || sortBy === 'priceDesc') {
    const direction = sortBy === 'priceAsc' ? 1 : -1;
    return [...results].sort((a, b) => {
      const difference = (priceValue(a) - priceValue(b)) * direction;
      return (
        difference ||
        (b.qualityScore || 0) - (a.qualityScore || 0) ||
        String(a.id || '').localeCompare(String(b.id || ''))
      );
    });
  }
  return sortRankedSuppliers(results, sortBy, hasDistance);
}

async function searchSuppliers(rawQuery = {}) {
  const startedAt = Date.now();
  const normalized = baseSearchService.normalizeSupplierQuery(rawQuery);
  const [{ results: filteredResults, metadata }, rawSuppliers, packages, users] = await Promise.all(
    [
      collectFilteredSuppliers(rawQuery),
      dbUnified.read('suppliers'),
      dbUnified.read('packages'),
      dbUnified.read('users').catch(() => []),
    ]
  );

  const suppliersById = new Map((rawSuppliers || []).map(supplier => [supplier.id, supplier]));
  const packagesBySupplier = groupPackages(packages);
  const validOwnerIds = users?.length ? new Set(users.map(user => user.id).filter(Boolean)) : null;
  const searchMode = Boolean(normalized.q);

  let ranked = filteredResults
    .map(projected => ({
      projected,
      supplier: { ...(suppliersById.get(projected.id) || {}), ...projected },
    }))
    .filter(({ supplier }) => isPubliclyEligibleSupplier(supplier, validOwnerIds))
    .filter(
      ({ supplier }) =>
        normalized.minRating === undefined || effectiveRating(supplier) >= normalized.minRating
    )
    .map(({ supplier, projected }) => {
      const supplierPackages = packagesBySupplier.get(supplier.id) || [];
      const ranking = calculateSupplierRanking(supplier, supplierPackages, { searchMode });
      const relevance = searchMode
        ? calculateSupplierRelevance(supplier, supplierPackages, normalized)
        : { score: 0 };
      const finalRankingScore = searchMode
        ? calculateFinalSearchScore(ranking, relevance)
        : ranking.finalScore;
      const tier = effectiveSubscriptionTier(supplier);
      return {
        ...projected,
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
        // Public search results are eligible by definition. Omitting the raw
        // approval flag prevents the card from confusing approval with verification.
        approved: undefined,
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
    });

  if (searchMode) ranked = ranked.filter(supplier => supplier.textRelevanceScore > 0);

  const hasDistance = ranked.some(supplier => Number.isFinite(supplier.distanceMiles));
  const appliedSort =
    normalized.sortBy === 'distance' && !hasDistance ? 'relevance' : normalized.sortBy;
  ranked = sortResults(ranked, appliedSort, hasDistance);

  const total = ranked.length;
  const skip = (normalized.page - 1) * normalized.limit;
  const results = ranked.slice(skip, skip + normalized.limit);

  let fallback = null;
  if (total === 0 && normalized.page === 1) {
    const legacy = await baseSearchService.searchSuppliers(rawQuery);
    fallback = legacy.fallback || null;
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
  searchSuppliers,
};
