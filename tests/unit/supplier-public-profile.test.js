'use strict';

const { safeImageUrl, safePublicPackage, safePublicSupplier } = require('../../utils/supplierPublicProfile');

describe('supplier public profile safety helpers', () => {
  test('strips private/internal fields from public supplier payloads', () => {
    const payload = safePublicSupplier(
      {
        id: 'sup_123',
        name: 'Example Supplier',
        email: 'private@example.com',
        ownerUserId: 'user_private',
        approved: true,
        bannerUrl: 'https://example.com/banner.jpg',
        website: 'javascript:alert(1)',
        socialLinks: { instagram: 'https://instagram.com/example', facebook: 'javascript:bad' },
        latitude: 51.5,
        longitude: -3.2,
        adminNotes: 'internal only',
        stripeCustomerId: 'cus_secret',
      },
      { isPro: true, featuredSupplier: true }
    );

    expect(payload.id).toBe('sup_123');
    expect(payload.name).toBe('Example Supplier');
    expect(payload.bannerUrl).toBe('https://example.com/banner.jpg');
    expect(payload.website).toBe('');
    expect(payload.socialLinks).toEqual({ instagram: 'https://instagram.com/example' });
    expect(payload.isPro).toBe(true);
    expect(payload.featuredSupplier).toBe(true);
    expect(payload.email).toBeUndefined();
    expect(payload.ownerUserId).toBeUndefined();
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
    expect(payload.adminNotes).toBeUndefined();
    expect(payload.stripeCustomerId).toBeUndefined();
  });

  test('allows only safe public image URL forms', () => {
    expect(safeImageUrl('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
    expect(safeImageUrl('http://example.com/photo.jpg')).toBe('http://example.com/photo.jpg');
    expect(safeImageUrl('data:image/webp;base64,aaaa')).toBe('data:image/webp;base64,aaaa');
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe('');
  });

  test('returns trimmed package payloads for public profile cards', () => {
    const pkg = safePublicPackage({
      id: 'pkg_1',
      supplierId: 'sup_123',
      title: 'Wedding Package',
      description: '<b>Great</b> package',
      image: 'javascript:bad',
      costInternal: 123,
      supplierMargin: 99,
    });

    expect(pkg.id).toBe('pkg_1');
    expect(pkg.title).toBe('Wedding Package');
    expect(pkg.description).toBe('Great package');
    expect(pkg.image).toBe('');
    expect(pkg.costInternal).toBeUndefined();
    expect(pkg.supplierMargin).toBeUndefined();
  });
});
