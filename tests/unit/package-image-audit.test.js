/**
 * Tests for package image audit diagnostics used by the admin endpoint.
 */

'use strict';

const {
  PLACEHOLDER_PACKAGE_IMAGE,
  buildPackageImageAudit,
  collectNamedPackageImageFields,
} = require('../../utils/packageImageUtils');

describe('package image audit diagnostics', () => {
  it('records raw image classifications and public resolved image fields', () => {
    const audit = buildPackageImageAudit({
      id: 'pkg_foil',
      title: 'Foil Stamping',
      supplierId: 'sup_embosseur_20260607',
      approved: true,
      image: 'data:image/png;base64,AAAA',
      gallery: [{ url: '/api/photos/photo_real_foil' }],
      images: [{ thumbnail: PLACEHOLDER_PACKAGE_IMAGE }],
    });

    expect(audit.imageRaw).toBe('data:image/png;base64,AAAA');
    expect(audit.imageRawIsDataUri).toBe(true);
    expect(audit.imageRawIsApiPhoto).toBe(false);
    expect(audit.imageRawIsPlaceholder).toBe(true);
    expect(audit.galleryRaw).toEqual([{ url: '/api/photos/photo_real_foil' }]);
    expect(audit.imagesRaw).toEqual([{ thumbnail: PLACEHOLDER_PACKAGE_IMAGE }]);
    expect(audit.image).toBe('/api/photos/photo_real_foil');
    expect(audit.resolvedImage).toBe('/api/photos/photo_real_foil');
    expect(audit.resolvedImageIsApiPhoto).toBe(true);
    expect(audit.isPlaceholder).toBe(false);
    expect(audit.resolvedGallery).toEqual([{ url: '/api/photos/photo_real_foil' }]);
  });

  it('collects the named image fields requested for production audits', () => {
    const fields = collectNamedPackageImageFields({
      original: '/api/photos/original',
      uploadResult: {
        optimized: '/api/photos/optimized',
        large: '/api/photos/large',
        thumbnail: '/api/photos/thumb',
      },
      gallery: [
        {
          photoUrl: '/api/photos/photo-url',
          imageUrl: '/api/photos/image-url',
          secureUrl: 'https://cdn.example.com/secure.jpg',
          cdnUrl: 'https://cdn.example.com/cdn.jpg',
        },
      ],
    });

    expect(fields).toEqual(
      expect.arrayContaining([
        { path: 'pkg.original', field: 'original', value: '/api/photos/original' },
        { path: 'pkg.uploadResult.optimized', field: 'optimized', value: '/api/photos/optimized' },
        { path: 'pkg.uploadResult.large', field: 'large', value: '/api/photos/large' },
        { path: 'pkg.uploadResult.thumbnail', field: 'thumbnail', value: '/api/photos/thumb' },
        { path: 'pkg.gallery[0].photoUrl', field: 'photoUrl', value: '/api/photos/photo-url' },
        { path: 'pkg.gallery[0].imageUrl', field: 'imageUrl', value: '/api/photos/image-url' },
        {
          path: 'pkg.gallery[0].secureUrl',
          field: 'secureUrl',
          value: 'https://cdn.example.com/secure.jpg',
        },
        {
          path: 'pkg.gallery[0].cdnUrl',
          field: 'cdnUrl',
          value: 'https://cdn.example.com/cdn.jpg',
        },
      ])
    );
  });
});
