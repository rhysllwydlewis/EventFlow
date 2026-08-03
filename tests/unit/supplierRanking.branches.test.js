/**
 * Branch and alias coverage for the canonical supplier-ranking model.
 */

'use strict';

const {
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
} = require('../../services/supplierRanking.service');

const NOW = new Date('2026-08-01T12:00:00.000Z');
const DAY_MS = 86400000;

function dated(daysAgo) {
  return new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString();
}

function supplier(overrides = {}) {
  return {
    id: 'supplier_1',
    ownerUserId: 'owner_1',
    approved: true,
    status: 'published',
    name: 'South Wales Event Photography',
    category: 'Photography',
    location: 'Cardiff',
    postcode: 'CF10 1AA',
    profilePhotoUrl: '/uploads/profile.jpg',
    coverImage: '/uploads/cover.jpg',
    description_short:
      'Natural event photography for weddings and celebrations throughout South Wales.',
    description_long:
      'We provide natural event photography for weddings, private celebrations and corporate occasions throughout South Wales, with planning support, professional editing and a secure online gallery included with every booking.',
    images: ['/uploads/one.jpg', '/uploads/two.jpg', '/uploads/three.jpg', '/uploads/four.jpg'],
    tags: ['wedding', 'photography'],
    amenities: ['Planning call', 'Online gallery'],
    price_display: '££',
    averageRating: 4.8,
    reviewCount: 10,
    verified: true,
    verifications: {
      business: { verified: true },
      email: { status: 'verified' },
      phone: true,
    },
    createdAt: dated(365),
    updatedAt: dated(10),
    ...overrides,
  };
}

function completePackage(overrides = {}) {
  return {
    id: 'package_1',
    supplierId: 'supplier_1',
    approved: true,
    title: 'Full-day wedding photography',
    description:
      'Full-day wedding photography with planning support, edited photographs and a secure online gallery.',
    price: 1495,
    image: '/uploads/package.jpg',
    features: ['Full-day coverage'],
    updatedAt: dated(5),
    ...overrides,
  };
}

describe('supplierRanking service branches', () => {
  test.each([
    ['', 20, false],
    ['test', 2, false],
    ['coming soon', 5, false],
    ['Repeated repeated repeated repeated repeated', 20, false],
    ['Distinct words describe a useful professional service', 20, true],
  ])('recognises meaningful text %#', (value, length, expected) => {
    expect(isMeaningfulText(value, length)).toBe(expected);
  });

  test('rejects placeholder images and normalises legacy galleries', () => {
    expect(isUsableImage('')).toBe(false);
    expect(isUsableImage('data:image/svg+xml;base64,abc')).toBe(false);
    expect(isUsableImage('/images/default-avatar.png')).toBe(false);
    expect(isUsableImage('/uploads/real-photo.jpg')).toBe(true);

    expect(
      effectiveImages({
        images: ['/uploads/a.jpg', '/uploads/a.jpg'],
        photosGallery: [{ url: '/uploads/b.jpg' }, '/images/placeholder.jpg'],
        gallery: [{ url: '/uploads/c.jpg' }, '/uploads/d.jpg'],
      })
    ).toEqual(['/uploads/a.jpg', '/uploads/b.jpg', '/uploads/c.jpg', '/uploads/d.jpg']);
  });

  test('normalises rating, reviews, trust, featured and subscription aliases', () => {
    expect(effectiveRating({ averageRating: 7 })).toBe(5);
    expect(effectiveRating({ rating: -2 })).toBe(0);
    expect(effectiveReviewCount({ totalReviews: 12 })).toBe(12);
    expect(effectiveReviewCount({ reviewCount: -5 })).toBe(0);
    expect(effectiveVerified({ verificationStatus: 'approved' })).toBe(true);
    expect(effectiveVerified({ verified: false })).toBe(false);
    expect(effectiveFeatured({ featuredSupplier: true })).toBe(true);
    expect(effectiveFeatured({ featured: false })).toBe(false);
    expect(effectiveSubscriptionTier({ subscriptionTier: 'pro-plus' })).toBe('pro_plus');
    expect(effectiveSubscriptionTier({ subscription: { tier: 'proplus' } })).toBe('pro_plus');
    expect(effectiveSubscriptionTier({ isPro: true })).toBe('pro');
    expect(effectiveSubscriptionTier({ subscriptionTier: 'starter' })).toBe('free');
  });

  test('applies every public eligibility gate', () => {
    const owners = new Set(['owner_1']);
    expect(isPubliclyEligibleSupplier(null, owners)).toBe(false);
    expect(isPubliclyEligibleSupplier({ approved: false }, owners)).toBe(false);
    expect(isPubliclyEligibleSupplier({ approved: true, isTest: true }, owners)).toBe(false);
    expect(isPubliclyEligibleSupplier({ approved: true, status: 'suspended' }, owners)).toBe(false);
    expect(
      isPubliclyEligibleSupplier({ approved: true, verificationStatus: 'suspended' }, owners)
    ).toBe(false);
    expect(
      isPubliclyEligibleSupplier({ approved: true, verificationStatus: 'rejected' }, owners)
    ).toBe(false);
    expect(isPubliclyEligibleSupplier({ approved: true, ownerUserId: 'missing' }, owners)).toBe(
      false
    );
    expect(isPubliclyEligibleSupplier({ approved: true, ownerUserId: 'owner_1' }, owners)).toBe(
      true
    );
    expect(isPubliclyEligibleSupplier({ approved: true }, owners)).toBe(true);
  });

  test('scores profile image tiers and reports incomplete fields', () => {
    const empty = calculateProfileQuality({});
    const one = calculateProfileQuality(
      supplier({ images: ['/uploads/one.jpg'], tags: [], amenities: [] })
    );
    const two = calculateProfileQuality(
      supplier({ images: ['/uploads/one.jpg', '/uploads/two.jpg'] })
    );
    const four = calculateProfileQuality(supplier());

    expect(empty.score).toBe(0);
    expect(empty.missing).toContain('missing_name');
    expect(empty.missing).toContain('insufficient_gallery');
    expect(one.imageCount).toBe(1);
    expect(two.score).toBeGreaterThan(one.score);
    expect(four.score).toBe(40);
  });

  test('scores package count, descriptions, prices, images, features and capacity', () => {
    expect(calculatePackageQuality([])).toEqual(
      expect.objectContaining({ score: 0, packageCount: 0, missing: ['no_public_packages'] })
    );

    const incomplete = calculatePackageQuality([
      {
        approved: true,
        title: 'Basic package',
        description: 'Too short',
        price: 'POA',
        image: '/images/package-placeholder.png',
      },
    ]);
    expect(incomplete.score).toBe(6);
    expect(incomplete.missing).toEqual(
      expect.arrayContaining([
        'package_description_too_short',
        'package_missing_price',
        'package_missing_image',
        'package_missing_features',
      ])
    );

    const two = calculatePackageQuality([
      completePackage(),
      completePackage({ id: 'package_2', price: '£500', features: [], maxGuests: 100 }),
      completePackage({ id: 'hidden', approved: false }),
    ]);
    const three = calculatePackageQuality([
      completePackage(),
      completePackage({ id: 'package_2' }),
      completePackage({ id: 'package_3' }),
    ]);

    expect(two.packageCount).toBe(2);
    expect(two.score).toBe(23);
    expect(three.score).toBe(25);
  });

  test.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [4, 3],
    [7, 4],
    [10, 5],
  ])('uses the expected review-volume band for %i reviews', (reviewCount, volumePoints) => {
    const result = calculateReviewQuality({ averageRating: 0, reviewCount });
    expect(result.score).toBe(volumePoints);
  });

  test('scores all trust flag representations', () => {
    const full = calculateTrustQuality(supplier());
    const partial = calculateTrustQuality({
      verified: false,
      verification: {
        business: { status: 'verified' },
        email: { verified: true },
        phone: false,
      },
    });

    expect(full.score).toBe(10);
    expect(full.missing).toEqual([]);
    expect(partial.score).toBe(4);
    expect(partial.missing).toContain('not_verified');
  });

  test.each([
    [null, 0, null],
    [10, 5, 10],
    [60, 3, 60],
    [120, 1, 120],
    [240, 0, 240],
  ])('scores freshness at %s days', (daysAgo, score, ageDays) => {
    const value = daysAgo === null ? {} : { updatedAt: dated(daysAgo) };
    const result = calculateFreshnessQuality(value, [], NOW);
    expect(result.score).toBe(score);
    expect(result.ageDays).toBe(ageDays);
  });

  test('uses package freshness when it is newer than the profile', () => {
    const result = calculateFreshnessQuality(
      { updatedAt: dated(240) },
      [completePackage({ updatedAt: dated(5) })],
      NOW
    );
    expect(result.score).toBe(5);
    expect(result.ageDays).toBe(5);
  });

  test.each([
    [80, 'excellent'],
    [65, 'strong'],
    [50, 'fair'],
    [30, 'weak'],
    [29.99, 'poor'],
  ])('maps %s to the %s quality band', (score, band) => {
    expect(getQualityBand(score)).toBe(band);
  });

  test('applies new-supplier boost bands and browse caps', () => {
    const at20 = calculateSupplierRanking(
      supplier({ createdAt: dated(20), subscriptionTier: 'pro_plus', featured: true }),
      [completePackage()],
      { now: NOW }
    );
    const at40 = calculateSupplierRanking(supplier({ createdAt: dated(40) }), [completePackage()], {
      now: NOW,
    });
    const at55 = calculateSupplierRanking(supplier({ createdAt: dated(55) }), [completePackage()], {
      now: NOW,
    });
    const old = calculateSupplierRanking(supplier({ createdAt: dated(100) }), [completePackage()], {
      now: NOW,
    });

    expect(at20.adjustments.newSupplier).toBe(3);
    expect(at20.adjustments.total).toBe(8);
    expect(at40.adjustments.newSupplier).toBe(2);
    expect(at55.adjustments.newSupplier).toBe(1);
    expect(old.adjustments.newSupplier).toBe(0);
  });

  test('covers exact, prefix, phrase, tag, location and package relevance', () => {
    const exact = calculateSupplierRelevance(supplier({ name: 'Jazz Quartet' }), [], {
      q: 'jazz quartet',
    });
    const prefix = calculateSupplierRelevance(supplier({ name: 'Jazz Quartet Cardiff' }), [], {
      q: 'jazz quartet',
    });
    const phrase = calculateSupplierRelevance(
      supplier({ description_short: 'Book our award winning jazz quartet for your celebration' }),
      [],
      { q: 'jazz quartet' }
    );
    const tag = calculateSupplierRelevance(supplier({ tags: ['acoustic jazz'] }), [], {
      q: 'acoustic jazz',
    });
    const location = calculateSupplierRelevance(supplier(), [], { q: 'cardiff cf10' });
    const packageResult = calculateSupplierRelevance(supplier(), [completePackage()], {
      q: 'full day wedding',
    });

    expect(exact.components.name).toBe(1);
    expect(prefix.components.name).toBeGreaterThanOrEqual(0.9);
    expect(phrase.components.descriptions).toBeGreaterThanOrEqual(0.8);
    expect(tag.components.descriptions).toBeGreaterThan(0);
    expect(location.components.location).toBeGreaterThan(0);
    expect(packageResult.components.packages).toBeGreaterThan(0);
    expect(calculateSupplierRelevance(supplier(), [], { q: 'a' })).toEqual({ score: 0 });
  });

  test('clamps final search scores to the public 0-100 range', () => {
    expect(
      calculateFinalSearchScore({ qualityScore: 100, adjustments: { total: 8 } }, { score: 100 })
    ).toBe(100);
  });

  test('supports every explicit sort with deterministic fallbacks', () => {
    const items = [
      {
        id: 'b',
        name: 'Beta',
        reviewConfidenceAdjustedRating: 4.2,
        reviewCount: 5,
        createdAt: dated(20),
        distanceMiles: 8,
        finalRankingScore: 60,
        qualityScore: 55,
      },
      {
        id: 'a',
        name: 'Alpha',
        reviewConfidenceAdjustedRating: 4.8,
        reviewCount: 2,
        createdAt: dated(5),
        distanceMiles: 2,
        finalRankingScore: 70,
        qualityScore: 65,
      },
    ];

    expect(sortRankedSuppliers(items, 'rating', false)[0].id).toBe('a');
    expect(sortRankedSuppliers(items, 'reviews', false)[0].id).toBe('b');
    expect(sortRankedSuppliers(items, 'name', false)[0].id).toBe('a');
    expect(sortRankedSuppliers(items, 'newest', false)[0].id).toBe('a');
    expect(sortRankedSuppliers(items, 'distance', true)[0].id).toBe('a');
    expect(sortRankedSuppliers(items, 'distance', false)[0].id).toBe('a');
    expect(sortRankedSuppliers(items, 'relevance', false)[0].id).toBe('a');
  });
});
