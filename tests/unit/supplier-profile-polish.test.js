'use strict';

const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const listingCss = read('public/assets/css/suppliers-mobile-polish.css');
const profileCss = read('public/assets/css/supplier-profile-polish.css');
const profileJs = read('public/assets/js/supplier-profile-polish.js');
const packagesJs = read('public/assets/js/supplier-profile-packages-v2.js');

describe('supplier listing desktop summary placement', () => {
  test('creates a dedicated flexible remainder row below profile and description', () => {
    const desktop = listingCss.slice(listingCss.indexOf('@media (min-width: 901px)'));
    expect(desktop).toMatch(/grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
    expect(desktop).toMatch(/\.sp-card-profile\s*\{[^}]*grid-row:\s*1/);
    expect(desktop).toMatch(/\.sp-card > \.sp-card-description\s*\{[^}]*grid-row:\s*2/);
  });

  test('keeps packages and actions spanning the complete listing card', () => {
    const desktop = listingCss.slice(listingCss.indexOf('@media (min-width: 901px)'));
    expect(desktop).toMatch(
      /\.sp-card-packages,[\s\S]*\.sp-card-actions\s*\{[^}]*grid-row:\s*1 \/ -1/
    );
  });
});

describe('supplier profile information polish', () => {
  test('preserves long biographies behind an accessible read-more control', () => {
    expect(profileJs).toContain("toggle.textContent = 'Read more'");
    expect(profileJs).toContain("toggle.textContent = expanded ? 'Read more' : 'Read less'");
    expect(profileJs).toContain("toggle.setAttribute('aria-expanded'");
    expect(profileCss).toMatch(/-webkit-line-clamp:\s*7/);
  });

  test('normalises external links and permits only HTTP(S)', () => {
    expect(profileJs).toContain("['http:', 'https:'].includes(parsed.protocol)");
    expect(profileJs).toContain("link.rel = 'noopener noreferrer external'");
    expect(profileJs).toContain("link.textContent = 'Visit website'");
  });

  test('applies decorative cover polish only when an uploaded cover is missing', () => {
    expect(profileJs).toContain(
      "heroMedia.classList.toggle('sp-hero-media--fallback', !hasCover)"
    );
    expect(profileCss).toContain('.hero-media.sp-hero-media--fallback::before');
  });

  test('replaces emoji socials with consistent labelled SVG controls', () => {
    expect(profileJs).toContain("label: 'LinkedIn'");
    expect(profileJs).toContain("label: 'YouTube'");
    expect(profileJs).toContain('sp-social-link__icon');
    expect(profileCss).toMatch(/\.sp-social-link\s*\{[^}]*min-height:\s*38px/);
  });

  test('hides generic subscription and verification groups from the wide badge section', () => {
    expect(profileJs).toContain("['subscription', 'verification'].includes(name)");
    expect(profileJs).toContain("container.classList.toggle('is-empty', !shouldShow)");
  });
});

describe('supplier profile packages and reviews', () => {
  test('uses three balanced package columns on wide desktop', () => {
    expect(profileCss).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/);
    expect(profileCss).toMatch(/@media \(max-width: 1180px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  test('offers both add-to-plan and clearly labelled detail actions', () => {
    expect(packagesJs).toContain("planButton.textContent = 'Add to plan'");
    expect(packagesJs).toContain("detailsLink.textContent = 'View details'");
    expect(packagesJs).toContain("query.set('packageId', item.id)");
    expect(packagesJs).toContain("query.set('supplierId', supplierId)");
  });

  test('loads the profile polish layer from the existing package module entry point', () => {
    expect(packagesJs).toContain("import './supplier-profile-polish.js'");
  });

  test('collapses zero-review scaffolding into one EventFlow-specific empty state', () => {
    expect(profileJs).toContain("title.textContent = 'No EventFlow reviews yet'");
    expect(profileJs).toContain("widget.classList.toggle('sp-reviews-widget--empty'");
    expect(profileCss).toMatch(/\.sp-reviews-widget--empty \.review-summary/);
    expect(profileCss).toMatch(/\.sp-reviews-widget--empty \.review-controls/);
  });
});
