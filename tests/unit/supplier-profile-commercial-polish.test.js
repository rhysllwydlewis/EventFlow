'use strict';

const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const supplierHtml = read('public/supplier.html');
const css = read('public/assets/css/supplier-profile-commercial-polish.css');
const componentsCss = read('public/assets/css/components.css');

describe('supplier profile commercial polish contracts', () => {
  test('loads the shared component styles and final supplier polish layer', () => {
    expect(supplierHtml).toContain('/assets/css/components.css?v=18.4.1');
    expect(supplierHtml).toContain('/assets/css/supplier-profile-commercial-polish.css?v=20.2.0');
  });

  test('widens desktop composition and reduces decorative fallback heroes', () => {
    expect(css).toContain('1420px');
    expect(css).toContain('--sp-hero-height: 146px');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });

  // The cookie-consent banner's floating "bottom sheet" styling was
  // standardised sitewide (into components.css) rather than left as a
  // supplier-profile-only override — this page now only keeps the layout
  // compensation that's genuinely specific to its own .sp-page wrapper.
  test('coordinates cookie consent and the PWA install prompt', () => {
    expect(componentsCss).toContain('.cookie-consent-banner.cookie-consent-visible');
    expect(componentsCss).toContain('body.ef-cookie-banner-open #ef-pwa-install-banner');
    expect(css).toContain(':has(#cookie-consent-banner).ef-pwa-banner-visible .sp-page');
  });

  test('compacts the empty review experience', () => {
    expect(css).toContain("grid-template-areas:\n    'icon title action'");
    expect(css).toContain('#reviews-widget .reviews-empty');
  });
});
