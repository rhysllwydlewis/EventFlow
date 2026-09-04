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
    expect(errorHandlerJs).toMatch(/catch\s*\(\s*_?parseError\s*\)/);
    expect(errorHandlerJs).toContain('return defaultMessage');
  });

  it('fetch interceptor clones response before parsing to preserve original', () => {
    expect(errorHandlerJs).toContain('response.clone()');
  });

  it('fetch interceptor re-throws network errors so callers can handle them', () => {
    expect(errorHandlerJs).toContain('throw error');
  });

  it('only reports failed requests to EventFlow as application network errors', () => {
    expect(errorHandlerJs).toContain('function isEventFlowRequest(input)');
    expect(errorHandlerJs).toContain('if (!shouldHandleError)');
    expect(appJs).not.toContain('const realFetch = window.fetch.bind(window)');
  });
});

// ─── Fix: supplier profile save / form interaction regressions ──────────────

const galleryJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/supplier-gallery.js'),
  'utf8'
);

const appJs = fs.readFileSync(path.join(process.cwd(), 'public/assets/js/app.js'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(process.cwd(), 'public/settings.html'), 'utf8');
const messengerWidgetJs = fs.readFileSync(
  path.join(process.cwd(), 'public/messenger/js/MessengerWidgetV4.js'),
  'utf8'
);
const stylesCss = fs.readFileSync(path.join(process.cwd(), 'public/assets/css/styles.css'), 'utf8');
const photoUploaderJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/components/photo-uploader.js'),
  'utf8'
);
const supplierMessagesJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/supplier-messages.js'),
  'utf8'
);

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
    expect(dashboardHtml).toContain(
      'If no protocol is provided, https:// will be added when you save'
    );
    expect(dashboardHtml).toContain('www.event-flow.co.uk');
  });
});

describe('Supplier dashboard/profile UI polish', () => {
  it('dashboard-supplier toggle profile button uses a pencil edit icon (not plus)', () => {
    const start = dashboardHtml.indexOf('id="toggle-profile-form"');
    expect(start).toBeGreaterThan(-1);
    const section = dashboardHtml.slice(start, start + 1000);
    expect(section).toContain(
      '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'
    );
    expect(section).not.toContain('<path d="M5 12h14"/>');
    expect(section).not.toContain('<path d="M12 5v14"/>');
  });

  it('supplier profile Remove button is absent — no remove profile ability', () => {
    // The Remove button was intentionally removed from the card UI.
    // There should be no supplier-profile-photo-remove button in the card template.
    expect(appJs).not.toContain(
      'class="supplier-profile-photo-remove spc-action-btn spc-action-btn--danger"'
    );
    expect(appJs).not.toContain('spc-action-btn--danger');
    // The photo-remove event binding loop should also be gone
    expect(appJs).not.toContain("querySelectorAll('.supplier-profile-photo-remove')");
  });

  it('settings Remove photo button matches outlined upload-button chrome', () => {
    expect(settingsHtml).toContain('id="avatar-delete-btn"');
    expect(settingsHtml).toContain('border:1px solid #CFEDEA;background:#F6FAF9;color:#dc2626');
    expect(settingsHtml).toContain('box-sizing:border-box;line-height:inherit;');
    const uploadLabel = settingsHtml.match(/<label[^>]*for="avatar-upload-input"[^>]*>/)?.[0];
    expect(uploadLabel).toBeDefined();
    expect(uploadLabel).toContain('class="cta secondary"');
    expect(uploadLabel).toMatch(/font-size:\s*0\.8125rem/);
    expect(uploadLabel).toContain('box-sizing:border-box;line-height:inherit;');
    expect(settingsHtml).not.toContain('border:1px solid #fca5a5;background:#fff5f5;color:#dc2626');
    expect(settingsHtml).not.toContain('border:1px solid #d1d5db;background:#fff;color:#dc2626');
  });

  it('dashboard and messenger avatar URLs allow safe https CDN and rooted relative forms', () => {
    expect(messengerWidgetJs).toContain('/^(https?:\\/\\/|\\/[^:])/i.test(avatarUrl)');
    expect(appJs).toContain('/^(https?:\\/\\/|\\/[^:])/i.test(otherParticipant.avatar)');
    expect(supplierMessagesJs).toContain('/^(https?:\\/\\/|\\/[^:])/i.test(avatarUrl.trim())');
    expect(supplierMessagesJs).toContain(
      "const initial = escapeHtml((name || 'U').charAt(0).toUpperCase())"
    );
  });

  it('gallery remove buttons use reduced dimensions with hue-only hover (no scale)', () => {
    expect(stylesCss).toContain('.photo-remove-btn{');
    expect(stylesCss).toContain('width:10px;');
    expect(stylesCss).toContain('height:10px;');
    const compactRemoveStart = stylesCss.indexOf('.photo-remove-btn{');
    const compactRemoveBlock = stylesCss.slice(
      compactRemoveStart,
      stylesCss.indexOf('}', compactRemoveStart) + 1
    );
    expect(compactRemoveBlock).toMatch(/font-size:\s*11px;/);
    expect(stylesCss).toContain('.photo-remove-btn:hover{');
    expect(stylesCss).toContain('background:#dc2626;');
    // .photo-remove-btn:hover must NOT use a scale transform — hue change only
    const hoverStart = stylesCss.indexOf('.photo-remove-btn:hover{');
    const hoverBlock = stylesCss.slice(hoverStart, stylesCss.indexOf('}', hoverStart) + 1);
    expect(hoverBlock).not.toContain('transform:scale');

    expect(photoUploaderJs).toContain('.photo-uploader__preview-remove {');
    expect(photoUploaderJs).toContain('width: 14px;');
    expect(photoUploaderJs).toContain('height: 14px;');
    expect(photoUploaderJs).toContain('font-size: 0.6875rem;');
    expect(photoUploaderJs).toContain('background: rgba(220,38,38,1);');

    expect(supplierDashImprovementsCss).toContain('.photo-preview-remove {');
    expect(supplierDashImprovementsCss).toContain('width: 14px;');
    expect(supplierDashImprovementsCss).toContain('height: 14px;');
    // No scale on .photo-preview-remove:hover either
    const previewHoverStart = supplierDashImprovementsCss.indexOf('.photo-preview-remove:hover {');
    const previewHoverBlock = supplierDashImprovementsCss.slice(
      previewHoverStart,
      supplierDashImprovementsCss.indexOf('}', previewHoverStart) + 1
    );
    expect(previewHoverBlock).not.toContain('transform: scale');
  });

  it('supplier gallery tile remove buttons are reduced and anchored at the corner edge', () => {
    expect(supplierDashImprovementsCss).toContain(
      '.photo-preview-item--existing .photo-delete-btn,'
    );
    expect(supplierDashImprovementsCss).toContain(
      '.photo-preview-item--pending .photo-remove-btn {'
    );
    const tileDeleteStart = supplierDashImprovementsCss.indexOf(
      '.photo-preview-item--existing .photo-delete-btn,'
    );
    const tileDeleteBlock = supplierDashImprovementsCss.slice(
      tileDeleteStart,
      supplierDashImprovementsCss.indexOf('}', tileDeleteStart) + 1
    );
    expect(tileDeleteBlock).toContain('top: -8px;');
    expect(tileDeleteBlock).toContain('right: -8px;');
    expect(tileDeleteBlock).toContain('width: 20px;');
    expect(tileDeleteBlock).toContain('height: 20px;');
    // min-width/min-height must remain 0 to override the global 44px touch-target rule
    expect(tileDeleteBlock).toContain('min-width: 0;');
    expect(tileDeleteBlock).toContain('min-height: 0;');
    expect(tileDeleteBlock).toMatch(/font-size:\s*12px;/);
  });

  it('supplier profile summary card uses structured spc-* layout classes', () => {
    expect(appJs).toContain('class="supplier-card card glass-card spc-root"');
    expect(appJs).toContain('class="spc-summary"');
    expect(appJs).toContain('class="spc-name-row"');
    // Inline checklist link removed — View Checklist button in action bar is sufficient
    expect(appJs).not.toContain('class="spc-checklist-link"');
    // Description and health bar removed from card body (ring + checklist card handle these)
    expect(appJs).not.toContain('class="spc-desc"');
    expect(appJs).not.toContain('class="listing-health spc-health"');
    // Category chip
    expect(appJs).toContain('class="spc-category-chip"');
    // 3-button action bar
    expect(appJs).toContain('data-action="upload-photo"');
    expect(appJs).toContain('spc-action-btn--edit');
    expect(appJs).toContain('spc-action-btn--checklist');
    expect(appJs).not.toContain('class="card-actions spc-edit-row"');
    // Checklist card defaults visible and toggle starts in "Hide" state
    expect(appJs).toContain('class="spc-checklist-card"');
    expect(appJs).toContain('class="spc-checklist-steps"');
    expect(appJs).toContain('Profile Setup Checklist');
    expect(appJs).toContain('class="spc-checklist-btn-label">Hide Checklist</span>');
    expect(appJs).toContain("actionEl.setAttribute('aria-expanded', 'false')");
    expect(appJs).toContain("checklistCard.setAttribute('hidden', '')");
    // Checklist items match reference labels
    expect(appJs).toContain("'Business Details'");
    expect(appJs).toContain("'Categories & Services'");
    expect(appJs).toContain("'Photos'");
    expect(appJs).toContain("'Contact Information'");
    expect(appJs).toContain("'Business Description'");
    expect(supplierDashImprovementsCss).toContain('.spc-root {');
    expect(supplierDashImprovementsCss).toContain('.spc-summary {');
    expect(supplierDashImprovementsCss).toContain('.spc-health .listing-health-bar {');
    // 3-col action bar
    expect(supplierDashImprovementsCss).toContain('grid-template-columns: repeat(3, 1fr)');
    // New components
    expect(supplierDashImprovementsCss).toContain('.spc-category-chip {');
    expect(supplierDashImprovementsCss).toContain('.spc-checklist-card {');
    expect(supplierDashImprovementsCss).toContain('.spc-checklist-step {');
    expect(supplierDashImprovementsCss).toContain('.spc-checklist-step-circle {');
  });

  it('removes profile-level price display from summary meta row (no POA/profile price badge)', () => {
    expect(appJs).not.toContain('${priceDisplay ?');
    expect(appJs).not.toContain('spc-meta-pipe');
  });

  it('adds 12 o’clock profile avatar delete button and delete action wiring', () => {
    expect(appJs).toContain('class="spc-avatar-delete-btn"');
    expect(appJs).toContain('data-action="delete-profile-photo"');
    expect(appJs).toContain("fetch('/api/profile/avatar'");
    expect(appJs).toContain("method: 'DELETE'");
    expect(supplierDashImprovementsCss).toContain('.spc-avatar-delete-btn {');
    expect(supplierDashImprovementsCss).toContain('.spc-avatar-delete-btn:active {');
    expect(supplierDashImprovementsCss).toContain('transform: translateX(-50%);');
  });

  it('upload-photo action targets gallery upload row and opens a single picker path', () => {
    expect(appJs).toContain('data-action="upload-photo"');
    expect(appJs).toContain("const uploader = document.getElementById('sup-photo-drop')");
    expect(appJs).toContain('await editProfile(profileId, { skipFormScroll: true })');
    expect(appJs).toContain("const galleryRow = uploader.closest('.form-row') || uploader");
    expect(appJs).toContain("galleryRow.scrollIntoView({ behavior: 'smooth', block: 'start' })");
    expect(appJs).toContain('uploader.focus({ preventScroll: true })');
    expect(appJs).toContain('uploader.click()');
    expect(appJs).not.toContain("efSetupPhotoDropZone(\n    'sup-photo-drop'");
  });

  it('profile initials fallback uses multi-letter initials (e.g. RT)', () => {
    expect(appJs).toContain('.split(/\\s+/)');
    expect(appJs).toContain('.slice(0, 2)');
    expect(appJs).toContain('.map(part => part.charAt(0).toUpperCase())');
  });

  it('package gallery circular delete buttons are reduced to half-size chrome', () => {
    expect(supplierDashImprovementsCss).toContain('.pkg-gallery-delete {');
    expect(supplierDashImprovementsCss).toContain('top: -6px;');
    expect(supplierDashImprovementsCss).toContain('right: -6px;');
    expect(supplierDashImprovementsCss).toContain('width: 16px;');
    expect(supplierDashImprovementsCss).toContain('height: 16px;');
    const packageDeleteStart = supplierDashImprovementsCss.indexOf('.pkg-gallery-delete {');
    const packageDeleteBlock = supplierDashImprovementsCss.slice(
      packageDeleteStart,
      supplierDashImprovementsCss.indexOf('}', packageDeleteStart) + 1
    );
    expect(packageDeleteBlock).toMatch(/font-size:\s*11px;/);
    // ef-cta must NOT be on the button — it overrides padding/position and breaks the overlay
    expect(appJs).not.toContain('ef-cta pkg-gallery-delete');
    expect(appJs).toContain('class="pkg-gallery-delete"');
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
  it('app.js checks for empty savedId and aborts with an error message', () => {
    expect(appJs).toContain('if (!savedId)');
  });

  it('app.js shows an error status message when savedId is empty after save', () => {
    const guardIdx = appJs.indexOf('if (!savedId)');
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
    expect(handlerBlock).toContain('www.example.com');
  });
});

describe('Supplier form – structured city coverage preservation', () => {
  it('retains existing city service areas before serializing editable travel controls', () => {
    const coverageStart = appJs.indexOf('function applyCoverageToPayload(payload)');
    expect(coverageStart).toBeGreaterThan(-1);

    const coverageBlock = appJs.slice(coverageStart, coverageStart + 1800);
    const cityFilter = coverageBlock.indexOf("area.type === 'city'");
    const payloadAssignment = coverageBlock.indexOf('payload.serviceAreas = serviceAreas');

    expect(coverageBlock).toContain('cachedSuppliers.find');
    expect(coverageBlock).toContain('currentEditingSupplierId');
    expect(cityFilter).toBeGreaterThan(-1);
    expect(payloadAssignment).toBeGreaterThan(cityFilter);
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
    const loadExistingIdx = galleryJs.indexOf('this.loadExistingPhotos();', setupIdx);
    expect(loadExistingIdx).toBeGreaterThan(setupIdx);
    const setupBody = galleryJs.slice(setupIdx, loadExistingIdx + 100);
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

  it('supplier-dashboard-improvements.css includes responsive supplier form spacing guards', () => {
    expect(supplierDashImprovementsCss).toContain('#supplier-form .supplier-form-grid > div');
    expect(supplierDashImprovementsCss).toContain('box-sizing: border-box');
    expect(supplierDashImprovementsCss).toContain('@media (max-width: 680px)');
  });

  it('supplier-dashboard-improvements.css keeps profile-form helper/error text compact and scoped', () => {
    expect(supplierDashImprovementsCss).toContain(
      '#profile-form-section #supplier-form .small.form-error-text'
    );
    expect(supplierDashImprovementsCss).toContain(
      '#profile-form-section #supplier-form .form-help-text'
    );
    expect(supplierDashImprovementsCss).toContain(
      '#profile-form-section #supplier-form .supplier-form-actions'
    );
  });
});
