'use strict';

const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const themeJs = read('public/assets/js/supplier-profile-polish.js');
const themeCss = read('public/assets/css/supplier-profile-theme.css');

describe('supplier profile layout balance contracts', () => {
  test('compacts fallback heroes while preserving full image heroes', () => {
    expect(themeCss).toContain("html[data-sp-hero-mode='image']");
    expect(themeCss).toContain('--sp-hero-height: 300px');
    expect(themeCss).toContain('--sp-hero-height-mobile: 200px');
    expect(themeCss).toContain("html[data-sp-hero-mode='preset']");
    expect(themeCss).toContain('--sp-hero-height: 176px');
    expect(themeCss).toContain('--sp-hero-height-mobile: 148px');
    expect(themeCss).toMatch(/\.hero-avatar-wrap\s*\{[\s\S]*var\(--sp-hero-height\) - 1\.75rem/);
  });

  test('moves badges into the identity and makes sidebar contact secondary', () => {
    expect(themeJs).toContain('function moveHeroBadgesIntoIdentity()');
    expect(themeJs).toContain('identity.appendChild(badges)');
    expect(themeJs).toContain("eyebrow.textContent = 'Contact & availability'");
    expect(themeJs).toContain('function polishContactHierarchy');
    expect(themeCss).toContain('.sp-contact-card .sp-cta-btn--primary');
    expect(themeCss).toContain('background: var(--sp-profile-accent-soft) !important');
  });

  test('widens large desktop profiles and protects content from fixed install UI', () => {
    expect(themeCss).toContain('--sp-page-max-width: 1360px');
    expect(themeCss).toContain('body.sp-profile-page.ef-pwa-banner-visible .sp-page');
    expect(themeCss).toContain('padding-bottom: calc(7rem + var(--ef-pwa-banner-height, 80px))');
    expect(themeJs).toContain("document.body?.classList.add('sp-profile-page')");
  });

  test('cache-busts the corrected theme layer', () => {
    expect(themeJs).toContain('/assets/css/supplier-profile-theme.css?v=20.1.0');
  });
});
