'use strict';

/**
 * A package has one price, held in both `price` (what suppliers type) and `price_display` (what the
 * admin screens edit and the public pages show first). Whichever editor saves, both fields change,
 * so nobody is ever shown a price that someone else has already replaced.
 */

jest.mock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');
const {
  MAX_PRICE_LENGTH,
  cleanPrice,
  packagePriceText,
  priceFields,
} = require('../../utils/packagePrice');

const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

describe('packagePriceText', () => {
  test('is the display price, else the typed price, else nothing', () => {
    expect(packagePriceText({ price_display: 'From £900', price: '£500' })).toBe('From £900');
    expect(packagePriceText({ price: '£500' })).toBe('£500');
    expect(packagePriceText({ price_display: '', price: '£500' })).toBe('£500');
    expect(packagePriceText({ price_display: '   ', price: '  ' })).toBe('');
    expect(packagePriceText({})).toBe('');
    expect(packagePriceText(null)).toBe('');
    expect(packagePriceText(undefined)).toBe('');
  });

  test('accepts a numeric price and trims what it returns', () => {
    expect(packagePriceText({ price: 750 })).toBe('750');
    expect(packagePriceText({ price_display: '  £45 pp  ' })).toBe('£45 pp');
  });
});

describe('priceFields', () => {
  test('holds the same text in both fields', () => {
    expect(priceFields('  £1,234 pp ')).toEqual({ price: '£1,234 pp', price_display: '£1,234 pp' });
    expect(priceFields(600)).toEqual({ price: '600', price_display: '600' });
  });

  test('has no price for nothing, and keeps to the length limit', () => {
    expect(priceFields(undefined)).toEqual({ price: '', price_display: '' });
    expect(priceFields(null)).toEqual({ price: '', price_display: '' });
    expect(cleanPrice('x'.repeat(200))).toHaveLength(MAX_PRICE_LENGTH);
  });
});

/** Mounts routes/packages.js with stand-ins for the things server.js normally injects. */
function mountPackages() {
  const packages = require('../../routes/packages');
  const pass = (req, res, next) => next();
  packages.initializeDependencies({
    dbUnified: fakeDb,
    authRequired: (req, res, next) => {
      req.user = JSON.parse(req.headers['x-test-user']);
      next();
    },
    roleRequired: role => (req, res, next) =>
      req.user.role === role ? next() : res.sendStatus(403),
    requireVerifiedUser: pass,
    requireApprovedSupplier: pass,
    csrfProtection: pass,
    featureRequired: () => pass,
    writeLimiter: pass,
    photoUpload: { array: () => pass, single: () => pass },
    uploadValidation: pass,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    uid: () => 'pkg_new',
  });
  const app = express();
  app.use(express.json());
  app.use('/api', packages);
  return app;
}

const SUPPLIER = { id: 'user-1', role: 'supplier' };
const ADMIN = { id: 'admin-1', role: 'admin' };

/** A package an admin created, with only price_display. */
const adminMadePackage = () => ({
  id: 'pkg-1',
  supplierId: 'sup-1',
  title: 'Celebration Photography',
  slug: 'celebration-photography',
  price_display: 'From £900',
  approved: true,
});

beforeEach(() => {
  fakeDb.__reset({
    suppliers: [{ id: 'sup-1', ownerUserId: 'user-1', name: 'Moor Audio', approved: true }],
    packages: [adminMadePackage()],
  });
});

const stored = () => fakeDb.__store().packages.find(pkg => pkg.id === 'pkg-1');

describe('a supplier editing the price', () => {
  test('replaces the price everywhere, including the display price an admin had set', async () => {
    const res = await request(mountPackages())
      .put('/api/me/packages/pkg-1')
      .set('x-test-user', JSON.stringify(SUPPLIER))
      .send({ price: '  £1,500 pp ' });

    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ price: '£1,500 pp', price_display: '£1,500 pp' });
    expect(packagePriceText(stored())).toBe('£1,500 pp');
  });

  test('cannot blank it: a price is required, as when the package was created', async () => {
    const res = await request(mountPackages())
      .put('/api/me/packages/pkg-1')
      .set('x-test-user', JSON.stringify(SUPPLIER))
      .send({ price: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price is required/i);
    expect(stored()).toMatchObject({ price_display: 'From £900' });
    expect(stored().price).toBeUndefined();
  });

  test('leaves the price alone when an edit does not send one', async () => {
    const res = await request(mountPackages())
      .put('/api/me/packages/pkg-1')
      .set('x-test-user', JSON.stringify(SUPPLIER))
      .send({ title: 'Celebration Photography Plus' });

    expect(res.status).toBe(200);
    expect(stored().price_display).toBe('From £900');
  });
});

describe('an admin editing the display price', () => {
  test('changes the price the supplier sees too', async () => {
    fakeDb.__store().packages[0].price = '£500';

    const res = await request(mountPackages())
      .put('/api/admin/packages/pkg-1')
      .set('x-test-user', JSON.stringify(ADMIN))
      .send({ price_display: 'From £2,000' });

    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ price: 'From £2,000', price_display: 'From £2,000' });
  });
});

describe('every path that sets a package price stores it through priceFields', () => {
  test.each([
    ['routes/packages.js', 3],
    ['routes/admin.js', 1],
    ['routes/admin-user-management.js', 1],
    ['routes/admin-v2.js', 1],
  ])('%s', (file, minimum) => {
    const uses = read(file).match(/priceFields\(/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(minimum);
  });

  test('nothing sets one price field on its own any more', () => {
    expect(read('routes/packages.js')).not.toMatch(/pkgUpdates\.price\s*=/);
    expect(read('routes/packages.js')).not.toMatch(/pkgUpdates\.price_display\s*=/);
    expect(read('routes/admin-user-management.js')).not.toMatch(/setFields\.price(_display)?\s*=/);
  });
});

describe('every reader of a package price applies the same rule', () => {
  test.each([
    'services/publicListingSeo.service.js',
    'services/supplierRanking.service.js',
    'services/supplierProfilePackageCards.js',
    'services/searchService.js',
  ])('%s uses packagePriceText', file => {
    expect(read(file)).toContain('packagePriceText');
  });

  test('the admin packages screen shows and edits a supplier-set price too', () => {
    const source = read('public/assets/js/pages/admin-packages-init.js');
    expect(source).toContain("pkg.price_display || pkg.price || ''");
    expect(source.match(/pkg\.price_display \|\| pkg\.price \|\| ''/g)).toHaveLength(2);
  });
});

describe('parsePriceAmount / packagePriceAmount', () => {
  const { parsePriceAmount, packagePriceAmount } = require('../../utils/packagePrice');

  test.each([
    ['£3,500', 3500],
    ['from £450', 450],
    ['From £450 per day', 450],
    ['£25 pp', 25],
    ['£1,200 - £1,800', 1200],
    ['£12.50', 12.5],
    ['£2k', 2000],
    ['£1.5k', 1500],
    ['1200', 1200],
    [1200, 1200],
    ['£1,234,567', 1234567],
    ['POA', null],
    ['Contact for pricing', null],
    ['Free', null],
    ['£0', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%j is %j', (text, expected) => {
    expect(parsePriceAmount(text)).toBe(expected);
  });

  test('a package is read through the same rule as its displayed price', () => {
    expect(packagePriceAmount({ price_display: 'From £900', price: '£500' })).toBe(900);
    expect(packagePriceAmount({ price: '£500' })).toBe(500);
    expect(packagePriceAmount({})).toBe(null);
  });
});
