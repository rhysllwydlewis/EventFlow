'use strict';

const {
  safeExternalUrl,
  safeImageUrl,
  safePublicPackage,
  safePublicSupplier,
} = require('../../utils/supplierPublicProfile');

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
    expect(payload.messagingRecipientId).toBeUndefined();
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
    expect(payload.adminNotes).toBeUndefined();
    expect(payload.stripeCustomerId).toBeUndefined();
  });

  test('allows only safe public image URL forms', () => {
    expect(safeImageUrl('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
    expect(safeImageUrl('http://example.com/photo.jpg')).toBe('http://example.com/photo.jpg');
    expect(safeImageUrl('/api/photos/photo_test')).toBe('/api/photos/photo_test');
    expect(safeImageUrl('/uploads/avatar.webp')).toBe('/uploads/avatar.webp');
    expect(safeImageUrl('data:image/webp;base64,aaaa')).toBe('');
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe('');
    expect(safeImageUrl('//evil.example/avatar.webp')).toBe('');
  });

  test('returns resolved profile-photo fields without letting logo override the avatar', () => {
    const payload = safePublicSupplier(
      {
        id: 'sup_123',
        name: 'Profile Photo Supplier',
        profilePhotoUrl: '/api/photos/photo_test',
        displayAvatarUrl: '/api/photos/display_should_not_win',
        avatarUrl: '/api/photos/avatar_should_not_win',
        logo: '/uploads/logo.webp',
        profileImage: '/uploads/profile-image.webp',
      },
      { profilePhotoUrl: '/api/photos/owner_avatar' }
    );

    expect(payload.profilePhotoUrl).toBe('/api/photos/owner_avatar');
    expect(payload.avatarUrl).toBe('/api/photos/owner_avatar');
    expect(payload.displayAvatarUrl).toBe('/api/photos/owner_avatar');
    expect(payload.logo).toBe('/uploads/logo.webp');
    expect(payload.profileImage).toBe('/uploads/logo.webp');
  });

  test('handles null and malformed nested public profile fields without leaking placeholders', () => {
    expect(safePublicPackage(null)).toMatchObject({ title: 'Package', image: '', imageUrl: '' });
    expect(safePublicSupplier(null)).toMatchObject({ name: 'Supplier', topPackages: [] });

    const payload = safePublicSupplier({
      badgeDetails: [null, 'invalid', { name: '<b>Trusted</b>' }],
      socialLinks: 'not-an-object',
      topPackages: [null, 'invalid', { title: '<i>Real Package</i>', image: 'javascript:bad' }],
      verifications: 'not-an-object',
    });

    expect(payload.badgeDetails).toEqual([
      {
        id: null,
        type: null,
        name: 'Trusted',
        description: null,
        icon: null,
        displayOrder: null,
      },
    ]);
    expect(payload.socialLinks).toEqual({});
    expect(payload.topPackages).toEqual([
      expect.objectContaining({ title: 'Real Package', image: '', imageUrl: '' }),
    ]);
    expect(payload.verifications).toEqual({
      email: { verified: false },
      phone: { verified: false },
      business: { verified: false },
    });
  });

  test('normalises URLs through URL parsing and rejects non-absolute external links', () => {
    expect(safeImageUrl('https://example.com/photo one.jpg')).toBe(
      'https://example.com/photo%20one.jpg'
    );
    expect(safeExternalUrl('/relative-path')).toBe('');
    expect(safeExternalUrl('https://example.com/suppliers?ref=EventFlow')).toBe(
      'https://example.com/suppliers?ref=EventFlow'
    );
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

  test('preserves only the effective public supplier theme state', () => {
    expect(
      safePublicSupplier({
        themeMode: 'preset',
        heroPreset: 'midnight',
        themeColor: '#ec4899',
      })
    ).toMatchObject({
      themeMode: 'preset',
      heroPreset: 'midnight',
      themeColor: null,
    });

    expect(
      safePublicSupplier({
        themeMode: 'custom',
        heroPreset: 'midnight',
        themeColor: '#ec4899',
      })
    ).toMatchObject({
      themeMode: 'custom',
      heroPreset: null,
      themeColor: '#EC4899',
    });

    expect(safePublicSupplier({ category: 'Photography' })).toMatchObject({
      themeMode: 'automatic',
      heroPreset: null,
      themeColor: null,
    });
  });
});
