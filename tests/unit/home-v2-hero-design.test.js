'use strict';

/**
 * Homepage V2's hero design.
 *
 * V2 no longer mirrors V1's hero. `home-v2-hero-design.css` layers the V2
 * design on top of the parity bridge, and the markup it styles lives in
 * `home-v2.html`. Two things have to hold for that to keep working:
 *
 *   1. the design layer stays scoped to `.home-v2-page`, so V1 and V3 — which
 *      share `hero-modern.css`, `ef-search-bar.css` and `home-v2.css` — are not
 *      restyled by it, and
 *   2. the markup the design needs (icons, copy, collage categories) is present
 *      and V1's is left alone.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const homeV2Html = fs.readFileSync(path.join(ROOT, 'public/home-v2.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const designCss = fs.readFileSync(
  path.join(ROOT, 'public/assets/css/home-v2-hero-design.css'),
  'utf8'
);
const heroModernCss = fs.readFileSync(path.join(ROOT, 'public/assets/css/hero-modern.css'), 'utf8');
const searchBarCss = fs.readFileSync(
  path.join(ROOT, 'public/assets/css/ef-search-bar.css'),
  'utf8'
);

const HERO_PATTERN = /<section class="hero hero-modern">[\s\S]*?\n {6}<\/section>/;

function extractHero(html) {
  const match = html.match(HERO_PATTERN);
  return match ? match[0] : null;
}

function selectorsOf(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map(block => block.split('{')[0].trim())
    .filter(Boolean)
    .flatMap(group => group.split(','))
    .map(selector => selector.trim())
    .filter(selector => selector && !selector.startsWith('@') && !/^\d/.test(selector));
}

describe('homepage V2 hero design layer', () => {
  test('every rule is scoped to the V2 page', () => {
    // An unscoped rule here would reach V1 and V3 through the shared
    // stylesheets, which is exactly what the parity bridge exists to avoid.
    const unscoped = selectorsOf(designCss).filter(selector => !selector.includes('.home-v2-page'));

    expect(unscoped).toEqual([]);
  });

  test('the page loads the design layer after the parity bridge it overrides', () => {
    const parityIndex = homeV2Html.indexOf('/assets/css/home-v2-hero-parity.css');
    const designIndex = homeV2Html.indexOf('/assets/css/home-v2-hero-design.css');

    expect(parityIndex).toBeGreaterThan(-1);
    expect(designIndex).toBeGreaterThan(parityIndex);
  });

  test('the hero copy is the shortened one-line version', () => {
    const hero = extractHero(homeV2Html);

    expect(hero).toContain('Find venues, catering, entertainment and more.');
    // The long V1 second sentence is gone.
    expect(hero).not.toContain('Add options to your plan instantly');
    expect(hero).toContain('placeholder="Search suppliers, packages, venues…"');
  });

  test('the quick tags and category selector carry line icons', () => {
    const hero = extractHero(homeV2Html);
    const tagIcons = hero.match(/class="hv2-quick-tag-icon"/g) || [];

    expect(tagIcons).toHaveLength(4);
    expect(hero).toContain('class="hv2-search-category-icon"');

    // The icons are decorative; the accessible name comes from the label text
    // and `data-search` is what `ef-search-bar.js` reads on click.
    for (const search of ['london venues', 'canapés drinks', 'dj packages', 'corporate']) {
      expect(hero).toContain(`data-search="${search}"`);
    }
  });

  test('the collage labels use line icons rather than emoji', () => {
    const hero = extractHero(homeV2Html);
    const iconSpans = hero.match(/<span class="hero-collage-icon">/g) || [];

    expect(iconSpans).toHaveLength(4);
    for (const emoji of ['🏛️', '🍽️', '🎤', '📸']) {
      expect(hero).not.toContain(emoji);
    }
  });

  test('each collage card gets its own shape from the design layer', () => {
    for (const category of ['venues', 'catering', 'entertainment', 'photography']) {
      expect(designCss).toContain(`.hero-collage-card[data-category='${category}']`);
    }

    // The overlapping layout only applies from the two-column breakpoint up;
    // below it `hero-modern.css` keeps its 2x2 grid.
    expect(designCss).toMatch(/@media \(min-width: 1024px\)/);
    expect(designCss).toContain('position: absolute');
  });

  test('each collage image advertises the width its own card actually gets', () => {
    const hero = extractHero(homeV2Html);

    // The four cards are no longer the same size, so they cannot share V1's
    // single `25vw` slot — the feature card is roughly twice the others and
    // would be served an under-resolved image on high-DPI displays.
    const sizes = Array.from(hero.matchAll(/sizes="([^"]+)"/g), match => match[1]);

    expect(sizes).toHaveLength(4);
    expect(new Set(sizes).size).toBe(4);
    for (const value of sizes) {
      expect(value).toMatch(/^\(max-width: 1023px\) 46vw, \(max-width: 1699px\) \d+vw, \d+px$/);
    }

    // The feature card asks for the largest slot of the four.
    const declaredVw = sizes.map(value => Number(value.match(/(\d+)vw,/g)[1].match(/\d+/)[0]));
    expect(Math.max(...declaredVw)).toBe(declaredVw[0]);
  });

  test('V1 keeps the emoji labels and the long subcopy', () => {
    // The design is V2-only. If someone applies it to V1 too, this is the test
    // that should be deleted deliberately rather than the divergence
    // spreading by accident.
    const v1Hero = extractHero(indexHtml);

    expect(v1Hero).toContain('🏛️');
    expect(v1Hero).toContain('Add options to your plan instantly');
    expect(v1Hero).toContain('placeholder="Search suppliers, packages..."');
    expect(v1Hero).not.toContain('hv2-quick-tag-icon');
  });

  test('the shared stylesheets the design overrides are still unedited', () => {
    // The design works by overriding these from a scoped layer. If a value
    // moves into the shared file instead, V1 and V3 inherit it silently.
    expect(heroModernCss).toContain('border-radius: 16px;');
    expect(heroModernCss).toContain('--hero-stack-gap: 12px;');
    expect(searchBarCss).toContain('--search-bar-radius: 20px;');
    expect(searchBarCss).not.toContain('home-v2-page');
    expect(heroModernCss).not.toContain('home-v2-page');
  });
});
