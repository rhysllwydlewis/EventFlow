/**
 * The package endpoints behind the homepage carousels, supplier profiles and
 * package pages are unauthenticated. They must not publish edit history or
 * internal ids alongside the listing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  toPublicPackageCard,
  INTERNAL_PACKAGE_FIELDS,
} = require('../../services/publicPackageCard');

const stored = {
  _id: '6a8923ac8bf8aa70a83aa4e5',
  id: 'pkg_1',
  supplierId: 'sup_1',
  title: 'Barn Exclusive',
  description: 'Full-day venue hire.',
  price_display: '£500',
  slug: 'barn-exclusive',
  gallery: [{ url: '/api/photos/photo_1', approved: true }],
  approved: true,
  featured: true,
  isTest: false,
  lastEditedBy: 'usr_admin',
  versionHistory: [{ timestamp: '2026-08-24T23:28:25.385Z', editedBy: 'usr_admin', title: 'Old' }],
  adminNotes: 'chase for better photos',
};

describe('toPublicPackageCard', () => {
  it('drops bookkeeping fields and keeps what the listing shows', () => {
    const card = toPublicPackageCard(stored, {
      image: '/api/photos/photo_1',
      supplier_name: 'Barn',
    });

    for (const field of INTERNAL_PACKAGE_FIELDS) {
      expect(card).not.toHaveProperty(field);
    }
    expect(card).toMatchObject({
      id: 'pkg_1',
      supplierId: 'sup_1',
      title: 'Barn Exclusive',
      price_display: '£500',
      slug: 'barn-exclusive',
      image: '/api/photos/photo_1',
      supplier_name: 'Barn',
    });
    expect(card.gallery).toEqual(stored.gallery);
  });

  it('does not mutate the stored document', () => {
    toPublicPackageCard(stored);
    expect(stored.versionHistory).toHaveLength(1);
    expect(stored._id).toBe('6a8923ac8bf8aa70a83aa4e5');
  });

  it('tolerates a missing package', () => {
    expect(toPublicPackageCard(null, { image: 'x' })).toEqual({ image: 'x' });
  });
});

describe('public package routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../routes/suppliers.js'), 'utf8');

  it('never spread a stored package straight into a response', () => {
    expect(source).not.toMatch(/\.\.\.pkg,/);
    expect(source.match(/toPublicPackageCard\(/g).length).toBeGreaterThanOrEqual(6);
  });
});
