/**
 * Marketplace listing geography: resolving a listing to a UK registry city,
 * and ranking listings for a city page.
 */

'use strict';

const registry = require('../../services/locationRegistry.service');
const marketplaceListingLocation = require('../../services/marketplaceListingLocation.service');

const cardiff = registry.getCity('cardiff');
const newport = registry.getCity('newport');

/**
 * A live, approved marketplace listing.
 * @param {string} id Listing id.
 * @param {Object} overrides Extra fields.
 * @returns {Object} Listing record.
 */
function listing(id, overrides = {}) {
  return {
    id,
    userId: 'user-1',
    title: `Listing ${id}`,
    approved: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveListingCitySlug', () => {
  it('resolves a geocoded coordinate to the nearest registry city', () => {
    const mapping = marketplaceListingLocation.deriveListingCitySlug(
      listing('l1', {
        locationCoordinates: { lat: cardiff.centre.latitude, lng: cardiff.centre.longitude },
      })
    );
    expect(mapping).toEqual(expect.objectContaining({ citySlug: 'cardiff', confidence: 'high' }));
  });

  it('falls back to the free-text location when there is no usable coordinate', () => {
    const mapping = marketplaceListingLocation.deriveListingCitySlug(
      listing('l2', { location: 'Cardiff' })
    );
    expect(mapping).toEqual(expect.objectContaining({ citySlug: 'cardiff' }));
  });

  it('never guesses at text naming two cities', () => {
    const mapping = marketplaceListingLocation.deriveListingCitySlug(
      listing('l3', { location: 'Cardiff or Bristol, either works' })
    );
    expect(mapping).toBeNull();
  });

  it('returns null for text that names no registry city', () => {
    const mapping = marketplaceListingLocation.deriveListingCitySlug(
      listing('l4', { location: 'Somewhere lovely' })
    );
    expect(mapping).toBeNull();
  });

  it('returns null for a listing with neither a coordinate nor any location text', () => {
    expect(marketplaceListingLocation.deriveListingCitySlug(listing('l5'))).toBeNull();
  });
});

describe('normaliseListingCitySlug', () => {
  it('trusts a previously stored mapping over deriving one live', () => {
    const mapped = marketplaceListingLocation.normaliseListingCitySlug(
      listing('l1', { citySlug: 'bristol', location: 'Cardiff' })
    );
    expect(mapped.citySlug).toBe('bristol');
  });

  it('falls back to live derivation when the stored slug is not a real registry city', () => {
    const mapped = marketplaceListingLocation.normaliseListingCitySlug(
      listing('l1', { citySlug: 'not-a-real-city', location: 'Cardiff' })
    );
    expect(mapped.citySlug).toBe('cardiff');
  });
});

describe('isEligibleForLocationPages', () => {
  it('accepts an approved, active listing', () => {
    expect(marketplaceListingLocation.isEligibleForLocationPages(listing('l1'))).toBe(true);
  });

  it('rejects an unapproved listing', () => {
    expect(
      marketplaceListingLocation.isEligibleForLocationPages(listing('l1', { approved: false }))
    ).toBe(false);
  });

  it('rejects a sold or removed listing', () => {
    expect(
      marketplaceListingLocation.isEligibleForLocationPages(listing('l1', { status: 'sold' }))
    ).toBe(false);
    expect(
      marketplaceListingLocation.isEligibleForLocationPages(listing('l1', { status: 'removed' }))
    ).toBe(false);
  });
});

describe('matchListingToCity', () => {
  it('matches in_city when the resolved city is this one', () => {
    const match = marketplaceListingLocation.matchListingToCity(
      listing('l1', { citySlug: 'cardiff' }),
      cardiff
    );
    expect(match).toEqual({ relationship: 'in_city', distanceMiles: null });
  });

  it('matches nearby when the coordinate falls within the city’s catchment radius', () => {
    // Newport's own centre resolves in_city to Newport (10.5 miles away), but
    // is still within Cardiff's 25-mile radius, so it is "nearby" Cardiff too.
    const match = marketplaceListingLocation.matchListingToCity(
      listing('l1', {
        locationCoordinates: { lat: newport.centre.latitude, lng: newport.centre.longitude },
      }),
      cardiff
    );
    expect(match.relationship).toBe('nearby');
    expect(match.distanceMiles).toBe(11);
  });

  it('never demotes a listing to nearby when its own resolved city is this one', () => {
    const match = marketplaceListingLocation.matchListingToCity(
      listing('l1', {
        citySlug: 'cardiff',
        locationCoordinates: { lat: newport.centre.latitude, lng: newport.centre.longitude },
      }),
      cardiff
    );
    expect(match).toEqual({ relationship: 'in_city', distanceMiles: null });
  });

  it('never matches a listing with no usable location at all', () => {
    expect(marketplaceListingLocation.matchListingToCity(listing('l1'), cardiff)).toBeNull();
  });

  it('returns null for a missing listing or city', () => {
    expect(marketplaceListingLocation.matchListingToCity(null, cardiff)).toBeNull();
    expect(marketplaceListingLocation.matchListingToCity(listing('l1'), null)).toBeNull();
  });
});

describe('rankListingsForCity', () => {
  it('excludes ineligible and unmapped listings', () => {
    const ranked = marketplaceListingLocation.rankListingsForCity(
      [
        listing('unapproved', { citySlug: 'cardiff', approved: false }),
        listing('sold', { citySlug: 'cardiff', status: 'sold' }),
        listing('unmapped', { location: 'Somewhere lovely' }),
        listing('mapped', { citySlug: 'cardiff' }),
      ],
      cardiff
    );
    expect(ranked.map(entry => entry.listing.id)).toEqual(['mapped']);
  });

  it('ranks in_city listings ahead of nearby ones', () => {
    const ranked = marketplaceListingLocation.rankListingsForCity(
      [
        listing('nearby-1', {
          locationCoordinates: { lat: newport.centre.latitude, lng: newport.centre.longitude },
        }),
        listing('in-city-1', { citySlug: 'cardiff' }),
      ],
      cardiff
    );
    expect(ranked[0].listing.id).toBe('in-city-1');
    expect(ranked[0].relationship).toBe('in_city');
    expect(ranked[1].listing.id).toBe('nearby-1');
    expect(ranked[1].relationship).toBe('nearby');
  });

  it('gives each result a human-readable label', () => {
    const ranked = marketplaceListingLocation.rankListingsForCity(
      [listing('l1', { citySlug: 'cardiff' })],
      cardiff
    );
    expect(ranked[0].label).toBe('Listed in Cardiff');
  });

  it('respects the requested limit', () => {
    const listings = Array.from({ length: 5 }, (_unused, index) =>
      listing(`l${index}`, { citySlug: 'cardiff' })
    );
    const ranked = marketplaceListingLocation.rankListingsForCity(listings, cardiff, { limit: 2 });
    expect(ranked).toHaveLength(2);
  });

  it('returns nothing for an unresolved city', () => {
    expect(marketplaceListingLocation.rankListingsForCity([listing('l1')], null)).toEqual([]);
  });
});
