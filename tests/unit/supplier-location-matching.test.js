/**
 * Supplier geography: legacy classification, service areas, relationship
 * precedence, ranking integrity and the capped subscription boost.
 */

'use strict';

const registry = require('../../services/locationRegistry.service');
const supplierLocation = require('../../services/supplierLocation.service');
const { AUDIT_STATUSES, RELATIONSHIPS } = require('../../models/LocationContent');

const cardiff = registry.getCity('cardiff');
const newport = registry.getCity('newport');
const bristol = registry.getCity('bristol');

/**
 * Build an approved supplier record.
 * @param {Object} overrides Fields to override.
 * @returns {Object} Supplier record.
 */
function supplier(overrides = {}) {
  return {
    id: 'sup-1',
    name: 'Test Supplier',
    category: 'Venues',
    approved: true,
    ownerUserId: 'user-1',
    ...overrides,
  };
}

/**
 * A base location anchored on a registry city.
 * @param {string} slug City slug.
 * @returns {Object} Base location document.
 */
function baseIn(slug) {
  const city = registry.getCity(slug);
  return {
    displayName: `${city.name}, ${city.nation}`,
    citySlug: city.slug,
    nation: city.nation,
    coordinates: { type: 'Point', coordinates: [city.centre.longitude, city.centre.latitude] },
    source: 'postcode_lookup',
    confidence: 'high',
  };
}

const owners = new Set(['user-1', 'user-2', 'user-3']);

describe('legacy location classification', () => {
  it('maps a location that names exactly one city', () => {
    const result = supplierLocation.classifyLegacyLocation('Cardiff');
    expect(result.status).toBe(AUDIT_STATUSES.highConfidence);
    expect(result.citySlug).toBe('cardiff');
  });

  it('accepts an alternative name as an exact match', () => {
    expect(supplierLocation.classifyLegacyLocation('Caerdydd').citySlug).toBe('cardiff');
  });

  it('sends a city plus a wider area to review rather than mapping it', () => {
    const result = supplierLocation.classifyLegacyLocation('Cardiff and South Wales');
    expect(result.status).toBe(AUDIT_STATUSES.reviewRequired);
    expect(result.citySlug).toBe('cardiff');
    expect(result.reason).toMatch(/wider area/);
  });

  it('sends text naming two cities to review with no mapping', () => {
    const result = supplierLocation.classifyLegacyLocation('Cardiff, Bristol');
    expect(result.status).toBe(AUDIT_STATUSES.reviewRequired);
    expect(result.citySlug).toBeNull();
    expect(result.matchedNames).toEqual(expect.arrayContaining(['Cardiff', 'Bristol']));
  });

  it('does not match a city name inside a longer word', () => {
    expect(supplierLocation.classifyLegacyLocation('Yorkshire Dales').citySlug).not.toBe('york');
  });

  it('reports unmapped text as unmapped', () => {
    expect(supplierLocation.classifyLegacyLocation('Somewhere lovely').status).toBe(
      AUDIT_STATUSES.unmapped
    );
    expect(supplierLocation.classifyLegacyLocation('').status).toBe(AUDIT_STATUSES.unmapped);
  });
});

describe('base location normalisation', () => {
  it('reads a structured base location', () => {
    const base = supplierLocation.normaliseBaseLocation(
      supplier({ baseLocation: baseIn('cardiff') })
    );
    expect(base.citySlug).toBe('cardiff');
    expect(base.coordinates.coordinates[0]).toBeCloseTo(-3.1791, 3);
    expect(base.point.latitude).toBeCloseTo(51.4816, 3);
  });

  it('exposes no city for a legacy-only record, however suggestive the text', () => {
    const base = supplierLocation.normaliseBaseLocation(supplier({ location: 'Cardiff' }));
    expect(base.citySlug).toBeNull();
    expect(base.legacyClassification.status).toBe(AUDIT_STATUSES.highConfidence);
  });

  it('returns null when a supplier has no location at all', () => {
    expect(supplierLocation.normaliseBaseLocation(supplier())).toBeNull();
  });

  it('keeps the legacy string readable alongside the structured value', () => {
    const base = supplierLocation.normaliseBaseLocation(
      supplier({ baseLocation: baseIn('cardiff'), location: 'Cardiff and South Wales' })
    );
    expect(base.legacyLocation).toBe('Cardiff and South Wales');
  });
});

describe('service area normalisation', () => {
  it('keeps known cities and drops unknown ones', () => {
    const coverage = supplierLocation.normaliseServiceAreas(
      supplier({
        serviceAreas: [
          { type: 'city', slug: 'cardiff' },
          { type: 'city', slug: 'atlantis' },
          { type: 'city', slug: 'Caerdydd' },
        ],
      })
    );
    expect(coverage.cities).toEqual(['cardiff']);
  });

  it('takes the widest valid radius and caps it', () => {
    const coverage = supplierLocation.normaliseServiceAreas(
      supplier({
        serviceAreas: [
          { type: 'radius', miles: 20 },
          { type: 'radius', miles: 45 },
          { type: 'radius', miles: 5000 },
        ],
      })
    );
    expect(coverage.radiusMiles).toBe(supplierLocation.MAX_TRAVEL_RADIUS_MILES);
  });

  it('reads the nationwide flag from either shape', () => {
    expect(
      supplierLocation.normaliseServiceAreas(supplier({ serviceAreas: [{ type: 'nationwide' }] }))
        .nationwide
    ).toBe(true);
    expect(
      supplierLocation.normaliseServiceAreas(supplier({ travelPolicy: { nationwide: true } }))
        .nationwide
    ).toBe(true);
  });

  it('ignores malformed entries', () => {
    const coverage = supplierLocation.normaliseServiceAreas(
      supplier({ serviceAreas: [null, 'cardiff', { type: 'radius', miles: -4 }, {}] })
    );
    expect(coverage.cities).toEqual([]);
    expect(coverage.radiusMiles).toBe(0);
  });
});

describe('relationship precedence', () => {
  it('identifies a supplier based in the city', () => {
    const match = supplierLocation.matchSupplierToCity(
      supplier({ baseLocation: baseIn('cardiff') }),
      cardiff
    );
    expect(match.relationship).toBe(RELATIONSHIPS.basedIn);
    expect(match.label).toBe('Based in Cardiff');
  });

  it('identifies a supplier that explicitly serves the city', () => {
    const match = supplierLocation.matchSupplierToCity(
      supplier({
        baseLocation: baseIn('newport'),
        serviceAreas: [{ type: 'city', slug: 'cardiff' }],
      }),
      cardiff
    );
    expect(match.relationship).toBe(RELATIONSHIPS.serves);
    expect(match.label).toBe('Serves Cardiff');
  });

  it('matches on the travel radius using real coordinates', () => {
    const match = supplierLocation.matchSupplierToCity(
      supplier({ baseLocation: baseIn('newport'), serviceAreas: [{ type: 'radius', miles: 25 }] }),
      cardiff
    );
    expect(match.relationship).toBe(RELATIONSHIPS.radius);
    expect(match.distanceMiles).toBeGreaterThan(8);
    expect(match.label).toMatch(/miles away$/);
  });

  it('does not match beyond the declared radius', () => {
    const match = supplierLocation.matchSupplierToCity(
      supplier({ baseLocation: baseIn('newport'), serviceAreas: [{ type: 'radius', miles: 2 }] }),
      cardiff
    );
    expect(match).toBeNull();
  });

  it('treats nationwide cover as the last resort, not a local claim', () => {
    const nationwideSupplier = supplier({
      baseLocation: baseIn('newport'),
      travelPolicy: { nationwide: true },
    });
    expect(supplierLocation.matchSupplierToCity(nationwideSupplier, cardiff).relationship).toBe(
      RELATIONSHIPS.nationwide
    );
    expect(supplierLocation.matchSupplierToCity(nationwideSupplier, newport).relationship).toBe(
      RELATIONSHIPS.basedIn
    );
  });

  it('prefers "based in" over a service area naming the same city', () => {
    const match = supplierLocation.matchSupplierToCity(
      supplier({
        baseLocation: baseIn('cardiff'),
        serviceAreas: [
          { type: 'city', slug: 'cardiff' },
          { type: 'radius', miles: 50 },
        ],
      }),
      cardiff
    );
    expect(match.relationship).toBe(RELATIONSHIPS.basedIn);
  });

  it('returns null when nothing connects the supplier to the city', () => {
    expect(
      supplierLocation.matchSupplierToCity(supplier({ baseLocation: baseIn('newport') }), bristol)
    ).toBeNull();
    expect(supplierLocation.matchSupplierToCity(supplier(), cardiff)).toBeNull();
    expect(supplierLocation.matchSupplierToCity(null, cardiff)).toBeNull();
  });
});

describe('eligibility', () => {
  const cases = [
    ['unapproved', { approved: false }],
    ['suspended by status', { status: 'suspended' }],
    ['suspended by flag', { suspended: true }],
    ['a test account', { isTest: true }],
    ['soft deleted', { deletedAt: '2026-01-01T00:00:00.000Z' }],
    ['orphaned', { ownerUserId: 'ghost-user' }],
    ['nameless', { name: '' }],
  ];

  it.each(cases)('excludes a supplier that is %s', (_label, overrides) => {
    expect(supplierLocation.isEligibleForLocationPages(supplier(overrides), owners)).toBe(false);
  });

  it('includes an ordinary approved supplier', () => {
    expect(supplierLocation.isEligibleForLocationPages(supplier(), owners)).toBe(true);
  });
});

describe('ranking', () => {
  it('excludes ineligible suppliers from the results', () => {
    const ranked = supplierLocation.rankSuppliersForCity(
      [
        supplier({ id: 'good', baseLocation: baseIn('cardiff') }),
        supplier({ id: 'unapproved', approved: false, baseLocation: baseIn('cardiff') }),
        supplier({ id: 'suspended', status: 'suspended', baseLocation: baseIn('cardiff') }),
        supplier({ id: 'orphan', ownerUserId: 'ghost', baseLocation: baseIn('cardiff') }),
      ],
      cardiff,
      { validOwnerIds: owners }
    );
    expect(ranked.map(entry => entry.supplier.id)).toEqual(['good']);
  });

  it('ranks a local supplier above a distant nationwide one', () => {
    const ranked = supplierLocation.rankSuppliersForCity(
      [
        supplier({
          id: 'nationwide',
          name: 'Nationwide Co',
          baseLocation: baseIn('inverness'),
          travelPolicy: { nationwide: true },
        }),
        supplier({ id: 'local', name: 'Local Co', baseLocation: baseIn('cardiff') }),
      ],
      cardiff,
      { validOwnerIds: owners }
    );
    expect(ranked[0].supplier.id).toBe('local');
  });

  it('does not let a paid tier displace a stronger local match', () => {
    const ranked = supplierLocation.rankSuppliersForCity(
      [
        supplier({
          id: 'pro-distant',
          name: 'Pro Distant',
          isPro: true,
          baseLocation: baseIn('newport'),
          serviceAreas: [{ type: 'city', slug: 'cardiff' }],
        }),
        supplier({ id: 'free-local', name: 'Free Local', baseLocation: baseIn('cardiff') }),
      ],
      cardiff,
      { validOwnerIds: owners }
    );
    expect(ranked[0].supplier.id).toBe('free-local');
  });

  it('keeps the tier boost below the narrowest relationship gap', () => {
    expect(supplierLocation.MAX_TIER_BOOST).toBeLessThan(20);
  });

  it('lets the paid tier break a tie between equal relationships', () => {
    const ranked = supplierLocation.rankSuppliersForCity(
      [
        supplier({ id: 'free', name: 'A Free', baseLocation: baseIn('cardiff') }),
        supplier({ id: 'pro', name: 'B Pro', isPro: true, baseLocation: baseIn('cardiff') }),
      ],
      cardiff,
      { validOwnerIds: owners }
    );
    expect(ranked[0].supplier.id).toBe('pro');
  });

  it('collapses duplicate records for the same business', () => {
    const ranked = supplierLocation.rankSuppliersForCity(
      [
        supplier({ id: 'legacy-id', name: 'Same Business', baseLocation: baseIn('cardiff') }),
        supplier({
          id: 'current-id',
          name: 'Same Business',
          baseLocation: baseIn('cardiff'),
          isPro: true,
        }),
      ],
      cardiff,
      { validOwnerIds: owners }
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].supplier.id).toBe('current-id');
  });

  it('honours the result limit', () => {
    const suppliers = Array.from({ length: 8 }, (_value, index) =>
      supplier({ id: `sup-${index}`, name: `Supplier ${index}`, baseLocation: baseIn('cardiff') })
    );
    expect(
      supplierLocation.rankSuppliersForCity(suppliers, cardiff, {
        validOwnerIds: owners,
        limit: 3,
      })
    ).toHaveLength(3);
  });

  it('returns nothing for a missing city', () => {
    expect(supplierLocation.rankSuppliersForCity([supplier()], null)).toEqual([]);
  });
});

describe('audit rows', () => {
  it('reports an already-mapped supplier', () => {
    const row = supplierLocation.auditSupplierLocation(
      supplier({ baseLocation: baseIn('cardiff') })
    );
    expect(row.status).toBe(AUDIT_STATUSES.alreadyMapped);
    expect(row.citySlug).toBe('cardiff');
  });

  it('reports a legacy exact match as high confidence', () => {
    const row = supplierLocation.auditSupplierLocation(supplier({ location: 'Bristol' }));
    expect(row.status).toBe(AUDIT_STATUSES.highConfidence);
    expect(row.citySlug).toBe('bristol');
  });

  it('reports ambiguous text as review required', () => {
    const row = supplierLocation.auditSupplierLocation(
      supplier({ location: 'Cardiff and surrounding areas' })
    );
    expect(row.status).toBe(AUDIT_STATUSES.reviewRequired);
  });

  it('carries the postcode through for a second attempt', () => {
    const row = supplierLocation.auditSupplierLocation(
      supplier({ location: 'By the sea', postcode: 'CF10 1AA' })
    );
    expect(row.status).toBe(AUDIT_STATUSES.unmapped);
    expect(row.postcode).toBe('CF10 1AA');
  });
});
