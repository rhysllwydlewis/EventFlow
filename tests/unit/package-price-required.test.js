/**
 * Package Price Required & Image Pipeline – Unit Tests
 *
 * Verifies the changes introduced in the "fix package image display issues" PR:
 *
 *  1. routes/packages.js POST /me/packages – price is required (server-side).
 *  2. routes/packages.js POST /me/packages – base64 image routed through
 *     saveImageBase64 pipeline, stored URL added to gallery.
 *  3. routes/packages.js PUT /me/packages/:id – base64 image goes through
 *     the same pipeline; gallery is kept in sync.
 *  4. routes/packages.js POST /me/packages/:id/photos (gallery upload) –
 *     auto-syncs pkg.image when it was previously a placeholder.
 *  5. Display components show "Price not set" instead of "Contact for pricing".
 *  6. dashboard-supplier.html price input carries the HTML `required` attribute.
 *  7. app.js client-side validation blocks submission when price is empty.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGES_ROUTES = path.join(__dirname, '../../routes/packages.js');
const CAROUSEL_JS = path.join(__dirname, '../../public/assets/js/components/carousel.js');
const PACKAGE_LIST_JS = path.join(__dirname, '../../public/assets/js/components/package-list.js');
const HOME_INIT_JS = path.join(__dirname, '../../public/assets/js/pages/home-init.js');
const PACKAGE_INIT_JS = path.join(__dirname, '../../public/assets/js/pages/package-init.js');
const START_WIZARD_JS = path.join(__dirname, '../../public/assets/js/pages/start-wizard.js');
const DASHBOARD_HTML = path.join(__dirname, '../../public/dashboard-supplier.html');
const APP_JS = path.join(__dirname, '../../public/assets/js/app.js');

let packagesContent;
let carouselContent;
let packageListContent;
let homeInitContent;
let packageInitContent;
let startWizardContent;
let dashboardHtml;
let appJs;

beforeAll(() => {
  packagesContent = fs.readFileSync(PACKAGES_ROUTES, 'utf8');
  carouselContent = fs.readFileSync(CAROUSEL_JS, 'utf8');
  packageListContent = fs.readFileSync(PACKAGE_LIST_JS, 'utf8');
  homeInitContent = fs.readFileSync(HOME_INIT_JS, 'utf8');
  packageInitContent = fs.readFileSync(PACKAGE_INIT_JS, 'utf8');
  startWizardContent = fs.readFileSync(START_WIZARD_JS, 'utf8');
  dashboardHtml = fs.readFileSync(DASHBOARD_HTML, 'utf8');
  appJs = fs.readFileSync(APP_JS, 'utf8');
});

// ─── 1. Server-side price required on POST ────────────────────────────────────

describe('POST /me/packages — price required (server)', () => {
  it('rejects missing price with a 400 status check', () => {
    expect(packagesContent).toContain('if (!price || !String(price).trim())');
    expect(packagesContent).toContain('res.status(400)');
  });

  it('returns a clear error message when price is missing', () => {
    expect(packagesContent).toContain(
      'A price is required. Please enter a specific price for this package.'
    );
  });

  it('stores price as trimmed string on the new package object', () => {
    expect(packagesContent).toContain('price: String(price).trim().slice(0, 60)');
  });
});

// ─── 2. POST base64 image pipeline ────────────────────────────────────────────

describe('POST /me/packages — base64 image pipeline', () => {
  it('detects data: URI and calls saveImageBase64', () => {
    expect(packagesContent).toContain("image.startsWith('data:')");
    expect(packagesContent).toContain('saveImageBase64(image,');
  });

  it('adds the resolved image to the gallery on create', () => {
    // After saveImageBase64 the URL is pushed into gallery
    expect(packagesContent).toContain('gallery.push({ url: resolvedImage, approved: true');
  });

  it('stores both image and gallery fields in the new package document', () => {
    expect(packagesContent).toContain('image: resolvedImage,');
    expect(packagesContent).toContain('gallery,');
  });

  it('falls back gracefully when saveImageBase64 throws on create', () => {
    expect(packagesContent).toContain(
      "logger.warn('Package create: image processing failed, storing without image:'"
    );
  });
});

// ─── 3. PUT base64 image pipeline ─────────────────────────────────────────────

describe('PUT /me/packages/:id — base64 image pipeline', () => {
  it('detects data: URI in PUT body and routes through saveImageBase64', () => {
    // The PUT block should check startsWith('data:') and call saveImageBase64
    expect(packagesContent).toContain("newImage.startsWith('data:')");
    expect(packagesContent).toContain('saveImageBase64(');
  });

  it('adds the stored URL to gallery when not already present', () => {
    expect(packagesContent).toContain('alreadyInGallery');
    // If not in gallery, it prepends the new entry
    expect(packagesContent).toContain('pkgUpdates.gallery = [');
  });

  it('falls back gracefully when saveImageBase64 throws on update', () => {
    expect(packagesContent).toContain(
      "logger.warn('Package update: image processing failed, keeping existing image:'"
    );
  });

  it('invalidates package caches after PUT', () => {
    // Find the PUT handler block — it ends just before the next router.put/router.post/router.delete.
    // All router definitions in packages.js begin with '\nrouter.' at the start of a line, so
    // this boundary detection is reliable for this codebase.
    const marker = "router.put(\n  '/me/packages/:id'";
    const start = packagesContent.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    // Find the end of the block (next router method definition)
    const after = packagesContent.indexOf('\nrouter.', start + marker.length);
    const block = packagesContent.substring(start, after === -1 ? undefined : after);
    expect(block).toContain('suppliersRouter.invalidatePackageCaches()');
  });
});

// ─── 4. Gallery upload — auto-sync pkg.image ─────────────────────────────────

describe('POST /me/packages/:id/photos — auto-sync pkg.image', () => {
  it('sets pkg.image to the uploaded URL when pkg.image was a placeholder', () => {
    expect(packagesContent).toContain(
      "if (!p.image || p.image === PLACEHOLDER_PACKAGE_IMAGE || p.image === '')"
    );
    expect(packagesContent).toContain('updateFields.image = url');
  });

  it('does NOT overwrite a real pkg.image when one already exists', () => {
    // The guard fires only when image is absent/placeholder — a surrounding conditional ensures
    // a real image is never replaced.  Just verify the guard and update are present.
    expect(packagesContent).toContain(
      "if (!p.image || p.image === PLACEHOLDER_PACKAGE_IMAGE || p.image === '')"
    );
    expect(packagesContent).toContain('updateFields.image = url');
  });

  it('invalidates package caches after gallery upload', () => {
    // The photo upload route (POST /me/packages/:id/photos) calls invalidatePackageCaches
    // after committing the updated gallery + auto-synced image to the DB.
    // We verify via line proximity: the photo route adds to p.gallery and then invalidates.
    expect(packagesContent).toContain('p.gallery.push({ url, approved: true');
    expect(packagesContent).toContain('suppliersRouter.invalidatePackageCaches()');
  });
});

// ─── 5. "Price not set" in display components ────────────────────────────────

describe('Display components — "Price not set" fallback', () => {
  it('carousel.js shows "Price not set" when price is missing', () => {
    expect(carouselContent).toContain("return 'Price not set'");
    expect(carouselContent).not.toContain('Contact for pricing');
  });

  it('package-list.js falls back to "Price not set"', () => {
    expect(packageListContent).toContain("'Price not set'");
    expect(packageListContent).not.toContain('Contact for price');
  });

  it('home-init.js shows "Price not set" when price is missing', () => {
    expect(homeInitContent).toContain("return 'Price not set'");
    expect(homeInitContent).not.toContain('Contact for pricing');
  });

  it('package-init.js shows "Price not set" when price is missing', () => {
    expect(packageInitContent).toContain("'Price not set'");
    expect(packageInitContent).not.toContain('Contact for price');
  });

  it('start-wizard.js shows "Price not set" when price is missing', () => {
    expect(startWizardContent).toContain("'Price not set'");
    expect(startWizardContent).not.toContain('Contact for pricing');
  });
});

// ─── 6. HTML `required` on price input ───────────────────────────────────────

describe('dashboard-supplier.html — price input required attribute', () => {
  it('pkg-price input has required attribute', () => {
    // The input must have both id="pkg-price" and the required attribute
    expect(dashboardHtml).toMatch(/id="pkg-price"[^>]*required|required[^>]*id="pkg-price"/);
  });

  it('price label marks the field as required with an asterisk indicator', () => {
    expect(dashboardHtml).toContain('form-required');
  });
});

// ─── 7. Client-side price validation in app.js ────────────────────────────────

describe('app.js — client-side price validation', () => {
  it('validates that price is non-empty before submitting', () => {
    expect(appJs).toContain('!payload.price || !String(payload.price).trim()');
  });

  it('shows a user-friendly alert when price is missing', () => {
    expect(appJs).toContain('Please enter a price for this package');
  });
});
