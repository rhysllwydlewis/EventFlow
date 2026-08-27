'use strict';

const express = require('express');
const request = require('supertest');
const createPublicSupplierSeoRouter = require('../../routes/public-supplier-seo');
const { buildPublicSupplierSlug } = require('../../services/publicSupplierSeo.service');
const { lifecycleBlockReason } = require('../../services/seoRecordLifecycle.util');
const {
  isSupplierBotPilotProfile,
  pilotPresentationSupplier,
} = require('../../services/supplierBotPilotVisibility.util');

function createApp(suppliers) {
  const dbUnified = {
    read: jest.fn(async collection => {
      if (collection === 'suppliers') {
        return suppliers;
      }
      return [];
    }),
  };
  const app = express();
  app.use(
    createPublicSupplierSeoRouter({
      dbUnified,
      logger: { error: jest.fn() },
      baseUrl: 'https://event-flow.co.uk',
      supplierCacheTtlMs: 0,
    })
  );
  app.use((_req, res) => res.status(404).send('Not found'));
  return app;
}

function pilotSupplier(overrides = {}) {
  return {
    id: 'sup_bot_pilot_1',
    ownershipStatus: 'unclaimed',
    name: 'Pilot Venue',
    category: 'Venues',
    location: 'South Wales',
    website: 'https://pilot-venue.example/',
    status: 'draft',
    approved: false,
    tags: ['Weddings', 'Exclusive hire'],
    acquisition: {
      source: 'supplier_bot',
      candidateId: 'candidate_pilot_1',
      publicationScope: 'pilot_unclaimed',
      advertisedPrices: ['From £2,500'],
      sourcePackages: [
        { name: 'Exclusive hire', price: '£2,500', features: ['Exclusive use', 'Ceremony room'] },
      ],
      sourceMedia: {
        coverImage: 'https://pilot-venue.example/media/hero.jpg',
        images: [
          'https://pilot-venue.example/media/hero.jpg',
          'https://pilot-venue.example/media/reception.jpg',
        ],
        evidence: [],
      },
    },
    ...overrides,
  };
}

describe('one-profile Supplier Bot production pilot', () => {
  test('keeps the normal lifecycle fail-closed while allowing only the explicit pilot direct route', async () => {
    const supplier = pilotSupplier();
    expect(lifecycleBlockReason(supplier)).toBe('not_approved');
    expect(isSupplierBotPilotProfile(supplier)).toBe(true);

    const slug = buildPublicSupplierSlug(supplier);
    const response = await request(createApp([supplier]))
      .get(`/supplier/${slug}`)
      .expect(200);

    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(response.text).toContain('Unclaimed profile');
    expect(response.text).not.toContain('id="supplier-structured-data"');
  });

  test('redirects the pilot plain-slug tester URL to its canonical tokenised profile', async () => {
    const supplier = pilotSupplier({ name: 'Hensol Castle' });
    const canonicalSlug = buildPublicSupplierSlug(supplier);

    const response = await request(createApp([supplier]))
      .get('/supplier/hensol-castle?utm_source=pilot&junk=discarded')
      .expect(302);

    expect(response.headers.location).toBe(`/supplier/${canonicalSlug}?utm_source=pilot`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
  });

  test('does not expose an ordinary unclaimed Supplier Bot draft through tokenised or plain direct routes', async () => {
    const supplier = pilotSupplier({
      id: 'sup_bot_hidden',
      name: 'Hidden Venue',
      acquisition: {
        ...pilotSupplier().acquisition,
        candidateId: 'candidate_hidden',
        publicationScope: undefined,
      },
    });
    const slug = buildPublicSupplierSlug(supplier);

    const tokenisedResponse = await request(createApp([supplier]))
      .get(`/supplier/${slug}`)
      .expect(404);
    expect(tokenisedResponse.headers['x-robots-tag']).toBe('noindex, nofollow');

    const plainResponse = await request(createApp([supplier]))
      .get('/supplier/hidden-venue')
      .expect(404);
    expect(plainResponse.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('projects source media, services, price and package evidence for the pilot render without mutating stored public fields', () => {
    const stored = pilotSupplier({ coverImage: '', images: [], priceRange: '£' });
    const presented = pilotPresentationSupplier(stored);

    expect(presented.coverImage).toBe('https://pilot-venue.example/media/hero.jpg');
    expect(presented.images).toHaveLength(2);
    expect(presented.featuredServices).toEqual(['Weddings', 'Exclusive hire']);
    expect(presented.priceRange).toBe('From £2,500');
    expect(presented.topPackages[0]).toMatchObject({
      title: 'Exclusive hire',
      price: '£2,500',
    });
    expect(stored.coverImage).toBe('');
    expect(stored.images).toEqual([]);
  });
});
