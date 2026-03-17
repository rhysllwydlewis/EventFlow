/**
 * Package Detail Image Fix – Unit Tests
 *
 * Verifies the three changes made to fix intermittent placeholder images
 * on package detail pages:
 *
 *  1. routes/suppliers.js – GET /packages/:slug now returns
 *     `image: resolvePackageImage(pkg)` instead of the raw database value.
 *
 *  2. public/assets/js/pages/package-init.js – gallery items with empty or
 *     placeholder URLs are filtered out before being passed to PackageGallery.
 *
 *  3. public/assets/js/components/package-gallery.js – the first (immediately
 *     visible) gallery image uses loading="eager" to avoid the Chrome lazy-load
 *     browser intervention that can replace it with a placeholder.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SUPPLIERS_ROUTES = path.join(__dirname, '../../routes/suppliers.js');
const PACKAGE_INIT = path.join(__dirname, '../../public/assets/js/pages/package-init.js');
const PACKAGE_GALLERY = path.join(
  __dirname,
  '../../public/assets/js/components/package-gallery.js'
);

let suppliersContent;
let packageInitContent;
let packageGalleryContent;

beforeAll(() => {
  suppliersContent = fs.readFileSync(SUPPLIERS_ROUTES, 'utf8');
  packageInitContent = fs.readFileSync(PACKAGE_INIT, 'utf8');
  packageGalleryContent = fs.readFileSync(PACKAGE_GALLERY, 'utf8');
});

// ─── API route image normalisation ───────────────────────────────────────────

describe('GET /packages/:slug — image field normalisation', () => {
  it('applies resolvePackageImage() before sending the package response', () => {
    // Find the /packages/:slug handler block
    const marker = "router.get('/packages/:slug'";
    const start = suppliersContent.indexOf(marker);
    expect(start).toBeGreaterThan(-1);

    // Extract from the handler up to the next router definition
    const afterStart = suppliersContent.indexOf('\nrouter.', start + marker.length);
    const block = suppliersContent.substring(start, afterStart === -1 ? undefined : afterStart);

    // The response must spread pkg and override image with resolvePackageImage(pkg)
    expect(block).toContain('resolvePackageImage(pkg)');
    // Ensure it spreads the package data (not just replaces the whole object)
    expect(block).toContain('...pkg');
  });

  it('does NOT return the raw pkg object directly in the package field', () => {
    const marker = "router.get('/packages/:slug'";
    const start = suppliersContent.indexOf(marker);
    const afterStart = suppliersContent.indexOf('\nrouter.', start + marker.length);
    const block = suppliersContent.substring(start, afterStart === -1 ? undefined : afterStart);

    // Should not use `package: pkg` without spreading/normalising
    expect(block).not.toMatch(/package:\s*pkg[,\s}]/);
  });
});

// ─── package-init.js gallery filtering ───────────────────────────────────────

describe('package-init.js — gallery item filtering', () => {
  it('filters gallery entries with empty URLs before building galleryImages', () => {
    expect(packageInitContent).toContain('validGalleryImages');
    expect(packageInitContent).toContain('.filter(');
  });

  it('guards against null/undefined gallery items (avoids TypeError)', () => {
    // The filter must bail out early when img is falsy — check the block form used
    expect(packageInitContent).toContain('if (!img) {');
    expect(packageInitContent).toContain('return false;');
  });

  it('filters out placeholder path entries from the gallery', () => {
    expect(packageInitContent).toContain('PLACEHOLDER_PATH');
    expect(packageInitContent).toContain('/assets/images/placeholders/');
  });

  it('falls back to pkg.image only when it is not a placeholder', () => {
    // The fallback conditional must guard against both null pkg.image and placeholder values.
    // Look for the pattern used in package-init.js.
    expect(packageInitContent).toContain('pkg.image && !pkg.image.includes(PLACEHOLDER_PATH)');
  });

  it('passes validGalleryImages (not rawGallery) to PackageGallery', () => {
    expect(packageInitContent).toContain(
      "new PackageGallery('package-gallery-container', galleryImages)"
    );
    // galleryImages must be derived from validGalleryImages (not rawGallery directly).
    // Find the galleryImages assignment and confirm it references validGalleryImages.
    const idx = packageInitContent.indexOf('const galleryImages');
    const nextSemi = packageInitContent.indexOf(';', idx + 200);
    const galleryImagesBlock =
      nextSemi === -1
        ? packageInitContent.substring(idx, idx + 400)
        : packageInitContent.substring(idx, nextSemi + 1);
    expect(galleryImagesBlock).toContain('validGalleryImages');
  });
});

// ─── package-gallery.js eager loading for first image ────────────────────────

describe('PackageGallery — first image uses eager loading', () => {
  it('sets loading="eager" for the first image (index 0)', () => {
    expect(packageGalleryContent).toMatch(/index\s*===\s*0.*?eager/s);
  });

  it('retains loading="lazy" for subsequent images', () => {
    expect(packageGalleryContent).toContain("'lazy'");
  });

  it('does not set loading="lazy" unconditionally for all images', () => {
    // The old unconditional assignment must no longer be present
    expect(packageGalleryContent).not.toMatch(/image\.loading\s*=\s*'lazy'\s*;/);
  });
});

// ─── package.html breadcrumb fix ─────────────────────────────────────────────

describe('package.html — breadcrumb double-separator fix', () => {
  let packageHtmlContent;

  beforeAll(() => {
    const htmlPath = path.join(__dirname, '../../public/package.html');
    packageHtmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  it('wraps the category crumb in a group hidden by default', () => {
    expect(packageHtmlContent).toContain('id="breadcrumb-category-group"');
    expect(packageHtmlContent).toContain('style="display:none;"');
  });

  it('package-init.js reveals the category group only when categories exist', () => {
    expect(packageInitContent).toContain('breadcrumb-category-group');
    expect(packageInitContent).toContain('catGroup.style.display');
  });

  it('package.html OG/Twitter URL uses clean path without .html extension', () => {
    expect(packageHtmlContent).not.toContain('package.html"');
    expect(packageHtmlContent).toContain('event-flow.co.uk/package"');
  });
});
