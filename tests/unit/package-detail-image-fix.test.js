/**
 * Package Detail Image Fix – Unit Tests
 *
 * Verifies the changes made to fix intermittent placeholder images
 * on package detail pages:
 *
 *  1. routes/suppliers.js – GET /packages/:slug now returns
 *     `image: resolvePackageImage(pkg)` instead of the raw database value,
 *     plus a `resolvedGallery` array with normalised {url} objects and
 *     optional `_debug` diagnostics when ?debugImages=1.
 *
 *  2. public/assets/js/pages/package-init.js – gallery items with empty or
 *     placeholder URLs are filtered out before being passed to PackageGallery.
 *     URL extraction now includes originalUrl and thumbnail field names.
 *     resolvedGallery from the API is preferred over raw gallery.
 *
 *  3. public/assets/js/components/package-gallery.js – URL extraction now
 *     includes originalUrl and thumbnail field names in both the main image
 *     and thumbnail rendering paths.
 *     The first (immediately visible) gallery image uses loading="eager".
 *
 *  4. public/package.html – loads package-image-resolver.js before the
 *     gallery and page-init scripts.
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
const PACKAGE_HTML = path.join(__dirname, '../../public/package.html');

let suppliersContent;
let packageInitContent;
let packageGalleryContent;
let packageHtmlContent;

beforeAll(() => {
  suppliersContent = fs.readFileSync(SUPPLIERS_ROUTES, 'utf8');
  packageInitContent = fs.readFileSync(PACKAGE_INIT, 'utf8');
  packageGalleryContent = fs.readFileSync(PACKAGE_GALLERY, 'utf8');
  packageHtmlContent = fs.readFileSync(PACKAGE_HTML, 'utf8');
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

  it('includes resolvedGallery in the package detail response', () => {
    const marker = "router.get('/packages/:slug'";
    const start = suppliersContent.indexOf(marker);
    const afterStart = suppliersContent.indexOf('\nrouter.', start + marker.length);
    const block = suppliersContent.substring(start, afterStart === -1 ? undefined : afterStart);

    expect(block).toContain('resolvedGallery');
    expect(block).toContain('normalizeGallery(');
  });

  it('includes ?debugImages=1 diagnostic support in the detail endpoint', () => {
    const marker = "router.get('/packages/:slug'";
    const start = suppliersContent.indexOf(marker);
    const afterStart = suppliersContent.indexOf('\nrouter.', start + marker.length);
    const block = suppliersContent.substring(start, afterStart === -1 ? undefined : afterStart);

    expect(block).toContain('debugImages');
    expect(block).toContain('_debug');
  });
});

// ─── normalizeGallery helper ──────────────────────────────────────────────────

describe('suppliers.js — normalizeGallery function', () => {
  it('defines a normalizeGallery function', () => {
    expect(suppliersContent).toContain('function normalizeGallery(');
  });

  it('handles string gallery items in normalizeGallery', () => {
    expect(suppliersContent).toContain("typeof img === 'string'");
  });

  it('extracts originalUrl and thumbnail field names and filters placeholders in normalizeGallery', () => {
    // Extract the normalizeGallery function body by tracking brace depth from the
    // function declaration, so inner block closing braces are not confused with the
    // function-level closing brace.
    const fnStart = suppliersContent.indexOf('function normalizeGallery(');
    expect(fnStart).toBeGreaterThan(-1);

    let depth = 0;
    let fnEnd = -1;
    for (let i = fnStart; i < suppliersContent.length; i++) {
      if (suppliersContent[i] === '{') {
        depth++;
      } else if (suppliersContent[i] === '}') {
        depth--;
        if (depth === 0) {
          fnEnd = i;
          break;
        }
      }
    }
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBlock = suppliersContent.substring(fnStart, fnEnd + 1);

    expect(fnBlock).toContain('img.originalUrl');
    expect(fnBlock).toContain('img.thumbnail');
    expect(fnBlock).toContain('isPlaceholderImage(url)');
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

  it('prefers resolvedGallery from API over raw gallery', () => {
    expect(packageInitContent).toContain('pkg.resolvedGallery');
    // rawGallery must prefer resolvedGallery
    const rawIdx = packageInitContent.indexOf('const rawGallery');
    expect(rawIdx).toBeGreaterThan(-1);
    const rawLine = packageInitContent.substring(rawIdx, rawIdx + 100);
    expect(rawLine).toContain('pkg.resolvedGallery');
  });

  it('extracts originalUrl field from gallery items', () => {
    expect(packageInitContent).toContain('img.originalUrl');
  });

  it('extracts thumbnail field from gallery items', () => {
    expect(packageInitContent).toContain('img.thumbnail');
  });
});

// ─── package-gallery.js URL extraction ───────────────────────────────────────

describe('PackageGallery — URL field extraction', () => {
  it('extracts originalUrl from gallery items in main image rendering', () => {
    expect(packageGalleryContent).toContain('img.originalUrl');
  });

  it('extracts thumbnail from gallery items in main image rendering', () => {
    // Verify the main image render (first occurrence of originalUrl) also has thumbnail
    const firstOrigIdx = packageGalleryContent.indexOf('img.originalUrl');
    expect(firstOrigIdx).toBeGreaterThan(-1);
    const block = packageGalleryContent.substring(firstOrigIdx, firstOrigIdx + 100);
    expect(block).toContain('img.thumbnail');
  });

  it('extracts originalUrl from gallery items in thumbnail rendering', () => {
    // Verify the second occurrence (thumbnail strip) also extracts originalUrl
    const firstOrigIdx = packageGalleryContent.indexOf('img.originalUrl');
    const secondOrigIdx = packageGalleryContent.indexOf('img.originalUrl', firstOrigIdx + 1);
    expect(secondOrigIdx).toBeGreaterThan(-1);
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

// ─── package.html script loading ─────────────────────────────────────────────

describe('package.html — script loading order', () => {
  it('loads package-image-resolver.js', () => {
    expect(packageHtmlContent).toContain('package-image-resolver.js');
  });

  it('loads package-image-resolver.js before package-gallery.js', () => {
    const resolverIdx = packageHtmlContent.indexOf('package-image-resolver.js');
    const galleryIdx = packageHtmlContent.indexOf('package-gallery.js');
    expect(resolverIdx).toBeGreaterThan(-1);
    expect(galleryIdx).toBeGreaterThan(-1);
    expect(resolverIdx).toBeLessThan(galleryIdx);
  });

  it('loads package-image-resolver.js before package-init.js', () => {
    const resolverIdx = packageHtmlContent.indexOf('package-image-resolver.js');
    const initIdx = packageHtmlContent.indexOf('package-init.js');
    expect(resolverIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(-1);
    expect(resolverIdx).toBeLessThan(initIdx);
  });
});

// ─── package.html breadcrumb fix ─────────────────────────────────────────────

describe('package.html — breadcrumb double-separator fix', () => {
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
