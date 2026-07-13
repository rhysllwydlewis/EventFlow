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
const LEGACY_PLACEHOLDER = '/assets/images/placeholders/package-event.svg';

describe('package placeholder consistency', () => {
  it('uses the approved suppliers-page placeholder in both resolvers', () => {
    expect(serverPackageImages.PLACEHOLDER_PACKAGE_IMAGE).toBe(APPROVED_PLACEHOLDER);
    expect(clientPackageImages.PLACEHOLDER_PACKAGE_IMAGE).toBe(APPROVED_PLACEHOLDER);
    expect(serverPackageImages.resolvePackageImage({})).toBe(APPROVED_PLACEHOLDER);
    expect(clientPackageImages.resolvePackageImage({})).toBe(APPROVED_PLACEHOLDER);
  });

  it('continues to recognise old placeholder values as non-photo data', () => {
    expect(serverPackageImages.isPlaceholderImage(LEGACY_PLACEHOLDER)).toBe(true);
    expect(clientPackageImages.isPlaceholderImage(LEGACY_PLACEHOLDER)).toBe(true);
    expect(serverPackageImages.isPlaceholderImage(APPROVED_PLACEHOLDER)).toBe(true);
    expect(clientPackageImages.isPlaceholderImage(APPROVED_PLACEHOLDER)).toBe(true);
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
