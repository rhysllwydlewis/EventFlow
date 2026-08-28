/**
 * Unit tests for supplier badge enrichment and display logic
 * Tests the logic in routes/suppliers.js (badgeDetails enrichment)
 * and the CSS class mapping for earned/performance badges.
 */

'use strict';

const { BADGE_DEFINITIONS } = require('../../utils/badgeManagement');

// --------------------------------------------------------------------------
// Pure helpers extracted from routes/suppliers.js for unit testing
// --------------------------------------------------------------------------

/**
 * Enrich a supplier's badges array with full badge definitions.
 * Mirrors the logic added to GET /api/suppliers/:id
 */
function enrichBadgeDetails(supplierBadges, allBadgesFromDb) {
  if (!Array.isArray(supplierBadges) || supplierBadges.length === 0) {
    return [];
  }

  const fallbackDefs = Object.values(BADGE_DEFINITIONS);

  return supplierBadges
    .map(badgeId => {
      const fromDb = allBadgesFromDb.find(b => b.id === badgeId);
      if (fromDb) {
        return fromDb;
      }
      return fallbackDefs.find(b => b.id === badgeId) || null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99));
}

/**
 * Map a badge to its CSS class (mirrors verification-badges.js logic)
 */
function earnedBadgeCssClass(badge) {
  const classMap = {
    'fast-responder': 'badge-fast-responder',
    'top-rated': 'badge-top-rated',
    expert: 'badge-expert',
    custom: 'badge-custom',
  };
  return classMap[badge.id] || classMap[badge.type] || 'badge-custom';
}

/**
 * Determine which groups appear in the badge section (mirrors supplier-profile.js)
 */
function getBadgeSectionGroups(supplier) {
  const groups = [];

  // Subscription tier
  const tier =
    supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');
  if (tier === 'pro_plus' || tier === 'pro') {
    groups.push('subscription');
  }

  // Ownership — bot-sourced listings are published unclaimed until the real
  // business claims them
  if (supplier.ownershipStatus === 'unclaimed') {
    groups.push('ownership');
  }

  // Earned badges
  const SKIP_TYPES = new Set(['pro', 'pro-plus', 'founder', 'verified', 'featured']);
  const earnedBadges = Array.isArray(supplier.badgeDetails)
    ? supplier.badgeDetails.filter(b => !SKIP_TYPES.has(b.type))
    : [];
  if (earnedBadges.length > 0) {
    groups.push('earned');
  }

  // Recognition
  if (
    supplier.isFoundingSupplier ||
    supplier.isFounding ||
    supplier.founding ||
    supplier.featured ||
    supplier.featuredSupplier
  ) {
    groups.push('recognition');
  }

  // Verification
  if (
    supplier.emailVerified ||
    supplier.phoneVerified ||
    supplier.businessVerified ||
    supplier.verifications?.email?.verified ||
    supplier.verifications?.phone?.verified ||
    supplier.verifications?.business?.verified ||
    supplier.verified
  ) {
    groups.push('verification');
  }

  return groups;
}

/**
 * Build the prioritized, capped hero badge ID list (mirrors the
 * priority/sort/maxBadges logic in renderVerificationBadges,
 * public/assets/js/utils/verification-badges.js -- the function the hero
 * actually renders through). Priority 0 (Unclaimed) always wins a spot
 * under the cap: it is the one signal that undercuts every other badge, so
 * it must never be the one silently dropped.
 */
function buildHeroBadges(supplier, maxBadges = 3) {
  const badges = [];
  if (supplier.ownershipStatus === 'unclaimed') {
    badges.push({ id: 'unclaimed', priority: 0 });
  }
  if (supplier.isFoundingSupplier || supplier.isFounding || supplier.founding) {
    badges.push({ id: 'founding', priority: 1 });
  }
  const tier =
    supplier.subscriptionTier || supplier.subscription?.tier || (supplier.isPro ? 'pro' : 'free');
  if (tier === 'pro_plus') {
    badges.push({ id: 'pro-plus', priority: 2 });
  } else if (tier === 'pro') {
    badges.push({ id: 'pro', priority: 2 });
  }
  if (supplier.featured || supplier.featuredSupplier) {
    badges.push({ id: 'featured', priority: 2 });
  }
  if (supplier.emailVerified || supplier.verifications?.email?.verified) {
    badges.push({ id: 'email-verified', priority: 3 });
  }
  badges.sort((a, b) => a.priority - b.priority);
  return badges.slice(0, maxBadges).map(badge => badge.id);
}

// --------------------------------------------------------------------------
// Test data
// --------------------------------------------------------------------------

const SAMPLE_DB_BADGES = [
  {
    id: 'fast-responder',
    name: 'Fast Responder',
    type: 'custom',
    description: 'Responds to enquiries within 24 hours',
    icon: '⚡',
    displayOrder: 5,
  },
  {
    id: 'top-rated',
    name: 'Top Rated',
    type: 'custom',
    description: 'Maintains an average rating of 4.5 stars or higher',
    icon: '🌟',
    displayOrder: 4,
  },
  {
    id: 'expert',
    name: 'Expert',
    type: 'custom',
    description: 'Has successfully completed over 50 events',
    icon: '🎓',
    displayOrder: 3,
  },
];

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('Supplier badge enrichment (badgeDetails)', () => {
  it('returns empty array when supplier has no badges', () => {
    expect(enrichBadgeDetails([], SAMPLE_DB_BADGES)).toEqual([]);
    expect(enrichBadgeDetails(undefined, SAMPLE_DB_BADGES)).toEqual([]);
    expect(enrichBadgeDetails(null, SAMPLE_DB_BADGES)).toEqual([]);
  });

  it('enriches a single badge ID from the DB collection', () => {
    const result = enrichBadgeDetails(['fast-responder'], SAMPLE_DB_BADGES);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Fast Responder');
    expect(result[0].icon).toBe('⚡');
  });

  it('enriches multiple badge IDs, sorted by displayOrder', () => {
    const result = enrichBadgeDetails(['top-rated', 'expert', 'fast-responder'], SAMPLE_DB_BADGES);
    expect(result).toHaveLength(3);
    // expert (3) < top-rated (4) < fast-responder (5)
    expect(result[0].id).toBe('expert');
    expect(result[1].id).toBe('top-rated');
    expect(result[2].id).toBe('fast-responder');
  });

  it('falls back to BADGE_DEFINITIONS for IDs not in DB', () => {
    // Empty DB collection — should fall back to in-memory definitions
    const result = enrichBadgeDetails(['fast-responder'], []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('fast-responder');
    expect(result[0].name).toBe('Fast Responder');
  });

  it('skips badge IDs that do not exist in DB or BADGE_DEFINITIONS', () => {
    const result = enrichBadgeDetails(['unknown-badge-xyz'], SAMPLE_DB_BADGES);
    expect(result).toHaveLength(0);
  });

  it('prefers DB entry over in-memory definition when both exist', () => {
    const dbBadgeWithUpdatedName = [
      { id: 'fast-responder', name: 'Quick Reply Pro', type: 'custom', displayOrder: 5 },
    ];
    const result = enrichBadgeDetails(['fast-responder'], dbBadgeWithUpdatedName);
    expect(result[0].name).toBe('Quick Reply Pro');
  });
});

describe('Earned badge CSS class mapping', () => {
  it('maps fast-responder badge by ID', () => {
    expect(earnedBadgeCssClass({ id: 'fast-responder', type: 'custom' })).toBe(
      'badge-fast-responder'
    );
  });

  it('maps top-rated badge by ID', () => {
    expect(earnedBadgeCssClass({ id: 'top-rated', type: 'custom' })).toBe('badge-top-rated');
  });

  it('maps expert badge by ID', () => {
    expect(earnedBadgeCssClass({ id: 'expert', type: 'custom' })).toBe('badge-expert');
  });

  it('maps by type when ID is not recognised', () => {
    expect(earnedBadgeCssClass({ id: 'my-custom-badge', type: 'custom' })).toBe('badge-custom');
  });

  it('falls back to badge-custom for unknown ID and type', () => {
    expect(earnedBadgeCssClass({ id: 'whatever', type: 'unknown' })).toBe('badge-custom');
  });
});

describe('Badge section group visibility', () => {
  it('shows no groups for a free supplier with no badges', () => {
    const groups = getBadgeSectionGroups({});
    expect(groups).toHaveLength(0);
  });

  it('shows subscription group for pro supplier', () => {
    const groups = getBadgeSectionGroups({ subscriptionTier: 'pro' });
    expect(groups).toContain('subscription');
  });

  it('shows subscription group for pro_plus supplier', () => {
    const groups = getBadgeSectionGroups({ subscriptionTier: 'pro_plus' });
    expect(groups).toContain('subscription');
  });

  it('shows earned group when badgeDetails contains earned badges', () => {
    const supplier = {
      badgeDetails: [{ id: 'fast-responder', type: 'custom', name: 'Fast Responder' }],
    };
    const groups = getBadgeSectionGroups(supplier);
    expect(groups).toContain('earned');
  });

  it('does NOT show earned group for tier/founder/verified types in badgeDetails', () => {
    const supplier = {
      badgeDetails: [
        { id: 'pro', type: 'pro', name: 'Pro' },
        { id: 'verified', type: 'verified', name: 'Verified' },
      ],
    };
    const groups = getBadgeSectionGroups(supplier);
    expect(groups).not.toContain('earned');
  });

  it('shows recognition group for founding supplier', () => {
    const groups = getBadgeSectionGroups({ isFoundingSupplier: true });
    expect(groups).toContain('recognition');
  });

  it('shows ownership group for an unclaimed bot-sourced supplier', () => {
    const groups = getBadgeSectionGroups({ ownershipStatus: 'unclaimed' });
    expect(groups).toContain('ownership');
  });

  it('does NOT show ownership group for a claimed supplier', () => {
    const groups = getBadgeSectionGroups({ ownershipStatus: 'claimed' });
    expect(groups).not.toContain('ownership');
  });

  it('shows verification group for email-verified supplier', () => {
    const groups = getBadgeSectionGroups({ emailVerified: true });
    expect(groups).toContain('verification');
  });

  it('shows all groups for a fully-badged pro supplier', () => {
    const supplier = {
      subscriptionTier: 'pro',
      badgeDetails: [{ id: 'top-rated', type: 'custom', name: 'Top Rated' }],
      isFoundingSupplier: true,
      emailVerified: true,
      ownershipStatus: 'unclaimed',
    };
    const groups = getBadgeSectionGroups(supplier);
    expect(groups).toContain('subscription');
    expect(groups).toContain('ownership');
    expect(groups).toContain('earned');
    expect(groups).toContain('recognition');
    expect(groups).toContain('verification');
  });
});

describe('Hero badge cap', () => {
  it('never exceeds the cap even when every condition is true at once', () => {
    const supplier = {
      subscription: { tier: 'pro' },
      ownershipStatus: 'unclaimed',
      isFoundingSupplier: true,
      featured: true,
      emailVerified: true,
    };
    const badges = buildHeroBadges(supplier);
    expect(badges.length).toBeLessThanOrEqual(3);
    expect(badges).toEqual(['unclaimed', 'founding', 'pro']);
  });

  it('never lets the unclaimed disclosure be the badge the cap drops', () => {
    // Unclaimed is priority 0 -- the one signal that undercuts every other
    // badge shown -- so it must survive the cap regardless of how many
    // higher-volume badges (tier, featured, founding) a supplier also has.
    const badges = buildHeroBadges(
      {
        subscription: { tier: 'pro_plus' },
        ownershipStatus: 'unclaimed',
        isFoundingSupplier: true,
        featured: true,
      },
      2
    );
    expect(badges).toContain('unclaimed');
    expect(badges).toEqual(['unclaimed', 'founding']);
  });

  it('shows no unclaimed badge for a claimed supplier, regardless of other badges', () => {
    const badges = buildHeroBadges({
      ownershipStatus: 'claimed',
      isFoundingSupplier: true,
      featured: true,
    });
    expect(badges).not.toContain('unclaimed');
    expect(badges).toEqual(['founding', 'featured']);
  });
});
