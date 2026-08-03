/**
 * Canonical supplier-ranking tests.
 */

'use strict';

const {
  RANKING_VERSION,
  effectiveRating,
  effectiveVerified,
  isPubliclyEligibleSupplier,
  calculateSupplierRanking,
  calculateSupplierRelevance,
  calculateFinalSearchScore,
  sortRankedSuppliers,
} = require('../../services/supplierRanking.service');

const NOW = new Date('2026-08-02T12:00:00.000Z');

function completeSupplier(overrides = {}) {
  return {
    id: 'sup_complete',
    ownerUserId: 'user_1',
    approved: true,
    status: 'published',
    name: 'Cardiff Celebration Photography',
    category: 'Photography',
    location: 'Cardiff',
    postcode: 'CF10 1AA',
    profilePhotoUrl: '/uploads/suppliers/profile.jpg',
    coverImage: '/uploads/suppliers/cover.jpg',
    description_short: 'Natural wedding and event photography throughout Cardiff and South Wales.',
    description_long:
      'We create relaxed, natural event photography for weddings, parties and corporate celebrations throughout South Wales. Every booking includes a planning call, professionally edited photographs and a secure online gallery for sharing with guests.',
    images: [
      '/uploads/suppliers/one.jpg',
      '/uploads/suppliers/two.jpg',
      '/uploads/suppliers/three.jpg',
      '/uploads/suppliers/four.jpg',
    ],
    tags: ['wedding', 'photography'],
    amenities: ['Planning call', 'Online gallery'],
    price_display: '££',
    averageRating: 4.8,
    reviewCount: 10,
    verified: true,
    verifications: {
      business: { verified: true },
      email: { verified: true },
      phone: { verified: true },
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function completePackages() {
  return [
    {
      id: 'pkg_1',
      supplierId: 'sup_complete',
      approved: true,
      title: 'Full-day wedding photography',
      description:
        'Full-day wedding photography with planning support, edited photographs and an online gallery.',
      price: 1495,
      image: '/uploads/packages/wedding.jpg',
      features: ['Full day coverage', 'Edited gallery'],
      updatedAt: '2026-07-25T00:00:00.000Z',
    },
    {
      id: 'pkg_2',
      supplierId: 'sup_complete',
      approved: true,
      title: 'Party photography',
      description:
        'Photography coverage for birthdays, anniversaries and private celebrations across South Wales.',
      price: 495,
      image: '/uploads/packages/party.jpg',
      features: ['Three hours coverage'],
    },
    {
      id: 'pkg_3',
      supplierId: 'sup_complete',
      approved: true,
      title: 'Corporate event photography',
      description:
        'Professional event coverage for conferences, launches and company celebrations.',
      price: 695,
      image: '/uploads/packages/corporate.jpg',
      features: ['Commercial usage'],
    },
  ];
}

describe('supplierRanking.service', () => {
  test('uses the canonical ranking version', () => {
    expect(RANKING_VERSION).toBe('supplier-ranking-v1');
  });

  test('a complete Starter supplier outranks an incomplete Pro supplier', () => {
    const complete = calculateSupplierRanking(
      completeSupplier({ subscriptionTier: 'free' }),
      completePackages(),
      {
        now: NOW,
      }
    );
    const incompletePro = calculateSupplierRanking(
      {
        id: 'sup_incomplete',
        approved: true,
        name: 'Incomplete Pro',
        category: 'Photography',
        subscriptionTier: 'pro',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      [],
      { now: NOW }
    );

    expect(complete.finalScore).toBeGreaterThan(incompletePro.finalScore);
    expect(incompletePro.adjustments.subscription).toBe(3);
  });

  test('Pro and Pro Plus receive distinct, capped browse benefits', () => {
    const starter = calculateSupplierRanking(
      completeSupplier({ subscriptionTier: 'free' }),
      completePackages(),
      {
        now: NOW,
      }
    );
    const pro = calculateSupplierRanking(
      completeSupplier({ subscriptionTier: 'pro' }),
      completePackages(),
      {
        now: NOW,
      }
    );
    const proPlus = calculateSupplierRanking(
      completeSupplier({ subscriptionTier: 'pro_plus' }),
      completePackages(),
      { now: NOW }
    );

    expect(pro.adjustments.subscription).toBe(3);
    expect(proPlus.adjustments.subscription).toBe(5);
    expect(pro.finalScore).toBeGreaterThanOrEqual(starter.finalScore);
    expect(proPlus.finalScore).toBeGreaterThanOrEqual(pro.finalScore);
    expect(proPlus.adjustments.total).toBeLessThanOrEqual(8);
  });

  test('search-mode commercial adjustments are capped at five points', () => {
    const ranking = calculateSupplierRanking(
      completeSupplier({
        subscriptionTier: 'pro_plus',
        featured: true,
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
      completePackages(),
      { now: NOW, searchMode: true }
    );

    expect(ranking.adjustments.total).toBe(5);
    expect(ranking.adjustments.cap).toBe(5);
  });

  test('complete public packages materially improve quality', () => {
    const supplier = completeSupplier({ averageRating: 0, reviewCount: 0 });
    const withoutPackages = calculateSupplierRanking(supplier, [], { now: NOW });
    const withPackages = calculateSupplierRanking(supplier, completePackages(), { now: NOW });

    expect(withPackages.breakdown.packages.score).toBe(25);
    expect(withPackages.qualityScore - withoutPackages.qualityScore).toBe(25);
  });

  test('review confidence prevents one five-star review equalling ten established reviews', () => {
    const oneReview = calculateSupplierRanking(
      completeSupplier({ averageRating: 5, reviewCount: 1 }),
      completePackages(),
      { now: NOW }
    );
    const tenReviews = calculateSupplierRanking(
      completeSupplier({ averageRating: 4.8, reviewCount: 10 }),
      completePackages(),
      { now: NOW }
    );

    expect(tenReviews.breakdown.reviews.score).toBeGreaterThan(oneReview.breakdown.reviews.score);
  });

  test('falls back to the legacy rating field', () => {
    expect(effectiveRating({ rating: 4.7 })).toBe(4.7);
  });

  test('approval alone does not count as verification', () => {
    expect(effectiveVerified({ approved: true, verified: false })).toBe(false);
    expect(effectiveVerified({ approved: true, verificationStatus: 'approved' })).toBe(true);
  });

  test('excludes test, suspended, orphaned and ownerless suppliers while retaining valid-owner records', () => {
    const owners = new Set(['user_1']);
    expect(isPubliclyEligibleSupplier({ approved: true, ownerUserId: 'user_1' }, owners)).toBe(
      true
    );
    expect(
      isPubliclyEligibleSupplier({ approved: true, isTest: true, ownerUserId: 'user_1' }, owners)
    ).toBe(false);
    expect(
      isPubliclyEligibleSupplier(
        { approved: true, status: 'suspended', ownerUserId: 'user_1' },
        owners
      )
    ).toBe(false);
    expect(
      isPubliclyEligibleSupplier({ approved: true, ownerUserId: 'missing_user' }, owners)
    ).toBe(false);
    // No user collection was available when the record was written and it now
    // has no owner at all — cannot be tied to an existing account, so excluded.
    expect(isPubliclyEligibleSupplier({ approved: true }, owners)).toBe(false);
  });

  test('package text contributes to keyword relevance', () => {
    const supplier = completeSupplier({ name: 'Celebration Company', category: 'Other' });
    const packages = completePackages();
    const relevance = calculateSupplierRelevance(supplier, packages, { q: 'wedding photography' });

    expect(relevance.score).toBeGreaterThan(0);
    expect(relevance.components.packages).toBeGreaterThan(0);
  });

  test('a relevant Starter supplier outranks an irrelevant Pro supplier in search', () => {
    const starter = completeSupplier({ subscriptionTier: 'free' });
    const pro = completeSupplier({
      id: 'sup_pro',
      subscriptionTier: 'pro',
      name: 'Luxury Catering Company',
      category: 'Catering',
      description_short: 'Premium menus for formal dinners and private events.',
      description_long:
        'We provide carefully prepared menus, waiting staff and event catering for private and corporate occasions throughout Wales.',
      tags: ['food', 'catering'],
    });
    const starterRanking = calculateSupplierRanking(starter, completePackages(), {
      now: NOW,
      searchMode: true,
    });
    const proRanking = calculateSupplierRanking(pro, [], { now: NOW, searchMode: true });
    const starterRelevance = calculateSupplierRelevance(starter, completePackages(), {
      q: 'wedding photography',
    });
    const proRelevance = calculateSupplierRelevance(pro, [], { q: 'wedding photography' });

    expect(calculateFinalSearchScore(starterRanking, starterRelevance)).toBeGreaterThan(
      calculateFinalSearchScore(proRanking, proRelevance)
    );
  });

  test('ties are deterministic by supplier ID', () => {
    const sorted = sortRankedSuppliers(
      [
        { id: 'sup_b', finalRankingScore: 50, qualityScore: 50 },
        { id: 'sup_a', finalRankingScore: 50, qualityScore: 50 },
      ],
      'relevance',
      false
    );
    expect(sorted.map(item => item.id)).toEqual(['sup_a', 'sup_b']);
  });
});
