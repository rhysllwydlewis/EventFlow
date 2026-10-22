'use strict';

/**
 * Every server reader shows the price the same way (utils/packagePrice.js): price_display first,
 * then price. These are the readers that used to differ.
 */

const { safePublicPackage } = require('../../utils/supplierPublicProfile');
const { toSupplierProfilePackageCard } = require('../../services/supplierProfilePackageCards');
const PackageService = require('../../services/package.service');
const { priceFields } = require('../../utils/packagePrice');

describe('safePublicPackage (the supplier profile packages API)', () => {
  it('shows price_display before price in every price field', () => {
    const out = safePublicPackage({ id: 'p', price: '£1,200', price_display: '£1,500' });
    expect([out.price, out.price_display, out.priceDisplay]).toEqual([
      '£1,500',
      '£1,500',
      '£1,500',
    ]);
  });

  it('uses the typed price when there is no display price', () => {
    const out = safePublicPackage({ id: 'p', price: '£900' });
    expect(out.price_display).toBe('£900');
  });

  it('still shows a bot-imported camelCase price when nothing else is set', () => {
    expect(safePublicPackage({ id: 'p', priceDisplay: 'From £300' }).price).toBe('From £300');
  });
});

describe('toSupplierProfilePackageCard price', () => {
  const price = pkg => toSupplierProfilePackageCard({ id: 'p', title: 'T', ...pkg }).priceDisplay;

  it('shows the admin text over a stale typed price, once, with one pound sign', () => {
    expect(price({ price: '£1,200', price_display: '£1,500' })).toBe('£1,500');
  });

  it('shows text written with words as written', () => {
    expect(price({ price_display: 'From £800' })).toBe('From £800');
    expect(price({ price: '£45 pp' })).toBe('£45 pp');
  });

  it('puts a pound sign and grouping on a bare amount', () => {
    expect(price({ price: '1200' })).toBe('£1,200');
  });

  it('prefers the canonical price to a stale bot-imported one', () => {
    expect(price({ price_display: '£700', priceDisplay: '£500' })).toBe('£700');
  });
});

describe('PackageService writes both price fields', () => {
  it('on create', async () => {
    const inserted = [];
    const db = {
      insertOne: async (collection, doc) => {
        inserted.push(doc);
        return doc;
      },
      findOne: async () => null,
      read: async () => [],
    };
    const service = new PackageService(db, prefix => `${prefix}_1`);
    await service.createPackage({ name: 'Gold', price: '£500', supplierId: 's1' }, 'u1', 'admin');
    expect(inserted[0]).toMatchObject(priceFields('£500'));
  });
});
