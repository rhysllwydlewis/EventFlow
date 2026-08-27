'use strict';

const {
  getSupplierBotSourceImageCandidates,
  resolveSupplierProfilePhoto,
} = require('../../utils/supplierProfilePhoto');

describe('Supplier Bot profile image fallback', () => {
  test('prefers strongly classified logo evidence over cover/gallery media', () => {
    const supplier = {
      ownershipStatus: 'unclaimed',
      acquisition: {
        source: 'supplier_bot',
        sourceMedia: {
          coverImage: 'https://venue.example/photos/castle-hero.jpg',
          images: ['https://venue.example/photos/castle-room.jpg'],
          evidence: [
            {
              url: 'https://venue.example/assets/hensol-logo.svg',
              alt: 'Official business logo (site header) — Hensol Castle',
              score: 96,
              sameSite: true,
            },
            {
              url: 'https://venue.example/photos/castle-hero.jpg',
              alt: 'Castle exterior',
              score: 99,
              sameSite: true,
            },
          ],
        },
      },
    };

    expect(getSupplierBotSourceImageCandidates(supplier)[0]).toBe(
      'https://venue.example/assets/hensol-logo.svg'
    );
    expect(resolveSupplierProfilePhoto(supplier, null)).toBe(
      'https://venue.example/assets/hensol-logo.svg'
    );
  });

  test('falls back to the existing cover image for older bot profiles with no logo evidence', () => {
    const supplier = {
      ownershipStatus: 'unclaimed',
      acquisition: {
        source: 'supplier_bot',
        sourceMedia: {
          coverImage: 'https://venue.example/photos/castle-hero.jpg',
          images: ['https://venue.example/photos/castle-room.jpg'],
          evidence: [],
        },
      },
    };

    expect(resolveSupplierProfilePhoto(supplier, null)).toBe(
      'https://venue.example/photos/castle-hero.jpg'
    );
  });

  test('does not treat bot acquisition media as authoritative after ownership leaves unclaimed state', () => {
    const supplier = {
      ownershipStatus: 'claimed',
      acquisition: {
        source: 'supplier_bot',
        sourceMedia: {
          coverImage: 'https://venue.example/photos/castle-hero.jpg',
          evidence: [
            {
              url: 'https://venue.example/assets/logo.svg',
              alt: 'Official business logo (site header)',
              score: 100,
              sameSite: true,
            },
          ],
        },
      },
      logo: '/owner-logo.png',
    };

    expect(getSupplierBotSourceImageCandidates(supplier)).toEqual([]);
    expect(resolveSupplierProfilePhoto(supplier, null)).toBe('/owner-logo.png');
  });

  test('owner profile photo remains authoritative when present', () => {
    const supplier = {
      ownershipStatus: 'unclaimed',
      acquisition: {
        source: 'supplier_bot',
        sourceMedia: { coverImage: 'https://venue.example/photos/castle-hero.jpg' },
      },
    };

    expect(resolveSupplierProfilePhoto(supplier, { avatarUrl: '/owner-avatar.jpg' })).toBe(
      '/owner-avatar.jpg'
    );
  });
});
