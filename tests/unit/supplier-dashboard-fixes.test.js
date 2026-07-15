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

// â”€â”€â”€ file content fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Error 1: .indexOf() on undefined â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Supplier Dashboard â€“ .indexOf() null/undefined guards', () => {
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

// â”€â”€â”€ Error 2: createConversionFunnelWidget export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('supplier-analytics-chart.js â€“ createConversionFunnelWidget export', () => {
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

// â”€â”€â”€ Error 3: Image 404 fallback handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('dashboard-supplier.html â€“ Image 404 fallback handling', () => {
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

// â”€â”€â”€ Error 4: global-error-handler default/fallback for config reads â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('global-error-handler.js â€“ robustness improvements', () => {
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

// â”€â”€â”€ Fetch interceptor null-safety â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('global-error-handler.js â€“ fetch interceptor null-safety', () => {
  it('parseErrorMessage handles JSON parse failures gracefully', () => {
    expect(errorHandlerJs).toContain('async function parseErrorMessage(response, defaultMessage)');
    expect(errorHandlerJs).toMatch(/catch\s*\(\s*_?parseError\s*\)/);
    expect(errorHandlerJs).toContain('return defaultMessage');
  });

  it('fetch interceptor clones response before parsing to preserve original', () => {
    expect(errorHandlerJs).toContain('response.clone()');
  });

  it('fetch interceptor re-throws network errors so callers can handle them',²È="25ÌÑ¡”…Ñ•½Éä™¥•±‰•™½É”¥¹Ù½­¥¹œ‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…œ°€ ¤€ôøì(€€€½¹ÍÐÍÕ‰µ¥Ñ%‘à€ô…ÁÁ)Ì¹¥¹‘•á=˜ ‰ÍÕÁ½É´¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ÍÕ‰µ¥Ðœˆ¤ì(€€€½¹ÍÐ¡…¹‘±•É	±½¬€ô…ÁÁ)Ì¹Í±¥”¡ÍÕ‰µ¥Ñ%‘à°ÍÕ‰µ¥Ñ%‘à€¬€ÔÀÀÀ¤ì(€€€½¹ÍÐ…Ñ¡•­%‘à€ô¡…¹‘±•É	±½¬¹¥¹‘•á=˜ ÍÕÀµ…Ñ•½Éäœ¤ì(€€€½¹ÍÐ‰Õ¥±‘A…å±½…‘%‘à€ô¡…¹‘±•É	±½¬¹¥¹‘•á=˜ ‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…œ¤ì(€€€•áÁ•Ð¡…Ñ¡•­%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€•áÁ•Ð¡‰Õ¥±‘A…å±½…‘%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€•áÁ•Ð¡…Ñ¡•­%‘à¤¹Ñ½	•1•ÍÍQ¡…¸¡‰Õ¥±‘A…å±½…‘%‘à¤ì(€ô¤ì((€¥Ð …ÁÀ¹©ÌÍ¡½ÝÌ…¸¥¹±¥¹”•ÉÉ½È…¹™½ÕÍ•ÌÑ¡”¹…µ”™¥•±Ý¡•¸¹…µ”¥Ì•µÁÑäœ°€ ¤€ôøì(€€€€¼¼M•…É Ý¥Ñ¡¥¸Ñ¡”ÍÕ‰µ¥Ð¡…¹‘±•È‰±½¬Ñ¼…Ù½¥µ…Ñ¡¥¹œÁ½ÁÕ±…Ñ•MÕÁÁ±¥•É½É´(€€€½¹ÍÐÍÕ‰µ¥Ñ%‘à€ô…ÁÁ)Ì¹¥¹‘•á=˜ ‰ÍÕÁ½É´¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ÍÕ‰µ¥Ðœˆ¤ì(€€€½¹ÍÐ¡…¹‘±•É	±½¬€ô…ÁÁ)Ì¹Í±¥”¡ÍÕ‰µ¥Ñ%‘à°ÍÕ‰µ¥Ñ%‘à€¬€ØÀÀÀ¤ì(€€€•áÁ•Ð¡¡…¹‘±•É	±½¬¤¹Ñ½½¹Ñ…¥¸ ¹…µ•°¹™½ÕÍœ¤ì(€€€•áÁ•Ð¡¡…¹‘±•É	±½¬¤¹Ñ½½¹Ñ…¥¸ 	ÕÍ¥¹•ÍÌ¹…µ”¥ÌÉ•ÅÕ¥É•œ¤ì(€ô¤ì((€¥Ð …ÁÀ¹©ÌÑ½±•Ì¥¹±¥¹”Ù…±¥‘…Ñ¥½¸¡•±Á•ÉÌ½±…ÍÍ•Ì™½ÈÍÕÁÁ±¥•È™¥•±‘Ìœ°€ ¤€ôøì(€€€•áÁ•Ð¡…ÁÁ)Ì¤¹Ñ½½¹Ñ…¥¸ Í•ÑMÕÁÁ±¥•É¥•±‘ÉÉ½Èœ¤ì(€€€•áÁ•Ð¡…ÁÁ)Ì¤¹Ñ½½¹Ñ…¥¸ ±•…ÉMÕÁÁ±¥•É¥•±‘ÉÉ½Èœ¤ì(€€€•áÁ•Ð¡…ÁÁ)Ì¤¹Ñ½½¹Ñ…¥¸ ÍÕÁÁ±¥•Èµ™¥•±µ¥¹Ù…±¥œ¤ì(€ô¤ì)ô¤ì()‘•ÍÉ¥‰” MÕÁÁ±¥•È™½É´ƒŠLÝ•‰Í¥Ñ”UI0¹½Éµ…±¥é…Ñ¥½¸œ°€ ¤€ôøì(€¥Ð …ÁÀ¹©Ì¹½Éµ…±¥é•ÌÝ•‰Í¥Ñ”UI1Ì‰äÁÉ•Á•¹‘¥¹œ¡ÑÑÁÌè¼¼Ý¡•¸¹¼Í¡•µ”¥ÌÁÉ•Í•¹Ðœ°€ ¤€ôøì(€€€½¹ÍÐ‰Õ¥±‘MÑ…ÉÐ€ô…ÁÁ)Ì¹¥¹‘•á=˜ ™Õ¹Ñ¥½¸‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…¡™½É´¤œ¤ì(€€€½¹ÍÐ‰Õ¥±‘	±½¬€ô…ÁÁ)Ì¹Í±¥”¡‰Õ¥±‘MÑ…ÉÐ°‰Õ¥±‘MÑ…ÉÐ€¬€ÈÀÀÀ¤ì(€€€€¼¼•ÁÐ‰½Ñ Ñ•µÁ±…Ñ”µ±¥Ñ•É…°…¹½¹…Ñ•¹…Ñ¥½¸™½ÉµÌ½˜¡ÑÑÁÌè¼¼ÁÉ•Á•¹‘¥¹œ(€€€•áÁ•Ð¡‰Õ¥±‘	±½¬¤¹Ñ½5…Ñ  ½¡ÑÑÁÌép½p¼¼¤ì(€€€•áÁ•Ð¡‰Õ¥±‘	±½¬¤¹Ñ½½¹Ñ…¥¸ Á…å±½…¹Ý•‰Í¥Ñ”œ¤ì(€ô¤ì((€¥Ð …ÁÀ¹©ÌUI0¹½Éµ…±¥é…Ñ¥½¸ÉÕ¹Ì¥¹Í¥‘”‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…œ°€ ¤€ôøì(€€€½¹ÍÐ‰Õ¥±‘MÑ…ÉÐ€ô…ÁÁ)Ì¹¥¹‘•á=˜ ™Õ¹Ñ¥½¸‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…¡™½É´¤œ¤ì(€€€•áÁ•Ð¡‰Õ¥±‘MÑ…ÉÐ¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€½¹ÍÐ‰Õ¥±‘	±½¬€ô…ÁÁ)Ì¹Í±¥”¡‰Õ¥±‘MÑ…ÉÐ°‰Õ¥±‘MÑ…ÉÐ€¬€ÈÀÀÀ¤ì(€€€•áÁ•Ð¡‰Õ¥±‘	±½¬¤¹Ñ½½¹Ñ…¥¸ ¡ÑÑÁÌè¼¼œ¤ì(€€€•áÁ•Ð¡‰Õ¥±‘	±½¬¤¹Ñ½½¹Ñ…¥¸ Á…å±½…¹Ý•‰Í¥Ñ”œ¤ì(€ô¤ì((€¥Ð …ÁÀ¹©Ì‘½•Ì¹½ÐÁÉ•Á•¹¡ÑÑÁÌè¼¼Ý¡•¸Ñ¡”Í¡•µ”¥Ì…±É•…‘äÁÉ•Í•¹Ðœ°€ ¤€ôøì(€€€€¼¼Q¡”¹½Éµ…±¥é…Ñ¥½¸Õ…ÉÕÍ•Ì„É••àÑ•ÍÐ™½Èy¡ÑÑÁÌüè¼¼‰•™½É”ÁÉ•Á•¹‘¥¹œ(€€€€¼¼M½ÕÉ”½¹Ñ…¥¹ÌÑ¡”É••à±¥Ñ•É…°Í¼Ý”¡•¬™½ÈÑ¡”­•äÕ…ÉÁ…ÑÑ•É¸(€€€•áÁ•Ð¡…ÁÁ)Ì¤¹Ñ½½¹Ñ…¥¸ ¡ÑÑÁÌüèœ¤ì(€€€€¼¼¹ÍÕÉ”Ñ¡”¹½Éµ…±¥é…Ñ¥½¸±½¥Œ¥Ì¥¹Í¥‘”‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…(€€€½¹ÍÐ‰Õ¥±‘MÑ…ÉÐ€ô…ÁÁ)Ì¹¥¹‘•á=˜ ™Õ¹Ñ¥½¸‰Õ¥±‘MÕÁÁ±¥•ÉA…å±½…¡™½É´¤œ¤ì(€€€½¹ÍÐ‰Õ¥±‘	±½¬€ô…ÁÁ)Ì¹Í±¥”¡‰Õ¥±‘MÑ…ÉÐ°‰Õ¥±‘MÑ…ÉÐ€¬€ÈÀÀÀ¤ì(€€€•áÁ•Ð¡‰Õ¥±‘	±½¬¤¹Ñ½½¹Ñ…¥¸ ¡ÑÑÁÌüèœ¤ì(€ô¤ì((€¥Ð …ÁÀ¹©ÌÙ…±¥‘…Ñ•ÌÝ•‰Í¥Ñ”UI0™½Éµ…Ð‰•™½É”ÍÕ‰µ¥Ðœ°€ ¤€ôøì(€€€½¹ÍÐÍÕ‰µ¥Ñ%‘à€ô…ÁÁ)Ì¹¥¹‘•á=˜ ‰ÍÕÁ½É´¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ÍÕ‰µ¥Ðœˆ¤ì(€€€½¹ÍÐ¡…¹‘±•É	±½¬€ô…ÁÁ)Ì¹Í±¥”¡ÍÕ‰µ¥Ñ%‘à°ÍÕ‰µ¥Ñ%‘à€¬€àÀÀÀ¤ì(€€€•áÁ•Ð¡¡…¹‘±•É	±½¬¤¹Ñ½½¹Ñ…¥¸ ¹½Éµ…±¥é•¹‘Y…±¥‘…Ñ•]•‰Í¥Ñ•%¹ÁÕÐœ¤ì(€€€•áÁ•Ð¡¡…¹‘±•É	±½¬¤¹Ñ½½¹Ñ…¥¸ A±•…Í”™¥àÑ¡”Ý•‰Í¥Ñ”UI0…¹ÑÉä……¥¸¸œ¤ì(€€€•áÁ•Ð¡¡…¹‘±•É	±½¬¤¹Ñ½½¹Ñ…¥¸ ÝÝÜ¹•á…µÁ±”¹½´œ¤ì(€ô¤ì)ô¤ì()‘•ÍÉ¥‰” 	…¹¹•È•ÉÉ½ÈÍÑ…Ñ”ƒŠLƒŠj€Ý…É¹¥¹œ¥¹‘¥…Ñ½È½¹Í¥ÍÑ•¹äœ°€ ¤€ôøì(€¥Ð …ÁÀ¹©Ì…‘‘ÌÁ¡½Ñ¼µÁÉ•Ù¥•Üµ¥Ñ•µ}}¥µ…”µÝÉ…À´µ•ÉÉ½È±…ÍÌ½¸‰…¹¹•È¥µ…”±½…™…¥±ÕÉ”œ°€ ¤€ôøì(€€€€¼¼Q¡”‰…¹¹•È•ÉÉ½È¡…¹‘±•ÈµÕÍÐ…ÁÁ±äÑ¡”Í…µ”•ÉÉ½È±…ÍÌÕÍ•‰ä…±±•Éä•ÉÉ½ÉÌ(€€€½¹ÍÐ‰…¹¹•É%‘à€ô…ÁÁ)Ì¹¥¹‘•á=˜ ½Õ±¹½Ð±½…‰…¹¹•Èœ¤ì(€€€•áÁ•Ð¡‰…¹¹•É%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€½¹ÍÐ‰…¹¹•É	±½¬€ô…ÁÁ)Ì¹Í±¥”¡‰…¹¹•É%‘à°‰…¹¹•É%‘à€¬€ÌÀÀ¤ì(€€€•áÁ•Ð¡‰…¹¹•É	±½¬¤¹Ñ½½¹Ñ…¥¸ Á¡½Ñ¼µÁÉ•Ù¥•Üµ¥Ñ•µ}}¥µ…”µÝÉ…À´µ•ÉÉ½Èœ¤ì(€ô¤ì((€¥Ð …±±•Éä…¹‰…¹¹•È•ÉÉ½ÈÍÑ…Ñ•ÌÍ¡…É”Ñ¡”Í…µ”ML•ÉÉ½È±…ÍÌœ°€ ¤€ôøì(€€€€¼¼Y•É¥™ä…±±•Éä¹©Ì…±Í¼ÕÍ•ÌÑ¡”Í…µ”±…ÍÌ€¡¹½Ð„½¹”µ½™˜¤(€€€•áÁ•Ð¡…±±•Éå)Ì¤¹Ñ½½¹Ñ…¥¸ Á¡½Ñ¼µÁÉ•Ù¥•Üµ¥Ñ•µ}}¥µ…”µÝÉ…À´µ•ÉÉ½Èœ¤ì(€ô¤ì)ô¤ì()‘•ÍÉ¥‰” ÍÕÁÁ±¥•Èµ…±±•Éä¹©ÌƒŠL‘•…Í•ÑÕÁ½Éµ%¹Ñ•É•ÁÐ…±°É•µ½Ù•œ°€ ¤€ôøì(€¥Ð Í•ÑÕÀ ¤¹¼±½¹•È½¹Ñ…¥¹Ì„±¥Ù”…±°Ñ¼Í•ÑÕÁ½Éµ%¹Ñ•É•ÁÐœ°€ ¤€ôøì(€€€½¹ÍÐÍ•ÑÕÁ%‘à€ô…±±•Éå)Ì¹¥¹‘•á=˜ Í•ÑÕÀ ¤ìœ¤ì(€€€•áÁ•Ð¡Í•ÑÕÁ%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€½¹ÍÐ±½…‘á¥ÍÑ¥¹%‘à€ô…±±•Éå)Ì¹¥¹‘•á=˜ Ñ¡¥Ì¹±½…‘á¥ÍÑ¥¹A¡½Ñ½Ì ¤ìœ°Í•ÑÕÁ%‘à¤ì(€€€•áÁ•Ð¡±½…‘á¥ÍÑ¥¹%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸¡Í•ÑÕÁ%‘à¤ì(€€€½¹ÍÐÍ•ÑÕÁ	½‘ä€ô…±±•Éå)Ì¹Í±¥”¡Í•ÑÕÁ%‘à°±½…‘á¥ÍÑ¥¹%‘à€¬€ÄÀÀ¤ì(€€€•áÁ•Ð¡Í•ÑÕÁ	½‘ä¤¹¹½Ð¹Ñ½½¹Ñ…¥¸ Ñ¡¥Ì¹Í•ÑÕÁ½Éµ%¹Ñ•É•ÁÐ œ¤ì(€ô¤ì)ô¤ì()‘•ÍÉ¥‰” MLƒŠL€é¡…Ì ¤Í•±•Ñ½ÉÌÝÉ…ÁÁ•¥¸ÍÕÁÁ½ÉÑÌ™½È½±‘•È¥É•™½à½µÁ…Ñ¥‰¥±¥Ñäœ°€ ¤€ôøì(€¥Ð ‘…Í¡‰½…Éµ…¹¥µ…Ñ¥½¹Ì¹ÍÌÝÉ…ÁÌ€é¡…Ì ¤¡½Ù•ÈÉÕ±•Ì¥¸ÍÕÁÁ½ÉÑÌÍ•±•Ñ½È é¡…Ì ¨¤¤œ°€ ¤€ôøì(€€€•áÁ•Ð¡‘…Í¡‰½…É‘¹¥µ…Ñ¥½¹ÍÍÌ¤¹Ñ½½¹Ñ…¥¸ ÍÕÁÁ½ÉÑÌÍ•±•Ñ½È é¡…Ì ¨¤¤œ¤ì(€€€€¼¼Q¡”€é¡…Ì ¤Í•±•Ñ½ÉÌµÕÍÐ…ÁÁ•…È¥¹Í¥‘”Ñ¡”ÍÕÁÁ½ÉÑÌ‰±½¬(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ%‘à€ô‘…Í¡‰½…É‘¹¥µ…Ñ¥½¹ÍÍÌ¹¥¹‘•á=˜ ÍÕÁÁ½ÉÑÌÍ•±•Ñ½È é¡…Ì ¨¤¤œ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ	±½¬€ô‘…Í¡‰½…É‘¹¥µ…Ñ¥½¹ÍÍÌ¹Í±¥”¡ÍÕÁÁ½ÉÑÍ%‘à°ÍÕÁÁ½ÉÑÍ%‘à€¬€ÔÀÀ¤ì(€€€•áÁ•Ð¡ÍÕÁÁ½ÉÑÍ	±½¬¤¹Ñ½½¹Ñ…¥¸ œé¡…Ì¡™½É´¤é¡½Ù•Èœ¤ì(€ô¤ì((€¥Ð ÍÕÁÁ±¥•Èµ‘…Í¡‰½…Éµ¥µÁÉ½Ù•µ•¹ÑÌ¹ÍÌÝÉ…ÁÌ€é¡…Ì ¤¡½Ù•ÈÉÕ±•Ì¥¸ÍÕÁÁ½ÉÑÌÍ•±•Ñ½È é¡…Ì ¨¤¤œ°€ ¤€ôøì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ ÍÕÁÁ½ÉÑÌÍ•±•Ñ½È é¡…Ì ¨¤¤œ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ%‘à€ôÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¹¥¹‘•á=˜ ÍÕÁÁ½ÉÑÌÍ•±•Ñ½È é¡…Ì ¨¤¤œ¤ì(€€€½¹ÍÐÍÕÁÁ½ÉÑÍ	±½¬€ôÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¹Í±¥”¡ÍÕÁÁ½ÉÑÍ%‘à°ÍÕÁÁ½ÉÑÍ%‘à€¬€ÔÀÀ¤ì(€€€•áÁ•Ð¡ÍÕÁÁ½ÉÑÍ	±½¬¤¹Ñ½½¹Ñ…¥¸ œé¡…Ì œ¤ì(€ô¤ì)ô¤ì()‘•ÍÉ¥‰” MLƒŠLÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸ÕÍ•Ì€…¥µÁ½ÉÑ…¹ÐÑ¼ÁÉ•Ù•¹Ð…Í…‘”½Ù•ÉÉ¥‘”œ°€ ¤€ôøì(€¥Ð ‘…Í¡‰½…Éµ…¹¥µ…Ñ¥½¹Ì¹ÍÌÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸ÑÉ…¹Í¥Ñ¥½¸ÉÕ±”ÕÍ•Ì€…¥µÁ½ÉÑ…¹Ðœ°€ ¤€ôøì(€€€½¹ÍÐÁÉµ%‘à€ô‘…Í¡‰½…É‘¹¥µ…Ñ¥½¹ÍÍÌ¹¥¹‘•á=˜ µ•‘¥„€¡ÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸èÉ•‘Õ”¤œ¤ì(€€€•áÁ•Ð¡ÁÉµ%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€½¹ÍÐÁÉµ	±½¬€ô‘…Í¡‰½…É‘¹¥µ…Ñ¥½¹ÍÍÌ¹Í±¥”¡ÁÉµ%‘à°ÁÉµ%‘à€¬€ÐÀÀ¤ì(€€€•áÁ•Ð¡ÁÉµ	±½¬¤¹Ñ½5…Ñ  ½ÑÉ…¹Í¥Ñ¥½¹mxít¬…¥µÁ½ÉÑ…¹Ð¼¤ì(€ô¤ì((€¥Ð ÍÕÁÁ±¥•Èµ‘…Í¡‰½…Éµ¥µÁÉ½Ù•µ•¹ÑÌ¹ÍÌÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸ÑÉ…¹Í™½É´ÉÕ±”ÕÍ•Ì€…¥µÁ½ÉÑ…¹Ðœ°€ ¤€ôøì(€€€€¼¼¥¹Ñ¡”…ÉµÍÁ•¥™¥ŒÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸‰±½¬€¡Ñ¡•É”µ…ä‰”µÕ±Ñ¥Á±”¤(€€€½¹ÍÐÁÉµ%‘à€ôÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¹¥¹‘•á=˜ (€€€€€€œ¼¨I•ÍÁ•ÐÁÉ•™•ÉÌµÉ•‘Õ•µµ½Ñ¥½¸ƒŠPÕÍ”€…¥µÁ½ÉÑ…¹Ðœ(€€€€¤ì(€€€•áÁ•Ð¡ÁÉµ%‘à¤¹Ñ½	•É•…Ñ•ÉQ¡…¸ ´Ä¤ì(€€€½¹ÍÐÁÉµ	±½¬€ôÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¹Í±¥”¡ÁÉµ%‘à°ÁÉµ%‘à€¬€ÔÀÀ¤ì(€€€•áÁ•Ð¡ÁÉµ	±½¬¤¹Ñ½5…Ñ  ½ÑÉ…¹Í™½Éµmxít¬…¥µÁ½ÉÑ…¹Ð¼¤ì(€ô¤ì((€¥Ð ÍÕÁÁ±¥•Èµ‘…Í¡‰½…Éµ¥µÁÉ½Ù•µ•¹ÑÌ¹ÍÌ¥¹±Õ‘•Ì±½…‘¥¹œ½•ÉÉ½È™¥•±Á½±¥Í ÍÑå±•Ìœ°€ ¤€ôøì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ œ¹ÍÕÁÁ±¥•Èµ™¥•±µ¥¹Ù…±¥œ¤ì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ œÍÕÀµÉ•…Ñ”¹¥Ìµ±½…‘¥¹œèé…™Ñ•Èœ¤ì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ ­•å™É…µ•ÌÍÕÁÁ±¥•ÈµÍ…Ù”µÍÁ¥¸œ¤ì(€ô¤ì((€¥Ð ÍÕÁÁ±¥•Èµ‘…Í¡‰½…Éµ¥µÁÉ½Ù•µ•¹ÑÌ¹ÍÌ¥¹±Õ‘•ÌÉ•ÍÁ½¹Í¥Ù”ÍÕÁÁ±¥•È™½É´ÍÁ…¥¹œÕ…É‘Ìœ°€ ¤€ôøì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ œÍÕÁÁ±¥•Èµ™½É´€¹ÍÕÁÁ±¥•Èµ™½É´µÉ¥€ø‘¥Øœ¤ì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ ‰½àµÍ¥é¥¹œè‰½É‘•Èµ‰½àœ¤ì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ µ•‘¥„€¡µ…àµÝ¥‘Ñ è€ØàÁÁà¤œ¤ì(€ô¤ì((€¥Ð ÍÕÁÁ±¥•Èµ‘…Í¡‰½…Éµ¥µÁÉ½Ù•µ•¹ÑÌ¹ÍÌ­••ÁÌÁÉ½™¥±”µ™½É´¡•±Á•È½•ÉÉ½ÈÑ•áÐ½µÁ…Ð…¹Í½Á•œ°€ ¤€ôøì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ (€€€€€€œÁÉ½™¥±”µ™½É´µÍ•Ñ¥½¸€ÍÕÁÁ±¥•Èµ™½É´€¹Íµ…±°¹™½É´µ•ÉÉ½ÈµÑ•áÐœ(€€€€¤ì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ (€€€€€€œÁÉ½™¥±”µ™½É´µÍ•Ñ¥½¸€ÍÕÁÁ±¥•Èµ™½É´€¹™½É´µ¡•±ÀµÑ•áÐœ(€€€€¤ì(€€€•áÁ•Ð¡ÍÕÁÁ±¥•É…Í¡%µÁÉ½Ù•µ•¹ÑÍÍÌ¤¹Ñ½½¹Ñ…¥¸ (€€€€€€œÁÉ½™¥±”µ™½É´µÍ•Ñ¥½¸€ÍÕÁÁ±¥•Èµ™½É´€¹ÍÕÁÁ±¥•Èµ™½É´µ…Ñ¥½¹Ìœ(€€€€¤ì(€ô¤ì)ô¤ì(