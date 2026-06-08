/**
 * Supplier profile package image regression tests.
 *
 * Protects against /supplier package cards preferring raw placeholder values
 * over real images returned by the shared package image resolver path.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  PLACEHOLDER_PACKAGE_IMAGE,
  isPlaceholderImage,
  resolvePackageImage,
} = require('../../public/assets/js/utils/package-image-resolver.js');
const {
  resolvePackageImage: resolveServerPackageImage,
} = require('../../utils/packageImageUtils.js');

const SUPPLIER_PROFILE = path.join(__dirname, '../../public/assets/js/supplier-profile.js');
const SUPPLIER_HTML = path.join(__dirname, '../../public/supplier.html');

function firstReal(...urls) {
  return urls.find(url => typeof url === 'string' && url && !isPlaceholderImage(url)) || '';
}

function chooseAsSupplierProfileDoes(pkg) {
  const resolved = resolvePackageImage(pkg);
  if (!isPlaceholderImage(resolved)) {
    return resolved;
  }

  return firstReal(pkg.rawImage) || PLACEHOLDER_PACKAGE_IMAGE;
}

describe('supplier-profile package card image precedence', () => {
  it('does not let placeholder rawImage override a real image field', () => {
    expect(
      chooseAsSupplierProfileDoes({
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
        image: '/uploads/packages/foil-stamping.jpg',
      })
    ).toBe('/uploads/packages/foil-stamping.jpg');
  });

  it('does not let placeholder rawImage override a real resolvedImage field', () => {
    expect(
      chooseAsSupplierProfileDoes({
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
        image: PLACEHOLDER_PACKAGE_IMAGE,
        resolvedImage: '/uploads/packages/engraving.jpg',
      })
    ).toBe('/uploads/packages/engraving.jpg');
  });

  it('does not let placeholder rawImage override a real resolvedGallery entry', () => {
    expect(
      chooseAsSupplierProfileDoes({
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
        image: PLACEHOLDER_PACKAGE_IMAGE,
        resolvedGallery: [{ url: '/uploads/packages/gallery-foil.jpg' }],
      })
    ).toBe('/uploads/packages/gallery-foil.jpg');
  });

  it('still supports real gallery and images entries as fallbacks', () => {
    expect(
      chooseAsSupplierProfileDoes({
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
        image: PLACEHOLDER_PACKAGE_IMAGE,
        gallery: [
          { url: PLACEHOLDER_PACKAGE_IMAGE },
          { originalUrl: '/uploads/packages/gallery.jpg' },
        ],
      })
    ).toBe('/uploads/packages/gallery.jpg');

    expect(
      chooseAsSupplierProfileDoes({
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
        image: PLACEHOLDER_PACKAGE_IMAGE,
        images: [{ src: '/uploads/packages/images-array.jpg' }],
      })
    ).toBe('/uploads/packages/images-array.jpg');
  });

  it('uses the canonical placeholder only when no real image exists', () => {
    expect(
      chooseAsSupplierProfileDoes({
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
        image: PLACEHOLDER_PACKAGE_IMAGE,
        resolvedGallery: [{ url: PLACEHOLDER_PACKAGE_IMAGE }],
        gallery: [{ url: PLACEHOLDER_PACKAGE_IMAGE }],
        images: [],
      })
    ).toBe(PLACEHOLDER_PACKAGE_IMAGE);
  });
});

describe('shared package image resolver resolved-field support', () => {
  it('uses resolvedImage and resolvedGallery before falling back to raw fields', () => {
    expect(
      resolvePackageImage({
        image: PLACEHOLDER_PACKAGE_IMAGE,
        resolvedImage: '/uploads/packages/resolved-primary.jpg',
        resolvedGallery: [{ url: '/uploads/packages/resolved-gallery.jpg' }],
      })
    ).toBe('/uploads/packages/resolved-primary.jpg');

    expect(
      resolvePackageImage({
        image: PLACEHOLDER_PACKAGE_IMAGE,
        resolvedGallery: [{ url: '/uploads/packages/resolved-gallery.jpg' }],
      })
    ).toBe('/uploads/packages/resolved-gallery.jpg');
  });

  it('does not consider rawImage in the shared resolver', () => {
    expect(
      resolvePackageImage({
        image: PLACEHOLDER_PACKAGE_IMAGE,
        rawImage: '/uploads/packages/raw-only.jpg',
      })
    ).toBe(PLACEHOLDER_PACKAGE_IMAGE);
  });
});

describe('browser/server package image resolver parity', () => {
  it('keeps browser and server resolution aligned for all supplier-profile source fields', () => {
    const fixtures = [
      {
        image: '/uploads/packages/direct-image.jpg',
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
      },
      {
        resolvedImage: '/uploads/packages/resolved-image.jpg',
        image: PLACEHOLDER_PACKAGE_IMAGE,
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
      },
      {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        resolvedGallery: [{ url: '/uploads/packages/resolved-gallery.jpg' }],
        rawImage: PLACEHOLDER_PACKAGE_IMAGE,
      },
      {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        gallery: [{ url: PLACEHOLDER_PACKAGE_IMAGE }, { thumbnail: '/uploads/packages/thumb.jpg' }],
      },
      {
        image: PLACEHOLDER_PACKAGE_IMAGE,
        images: [{ originalUrl: '/uploads/packages/legacy-image-array.jpg' }],
      },
      {
        image: 'data:image/png;base64,AAAA',
        resolvedGallery: [{ url: PLACEHOLDER_PACKAGE_IMAGE }],
        rawImage: '/uploads/packages/raw-only-ignored-by-shared-resolvers.jpg',
      },
    ];

    fixtures.forEach(fixture => {
      expect(resolvePackageImage(fixture)).toBe(resolveServerPackageImage(fixture));
    });
  });
});

describe('supplier-profile source wiring', () => {
  let supplierProfileContent;
  let supplierHtmlContent;

  beforeAll(() => {
    supplierProfileContent = fs.readFileSync(SUPPLIER_PROFILE, 'utf8');
    supplierHtmlContent = fs.readFileSync(SUPPLIER_HTML, 'utf8');
  });

  it('uses the shared window.resolvePackageImage resolver for package cards', () => {
    expect(supplierProfileContent).toContain('function getPackageCardImage');
    expect(supplierProfileContent).toContain('window.resolvePackageImage(p)');
  });

  it('keeps rawImage behind resolved/image/gallery/images in the local fallback order', () => {
    const helperStart = supplierProfileContent.indexOf('function getPackageCardImage');
    const helperEnd = supplierProfileContent.indexOf('function _renderPackageCard', helperStart);
    const helper = supplierProfileContent.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(helper.indexOf('p.resolvedImage')).toBeLessThan(helper.indexOf('p.rawImage'));
    expect(helper.indexOf('p.image')).toBeLessThan(helper.indexOf('p.rawImage'));
    expect(helper.indexOf('p.resolvedGallery')).toBeLessThan(helper.indexOf('p.rawImage'));
    expect(helper.indexOf('p.gallery')).toBeLessThan(helper.indexOf('p.rawImage'));
    expect(helper.indexOf('p.images')).toBeLessThan(helper.indexOf('p.rawImage'));
  });

  it('loads package-image-resolver.js before supplier-profile.js with matching cache bust', () => {
    const resolverIdx = supplierHtmlContent.indexOf('package-image-resolver.js?v=18.7.0');
    const profileIdx = supplierHtmlContent.indexOf('supplier-profile.js?v=18.7.0');

    expect(resolverIdx).toBeGreaterThan(-1);
    expect(profileIdx).toBeGreaterThan(-1);
    expect(resolverIdx).toBeLessThan(profileIdx);
  });
});
