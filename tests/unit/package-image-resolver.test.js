/**
 * Package Image Resolver – Unit Tests
 *
 * Tests for the pure resolvePackageImage() and isPlaceholderImage() helpers
 * exported from public/assets/js/utils/package-image-resolver.js.
 *
 * These tests run in Node.js (Jest) so they exercise the module.exports path.
 */

'use strict';

const {
  resolvePackageImage,
  isPlaceholderImage,
  PLACEHOLDER_PACKAGE_IMAGE,
} = require('../../public/assets/js/utils/package-image-resolver');

// ─── isPlaceholderImage ────────────────────────────────────────────────────

describe('isPlaceholderImage', () => {
  it('returns true for the canonical placeholder path', () => {
    expect(isPlaceholderImage('/assets/images/placeholders/package-event.svg')).toBe(true);
  });

  it('returns true for null', () => {
    expect(isPlaceholderImage(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isPlaceholderImage(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isPlaceholderImage('')).toBe(true);
  });

  it('returns false for a real upload URL', () => {
    expect(isPlaceholderImage('/uploads/packages/photo.jpg')).toBe(false);
  });

  it('returns false for an absolute https URL', () => {
    expect(isPlaceholderImage('https://example.com/photo.jpg')).toBe(false);
  });

  it('returns true for a data: URL (too large / sanitized away by clients)', () => {
    expect(isPlaceholderImage('data:image/jpeg;base64,/9j/4AAQSkZJRgAB')).toBe(true);
  });

  it('returns true for a data: URL with mixed case protocol', () => {
    expect(isPlaceholderImage('DATA:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('returns true for a whitespace-only string', () => {
    expect(isPlaceholderImage('   ')).toBe(true);
  });

  it('returns false for a Cloudinary https URL (absolute URL must not be mangled)', () => {
    expect(
      isPlaceholderImage('https://res.cloudinary.com/eventflow/image/upload/v123/photo.jpg')
    ).toBe(false);
  });
});

// ─── resolvePackageImage ───────────────────────────────────────────────────

describe('resolvePackageImage', () => {
  describe('null / invalid input', () => {
    it('returns placeholder when pkg is null', () => {
      expect(resolvePackageImage(null)).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });

    it('returns placeholder when pkg is undefined', () => {
      expect(resolvePackageImage(undefined)).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });

    it('returns placeholder when pkg is not an object', () => {
      expect(resolvePackageImage('string')).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });
  });

  describe('pkg.image is real', () => {
    it('uses pkg.image when it is a real upload path', () => {
      const pkg = { image: '/uploads/packages/hero.jpg', gallery: [] };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/hero.jpg');
    });

    it('uses pkg.image even when gallery has images', () => {
      const pkg = {
        image: '/uploads/packages/hero.jpg',
        gallery: ['/uploads/packages/gallery1.jpg'],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/hero.jpg');
    });

    it('uses pkg.image when it is an absolute https URL', () => {
      const pkg = { image: 'https://cdn.example.com/photo.jpg' };
      expect(resolvePackageImage(pkg)).toBe('https://cdn.example.com/photo.jpg');
    });
  });

  describe('pkg.image is placeholder – falls back to gallery', () => {
    it('falls back to gallery[0] string when image is placeholder', () => {
      const pkg = {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        gallery: ['/uploads/packages/gallery1.jpg'],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery1.jpg');
    });

    it('falls back to gallery[0] when image is missing', () => {
      const pkg = { gallery: ['/uploads/packages/gallery1.jpg'] };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery1.jpg');
    });

    it('skips placeholder entries in gallery and uses first real one', () => {
      const pkg = {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        gallery: [PLACEHOLDER_PACKAGE_IMAGE, '/uploads/packages/real.jpg'],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/real.jpg');
    });

    it('supports gallery item as object with .url field', () => {
      const pkg = {
        gallery: [{ url: '/uploads/packages/gallery-obj.jpg' }],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-obj.jpg');
    });

    it('supports gallery item as object with .src field', () => {
      const pkg = {
        gallery: [{ src: '/uploads/packages/gallery-src.jpg' }],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-src.jpg');
    });

    it('supports gallery item as object with .path field', () => {
      const pkg = {
        gallery: [{ path: '/uploads/packages/gallery-path.jpg' }],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-path.jpg');
    });

    it('supports gallery item as object with .image field', () => {
      const pkg = {
        gallery: [{ image: '/uploads/packages/gallery-image.jpg' }],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-image.jpg');
    });

    it('supports gallery item as object with .originalUrl field', () => {
      const pkg = {
        gallery: [{ originalUrl: '/uploads/packages/gallery-original.jpg' }],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-original.jpg');
    });

    it('supports gallery item as object with .thumbnail field', () => {
      const pkg = {
        gallery: [{ thumbnail: '/uploads/packages/gallery-thumb.jpg' }],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-thumb.jpg');
    });

    it('prefers .url over .thumbnail when both are present', () => {
      const pkg = {
        gallery: [
          {
            url: '/uploads/packages/gallery-optimized.jpg',
            thumbnail: '/uploads/packages/gallery-thumb.jpg',
          },
        ],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery-optimized.jpg');
    });

    it('returns placeholder when all gallery entries are placeholders', () => {
      const pkg = {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        gallery: [PLACEHOLDER_PACKAGE_IMAGE, PLACEHOLDER_PACKAGE_IMAGE],
      };
      expect(resolvePackageImage(pkg)).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });
  });

  describe('no image and no gallery', () => {
    it('returns placeholder when pkg has no image or gallery', () => {
      expect(resolvePackageImage({})).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });

    it('returns placeholder when gallery is empty array', () => {
      expect(resolvePackageImage({ gallery: [] })).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });

    it('returns placeholder when gallery is not an array', () => {
      expect(resolvePackageImage({ gallery: 'not-an-array' })).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });
  });

  describe('data: URL handling', () => {
    it('skips pkg.image data: URL and falls back to gallery', () => {
      const pkg = {
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgAB',
        gallery: ['/uploads/packages/gallery1.jpg'],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/gallery1.jpg');
    });

    it('returns placeholder when pkg.image is a data: URL and gallery is empty', () => {
      const pkg = { image: 'data:image/png;base64,iVBORw0KGgo=', gallery: [] };
      expect(resolvePackageImage(pkg)).toBe(PLACEHOLDER_PACKAGE_IMAGE);
    });

    it('skips data: URLs inside gallery array', () => {
      const pkg = {
        gallery: ['data:image/jpeg;base64,/9j/AAAB', '/uploads/packages/real.jpg'],
      };
      expect(resolvePackageImage(pkg)).toBe('/uploads/packages/real.jpg');
    });
  });

  describe('absolute https:// URL handling', () => {
    it('returns a Cloudinary https URL directly (must not be corrupted)', () => {
      const cdnUrl = 'https://res.cloudinary.com/eventflow/image/upload/v123/photo.jpg';
      const pkg = { image: cdnUrl };
      expect(resolvePackageImage(pkg)).toBe(cdnUrl);
    });

    it('falls back to Cloudinary gallery URL when pkg.image is placeholder', () => {
      const cdnUrl = 'https://res.cloudinary.com/eventflow/image/upload/v123/gallery.jpg';
      const pkg = {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        gallery: [{ url: cdnUrl }],
      };
      expect(resolvePackageImage(pkg)).toBe(cdnUrl);
    });
  });
});
