'use strict';

const express = require('express');
const request = require('supertest');
const route = require('../../routes/supplier-profile-package-cards');

function createApp(packages, supplier = { id: 'sup_1', approved: true }) {
  const app = express();
  const db = {
    findOne: jest.fn(async (collection, query) => {
      if (collection === 'suppliers' && query.id === supplier.id) {
        return supplier;
      }
      return null;
    }),
    read: jest.fn(async collection => (collection === 'packages' ? packages : [])),
  };
  route.initializeDependencies({ dbUnified: db, logger: { error: jest.fn() } });
  app.use('/api', route);
  return app;
}

describe('supplier profile package cards v2 route', () => {
  it('returns the v2 contract and route ownership headers', async () => {
    const app = createApp([
      {
        id: 'pkg_1',
        slug: 'foil-stamping',
        supplierId: 'sup_1',
        title: 'Foil Stamping',
        approved: true,
        image: '/api/photos/foil',
        rawImage: '/legacy/raw',
        resolvedGallery: [{ url: '/legacy/gallery' }],
      },
    ]);

    const res = await request(app).get('/api/supplier-profile/sup_1/package-cards').expect(200);

    expect(res.headers['x-eventflow-supplier-packages-renderer']).toBe('v2');
    expect(res.body.meta.endpoint).toBe('supplier-profile-package-cards-v2');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: 'pkg_1',
      supplierId: 'sup_1',
      title: 'Foil Stamping',
      imageUrl: '/api/photos/foil',
    });
    expect(res.body.items[0]).not.toHaveProperty('rawImage');
    expect(res.body.items[0]).not.toHaveProperty('resolvedGallery');
  });

  it('includes candidate evidence and duplicate detection in debug mode', async () => {
    const app = createApp([
      {
        id: 'pkg_1',
        supplierId: 'sup_1',
        title: 'Engraving',
        approved: true,
        image: '/assets/images/placeholders/package-event.svg',
        gallery: [{ optimized: '/api/photos/engraving' }],
      },
      {
        id: 'pkg_2',
        supplierId: 'sup_1',
        title: 'Engraving',
        approved: false,
        image: '/api/photos/hidden',
      },
    ]);

    const res = await request(app)
      .get('/api/supplier-profile/sup_1/package-cards?debugImages=1')
      .expect(200);

    expect(res.body.items[0].imageUrl).toBe('/api/photos/engraving');
    expect(res.body.items[0].debug).toMatchObject({
      imageSource: 'gallery[0].optimized',
      duplicateTitleCount: 2,
      duplicatePackageIds: ['pkg_1', 'pkg_2'],
    });
    expect(res.body.items[0].debug.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'image', usable: false, rejectedReason: 'placeholder' }),
        expect.objectContaining({ source: 'gallery[0].optimized', usable: true }),
      ])
    );
  });

  it('serves Supplier Bot pilot package evidence without requiring approved package records', async () => {
    const supplier = {
      id: 'sup_pilot',
      slug: 'pilot-venue',
      approved: false,
      ownershipStatus: 'unclaimed',
      acquisition: {
        source: 'supplier_bot',
        publicationScope: 'pilot_unclaimed',
        sourcePackages: [
          {
            name: 'Exclusive Wedding Package',
            description: 'Venue hire with catering.',
            priceDisplay: 'From £2,500',
          },
        ],
      },
    };
    const app = createApp([], supplier);

    const res = await request(app).get('/api/supplier-profile/sup_pilot/package-cards').expect(200);

    expect(res.body.meta).toMatchObject({
      endpoint: 'supplier-profile-package-cards-v2',
      source: 'supplier_bot_publication_evidence_fallback',
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      supplierId: 'sup_pilot',
      title: 'Exclusive Wedding Package',
      description: 'Venue hire with catering.',
      priceDisplay: 'From £2,500',
      detailUrl: '/supplier/pilot-venue',
    });
  });
});
