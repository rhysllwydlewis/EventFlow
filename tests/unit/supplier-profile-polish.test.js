'use strict';

const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const supplierHtml = read('public/supplier.html');
const listingCss = read('public/assets/css/suppliers-mobile-polish.css');
const profileCss = read('public/assets/css/supplier-profile-polish.css');
const profileThemeCss = read('public/assets/css/supplier-profile-theme.css');
const profileJs = read('public/assets/js/supplier-profile-polish-base.js');
const profileThemeJs = read('public/assets/js/supplier-profile-polish.js');
const publicPolishJs = read('public/assets/js/pages/supplier-profile-public-polish.js');
const packagesJs = read('public/assets/js/supplier-profile-packages-v2.js');

describe('supplier listing desktop summary placement', () => {
  test('creates a dedicated flexible remainder row below profile and description', () => {
    const desktop = listingCss.slice(listingCss.indexOf('@media (min-width: 1025px)'));
    expect(desktop).toMatch(/grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
    expect(desktop).toMatch(/\.sp-card-profile\s*\{[^}]*grid-row:\s*1/);
    expect(desktop).toMatch(/\.sp-card > \.sp-card-description\s*\{[^}]*grid-row:\s*2/);
  });

  test('keeps packages and actions spanning the complete listing card', () => {
    const desktop = listingCss.slice(listingCss.indexOf('@media (min-width: 1025px)'));
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
    expect(profileJs).toContain("heroMedia.classList.toggle('sp-hero-media--fallback', !hasCover)");
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

  test('keeps mutation-driven response copy idempotent and preserves canonical wording', () => {
    expect(publicPolishJs).toContain('if (note.textContent !== text)');
    expect(publicPolishJs).toContain('if (note.dataset.derived !== derived)');
    expect(publicPolishJs).toContain('/^typically responds\\b/i.test(currentText)');
  });
});

describe('supplier profile theme consistency', () => {
  test('theme layer re-exports the polish module instead of loading its stylesheet a second time', () => {
    // supplier-profile-polish.js used to hardcode its own copy of the polish
    // stylesheet's id/href alongside supplier-profile-polish-base.js's copy.
    // The two version strings drifted, and because this module's
    // ensureStylesheet() ran after the base module's (ES modules evaluate
    // imported dependencies first), it silently reset the <link> back onto
    // the base module's *old* href on every theme apply -- undoing any
    // cache-bust to the polish stylesheet. There must be exactly one owner.
    expect(profileThemeJs).toContain("export * from './supplier-profile-polish-base.js'");
    expect(profileThemeJs).not.toContain('PROFILE_POLISH_STYLESHEET_ID');
    expect(profileThemeJs).not.toContain('supplier-profile-polish.css');
    expect(profileJs).toContain(
      "const PROFILE_POLISH_STYLESHEET_HREF = '/assets/css/supplier-profile-polish.css?v="
    );
    expect(profileThemeJs).toContain('/assets/css/supplier-profile-theme.css?v=20.1.0');
  });

  test('feeds the existing profile tokens from the resolved supplier accent', () => {
    expect(profileThemeCss).toContain('--sp-profile-accent: #0b8073');
    expect(profileThemeCss).toContain('--sp-primary: var(--sp-profile-accent-strong)');
    expect(profileThemeCss).toContain('--sp-card-border: var(--sp-profile-accent-border)');
    expect(profileThemeJs).toContain("source: 'heroPreset'");
    expect(profileThemeJs).toContain("source: 'category'");
  });

  test('themes only the colour fallback and preserves explicit hero presets', () => {
    expect(profileThemeCss).toContain("html[data-sp-hero-mode='theme']");
    expect(profileThemeCss).toContain('.sp-hero-use-accent');
    expect(profileThemeJs).toContain("return 'preset'");
    expect(profileThemeJs).toContain("heroMode === 'theme'");
  });

  test('derives a contrast-safe colour for solid CTA surfaces', () => {
    expect(profileThemeJs).toContain('strong: mixHex(accent, INK, 0.4)');
    expect(profileThemeJs).toContain("'--sp-profile-accent-strong': palette.strong");
    expect(profileThemeCss).toMatch(/#btn-enquiry\.btn-primary,[\s\S]*\.sp-cta-card/);
    expect(profileThemeCss).toContain('color: var(--sp-profile-on-strong) !important');
  });

  test('propagates the accent through highlights, packages and review calls to action', () => {
    expect(profileThemeCss).toMatch(/\.sp-highlights\s*,/);
    expect(profileThemeCss).toMatch(/\.sp-service-tag\s*\{/);
    expect(profileThemeCss).toMatch(/\.supplier-package-card-v2__action--details\s*\{/);
    expect(profileThemeCss).toMatch(/\.review-summary\s*\{/);
    expect(profileThemeCss).toMatch(/\.sp-reviews-widget--empty \.btn-write-review/);
  });

  test('keeps social, rating and trust colours semantic', () => {
    expect(profileThemeCss).not.toContain('.sp-social-link--facebook');
    expect(profileThemeCss).toContain('.meta-rating .star-icon');
    expect(profileThemeCss).toContain('color: #f59e0b !important');
    expect(profileThemeCss).toContain('.sp-trust-icon');
    expect(profileThemeCss).toContain('color: #059669 !important');
    expect(profileThemeCss).not.toContain('.badge-verified');
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

  test('uses the central auth manager before gating add-to-plan actions', () => {
    expect(packagesJs).toContain('window.__authState || window.AuthStateManager');
    expect(packagesJs).toContain('await authManager.init()');
    expect(packagesJs).toContain('if (!(await isAuthenticated()))');
    expect(packagesJs).toContain("fetch('/api/v1/auth/me', { credentials: 'include' })");
    expect(packagesJs).not.toContain('window.__authState__');
    expect(packagesJs).not.toContain('ef_session=');
  });

  test('loads the profile polish layer from the existing package module entry point', () => {
    expect(packagesJs).toContain("import './supplier-profile-polish.js?v=1'");
    expect(supplierHtml).toContain('supplier-profile-packages-v2.js?v=19.4.4');
  });

  test('collapses zero-review scaffolding into one EventFlow-specific empty state', () => {
    expect(profileJs).toContain("title.textContent = 'No EventFlow reviews yet'");
    expect(profileJs).toContain("widget.classList.toggle('sp-reviews-widget--empty'");
    expect(profileCss).toMatch(/\.sp-reviews-widget--empty \.review-summary/);
    expect(profileCss).toMatch(/\.sp-reviews-widget--empty \.review-controls/);
  });
});
