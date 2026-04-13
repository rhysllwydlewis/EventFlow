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

  it('supplier-form includes inline error regions for name/category/website validation', () => {
    expect(dashboardHtml).toContain('id="sup-name-error"');
    expect(dashboardHtml).toContain('id="sup-category-error"');
    expect(dashboardHtml).toContain('id="sup-website-error"');
  });

  it('website input includes helper text for https:// auto-normalization', () => {
    expect(dashboardHtml).toContain('id="sup-website-help"');
    expect(dashboardHtml).toContain('https:// is added automatically');
  });
});

describe('Gallery photo 404 error handling', () => {
  it('renderExistingPhotos attaches an onerror handler on gallery <img> elements', () => {
    // Prettier may split addEventListener args across lines; match flexibly
    expect(galleryJs).toMatch(/addEventListener\s*\(\s*['"]error['"]/);
    expect(galleryJs).toContain('photo-preview-item__image-wrap--error');
  });

  it('showPreview also attaches an onerror handler for pending preview images', () => {
    const idx = galleryJs.indexOf('showPreview(file, previewContainer)');
    expect(idx).toBeGreaterThan(-1);
    const previewBlock = galleryJs.slice(idx, idx + 2600);
    expect(previewBlock).toMatch(/addEventListener\s*\(\s*['"]error['"]/);
    expect(previewBlock).toContain('photo-preview-item__image-wrap--error');
  });

  it('banner preview in app.js attaches an onerror handler', () => {
    // Find the banner preview block and confirm error handling is present
    const idx = appJs.indexOf('sup-banner-preview');
    expect(idx).toBeGreaterThan(-1);
    const bannerBlock = appJs.slice(idx, idx + 1000);
    expect(bannerBlock).toMatch(/addEventListener\s*\(\s*['"]error['"]/);
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

// ─── Audit remediation – behavioral / sequencing checks ──────────────────────

describe('Supplier form submit – double-submit prevention (sequencing)', () => {
  it('app.js disables the submit button before any await in the save handler', () => {
    // Verify saveBtn.disabled = true appears BEFORE the first await in the submit block
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    expect(submitIdx).toBeGreaterThan(-1);
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 5000);
    const disabledIdx = handlerBlock.indexOf('saveBtn.disabled = true');
    const awaitIdx = handlerBlock.indexOf('await ensureCsrfToken');
    expect(disabledIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(disabledIdx).toBeLessThan(awaitIdx);
  });

  it('app.js re-enables the submit button inside a finally block', () => {
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    // The submit handler is large (validation + API call); use a generous slice
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 8000);
    const finallyIdx = handlerBlock.indexOf('} finally {');
    const reEnableIdx = handlerBlock.indexOf('saveBtn.disabled = false');
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(reEnableIdx).toBeGreaterThan(-1);
    // re-enable must come after the finally keyword
    expect(reEnableIdx).toBeGreaterThan(finallyIdx);
  });

  it('app.js early-returns if the save button is already disabled (re-entry guard)', () => {
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 500);
    expect(handlerBlock).toContain('saveBtn.disabled');
    expect(handlerBlock).toContain('return');
  });

  it('app.js applies and removes save-button loading state', () => {
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 8000);
    expect(handlerBlock).toContain("saveBtn.classList.add('is-loading')");
    expect(handlerBlock).toContain("saveBtn.classList.remove('is-loading')");
    expect(handlerBlock).toContain("saveBtn.textContent = 'Saving…'");
  });
});

describe('Supplier form submit – savedId empty guard', () => {
  it('app.js checks for empty savedId when method is POST and aborts with an error message', () => {
    expect(appJs).toContain("!savedId && method === 'POST'");
  });

  it('app.js shows an error status message when savedId is empty after POST', () => {
    const guardIdx = appJs.indexOf("!savedId && method === 'POST'");
    const guardBlock = appJs.slice(guardIdx, guardIdx + 400);
    expect(guardBlock).toContain('error');
    expect(guardBlock).toContain('return');
  });
});

describe('Supplier form submit – required field JS validation', () => {
  it('app.js validates the name field before invoking buildSupplierPayload', () => {
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 5000);
    const nameCheckIdx = handlerBlock.indexOf('sup-name');
    const buildPayloadIdx = handlerBlock.indexOf('buildSupplierPayload');
    expect(nameCheckIdx).toBeGreaterThan(-1);
    expect(buildPayloadIdx).toBeGreaterThan(-1);
    // name check must occur before buildSupplierPayload is called
    expect(nameCheckIdx).toBeLessThan(buildPayloadIdx);
  });

  it('app.js validates the category field before invoking buildSupplierPayload', () => {
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 5000);
    const catCheckIdx = handlerBlock.indexOf('sup-category');
    const buildPayloadIdx = handlerBlock.indexOf('buildSupplierPayload');
    expect(catCheckIdx).toBeGreaterThan(-1);
    expect(buildPayloadIdx).toBeGreaterThan(-1);
    expect(catCheckIdx).toBeLessThan(buildPayloadIdx);
  });

  it('app.js shows an inline error and focuses the name field when name is empty', () => {
    // Search within the submit handler block to avoid matching populateSupplierForm
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 6000);
    expect(handlerBlock).toContain('nameEl.focus');
    expect(handlerBlock).toContain('Business name is required');
  });

  it('app.js toggles inline validation helpers/classes for supplier fields', () => {
    expect(appJs).toContain('setSupplierFieldError');
    expect(appJs).toContain('clearSupplierFieldError');
    expect(appJs).toContain('supplier-field-invalid');
  });
});

describe('Supplier form – website URL normalization', () => {
  it('app.js normalizes website URLs by prepending https:// when no scheme is present', () => {
    const buildStart = appJs.indexOf('function buildSupplierPayload(form)');
    const buildBlock = appJs.slice(buildStart, buildStart + 2000);
    // Accept both template-literal and concatenation forms of https:// prepending
    expect(buildBlock).toMatch(/https:\/\//);
    expect(buildBlock).toContain('payload.website');
  });

  it('app.js URL normalization runs inside buildSupplierPayload', () => {
    const buildStart = appJs.indexOf('function buildSupplierPayload(form)');
    expect(buildStart).toBeGreaterThan(-1);
    const buildBlock = appJs.slice(buildStart, buildStart + 2000);
    expect(buildBlock).toContain('https://');
    expect(buildBlock).toContain('payload.website');
  });

  it('app.js does not prepend https:// when the scheme is already present', () => {
    // The normalization guard uses a regex test for ^https?:// before prepending
    // Source contains the regex literal so we check for the key guard pattern
    expect(appJs).toContain('https?:');
    // Ensure the normalization logic is inside buildSupplierPayload
    const buildStart = appJs.indexOf('function buildSupplierPayload(form)');
    const buildBlock = appJs.slice(buildStart, buildStart + 2000);
    expect(buildBlock).toContain('https?:');
  });

  it('app.js validates website URL format before submit', () => {
    const submitIdx = appJs.indexOf("supForm.addEventListener('submit'");
    const handlerBlock = appJs.slice(submitIdx, submitIdx + 8000);
    expect(handlerBlock).toContain('normalizeAndValidateWebsiteInput');
    expect(handlerBlock).toContain('Please fix the website URL and try again.');
  });
});

describe('Banner error state – ⚠ warning indicator consistency', () => {
  it('app.js adds photo-preview-item__image-wrap--error class on banner image load failure', () => {
    // The banner error handler must apply the same error class used by gallery errors
    const bannerIdx = appJs.indexOf('Could not load banner');
    expect(bannerIdx).toBeGreaterThan(-1);
    const bannerBlock = appJs.slice(bannerIdx, bannerIdx + 300);
    expect(bannerBlock).toContain('photo-preview-item__image-wrap--error');
  });

  it('gallery and banner error states share the same CSS error class', () => {
    // Verify gallery.js also uses the same class (not a one-off)
    expect(galleryJs).toContain('photo-preview-item__image-wrap--error');
  });
});

describe('supplier-gallery.js – dead setupFormIntercept call removed', () => {
  it('setup() no longer contains a live call to setupFormIntercept', () => {
    const setupIdx = galleryJs.indexOf('setup() {');
    expect(setupIdx).toBeGreaterThan(-1);
    // Extract the setup() method body (up to the next top-level method)
    const nextMethodIdx = galleryJs.indexOf('\n  setup', setupIdx + 1);
    const endIdx =
      nextMethodIdx !== -1
        ? galleryJs.indexOf('\n  ', nextMethodIdx + 5)
        : galleryJs.indexOf('\n  }', setupIdx) + 4;
    const setupBody = galleryJs.slice(setupIdx, endIdx > setupIdx ? endIdx : setupIdx + 800);
    expect(setupBody).not.toContain('this.setupFormIntercept(');
  });
});

describe('CSS – :has() selectors wrapped in @supports for older Firefox compatibility', () => {
  it('dashboard-animations.css wraps :has() hover rules in @supports selector(:has(*))', () => {
    expect(dashboardAnimationsCss).toContain('@supports selector(:has(*))');
    // The :has() selectors must appear inside the @supports block
    const supportsIdx = dashboardAnimationsCss.indexOf('@supports selector(:has(*))');
    const supportsBlock = dashboardAnimationsCss.slice(supportsIdx, supportsIdx + 500);
    expect(supportsBlock).toContain(':has(form):hover');
  });

  it('supplier-dashboard-improvements.css wraps :has() hover rules in @supports selector(:has(*))', () => {
    expect(supplierDashImprovementsCss).toContain('@supports selector(:has(*))');
    const supportsIdx = supplierDashImprovementsCss.indexOf('@supports selector(:has(*))');
    const supportsBlock = supplierDashImprovementsCss.slice(supportsIdx, supportsIdx + 500);
    expect(supportsBlock).toContain(':has(');
  });
});

describe('CSS – prefers-reduced-motion uses !important to prevent cascade override', () => {
  it('dashboard-animations.css prefers-reduced-motion transition rule uses !important', () => {
    const prmIdx = dashboardAnimationsCss.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(prmIdx).toBeGreaterThan(-1);
    const prmBlock = dashboardAnimationsCss.slice(prmIdx, prmIdx + 400);
    expect(prmBlock).toMatch(/transition[^;]+!important/);
  });

  it('supplier-dashboard-improvements.css prefers-reduced-motion transform rule uses !important', () => {
    // Find the card-specific prefers-reduced-motion block (there may be multiple)
    const prmIdx = supplierDashImprovementsCss.indexOf(
      '/* Respect prefers-reduced-motion — use !important'
    );
    expect(prmIdx).toBeGreaterThan(-1);
    const prmBlock = supplierDashImprovementsCss.slice(prmIdx, prmIdx + 500);
    expect(prmBlock).toMatch(/transform[^;]+!important/);
  });

  it('supplier-dashboard-improvements.css includes loading/error field polish styles', () => {
    expect(supplierDashImprovementsCss).toContain('.supplier-field-invalid');
    expect(supplierDashImprovementsCss).toContain('#sup-create.is-loading::after');
    expect(supplierDashImprovementsCss).toContain('@keyframes supplier-save-spin');
  });
});
