/**
 * UK city registry: slug handling, alias resolution, validation and postcode
 * lookup.
 */

'use strict';

const registry = require('../../services/locationRegistry.service');

describe('city registry loading', () => {
  it('validates the shipped registry without problems', () => {
    expect(() => registry.loadRegistry({ force: true })).not.toThrow();
    expect(registry.listCities().length).toBeGreaterThan(20);
  });

  it('stores coordinates in GeoJSON longitude, latitude order', () => {
    const cardiff = registry.getCity('cardiff');
    expect(cardiff.coordinates.type).toBe('Point');
    const [longitude, latitude] = cardiff.coordinates.coordinates;
    expect(longitude).toBeCloseTo(-3.1791, 3);
    expect(latitude).toBeCloseTo(51.4816, 3);
    expect(cardiff.centre.latitude).toBeCloseTo(51.4816, 3);
  });

  it('keeps every nearby slug pointing at a real city', () => {
    const slugs = new Set(registry.listCities().map(city => city.slug));
    for (const city of registry.listCities()) {
      for (const nearby of city.nearbyLocationSlugs) {
        expect(slugs.has(nearby)).toBe(true);
      }
    }
  });

  it('gives every city a unique slug', () => {
    const slugs = registry.listCities().map(city => city.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('slug normalisation', () => {
  it('normalises spacing, case and punctuation', () => {
    expect(registry.normaliseSlug('  Newcastle upon Tyne ')).toBe('newcastle-upon-tyne');
    expect(registry.normaliseSlug('Stoke-on-Trent')).toBe('stoke-on-trent');
    expect(registry.normaliseSlug('Brighton & Hove')).toBe('brighton-and-hove');
  });

  it('returns an empty string for unusable input', () => {
    expect(registry.normaliseSlug(null)).toBe('');
    expect(registry.normaliseSlug('   ')).toBe('');
    expect(registry.normaliseSlug('///')).toBe('');
  });

  it('rejects malformed slugs', () => {
    expect(registry.isValidSlug('cardiff')).toBe(true);
    expect(registry.isValidSlug('Cardiff')).toBe(false);
    expect(registry.isValidSlug('cardiff/')).toBe(false);
    expect(registry.isValidSlug('-cardiff')).toBe(false);
    expect(registry.isValidSlug('../../etc/passwd')).toBe(false);
    expect(registry.isValidSlug('')).toBe(false);
  });
});

describe('alias resolution', () => {
  it('resolves Cardiff and Caerdydd to one entity', () => {
    const english = registry.resolveCity('cardiff');
    const welsh = registry.resolveCity('Caerdydd');
    expect(english.city.slug).toBe('cardiff');
    expect(welsh.city.slug).toBe('cardiff');
    expect(welsh.city).toBe(english.city);
  });

  it('reports whether the requested spelling was already canonical', () => {
    expect(registry.resolveCity('cardiff').canonical).toBe(true);
    expect(registry.resolveCity('Cardiff').canonical).toBe(false);
    expect(registry.resolveCity('caerdydd').canonical).toBe(false);
  });

  it('resolves other Welsh names to their English canonical slug', () => {
    expect(registry.canonicalSlugFor('Abertawe')).toBe('swansea');
    expect(registry.canonicalSlugFor('Casnewydd')).toBe('newport');
    expect(registry.canonicalSlugFor('Wrecsam')).toBe('wrexham');
  });

  it('returns null for unknown or malformed input', () => {
    expect(registry.resolveCity('atlantis')).toBeNull();
    expect(registry.resolveCity('')).toBeNull();
    expect(registry.resolveCity(undefined)).toBeNull();
    expect(registry.canonicalSlugFor('nowhere')).toBe('');
  });

  it('does not resolve a partial name to a city', () => {
    expect(registry.resolveCity('cardi')).toBeNull();
    expect(registry.getCity('CARDIFF')).toBeNull();
  });
});

describe('nearby cities', () => {
  it('resolves nearby slugs to records', () => {
    const nearby = registry.nearbyCities('cardiff');
    expect(nearby.map(city => city.slug)).toContain('newport');
  });

  it('applies the caller filter, so unpublished pages can be excluded', () => {
    const published = new Set(['newport']);
    const nearby = registry.nearbyCities('cardiff', city => published.has(city.slug));
    expect(nearby.map(city => city.slug)).toEqual(['newport']);
  });

  it('returns nothing for an unknown city', () => {
    expect(registry.nearbyCities('atlantis')).toEqual([]);
  });
});

describe('search', () => {
  it('matches a prefix of a canonical name', () => {
    expect(registry.searchCities('card').map(city => city.slug)).toContain('cardiff');
  });

  it('matches an alternative name', () => {
    expect(registry.searchCities('caer').map(city => city.slug)).toContain('cardiff');
  });

  it('returns nothing for empty input', () => {
    expect(registry.searchCities('')).toEqual([]);
  });
});

describe('distance and nearest city', () => {
  it('measures distance from a city centre', () => {
    const cardiff = registry.getCity('cardiff');
    expect(registry.distanceToCity(cardiff, { latitude: 51.4816, longitude: -3.1791 })).toBeCloseTo(
      0,
      3
    );
    // Cardiff to Newport is roughly 11 miles.
    const toNewport = registry.distanceToCity(cardiff, { latitude: 51.5842, longitude: -2.9977 });
    expect(toNewport).toBeGreaterThan(8);
    expect(toNewport).toBeLessThan(15);
  });

  it('rejects unusable coordinates', () => {
    expect(registry.distanceToCity(registry.getCity('cardiff'), null)).toBeNull();
    expect(
      registry.distanceToCity(registry.getCity('cardiff'), { latitude: 'x', longitude: 1 })
    ).toBeNull();
  });

  it('finds the nearest city within the cutoff', () => {
    const nearest = registry.nearestCity({ latitude: 51.4816, longitude: -3.1791 });
    expect(nearest.city.slug).toBe('cardiff');
    expect(nearest.distanceMiles).toBeLessThan(1);
  });

  it('returns null when nothing is close enough', () => {
    // Mid-Atlantic: no UK city is within the default cutoff.
    expect(registry.nearestCity({ latitude: 40, longitude: -30 })).toBeNull();
  });
});

describe('postcode resolution', () => {
  it('resolves a valid postcode to a city through the geocoder', async () => {
    const geocodePostcode = jest
      .fn()
      .mockResolvedValue({ latitude: 51.4816, longitude: -3.1791, postcode: 'CF10 1AA' });
    const result = await registry.resolvePostcodeToCity('CF10 1AA', { geocodePostcode });

    expect(geocodePostcode).toHaveBeenCalledWith('CF10 1AA');
    expect(result.city.slug).toBe('cardiff');
    expect(result.coordinates.coordinates).toEqual([-3.1791, 51.4816]);
  });

  it('refuses a malformed postcode without calling the geocoder', async () => {
    const geocodePostcode = jest.fn();
    expect(await registry.resolvePostcodeToCity('not a postcode', { geocodePostcode })).toBeNull();
    expect(geocodePostcode).not.toHaveBeenCalled();
  });

  it('returns null when the geocoder finds nothing', async () => {
    const geocodePostcode = jest.fn().mockResolvedValue(null);
    expect(await registry.resolvePostcodeToCity('CF10 1AA', { geocodePostcode })).toBeNull();
  });

  it('returns null rather than throwing when the geocoder fails', async () => {
    const geocodePostcode = jest.fn().mockRejectedValue(new Error('network down'));
    expect(await registry.resolvePostcodeToCity('CF10 1AA', { geocodePostcode })).toBeNull();
  });
});
