'use strict';

const express = require('express');
const request = require('supertest');

describe('supplier PATCH: venue transitions, category/name validation, website URL, amenities', () => {
  let supplier;
  let updateOne;
  let geocodePostcode;
  let isValidUKPostcode;

  beforeEach(() => {
    jest.resetModules();

    supplier = {
      id: 'sup_1',
      ownerUserId: 'usr_supplier',
      name: 'Example Supplier',
      category: 'Photography',
      approved: true,
    };
    updateOne = jest.fn(async (_collection, _filter, update) => {
      Object.assign(supplier, update.$set || {});
      if (update.$unset) {
        Object.keys(update.$unset).forEach(key => delete supplier[key]);
      }
      return true;
    });
    geocodePostcode = jest.fn(async postcode => ({
      latitude: 51.5,
      longitude: -0.12,
      postcode,
    }));
    isValidUKPostcode = jest.fn(value => /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i.test(value));

    jest.doMock('../../photo-upload', () => ({ processAndSaveImage: jest.fn() }));
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
  });

  function app() {
    const router = require('../../routes/supplier-management');
    router.initializeDependencies({
      dbUnified: {
        findOne: jest.fn(async (_collection, filter) =>
          filter.id === supplier.id && filter.ownerUserId === supplier.ownerUserId ? supplier : null
        ),
        updateOne,
        insertOne: jest.fn(),
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
      uid: jest.fn(prefix => `${prefix}_1`),
      geocoding: { isValidUKPostcode, geocodePostcode },
      supplierAnalytics: { getSupplierAnalytics: jest.fn() },
    });

    const instance = express();
    instance.use(express.json({ limit: '10mb' }));
    instance.use(router);
    return instance;
  }

  describe('venue category transitions', () => {
    test('non-Venue to Venues without a postcode returns 400', async () => {
      const res = await request(app()).patch('/sup_1').send({ category: 'Venues' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/venue postcode is required/i);
      expect(updateOne).not.toHaveBeenCalled();
    });

    test('non-Venue to Venues with an invalid postcode returns 400', async () => {
      isValidUKPostcode.mockReturnValue(false);
      const res = await request(app())
        .patch('/sup_1')
        .send({ category: 'Venues', venuePostcode: 'nope' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid uk postcode/i);
      expect(updateOne).not.toHaveBeenCalled();
    });

    test('non-Venue to Venues with a valid postcode stores normalised postcode and coordinates', async () => {
      const res = await request(app())
        .patch('/sup_1')
        .send({ category: 'Venues', venuePostcode: 'sw1a 1aa' });

      expect(res.status).toBe(200);
      expect(geocodePostcode).toHaveBeenCalledWith('SW1A 1AA');
      expect(res.body.supplier.category).toBe('Venues');
      expect(res.body.supplier.venuePostcode).toBe('SW1A 1AA');
      expect(res.body.supplier.latitude).toBe(51.5);
      expect(res.body.supplier.longitude).toBe(-0.12);
    });

    test('Venues to Venues without a new postcode preserves the existing venue data', async () => {
      supplier.category = 'Venues';
      supplier.venuePostcode = 'SW1A 1AA';
      supplier.latitude = 51.5;
      supplier.longitude = -0.12;

      const res = await request(app()).patch('/sup_1').send({ tagline: 'Updated' });

      expect(res.status).toBe(200);
      expect(geocodePostcode).not.toHaveBeenCalled();
      expect(res.body.supplier.venuePostcode).toBe('SW1A 1AA');
      expect(res.body.supplier.latitude).toBe(51.5);
      expect(res.body.supplier.longitude).toBe(-0.12);
    });

    test('Venues to Venues with a new postcode updates and geocodes it', async () => {
      supplier.category = 'Venues';
      supplier.venuePostcode = 'SW1A 1AA';

      const res = await request(app()).patch('/sup_1').send({ venuePostcode: 'EC1A 1BB' });

      expect(res.status).toBe(200);
      expect(geocodePostcode).toHaveBeenCalledWith('EC1A 1BB');
      expect(res.body.supplier.venuePostcode).toBe('EC1A 1BB');
    });

    test('Venues to another category removes postcode and coordinates', async () => {
      supplier.category = 'Venues';
      supplier.venuePostcode = 'SW1A 1AA';
      supplier.latitude = 51.5;
      supplier.longitude = -0.12;

      const res = await request(app()).patch('/sup_1').send({ category: 'Catering' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.category).toBe('Catering');
      expect(res.body.supplier.venuePostcode).toBeUndefined();
      expect(res.body.supplier.latitude).toBeUndefined();
      expect(res.body.supplier.longitude).toBeUndefined();
      expect(updateOne).toHaveBeenCalledWith(
        'suppliers',
        { id: 'sup_1' },
        expect.objectContaining({
          $unset: expect.objectContaining({
            venuePostcode: 1,
            latitude: 1,
            longitude: 1,
          }),
        })
      );
    });
  });

  describe('required name and category validation', () => {
    test('empty PATCH name returns 400 and does not write', async () => {
      const res = await request(app()).patch('/sup_1').send({ name: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name cannot be empty/i);
      expect(updateOne).not.toHaveBeenCalled();
    });

    test('empty PATCH category returns 400 and does not write', async () => {
      const res = await request(app()).patch('/sup_1').send({ category: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/category cannot be empty/i);
      expect(updateOne).not.toHaveBeenCalled();
    });

    test('unsupported category returns 400', async () => {
      const res = await request(app()).patch('/sup_1').send({ category: 'Not A Real Category' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid category/i);
      expect(updateOne).not.toHaveBeenCalled();
    });

    test('a supported category is accepted', async () => {
      const res = await request(app()).patch('/sup_1').send({ category: 'Florist' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.category).toBe('Florist');
    });
  });

  describe('website URL validation', () => {
    test('a valid HTTPS website saves and renders', async () => {
      const res = await request(app())
        .patch('/sup_1')
        .send({ website: 'https://example.com/page' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.website).toBe('https://example.com/page');
    });

    test('a scheme-less domain normalises to HTTPS', async () => {
      const res = await request(app()).patch('/sup_1').send({ website: 'example.com' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.website).toBe('https://example.com/');
    });

    test('a javascript: URL is rejected', async () => {
      const res = await request(app()).patch('/sup_1').send({ website: 'javascript:alert(1)' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/http or https/i);
      expect(updateOne).not.toHaveBeenCalled();
    });

    test('clearing the website stores an empty string', async () => {
      supplier.website = 'https://old.example.com';
      const res = await request(app()).patch('/sup_1').send({ website: '' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.website).toBe('');
    });
  });

  describe('amenities clearing', () => {
    test('sending an empty amenities string clears previously stored amenities', async () => {
      supplier.amenities = ['Parking', 'WiFi'];
      const res = await request(app()).patch('/sup_1').send({ amenities: '' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.amenities).toEqual([]);
    });

    test('omitting amenities leaves existing amenities untouched', async () => {
      supplier.amenities = ['Parking', 'WiFi'];
      const res = await request(app()).patch('/sup_1').send({ tagline: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.supplier.amenities).toEqual(['Parking', 'WiFi']);
    });
  });
});
