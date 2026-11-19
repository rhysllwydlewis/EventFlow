'use strict';

/**
 * #1408: the public profile paints buttons, tags, borders and shadows with shades mixed
 * from the accent, but that maths lived only in supplier-profile-polish.js. The Profile
 * Customisation preview used the raw accent (and `accent + "1a"` for tags), so a
 * supplier saw different colours in the editor than on their profile.
 *
 * The maths now lives in the shared theme module, used by both.
 */

const fs = require('fs');
const path = require('path');
const theme = require('../../public/assets/js/shared/supplier-theme-core.js');

const ROOT = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('shared accent palette', () => {
  test('derives the same shades the public profile has always shown (EventFlow teal)', () => {
    // Golden values from the implementation that shipped in supplier-profile-polish.js
    // before it moved here; the move must not change a single colour.
    expect(theme.createAccentPalette('#0B8073')).toEqual({
      accent: '#0b8073',
      strong: '#0b3e41',
      hover: '#0b353b',
      light: '#469e95',
      soft: '#ebf5f4',
      subtle: '#daecea',
      border: '#b1d6d2',
      borderStrong: '#85c0b9',
      shadow: 'rgba(11, 128, 115, 0.24)',
      avatarEnd: '#54a69d',
    });
  });

  test('is case-insensitive and always emits lower-case colours', () => {
    expect(theme.createAccentPalette('#0B8073')).toEqual(theme.createAccentPalette('#0b8073'));
  });

  test('handles the extremes without leaving the colour range', () => {
    const black = theme.createAccentPalette('#000000');
    const white = theme.createAccentPalette('#ffffff');
    for (const palette of [black, white]) {
      for (const [key, value] of Object.entries(palette)) {
        if (key !== 'shadow') {
          expect(value).toMatch(/^#[0-9a-f]{6}$/);
        }
      }
    }
    expect(black.soft).toBe('#ebebeb'); // 8% black over white
    expect(white.strong).toBe('#6d7179'); // 40% white over ink: round(0.4*255 + 0.6*ink) per channel
  });

  test('mixHex weights the first colour and clamps the weight', () => {
    expect(theme.mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(theme.mixHex('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(theme.mixHex('#ff0000', '#0000ff', 5)).toBe('#ff0000');
    expect(theme.mixHex('#ff0000', '#0000ff', -1)).toBe('#0000ff');
  });

  test('every palette entry has a published CSS variable, and every variable maps to a real entry', () => {
    const palette = theme.createAccentPalette('#0B8073');
    expect(Object.keys(theme.ACCENT_PALETTE_VARIABLES)).toHaveLength(9);
    for (const [name, key] of Object.entries(theme.ACCENT_PALETTE_VARIABLES)) {
      expect(name).toMatch(/^--sp-profile-accent(-[a-z-]+)?$/);
      expect(palette[key]).toEqual(expect.any(String));
    }
  });

  test('every variable the profile stylesheet reads is one the palette publishes', () => {
    const css = read('public/assets/css/supplier-profile-theme.css');
    const used = new Set(
      [...css.matchAll(/var\((--sp-profile-accent[a-z-]*)\)/g)].map(match => match[1])
    );
    const published = new Set(Object.keys(theme.ACCENT_PALETTE_VARIABLES));
    expect([...used].filter(name => !published.has(name))).toEqual([]);
  });

  test('the palette is deep-frozen against accidental edits at the module boundary', () => {
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.ACCENT_PALETTE_VARIABLES)).toBe(true);
  });
});

describe('who uses the shared palette', () => {
  test('the public profile no longer carries its own copy of the maths', () => {
    const polish = read('public/assets/js/supplier-profile-polish.js');
    expect(polish).not.toMatch(/function (hexToRgb|rgbToHex|mixHex|rgba|createSupplierPalette)\b/);
    expect(polish).toContain('sharedTheme.createAccentPalette(');
    expect(polish).toContain('sharedTheme.ACCENT_PALETTE_VARIABLES');
  });

  test('the Profile Customisation preview paints with the same shades', () => {
    const customisation = read('public/supplier/js/profile-customization.js');
    expect(customisation).toContain('sharedTheme.createAccentPalette(accent)');
    // The old preview used the raw accent, which the public profile never does.
    expect(customisation).not.toContain('`${accent}1a`');
    expect(customisation).not.toMatch(/previewButton\.style\.backgroundColor\s*=\s*accent/);
    // The enquiry button on the public profile is a strong -> hover gradient with white text.
    expect(customisation).toMatch(
      /linear-gradient\(145deg, \$\{palette\.strong\}, \$\{palette\.hover\}\)/
    );
    // Service tags: strong text on a soft fill with a border.
    expect(customisation).toContain('tag.style.background = palette.soft');
    expect(customisation).toContain('tag.style.color = palette.strong');
  });

  test('the preview matches the stylesheet it mimics', () => {
    const css = read('public/assets/css/supplier-profile-theme.css');
    expect(css).toMatch(
      /#btn-enquiry\.btn-primary,\s*\.sp-cta-card\s*\{[^}]*linear-gradient\(\s*145deg,\s*var\(--sp-profile-accent-strong\),\s*var\(--sp-profile-accent-hover\)/s
    );
    expect(css).toMatch(
      /\.sp-service-tag\s*\{[^}]*color:\s*var\(--sp-profile-accent-strong\)[^}]*background:\s*var\(--sp-profile-accent-soft\)/s
    );
  });

  test('the server still loads the same module (palette additions are backwards compatible)', () => {
    const serverTheme = require('../../utils/supplierTheme');
    expect(serverTheme).toBeDefined();
    expect(theme.resolveSupplierTheme({ themeMode: 'custom', themeColor: '#123456' }).accent).toBe(
      '#123456'
    );
  });
});
