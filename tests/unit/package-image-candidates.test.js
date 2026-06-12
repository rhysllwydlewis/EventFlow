'use strict';

const {
  PLACEHOLDER_PACKAGE_IMAGE,
  PACKAGE_IMAGE_URL_FIELDS,
  extractGalleryItemUrl,
  listPackageImageCandidates,
  resolvePackageImage,
} = require('../../utils/packageImageUtils');
const browserResolver = require('../../public/assets/js/utils/package-image-resolver.js');

const FIELD_FIXTURES = {
  optimized: '/api/photos/optimized_123',
  large: '/api/photos/large_123',
  original: '/api/photos/original_123',
  photoUrl: '/api/photos/photo_url_123',
  imageUrl: '/api/photos/image_url_123',
  secureUrl: 'https://cdn.example.com/secure.jpg',
  cdnUrl: 'https://cdn.example.com/cdn.jpg',
};

describe('package image candidate extraction', () => {
  it('uses supported root image fields when canonical image fields are empty', () => {
    for (const [field, url] of Object.entries(FIELD_FIXTURES)) {
      expect(resolvePackageImage({ image: '', [field]: url })).toBe(url);
    }
  });

  it('uses supported gallery image fields when url is absent', () => {
    for (const [field, url] of Object.entries(FIELD_FIXTURES)) {
      expect(resolvePackageImage({ image: '', gallery: [{ [field]: url }] })).toBe(url);
      expect(extractGalleryItemUrl({ [field]: url })).toBe(url);
    }
  });

  it('prefers optimized/large/original before thumbnail in mixed upload objects', () => {
    const mixedUploadObject = {
      thumbnail: '/api/photos/thumb_123',
      original: '/api/photos/original_123',
      large: '/api/photos/large_123',
      optimized: '/api/photos/optimized_123',
    };

    expect(
      resolvePackageImage({
        image: '',
        gallery: [mixedUploadObject],
      })
    ).toBe('/api/photos/optimized_123');
    expect(extractGalleryItemUrl(mixedUploadObject)).toBe('/api/photos/optimized_123');
  });

  it('does not let an unusable early gallery field hide a later real field', () => {
    expect(
      resolvePackageImage({
        image: '',
        gallery: [
          {
            url: PLACEHOLDER_PACKAGE_IMAGE,
            optimized: '/api/photos/optimized_after_placeholder_url',
          },
        ],
      })
    ).toBe('/api/photos/optimized_after_placeholder_url');
    expect(
      extractGalleryItemUrl({
        url: PLACEHOLDER_PACKAGE_IMAGE,
        optimized: '/api/photos/optimized_after_placeholder_url',
      })
    ).toBe('/api/photos/optimized_after_placeholder_url');
  });

  it('rejects unsafe and non-public output values before falling back', () => {
    const candidates = listPackageImageCandidates({
      image: 'data:image/png;base64,AAAA',
      gallery: [
        { url: 'javascript:alert(1)' },
        { optimized: '<script>alert(1)</script>' },
        { large: PLACEHOLDER_PACKAGE_IMAGE },
      ],
    });

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'pkg.image', usable: false, reason: 'data-uri' }),
        expect.objectContaining({
          source: 'pkg.gallery[0].url',
          usable: false,
          reason: 'javascript-url',
        }),
        expect.objectContaining({
          source: 'pkg.gallery[1].optimized',
          usable: false,
          reason: 'html-payload',
        }),
        expect.objectContaining({
          source: 'pkg.gallery[2].large',
          usable: false,
          reason: 'placeholder',
        }),
      ])
    );
    expect(resolvePackageImage({ image: 'data:image/png;base64,AAAA' })).toBe(
      PLACEHOLDER_PACKAGE_IMAGE
    );
  });

  it('keeps browser resolver aligned with server candidates for production-like shapes', () => {
    const fixtures = [
      { id: 'pkg_prod_empty', title: 'Foil Stamping', image: '', imageUrl: '' },
      { image: '', gallery: [{ optimized: '/api/photos/prod_optimized' }] },
      { image: '', images: [{ secureUrl: 'https://cdn.example.com/prod.jpg' }] },
      { image: 'data:image/png;base64,AAAA', gallery: [{ photoUrl: '/api/photos/from_gallery' }] },
    ];

    fixtures.forEach(fixture => {
      expect(browserResolver.resolvePackageImage(fixture)).toBe(resolvePackageImage(fixture));
      expect(browserResolver.listPackageImageCandidates(fixture)).toEqual(
        listPackageImageCandidates(fixture)
      );
    });
  });

  it('documents the shared field order so server and browser cannot drift silently', () => {
    expect(browserResolver.PACKAGE_IMAGE_URL_FIELDS).toEqual(PACKAGE_IMAGE_URL_FIELDS);
  });
});
