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
const navbarCss = fs.readFileSync(
  path.join(ROOT, 'public/assets/css/home-v2-navbar-parity.css'),
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

  test('each collage card gets its own organic mask', () => {
    const paths = new Set();

    for (const category of ['venues', 'catering', 'entertainment', 'photography']) {
      expect(designCss).toContain(`.hero-collage-card[data-category='${category}']`);
      expect(designCss).toContain(`--hv2-mask: url(#hv2-mask-${category})`);

      // The mask lives in the markup, in objectBoundingBox units so it scales
      // with whatever size the card ends up at.
      const clipPath = homeV2Html.match(
        new RegExp(`<clipPath id="hv2-mask-${category}"[^>]*>\\s*<path d="([^"]+)"`)
      );
      expect(clipPath).toBeTruthy();
      expect(homeV2Html).toContain(
        `<clipPath id="hv2-mask-${category}" clipPathUnits="objectBoundingBox">`
      );
      paths.add(clipPath[1]);
    }

    // Four distinct silhouettes, not one shape reused.
    expect(paths.size).toBe(4);

    // The overlapping layout only applies from the two-column breakpoint up;
    // below it `hero-modern.css` keeps its 2x2 grid and the cards fall back to
    // a plain radius.
    expect(designCss).toMatch(/@media \(min-width: 1024px\)/);
    expect(designCss).toContain('position: absolute');
    expect(designCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*?border-radius: 28px/);
  });

  test('the collage cards sit on the geometry measured from the design', () => {
    // The design measures 757 x 659, with each card a fixed percentage of that
    // box. Keeping the numbers here means a nudge to one card cannot quietly
    // pull the composition off the measurements.
    expect(designCss).toContain('aspect-ratio: 757 / 659');

    const boxes = {
      venues: ['top: 0;', 'left: 0;', 'width: 85.2%;', 'height: 74.96%;', 'z-index: 1;'],
      catering: ['top: 3.64%;', 'left: 62.35%;', 'width: 37.65%;', 'height: 39.3%;', 'z-index: 3;'],
      entertainment: [
        'top: 54.78%;',
        'left: 3.3%;',
        'width: 40.16%;',
        'height: 43.1%;',
        'z-index: 4;',
      ],
      photography: [
        'top: 53.72%;',
        'left: 59.05%;',
        'width: 40.82%;',
        'height: 46.28%;',
        'z-index: 4;',
      ],
    };

    for (const [category, declarations] of Object.entries(boxes)) {
      const block = designCss.match(
        new RegExp(`\\.hero-collage-card\\[data-category='${category}'\\] \\{([^}]*)\\}`)
      );
      expect(block).toBeTruthy();
      for (const declaration of declarations) {
        expect(block[1]).toContain(declaration);
      }
    }
  });

  test('the white separator follows each mask rather than a rectangle', () => {
    // A `border` would draw around the card's box, which the mask has already
    // cut away from. The separator is the same mask on a box 3px larger.
    const backing = designCss.match(
      /\.home-v2-page \.hero-collage \.hero-collage-card::before \{([^}]*)\}/
    );

    expect(backing).toBeTruthy();
    expect(backing[1]).toContain('inset: -3px');
    expect(backing[1]).toContain('background: #fff');

    // Both the shared rules that would clip it away have to be lifted.
    expect(designCss).toContain('overflow: visible');
    expect(designCss).toMatch(/contain: layout style;/);
  });

  test('the mask reaches video as well as images', () => {
    // The collage swaps a card's `<img>` for a `<video>` whenever the admin
    // widget serves a clip, so a rule that only named `img` left video cards
    // as bare rectangles sitting on top of a masked white backing.
    const masked = designCss.match(
      /((?:\s*\.home-v2-page \.hero-collage \.hero-collage-card[^,{]*,)+[^{]*)\{\s*clip-path: var\(--hv2-mask\);/
    );

    expect(masked).toBeTruthy();
    expect(masked[1]).toContain('::before');
    expect(masked[1]).toContain(' img');
    expect(masked[1]).toContain(' video');

    // And the hover zoom stays off both, since scaling a clipped element
    // scales its clip with it.
    const hover = designCss.match(
      /((?:[^{}]*:hover[^{}]*|[^{}]*:focus[^{}]*),?)+\{\s*transform: none;/
    );
    expect(hover).toBeTruthy();
    expect(hover[0]).toContain('video');
  });

  test('the collage carries no creator credit', () => {
    // Two of them: the static pill in the markup, and the one the collage
    // module builds at runtime. V2 does not carry V1's inline styles for
    // `.pexels-credit`, so an uncaught one renders as raw text over the photo.
    const hidden = designCss.match(
      /\.home-v2-page \.hero-collage-credit,\s*\.home-v2-page \.hero-collage \.pexels-credit \{([^}]*)\}/
    );

    expect(hidden).toBeTruthy();
    expect(hidden[1]).toContain('display: none');
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

  test('the header and the hero agree on the header height and the container', () => {
    // The hero is pulled up by exactly the header's height so its wash runs
    // behind the header with no seam. The navbar layer owns that height and
    // the design layer consumes it — if the two drift the hero jumps.
    expect(navbarCss).toContain('--hv2-header-height: 96px');
    expect(navbarCss).toContain('min-height: var(--hv2-header-height)');
    expect(designCss).toContain('calc(var(--hv2-header-height) * -1)');
    expect(designCss).toContain('calc(var(--hv2-header-height) + ');

    // Both also have to resolve to the same gutter, or the wordmark stops
    // sitting over the search bar's left edge.
    const container = 'min(1580px, 93%)';
    expect(designCss).toContain(`width: ${container}`);
    expect(navbarCss).toContain(`calc((100% - ${container}) / 2)`);
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
