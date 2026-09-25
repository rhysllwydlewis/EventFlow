/**
 * The live write path for supplier geography.
 *
 * The migration script maps the suppliers that already exist. These tests cover
 * the other half: every profile a supplier creates or edits from here on has to
 * resolve onto the city registry by itself, or the registry decays back to free
 * text the moment the backfill finishes.
 */

'use strict';

const express = require('express');
const request = require('supertest');

const supplierLocation = require('../../services/supplierLocation.service');

/** Postcodes.io responses keyed by postcode, for the stubbed geocoder. */
const POSTCODES = {
  'CF10 1AA': { postcode: 'CF10 1AA', latitude: 51.4816, longitude: -3.1791 },
  'BS1 4DJ': { postcode: 'BS1 4DJ', latitude: 51.4545, longitude: -2.5879 },
  // Well inside the UK, but far from any registry city centre.
  'IV27 4HW': { postcode: 'IV27 4HW', latitude: 58.4, longitude: -5.0 },
};

const geocodePostcode = jest.fn(
  async postcode => POSTCODES[String(postcode).toUpperCase()] || null
);
const isValidUKPostcode = jest.fn(postcode =>
  /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i.test(String(postcode || '').trim())
);
/** Free-plan default; individual tests override this for a paid-plan supplier. */
const getServiceAreaAllowance = jest.fn(async () => 2);

beforeEach(() => {
  geocodePostcode.mockClear();
  isValidUKPostcode.mockClear();
  getServiceAreaAllowance.mockClear();
  getServiceAreaAllowance.mockImplementation(async () => 2);
});

describe('deriveBaseLocation', () => {
  const derive = supplier =>
    supplierLocation.deriveBaseLocation(supplier, { geocodePostcode, isValidUKPostcode });

  it('maps a base postcode to its city with high confidence', async () => {
    const derived = await derive({ basePostcode: 'CF10 1AA', location: 'anywhere really' });
    expect(derived.baseLocation.citySlug).toBe('cardiff');
    expect(derived.baseLocation.confidence).toBe('high');
    expect(derived.baseLocation.source).toBe('postcode_lookup');
    expect(derived.baseLocation.postcode).toBe('CF10 1AA');
  });

  it('stores the coordinate in GeoJSON longitude-latitude order', async () => {
    const derived = await derive({ basePostcode: 'CF10 1AA' });
    expect(derived.baseLocation.coordinates.type).toBe('Point');
    expect(derived.baseLocation.coordinates.coordinates[0]).toBeCloseTo(-3.1791, 3);
    expect(derived.baseLocation.coordinates.coordinates[1]).toBeCloseTo(51.4816, 3);
  });

  it('prefers a postcode over free text that names a different city', async () => {
    const derived = await derive({ basePostcode: 'BS1 4DJ', location: 'Cardiff' });
    expect(derived.baseLocation.citySlug).toBe('bristol');
  });

  it('falls back to a venue postcode when no base postcode was given', async () => {
    const derived = await derive({ venuePostcode: 'CF10 1AA' });
    expect(derived.baseLocation.citySlug).toBe('cardiff');
  });

  it('reuses coordinates the platform already geocoded rather than looking up again', async () => {
    const derived = await derive({ latitude: 51.4816, longitude: -3.1791 });
    expect(derived.baseLocation.citySlug).toBe('cardiff');
    expect(geocodePostcode).not.toHaveBeenCalled();
  });

  it('maps free text that is exactly a city name', async () => {
    const derived = await derive({ location: 'Cardiff' });
    expect(derived.baseLocation.citySlug).toBe('cardiff');
    expect(derived.baseLocation.source).toBe('registry_name');
  });

  it('maps a Welsh city name onto the same city as its English name', async () => {
    const derived = await derive({ location: 'Caerdydd' });
    expect(derived.baseLocation.citySlug).toBe('cardiff');
  });

  it('refuses to guess at ambiguous free text', async () => {
    expect(await derive({ location: 'Cardiff and surrounding areas' })).toBeNull();
    expect(await derive({ location: 'South Wales' })).toBeNull();
    expect(await derive({ location: 'Cardiff, Newport and Bristol' })).toBeNull();
  });

  it('returns nothing when a supplier has given no location at all', async () => {
    expect(await derive({ name: 'Nameless' })).toBeNull();
    expect(await derive(null)).toBeNull();
  });

  it('does not map a postcode that is nowhere near a registry city', async () => {
    expect(await derive({ basePostcode: 'IV27 4HW' })).toBeNull();
  });

  it('ignores a malformed postcode rather than calling the geocoder', async () => {
    expect(await derive({ basePostcode: 'not a postcode' })).toBeNull();
    expect(geocodePostcode).not.toHaveBeenCalled();
  });

  it('falls through to free text when the postcode lookup finds nothing', async () => {
    const derived = await derive({ basePostcode: 'BS1 9ZZ', location: 'Cardiff' });
    expect(derived.baseLocation.citySlug).toBe('cardiff');
    expect(derived.baseLocation.source).toBe('registry_name');
  });

  it('explains every mapping it makes', async () => {
    const derived = await derive({ basePostcode: 'CF10 1AA' });
    expect(derived.reason).toMatch(/postcode resolves to Cardiff/);
  });

  it('produces a base location the matcher immediately understands', async () => {
    const derived = await derive({ basePostcode: 'CF10 1AA' });
    const registry = require('../../services/locationRegistry.service');
    const match = supplierLocation.matchSupplierToCity(
      { baseLocation: derived.baseLocation },
      registry.getCity('cardiff')
    );
    expect(match.relationship).toBe('based_in');
  });
});

describe('sanitiseServiceAreas', () => {
  it('keeps known cities and canonicalises their slugs', () => {
    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'city', slug: 'caerdydd' },
        { type: 'city', slug: 'Bristol' },
      ])
    ).toEqual([
      { type: 'city', slug: 'cardiff' },
      { type: 'city', slug: 'bristol' },
    ]);
  });

  it('drops unknown cities rather than storing coverage no page honours', () => {
    expect(supplierLocation.sanitiseServiceAreas([{ type: 'city', slug: 'atlantis' }])).toEqual([]);
  });

  it('de-duplicates a city listed twice under different names', () => {
    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'city', slug: 'cardiff' },
        { type: 'city', slug: 'caerdydd' },
      ])
    ).toHaveLength(1);
  });

  it('caps a travel radius at the maximum journey', () => {
    expect(supplierLocation.sanitiseServiceAreas([{ type: 'radius', miles: 5000 }])).toEqual([
      { type: 'radius', miles: supplierLocation.MAX_TRAVEL_RADIUS_MILES },
    ]);
  });

  it('ignores a zero, negative or non-numeric radius', () => {
    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'radius', miles: 0 },
        { type: 'radius', miles: -10 },
        { type: 'radius', miles: 'lots' },
      ])
    ).toEqual([]);
  });

  it('keeps only the first radius and the first nationwide claim', () => {
    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'radius', miles: 10 },
        { type: 'radius', miles: 90 },
        { type: 'nationwide' },
        { type: 'nationwide' },
      ])
    ).toEqual([{ type: 'radius', miles: 10 }, { type: 'nationwide' }]);
  });

  it('drops unrecognised shapes and non-array input', () => {
    expect(supplierLocation.sanitiseServiceAreas([{ type: 'planet' }, null, 'cardiff'])).toEqual(
      []
    );
    expect(supplierLocation.sanitiseServiceAreas('cardiff')).toEqual([]);
    expect(supplierLocation.sanitiseServiceAreas(undefined)).toEqual([]);
  });

  it('drops city picks once nationwide is present, in either order', () => {
    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'nationwide' },
        { type: 'city', slug: 'cardiff' },
      ])
    ).toEqual([{ type: 'nationwide' }]);

    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'city', slug: 'cardiff' },
        { type: 'city', slug: 'bristol' },
        { type: 'nationwide' },
      ])
    ).toEqual([{ type: 'nationwide' }]);
  });

  it('keeps a radius alongside nationwide — only city picks are redundant', () => {
    expect(
      supplierLocation.sanitiseServiceAreas([
        { type: 'nationwide' },
        { type: 'radius', miles: 30 },
        { type: 'city', slug: 'cardiff' },
      ])
    ).toEqual([{ type: 'nationwide' }, { type: 'radius', miles: 30 }]);
  });

  it('round-trips through the read path the pages use', () => {
    const areas = supplierLocation.sanitiseServiceAreas([
      { type: 'city', slug: 'caerdydd' },
      { type: 'radius', miles: 40 },
    ]);
    const coverage = supplierLocation.normaliseServiceAreas({ serviceAreas: areas });
    expect(coverage.cities).toEqual(['cardiff']);
    expect(coverage.radiusMiles).toBe(40);
  });
});

describe('supplier profile routes', () => {
  let supplier;
  let inserted;
  let updateOne;

  beforeEach(() => {
    jest.resetModules();
    inserted = null;
    supplier = {
      id: 'sup_1',
      ownerUserId: 'usr_supplier',
      name: 'Example Supplier',
      category: 'Photography',
      approved: true,
      location: 'Cardiff',
    };
    updateOne = jest.fn(async (_collection, _filter, update) => {
      Object.assign(supplier, update.$set || {});
      return true;
    });

    jest.doMock('../../services/catalogCache', () => ({
      invalidate: jest.fn(async () => undefined),
    }));
    jest.doMock('../../services/supplierProfileProvisioning.service', () => ({
      supplierApprovalDefaults: jest.fn(async () => ({ approved: false })),
    }));
    jest.doMock('../../middleware/audit', () => ({
      auditLog: jest.fn(async () => ({ id: 'audit_1' })),
      AUDIT_ACTIONS: { SUPPLIER_APPROVED: 'supplier_approved' },
    }));
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock('../../services/subscriptionService', () => ({
      getServiceAreaAllowance,
      checkFeatureAccess: jest.fn(async () => false),
    }));
  });

  /**
   * Mount the supplier management routes with stubbed dependencies.
   * @param {Object} overrides Dependency overrides.
   * @returns {Object} Express app.
   */
  function app(overrides = {}) {
    const router = require('../../routes/supplier-management');
    router.initializeDependencies({
      dbUnified: {
        findOne: jest.fn(async (collection, filter) => {
          if (collection === 'users') {
            return { id: 'usr_supplier', email: 'supplier@example.com' };
          }
          if (filter.ownerUserId && !filter.id) {
            return overrides.existingProfile === undefined ? null : overrides.existingProfile;
          }
          return filter.id === supplier.id ? supplier : null;
        }),
        updateOne,
        insertOne: jest.fn(async (_collection, record) => {
          inserted = record;
          return true;
        }),
        find: jest.fn(async () => []),
        read: jest.fn(async () => []),
      },
      authRequired: (req, _res, next) => {
        req.user = { id: 'usr_supplier', role: 'supplier', email: 'supplier@example.com' };
        next();
      },
      roleRequired: () => (_req, _res, next) => next(),
      requireVerifiedUser: (_req, _res, next) => next(),
      csrfProtection: (_req, _res, next) => next(),
      writeLimiter: (_req, _res, next) => next(),
      uid: jest.fn(prefix => `${prefix}_new`),
      geocoding: { isValidUKPostcode, geocodePostcode, ...(overrides.geocoding || {}) },
      supplierAnalytics: { getSupplierAnalytics: jest.fn() },
    });

    const instance = express();
    instance.use(express.json({ limit: '10mb' }));
    instance.use(router);
    return instance;
  }

  it('maps a new profile onto a city as it is created', async () => {
    const response = await request(app())
      .post('/')
      .send({ name: 'New Co', category: 'Photography', basePostcode: 'cf10 1aa' });

    expect(response.status).toBe(200);
    expect(inserted.basePostcode).toBe('CF10 1AA');
    expect(inserted.baseLocation.citySlug).toBe('cardiff');
    expect(inserted.locationMappingReviewRequired).toBe(false);
  });

  it('keeps the legacy location string exactly as the supplier typed it', async () => {
    await request(app())
      .post('/')
      .send({ name: 'New Co', category: 'Photography', location: 'Cardiff' });

    expect(inserted.location).toBe('Cardiff');
    expect(inserted.baseLocation.citySlug).toBe('cardiff');
  });

  it('flags a profile it cannot map instead of guessing at one', async () => {
    await request(app())
      .post('/')
      .send({ name: 'New Co', category: 'Photography', location: 'South Wales and the borders' });

    expect(inserted.baseLocation).toBeNull();
    expect(inserted.locationMappingReviewRequired).toBe(true);
  });

  it('rejects a malformed base postcode on create', async () => {
    const response = await request(app())
      .post('/')
      .send({ name: 'New Co', category: 'Photography', basePostcode: 'XX' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/postcode/i);
  });

  it('stores validated coverage on create', async () => {
    await request(app())
      .post('/')
      .send({
        name: 'New Co',
        category: 'Photography',
        location: 'Cardiff',
        serviceAreas: [{ type: 'city', slug: 'newport' }, { type: 'planet' }],
      });

    expect(inserted.serviceAreas).toEqual([{ type: 'city', slug: 'newport' }]);
  });

  it('accepts the same field lengths on create as an edit later would', async () => {
    const description_short = 'x'.repeat(250);
    const description_long = 'y'.repeat(3000);
    const location = 'z'.repeat(150);

    await request(app()).post('/').send({
      name: 'New Co',
      category: 'Photography',
      description_short,
      description_long,
      location,
    });

    expect(inserted.description_short).toBe(description_short);
    expect(inserted.description_long).toBe(description_long);
    expect(inserted.location).toBe(location);
  });

  it('rejects more picks than the plan allows on create', async () => {
    getServiceAreaAllowance.mockImplementation(async () => 2);

    const response = await request(app())
      .post('/')
      .send({
        name: 'New Co',
        category: 'Photography',
        location: 'Cardiff',
        serviceAreas: [
          { type: 'city', slug: 'cardiff' },
          { type: 'city', slug: 'bristol' },
          { type: 'city', slug: 'newport' },
          { type: 'city', slug: 'swansea' },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/up to 2/i);
    expect(inserted).toBeNull();
  });

  it('re-derives the mapping when an edit moves the supplier', async () => {
    const response = await request(app()).patch('/sup_1').send({ basePostcode: 'BS1 4DJ' });

    expect(response.status).toBe(200);
    expect(supplier.baseLocation.citySlug).toBe('bristol');
    expect(supplier.basePostcode).toBe('BS1 4DJ');
  });

  it('leaves the mapping alone when an edit changes something else', async () => {
    supplier.baseLocation = { citySlug: 'cardiff', source: 'postcode_lookup', confidence: 'high' };
    await request(app()).patch('/sup_1').send({ tagline: 'Now with more confetti' });

    const [, , update] = updateOne.mock.calls[0];
    expect(update.$set).not.toHaveProperty('baseLocation');
    expect(geocodePostcode).not.toHaveBeenCalled();
  });

  it('does not re-derive unchanged location fields sent by the full dashboard form', async () => {
    supplier.basePostcode = 'CF10 1AA';
    supplier.baseLocation = { citySlug: 'cardiff', source: 'postcode_lookup', confidence: 'high' };
    const unavailableLookup = jest.fn(async () => null);

    const response = await request(app({ geocoding: { geocodePostcode: unavailableLookup } }))
      .patch('/sup_1')
      .send({
        tagline: 'Now with more confetti',
        location: 'Cardiff',
        basePostcode: 'cf10 1aa',
      });

    expect(response.status).toBe(200);
    expect(unavailableLookup).not.toHaveBeenCalled();
    expect(supplier.baseLocation).toEqual({
      citySlug: 'cardiff',
      source: 'postcode_lookup',
      confidence: 'high',
    });
  });

  it('preserves existing picks when only the travel radius is edited', async () => {
    supplier.serviceAreas = [
      { type: 'city', slug: 'cardiff' },
      { type: 'radius', miles: 30 },
    ];

    const response = await request(app())
      .patch('/sup_1')
      .send({
        serviceAreas: [{ type: 'radius', miles: 50 }],
      });

    expect(response.status).toBe(200);
    expect(supplier.serviceAreas).toEqual([
      { type: 'city', slug: 'cardiff' },
      { type: 'radius', miles: 50 },
    ]);
  });

  it('still accepts an explicit city coverage replacement from an API client', async () => {
    supplier.serviceAreas = [{ type: 'city', slug: 'cardiff' }];

    const response = await request(app())
      .patch('/sup_1')
      .send({ serviceAreas: [{ type: 'city', slug: 'bristol' }] });

    expect(response.status).toBe(200);
    expect(supplier.serviceAreas).toEqual([{ type: 'city', slug: 'bristol' }]);
  });

  it('treats an explicit nationwide claim the same as a city replacement', async () => {
    supplier.serviceAreas = [{ type: 'city', slug: 'cardiff' }];

    const response = await request(app())
      .patch('/sup_1')
      .send({ serviceAreas: [{ type: 'nationwide' }] });

    expect(response.status).toBe(200);
    expect(supplier.serviceAreas).toEqual([{ type: 'nationwide' }]);
  });

  describe('admin-assigned service areas', () => {
    it('is retained when the supplier replaces their own picks', async () => {
      supplier.serviceAreas = [
        { type: 'city', slug: 'cardiff', source: 'admin' },
        { type: 'city', slug: 'bristol' },
      ];

      const response = await request(app())
        .patch('/sup_1')
        .send({ serviceAreas: [{ type: 'city', slug: 'newport' }] });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual(
        expect.arrayContaining([
          { type: 'city', slug: 'cardiff', source: 'admin' },
          { type: 'city', slug: 'newport' },
        ])
      );
      expect(supplier.serviceAreas).not.toEqual(
        expect.arrayContaining([{ type: 'city', slug: 'bristol' }])
      );
    });

    it('is retained when the picker clears every self-service pick', async () => {
      supplier.serviceAreas = [
        { type: 'city', slug: 'cardiff', source: 'admin' },
        { type: 'city', slug: 'bristol' },
      ];

      const response = await request(app())
        .patch('/sup_1')
        .send({ serviceAreas: [], replaceServiceAreaPicks: true });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual([{ type: 'city', slug: 'cardiff', source: 'admin' }]);
    });

    it('is retained when the supplier claims nationwide coverage', async () => {
      supplier.serviceAreas = [{ type: 'city', slug: 'cardiff', source: 'admin' }];

      const response = await request(app())
        .patch('/sup_1')
        .send({ serviceAreas: [{ type: 'nationwide' }] });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual(
        expect.arrayContaining([
          { type: 'city', slug: 'cardiff', source: 'admin' },
          { type: 'nationwide' },
        ])
      );
    });

    it('does not count against the supplier self-service allowance', async () => {
      getServiceAreaAllowance.mockImplementation(async () => 1);
      supplier.serviceAreas = [{ type: 'city', slug: 'cardiff', source: 'admin' }];

      const response = await request(app())
        .patch('/sup_1')
        .send({ serviceAreas: [{ type: 'city', slug: 'newport' }] });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual(
        expect.arrayContaining([
          { type: 'city', slug: 'cardiff', source: 'admin' },
          { type: 'city', slug: 'newport' },
        ])
      );
    });

    it('cannot be minted by a supplier tagging their own request as admin-assigned', async () => {
      supplier.serviceAreas = [];

      const response = await request(app())
        .patch('/sup_1')
        .send({ serviceAreas: [{ type: 'city', slug: 'cardiff', source: 'admin' }] });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual([{ type: 'city', slug: 'cardiff' }]);
    });
  });

  it('clears every pick when the picker sends an empty list with the replace flag', async () => {
    supplier.serviceAreas = [
      { type: 'city', slug: 'cardiff' },
      { type: 'radius', miles: 30 },
    ];

    const response = await request(app())
      .patch('/sup_1')
      .send({
        serviceAreas: [{ type: 'radius', miles: 30 }],
        replaceServiceAreaPicks: true,
      });

    expect(response.status).toBe(200);
    expect(supplier.serviceAreas).toEqual([{ type: 'radius', miles: 30 }]);
  });

  it('rejects more picks than the free plan allows', async () => {
    getServiceAreaAllowance.mockImplementation(async () => 2);

    const response = await request(app())
      .patch('/sup_1')
      .send({
        serviceAreas: [
          { type: 'city', slug: 'cardiff' },
          { type: 'city', slug: 'bristol' },
          { type: 'city', slug: 'newport' },
          { type: 'city', slug: 'swansea' },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/up to 2/i);
    expect(response.body.limit).toBe(2);
  });

  it('allows a paid-plan supplier a higher self-service quota', async () => {
    getServiceAreaAllowance.mockImplementation(async () => 4);

    const response = await request(app())
      .patch('/sup_1')
      .send({
        serviceAreas: [
          { type: 'city', slug: 'cardiff' },
          { type: 'city', slug: 'bristol' },
          { type: 'city', slug: 'newport' },
          { type: 'city', slug: 'swansea' },
        ],
      });

    expect(response.status).toBe(200);
    expect(supplier.serviceAreas).toHaveLength(4);
  });

  it('does not let a redundant nationwide+city request falsely trip the allowance cap', async () => {
    // Nationwide collapses away any city picks sent alongside it (see
    // sanitiseServiceAreas), so a request that *looks* like 4 picks but is
    // really just "go nationwide" must not be rejected as over a 2-pick
    // allowance — only the resulting 1 real pick counts against it.
    getServiceAreaAllowance.mockImplementation(async () => 2);

    const response = await request(app())
      .patch('/sup_1')
      .send({
        serviceAreas: [
          { type: 'city', slug: 'cardiff' },
          { type: 'city', slug: 'bristol' },
          { type: 'city', slug: 'newport' },
          { type: 'nationwide' },
        ],
      });

    expect(response.status).toBe(200);
    expect(supplier.serviceAreas).toEqual([{ type: 'nationwide' }]);
  });

  describe('downgrading a plan while already over the new allowance', () => {
    /** Five picks — more than the free plan's allowance of 2 — as if saved while on a paid plan. */
    const fivePicks = [
      { type: 'city', slug: 'cardiff' },
      { type: 'city', slug: 'bristol' },
      { type: 'city', slug: 'newport' },
      { type: 'city', slug: 'london' },
      { type: 'city', slug: 'swansea' },
    ];

    beforeEach(() => {
      supplier.serviceAreas = fivePicks;
      getServiceAreaAllowance.mockImplementation(async () => 2);
    });

    it('keeps every existing pick when an unrelated field is saved', async () => {
      // The dashboard resends the supplier's full current pick list on every
      // save, even one that only touches an unrelated field — this must not
      // be read as "add 5 picks" and rejected against the new, lower cap.
      const response = await request(app())
        .patch('/sup_1')
        .send({ tagline: 'Now serving five cities', serviceAreas: fivePicks });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual(fivePicks);
      expect(supplier.tagline).toBe('Now serving five cities');
    });

    it('lets a downgraded supplier rearrange picks without shrinking below the old count', async () => {
      const swapped = [
        { type: 'city', slug: 'cardiff' },
        { type: 'city', slug: 'bristol' },
        { type: 'city', slug: 'newport' },
        { type: 'city', slug: 'manchester' },
        { type: 'city', slug: 'leeds' },
      ];

      const response = await request(app()).patch('/sup_1').send({ serviceAreas: swapped });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toEqual(swapped);
    });

    it('lets a downgraded supplier shrink their picks below the old count', async () => {
      const response = await request(app())
        .patch('/sup_1')
        .send({
          serviceAreas: [
            { type: 'city', slug: 'cardiff' },
            { type: 'city', slug: 'bristol' },
            { type: 'city', slug: 'newport' },
          ],
        });

      expect(response.status).toBe(200);
      expect(supplier.serviceAreas).toHaveLength(3);
    });

    it('still rejects a downgraded supplier trying to add a 6th pick', async () => {
      const response = await request(app())
        .patch('/sup_1')
        .send({
          serviceAreas: [...fivePicks, { type: 'city', slug: 'manchester' }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/up to 2/i);
      expect(supplier.serviceAreas).toEqual(fivePicks);
    });

    it('re-enforces the cap once the supplier is back at or under their new allowance', async () => {
      // Shrink to exactly the new limit first...
      const atLimit = await request(app())
        .patch('/sup_1')
        .send({
          serviceAreas: [
            { type: 'city', slug: 'cardiff' },
            { type: 'city', slug: 'bristol' },
          ],
        });
      expect(atLimit.status).toBe(200);

      // ...then growing even by one is rejected again, same as any other
      // supplier at their plan's limit.
      const grown = await request(app())
        .patch('/sup_1')
        .send({
          serviceAreas: [
            { type: 'city', slug: 'cardiff' },
            { type: 'city', slug: 'bristol' },
            { type: 'city', slug: 'newport' },
          ],
        });

      expect(grown.status).toBe(400);
      expect(grown.body.error).toMatch(/up to 2/i);
    });
  });

  it('does not geocode an unchanged venue postcode from a full form save', async () => {
    supplier.category = 'Venues';
    supplier.venuePostcode = 'CF10 1AA';
    supplier.baseLocation = { citySlug: 'cardiff', source: 'postcode_lookup', confidence: 'high' };
    const unavailableLookup = jest.fn(async () => null);

    const response = await request(app({ geocoding: { geocodePostcode: unavailableLookup } }))
      .patch('/sup_1')
      .send({ venuePostcode: 'cf10 1aa', tagline: 'Same venue, new tagline' });

    expect(response.status).toBe(200);
    expect(unavailableLookup).not.toHaveBeenCalled();
    expect(supplier.baseLocation.citySlug).toBe('cardiff');
  });

  it('never overwrites a mapping an admin verified by hand', async () => {
    supplier.baseLocation = { citySlug: 'cardiff', source: 'admin_verified', confidence: 'high' };
    await request(app()).patch('/sup_1').send({ location: 'Bristol' });

    expect(supplier.baseLocation.citySlug).toBe('cardiff');
    expect(supplier.baseLocation.source).toBe('admin_verified');
  });

  it('clears a stale mapping when the supplier replaces it with something vague', async () => {
    supplier.baseLocation = { citySlug: 'cardiff', source: 'registry_name', confidence: 'high' };
    await request(app()).patch('/sup_1').send({ location: 'Wales, mostly' });

    expect(supplier.baseLocation).toBeNull();
    expect(supplier.locationMappingReviewRequired).toBe(true);
  });

  it('rejects a malformed base postcode on edit', async () => {
    const response = await request(app()).patch('/sup_1').send({ basePostcode: 'XX' });
    expect(response.status).toBe(400);
  });

  it('lets a supplier clear their base postcode', async () => {
    supplier.basePostcode = 'CF10 1AA';
    await request(app()).patch('/sup_1').send({ basePostcode: '  ' });
    expect(supplier.basePostcode).toBeNull();
  });

  it('saves the profile even when the geocoder is unreachable', async () => {
    const response = await request(
      app({
        geocoding: {
          geocodePostcode: jest.fn(async () => {
            throw new Error('Postcodes.io timed out');
          }),
        },
      })
    )
      .patch('/sup_1')
      .send({ basePostcode: 'CF10 1AA', location: 'Wales, mostly' });

    expect(response.status).toBe(200);
    expect(supplier.basePostcode).toBe('CF10 1AA');
    expect(supplier.locationMappingReviewRequired).toBe(true);
  });

  it('falls back to free text when the geocoder is unreachable', async () => {
    const response = await request(
      app({
        geocoding: {
          geocodePostcode: jest.fn(async () => {
            throw new Error('Postcodes.io timed out');
          }),
        },
      })
    )
      .patch('/sup_1')
      .send({ basePostcode: 'CF10 1AA' });

    expect(response.status).toBe(200);
    expect(supplier.baseLocation.citySlug).toBe('cardiff');
    expect(supplier.baseLocation.source).toBe('registry_name');
  });
});
