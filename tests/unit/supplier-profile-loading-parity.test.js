'use strict';

const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const css = read('public/assets/css/supplier-profile-commercial-polish.css');

describe('supplier profile loading parity contracts', () => {
  test('keeps the unresolved hero at the final compact fallback height', () => {
    expect(css).toContain("html:not([data-sp-theme-ready='true'])");
    expect(css).toContain('--sp-hero-height: 146px !important');
    expect(css).toContain('#supplier-hero .hero-media > img');
    expect(css).toContain('opacity: 0 !important');
  });

  test('reserves the main and sidebar structure during loading', () => {
    expect(css).toContain('#sp-section-about::before');
    expect(css).toContain('#supplier-package-cards-root:empty::before');
    expect(css).toContain('#sp-section-reviews:empty::before');
    expect(css).toContain('#sp-sidebar-enquiry:empty::before');
    expect(css).toContain('min-height: 700px');
  });

  test('keeps loading actions inert and hides the install prompt', () => {
    expect(css).toContain('#supplier-hero .hero-actions');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('body:has(#supplier-hero) #ef-pwa-install-banner');
    expect(css).toContain('display: none !important');
  });

  test('tightens the final content transition after the identity strip', () => {
    expect(css).toContain('body:has(#supplier-hero) .sp-page');
    expect(css).toContain('padding-top: 1rem !important');
  });
});
