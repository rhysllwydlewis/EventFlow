/**
 * Unit tests for Supplier Dashboard Bug Fixes
 *
 * Verifies fixes for the following issues:
 *  1. TypeError: .indexOf() on undefined when processing API response data
 *  2. Missing/incorrect export of createConversionFunnelWidget
 *  3. Image 404 fallback handling in dashboard-supplier.html
 *  4. Default/fallback values when config reads return undefined
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── file content fixtures ────────────────────────────────────────────────────

const pagesDir = path.join(process.cwd(), 'public/assets/js/pages');
const dashboardHtml = `${fs.readFileSync(
  path.join(process.cwd(), 'public/dashboard-supplier.html'),
  'utf8'
)}\n${fs.readFileSync(path.join(pagesDir, 'dashboard-supplier-module.js'), 'utf8')}\n${
  fs.existsSync(path.join(pagesDir, 'dashboard-supplier-inline.js'))
    ? fs.readFileSync(path.join(pagesDir, 'dashboard-supplier-inline.js'), 'utf8')
    : ''
}\n${fs.readFileSync(
  path.join(pagesDir, 'dashboard-supplier-threads.js'),
  'utf8'
)}\n${fs.readFileSync(path.join(pagesDir, 'dashboard-supplier-category.js'), 'utf8')}`;

const errorHandlerJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/utils/global-error-handler.js'),
  'utf8'
);

const supplierAnalyticsJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/supplier-analytics-chart.js'),
  'utf8'
);

// ─── Error 1: .indexOf() on undefined ────────────────────────────────────────

describe('Supplier Dashboard – .indexOf() null/undefined guards', () => {
  it('image src guard uses && before .includes() to prevent TypeError', () => {
    // The image error handler should guard img.src before calling .includes()
    expect(dashboardHtml).toContain('img.src && img.src.includes');
  });

  it('label.textContent guard uses && before .includes() to prevent TypeError', () => {
    // The realtime notification handler guards label.textContent before .includes()
    expect(dashboardHtml).toContain('label.textContent &&');
    expect(dashboardHtml).toContain('label.textContent.includes');
  });

  it('app.js guards file.type before calling .indexOf()', () => {
    const appJs = fs.readFileSync(path.join(process.cwd(), 'public/assets/js/app.js'), 'utf8');
    // Accept various guard patterns: !file.type ||, file.type &&, optional chaining,
    // or a safe Set/object-lookup approach that avoids .indexOf() entirely.
    expect(appJs).toMatch(
      /(?:!file\.type\s*\|\|\s*file\.type\.indexOf|file\.type\?\.indexOf|file\.type\s*&&\s*file\.type\.indexOf|ALLOWED_TYPES\.has\(file\.type\)|ALLOWED_TYPES\[file\.type\]|!file\.type\s*\|\|\s*!ALLOWED_TYPES)/
    );
  });
});

// ─── Error 2: createConversionFunnelWidget export ────────────────────────────

describe('supplier-analytics-chart.js – createConversionFunnelWidget export', () => {
  it('exports createConversionFunnelWidget as a named export', () => {
    expect(supplierAnalyticsJs).toContain(
      'export async function createConversionFunnelWidget(containerId'
    );
  });

  it('includes createConversionFunnelWidget in the default export object', () => {
    // Allow for optional trailing comma or closing brace (resilient to formatting)
    expect(supplierAnalyticsJs).toMatch(/createConversionFunnelWidget\s*[,}]/);
  });

  it('dashboard-supplier.html imports createConversionFunnelWidget from the correct module', () => {
    expect(dashboardHtml).toContain('createConversionFunnelWidget');
    expect(dashboardHtml).toContain("from '/assets/js/supplier-analytics-chart.js'");
  });
});

// ─── Error 3: Image 404 fallback handling ────────────────────────────────────

describe('dashboard-supplier.html – Image 404 fallback handling', () => {
  it('has a global image error handler attached to DOMContentLoaded', () => {
    expect(dashboardHtml).toContain("document.addEventListener('DOMContentLoaded'");
    expect(dashboardHtml).toContain("e.target.tagName === 'IMG'");
  });

  it('logs a console.warn for upload path 404s', () => {
    expect(dashboardHtml).toContain("console.warn('Image upload 404 - File not found:'");
  });

  it('sets a placeholder SVG for supplier upload images that fail to load', () => {
    expect(dashboardHtml).toContain("img.src.includes('/uploads/suppliers/')");
    expect(dashboardHtml).toContain('img.src = placeholderSvg');
  });

  it('sets a placeholder for package images that fail to load', () => {
    expect(dashboardHtml).toContain("img.src.includes('/uploads/packages/')");
  });

  it('uses stopPropagation to prevent duplicate error events', () => {
    expect(dashboardHtml).toContain('e.stopPropagation()');
  });

  it('uses dataset.errorHandled flag to prevent re-triggering', () => {
    expect(dashboardHtml).toContain("img.dataset.errorHandled = 'true'");
  });
});

// ─── Error 4: global-error-handler default/fallback for config reads ─────────

describe('global-error-handler.js – robustness improvements', () => {
  it('isBenignError guards against non-string errorMessage', () => {
    expect(errorHandlerJs).toContain("typeof errorMessage !== 'string'");
  });

  it('isBenignError identifies module SyntaxError with "does not provide an export named" as benign', () => {
    expect(errorHandlerJs).toContain('does not provide an export named');
  });

  it('isBenignError identifies module SyntaxError with "The requested module" as benign', () => {
    expect(errorHandlerJs).toContain('The requested module');
  });

  it('logError uses optional chaining on error.stack to prevent undefined.substring TypeError', () => {
    // error.stack?.substring is safe; plain error.stack.substring would fail on missing stacks
    expect(errorHandlerJs).toMatch(
      /error\.stack\?\.substring|error\.stack && error\.stack\.substring/
    );
  });

  it('notifyError falls back gracefully when no notification system is available', () => {
    // Should have a final fallback (console.warn) when Toast and EventFlowNotifications are absent
    expect(errorHandlerJs).toContain('console.warn');
    expect(errorHandlerJs).toContain('Error notification:');
  });

  it('unhandledrejection handler converts non-Error reasons to Error objects', () => {
    expect(errorHandlerJs).toContain('event.reason instanceof Error');
    expect(errorHandlerJs).toContain('new Error(String(event.reason))');
  });
});

// ─── Fetch interceptor null-safety ───────────────────────────────────────────

describe('global-error-handler.js – fetch interceptor null-safety', () => {
  it('parseErrorMessage handles JSON parse failures gracefully', () => {
    expect(errorHandlerJs).toContain('async function parseErrorMessage(response, defaultMessage)');
    expect(errorHandlerJs).toContain('catch (parseError)');
    expect(errorHandlerJs).toContain('return defaultMessage');
  });

  it('fetch interceptor clones response before parsing to preserve original', () => {
    expect(errorHandlerJs).toContain('response.clone()');
  });

  it('fetch interceptor re-throws network errors so callers can handle them', () => {
    expect(errorHandlerJs).toContain('throw error');
  });
});

// ─── Fix: supplier profile save / form interaction regressions ──────────────

const galleryJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/supplier-gallery.js'),
  'utf8'
);

const appJs = fs.readFileSync(path.join(process.cwd(), 'public/assets/js/app.js'), 'utf8');

const dashboardAnimationsCss = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/css/dashboard-animations.css'),
  'utf8'
);

const supplierDashImprovementsCss = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/css/supplier-dashboard-improvements.css'),
  'utf8'
);

describe('Supplier profile save – no duplicate form submit handler', () => {
  it('supplier-gallery.js setupFormIntercept is a no-op (does not add a submit listener)', () => {
    // The old implementation added its own submit listener that raced with app.js.
    // Confirm setupFormIntercept no longer registers addEventListener('submit', ...).
    // We find the method body and verify it contains no 'submit' event binding.
    const methodStart = galleryJs.indexOf('setupFormIntercept(');
    expect(methodStart).toBeGreaterThan(-1);
    // Extract up to the next method definition
    const methodBody = galleryJs.slice(methodStart, galleryJs.indexOf('\n  }', methodStart) + 4);
    expect(methodBody).not.toContain("addEventListener('submit'");
    expect(methodBody).not.toContain('addEventListener("submit"');
  });

  it('supplier-gallery.js exposes uploadPendingGalleryPhotos on window', () => {
    expect(galleryJs).toContain('window.uploadPendingGalleryPhotos');
  });

  it('app.js calls window.uploadPendingGalleryPhotos after saving the supplier', () => {
    expect(appJs).toContain('uploadPendingGalleryPhotos');
  });

  it('app.js updates the sup-id hidden field for newly created suppliers', () => {
    expect(appJs).toContain('supIdField.value = savedId');
  });
});

describe('Supplier profile form – website field browser validation disabled', () => {
  it('supplier-form has novalidate attribute to prevent browser URL validation blocking save', () => {
    expect(dashboardHtml).toContain('id="supplier-form"');
    expect(dashboardHtml).toMatch(
      /id="supplier-form"[^>]*novalidate|novalidate[^>]*id="supplier-form"/
    );
  });

  it('sup-website input is type="text" not type="url" to avoid browser scroll-to-field validation', () => {
    expect(dashboardHtml).not.toMatch(/id="sup-website"[^>]*type="url"/);
    expect(dashboardHtml).toMatch(/id="sup-website"/);
  });
});

describe('Gallery photo 404 error handling', () => {
  it('renderExistingPhotos attaches an onerror handler on gallery <img> elements', () => {
    expect(galleryJs).toContain("addEventListener('error'");
    expect(galleryJs).toContain('photo-preview-item__image-wrap--error');
  });

  it('banner preview in app.js attaches an onerror handler', () => {
    // Find the banner preview block and confirm error handling is present
    const idx = appJs.indexOf('sup-banner-preview');
    expect(idx).toBeGreaterThan(-1);
    const bannerBlock = appJs.slice(idx, idx + 1000);
    expect(bannerBlock).toContain("addEventListener('error'");
  });
});

describe('Card hover animation – no layout shift on form cards', () => {
  it('dashboard-animations.css cancels translateY for sd-card on hover', () => {
    expect(dashboardAnimationsCss).toContain('.sd-card:hover');
    expect(dashboardAnimationsCss).toContain('transform: none');
  });

  it('dashboard-animations.css includes prefers-reduced-motion rule', () => {
    expect(dashboardAnimationsCss).toContain('prefers-reduced-motion');
    expect(dashboardAnimationsCss).toContain('transform: none');
  });

  it('supplier-dashboard-improvements.css cancels translateY for sd-card on hover', () => {
    expect(supplierDashImprovementsCss).toContain('.sd-card:hover');
    expect(supplierDashImprovementsCss).toContain('transform: none');
  });

  it('supplier-dashboard-improvements.css includes prefers-reduced-motion rule', () => {
    expect(supplierDashImprovementsCss).toContain('prefers-reduced-motion');
  });

  it('supplier-dashboard-improvements.css includes error state CSS for image wrap', () => {
    expect(supplierDashImprovementsCss).toContain('photo-preview-item__image-wrap--error');
  });
});
