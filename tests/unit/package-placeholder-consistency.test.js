/**
 * Package placeholder consistency regression tests.
 *
 * The light placeholder used by supplier package cards is the approved package
 * fallback everywhere. Legacy paths remain recognised as placeholders so old
 * records cannot reintroduce the former dark-green artwork.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const serverPackageImages = require('../../utils/packageImageUtils');
const clientPackageImages = require('../../public/assets/js/utils/package-image-resolver');

const ROOT = path.join(__dirname, '../..');
const APPROVED_PLACEHOLDER = '/assets/images/package-placeholder.webp';
const APPROVED_PLACEHOLDER_FILE = path.join(
  ROOT,
  'public/assets/images/package-placeholder.webp'
);
const LEGACY_PLACEHOLDER = '/assets/images/placeholders/package-event.svg';
const CATEGORY_PLACEHOLDER = '/assets/images/placeholders/venue-package.svg';

describe('package placeholder consistency', () => {
  it('uses the approved suppliers-page placeholder in both resolvers', () => {
    expect(serverPackageImages.PLACEHOLDER_PACKAGE_IMAGE).toBe(APPROVED_PLACEHOLDER);
    expect(clientPackageImages.PLACEHOLDER_PACKAGE_IMAGE).toBe(APPROVED_PLACEHOLDER);
    expect(serverPackageImages.resolvePackageImage({})).toBe(APPROVED_PLACEHOLDER);
    expect(clientPackageImages.resolvePackageImage({})).toBe(APPROVED_PLACEHOLDER);
  });

  it('points the canonical fallback at a valid WebP asset', () => {
    const placeholderFile = fs.readFileSync(APPROVED_PLACEHOLDER_FILE);

    expect(placeholderFile.length).toBeGreaterThan(12);
    expect(placeholderFile.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(placeholderFile.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('recognises old and category-specific placeholder values as non-photo data', () => {
    for (const placeholder of [
      APPROVED_PLACEHOLDER,
      LEGACY_PLACEHOLDER,
      CATEGORY_PLACEHOLDER,
    ]) {
      expect(serverPackageImages.isPlaceholderImage(placeholder)).toBe(true);
      expect(clientPackageImages.isPlaceholderImage(placeholder)).toBe(true);
    }
  });

  it('normalises category-specific legacy placeholders to the approved fallback', () => {
    const pkg = { image: CATEGORY_PLACEHOLDER, gallery: [] };

    expect(serverPackageImages.resolvePackageImage(pkg)).toBe(APPROVED_PLACEHOLDER);
    expect(clientPackageImages.resolvePackageImage(pkg)).toBe(APPROVED_PLACEHOLDER);
  });

  it('still prefers a genuine package photo over every placeholder variant', () => {
    const realPhoto = '/uploads/packages/real-package-photo.jpg';
    const packages = [
      { image: APPROVED_PLACEHOLDER, gallery: [{ url: realPhoto }] },
      { image: LEGACY_PLACEHOLDER, gallery: [{ url: realPhoto }] },
      { image: CATEGORY_PLACEHOLDER, gallery: [{ url: realPhoto }] },
    ];

    for (const pkg of packages) {
      expect(serverPackageImages.resolvePackageImage(pkg)).toBe(realPhoto);
      expect(clientPackageImages.resolvePackageImage(pkg)).toBe(realPhoto);
    }
  });

  it('allows the approved fallback through the package detail legacy-path filter', () => {
    const packageInit = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/package-init.js'),
      'utf8'
    );

    expect(packageInit).toContain("const PLACEHOLDER_PATH = '/assets/images/placeholders/';");
    expect(APPROVED_PLACEHOLDER).not.toContain('/assets/images/placeholders/');
    expect(packageInit).toContain('pkg.image && !pkg.image.includes(PLACEHOLDER_PATH)');
    expect(packageInit).toContain("new PackageGallery('package-gallery-container', galleryImages)");
  });

  it('removes the former dark-green artwork from the legacy SVG fallback', () => {
    const legacySvg = fs.readFileSync(
      path.join(ROOT, 'public/assets/images/placeholders/package-event.svg'),
      'utf8'
    );

    expect(legacySvg).not.toContain('#0B8073');
    expect(legacySvg).not.toContain('#065F54');
    expect(legacySvg).toContain('../package-placeholder.webp');
  });
});
