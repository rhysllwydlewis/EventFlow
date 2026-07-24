'use strict';

const fs = require('fs');
const path = require('path');

const read = relative => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const themeJs = read('public/assets/js/supplier-profile-polish.js');
const themeCss = read('public/assets/css/supplier-profile-theme.css');
const categoryCss = read('public/assets/css/supplier-profile-v2.css');

describe('supplier profile visual overhaul contracts', () => {
  test('resolves the profile accent from explicit mode, legacy values, category, then EventFlow default', () => {
    expect(themeJs).toContain("if (mode === 'custom')");
    expect(themeJs).toContain("if (mode === 'preset')");
    expect(themeJs).toContain("if (mode === 'automatic')");
    expect(themeJs).toContain("return { accent: chosen, source: 'themeColor' }");
    expect(themeJs).toContain("return { accent: PRESET_ACCENTS[preset], source: 'heroPreset' }");
    expect(themeJs).toContain(
      "return { accent: CATEGORY_ACCENTS[categoryKey], source: 'category' }"
    );
    expect(themeJs).toContain("return { accent: DEFAULT_ACCENT, source: 'default' }");
  });

  test('covers every canonical category family used by the supplier dashboard', () => {
    expect(themeJs).toContain("'music/dj': 'music'");
    expect(themeJs).toContain("videography: 'photography'");
    expect(themeJs).toContain("'event planner': 'wedding'");
    expect(themeJs).toContain("'hair & makeup': 'beauty'");
    expect(themeJs).toContain("decor: 'flowers'");
    expect(themeJs).toContain("cake: 'catering'");
    expect(categoryCss).toContain('data-category-preset="beauty"');
    expect(categoryCss).toContain('#9d174d');
  });

  test('preserves explicit hero presets and themes only the colour fallback', () => {
    expect(themeJs).toContain("return 'preset'");
    expect(themeJs).toContain(
      "heroMedia?.classList.toggle('sp-hero-use-accent', heroMode === 'theme')"
    );
    expect(themeCss).toContain(
      "html[data-sp-hero-mode='theme'] .hero-media.sp-hero-media--fallback.sp-hero-use-accent"
    );
    expect(themeCss).not.toMatch(
      /\.hero-media\.sp-hero-media--fallback\s*\{[\s\S]*?background-image/
    );
  });

  test('derives contrast-safe tokens in JavaScript rather than relying on color-mix support', () => {
    expect(themeJs).toContain('strong: mixHex(accent, INK, 0.4)');
    expect(themeJs).toContain("'--sp-profile-accent-strong': palette.strong");
    expect(themeCss).not.toContain('color-mix(');
  });

  test('places a larger portrait beside the supplier identity at desktop and mobile sizes', () => {
    expect(themeCss).toContain('--sp-avatar-size: 112px');
    expect(themeCss).toMatch(/\.hero-avatar-wrap\s*\{[\s\S]*position:\s*absolute/);
    expect(themeCss).toMatch(/\.hero-content\s*\{[\s\S]*padding:[\s\S]*var\(--sp-avatar-size\)/);
    expect(themeCss).toContain('--sp-avatar-size: 82px');
    expect(themeCss).toContain('--sp-avatar-size: 74px');
  });

  test('keeps semantic colours separate while theming profile-owned controls', () => {
    expect(themeCss).toContain('.meta-rating .star-icon');
    expect(themeCss).toContain('color: #f59e0b !important');
    expect(themeCss).toContain('.sp-trust-icon');
    expect(themeCss).toContain('color: #059669 !important');
    expect(themeCss).toMatch(/#btn-enquiry\.btn-primary,[\s\S]*\.sp-cta-card/);
    expect(themeCss).toMatch(/\.supplier-package-card-v2__action--details/);
    expect(themeCss).toMatch(/\.review-summary/);
  });

  test('replaces generic response claims and emoji detail icons with data-aware polish', () => {
    expect(themeJs).toContain('Send a message and the supplier will reply through EventFlow.');
    expect(themeJs).toContain('Typically responds in around');
    expect(themeJs).toContain('icon.innerHTML = DETAIL_ICONS[label]');
    expect(themeCss).toMatch(/\.sp-detail-row__icon svg/);
  });

  test('cache-busts the visual theme layer', () => {
    expect(themeJs).toContain('/assets/css/supplier-profile-theme.css?v=20.1.0');
  });
});
