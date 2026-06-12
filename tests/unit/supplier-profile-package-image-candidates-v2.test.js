'use strict';

const {
  PLACEHOLDER_PACKAGE_IMAGE,
  resolveSupplierProfilePackageImage,
} = require('../../services/supplierProfilePackageCards');

describe('supplier profile package image candidates v2', () => {
  it('uses pkg.image when it is a real app photo URL', () => {
    expect(resolveSupplierProfilePackageImage({ image: '/api/photos/abc' }).imageUrl).toBe(
      '/api/photos/abc'
    );
  });

  it('skips package placeholders and uses gallery optimized image', () => {
    expect(
      resolveSupplierProfilePackageImage({
        image: '/assets/images/placeholders/package-event.svg',
        gallery: [{ optimized: '/api/photos/real' }],
      }).imageUrl
    ).toBe('/api/photos/real');
  });

  it('treats category package placeholders as placeholders when a real gallery image exists', () => {
    expect(
      resolveSupplierProfilePackageImage({
        image: '/assets/images/placeholders/venue-package.svg',
        gallery: [{ optimized: '/api/photos/venue-real' }],
      }).imageUrl
    ).toBe('/api/photos/venue-real');
  });

  it('uses image-like root objects without forcing the browser to inspect nested fields', () => {
    const resolved = resolveSupplierProfilePackageImage(
      {
        image: { optimized: '/api/photos/root-optimized', thumbnail: '/api/photos/root-thumb' },
      },
      { debug: true }
    );

    expect(resolved.imageUrl).toBe('/api/photos/root-optimized');
    expect(resolved.imageSource).toBe('image.optimized');
    expect(resolved.candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'image.optimized', usable: true })])
    );
  });

  it('uses gallery large when url and optimized are missing', () => {
    expect(
      resolveSupplierProfilePackageImage({ gallery: [{ large: '/api/photos/large' }] }).imageUrl
    ).toBe('/api/photos/large');
  });

  it('uses gallery original when url and optimized are missing', () => {
    expect(
      resolveSupplierProfilePackageImage({ gallery: [{ original: '/api/photos/original' }] })
        .imageUrl
    ).toBe('/api/photos/original');
  });

  it('rejects data image URIs for public cards and reports them in debug', () => {
    const resolved = resolveSupplierProfilePackageImage(
      { image: 'data:image/jpeg;base64,AAAA' },
      { debug: true }
    );

    expect(resolved.imageUrl).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    expect(resolved.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'image',
          usable: false,
          rejectedReason: 'data-uri-public-card',
          valuePreview: expect.stringContaining('data:image/jpeg length='),
        }),
      ])
    );
  });

  it('rejects javascript URLs', () => {
    const resolved = resolveSupplierProfilePackageImage(
      { image: 'javascript:alert(1)' },
      { debug: true }
    );
    expect(resolved.imageUrl).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    expect(resolved.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'image',
          usable: false,
          rejectedReason: 'unsafe-protocol',
        }),
      ])
    );
  });

  it('rejects unknown private relative paths', () => {
    const resolved = resolveSupplierProfilePackageImage({ image: '/admin/foo' }, { debug: true });
    expect(resolved.imageUrl).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    expect(resolved.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'image', usable: false, rejectedReason: 'private-path' }),
      ])
    );
  });

  it('returns the placeholder only when no real candidate exists', () => {
    expect(
      resolveSupplierProfilePackageImage({ image: '', gallery: [{ url: 'placeholder' }] }).imageUrl
    ).toBe(PLACEHOLDER_PACKAGE_IMAGE);
  });
});
