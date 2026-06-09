'use strict';

const {
  getSupplierProfilePackageCards,
  toSupplierProfilePackageCard,
} = require('../../services/supplierProfilePackageCards');

describe('supplier profile package cards v2 serializer', () => {
  it('returns the clean public card contract with one resolved imageUrl', () => {
    const card = toSupplierProfilePackageCard({
      id: 'pkg_1',
      slug: 'foil-stamping',
      supplierId: 'sup_1',
      title: 'Foil Stamping',
      description: 'Premium foil details.',
      price: 650,
      image: '/api/photos/foil',
      rawImage: '/do-not-include',
      resolvedGallery: [{ url: '/do-not-include' }],
      approved: true,
    });

    expect(card).toEqual({
      id: 'pkg_1',
      slug: 'foil-stamping',
      supplierId: 'sup_1',
      title: 'Foil Stamping',
      description: 'Premium foil details.',
      priceDisplay: '£650',
      imageUrl: '/api/photos/foil',
      imageAlt: 'Foil Stamping package image',
      detailUrl: '/package/foil-stamping',
    });
    expect(card).not.toHaveProperty('rawImage');
    expect(card).not.toHaveProperty('resolvedGallery');
  });

  it('filters to approved package records for the requested supplier', async () => {
    const db = {
      read: jest.fn(async () => [
        {
          id: 'pkg_1',
          supplierId: 'sup_1',
          title: 'Visible',
          approved: true,
          image: '/api/photos/one',
        },
        {
          id: 'pkg_2',
          supplierId: 'sup_1',
          title: 'Hidden',
          approved: false,
          image: '/api/photos/two',
        },
        {
          id: 'pkg_3',
          supplierId: 'sup_2',
          title: 'Other',
          approved: true,
          image: '/api/photos/three',
        },
      ]),
    };

    const payload = await getSupplierProfilePackageCards('sup_1', { db });

    expect(payload.count).toBe(1);
    expect(payload.items[0]).toMatchObject({ id: 'pkg_1', imageUrl: '/api/photos/one' });
    expect(payload.meta.endpoint).toBe('supplier-profile-package-cards-v2');
  });

  it('uses supplier-scoped find queries for canonical and legacy supplier id fields', async () => {
    const db = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'pkg_1',
            supplierId: 'sup_1',
            title: 'Canonical',
            approved: true,
            image: '/api/photos/one',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'pkg_2',
            supplier_id: 'sup_1',
            title: 'Legacy',
            approved: true,
            image: '/api/photos/two',
          },
        ]),
      read: jest.fn(),
    };

    const payload = await getSupplierProfilePackageCards('sup_1', { db });

    expect(db.find).toHaveBeenCalledWith('packages', { supplierId: 'sup_1' });
    expect(db.find).toHaveBeenCalledWith('packages', { supplier_id: 'sup_1' });
    expect(db.read).not.toHaveBeenCalled();
    expect(payload.items.map(item => item.id)).toEqual(['pkg_1', 'pkg_2']);
  });

  it('includes duplicate title evidence in debug mode', async () => {
    const db = {
      read: jest.fn(async () => [
        {
          id: 'pkg_a',
          supplierId: 'sup_1',
          title: 'Engraving',
          approved: true,
          image: '/api/photos/a',
        },
        {
          id: 'pkg_b',
          supplierId: 'sup_1',
          title: 'Engraving',
          approved: false,
          image: '/api/photos/b',
        },
      ]),
    };

    const payload = await getSupplierProfilePackageCards('sup_1', { db, debug: true });

    expect(payload.items[0].debug).toMatchObject({
      duplicateTitleCount: 2,
      duplicatePackageIds: ['pkg_a', 'pkg_b'],
      imageSource: 'image',
    });
    expect(payload.items[0].debug.candidates[0]).toMatchObject({ source: 'image', usable: true });
  });
});
