'use strict';

/**
 * Homepage V2's hero started as a copy of V1's and now carries its own design
 * on top (see `home-v2-hero-design.test.js`). What the two pages still share is
 * the plumbing: `hero-modern.css`, `ef-search-bar.css` and the collage module
 * all key off the same class names and element ids. These tests guard that
 * shared contract — the V1-only stylesheets and scripts the markup needs, the
 * hooks the collage JS looks up, and the global layers V2 must not load.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const homeV2Html = fs.readFileSync(path.join(ROOT, 'public/home-v2.html'), 'utf8');
const heroParityCss = fs.readFileSync(
  path.join(ROOT, 'public/assets/css/home-v2-hero-parity.css'),
  'utf8'
);
const homeV2Css = fs.readFileSync(path.join(ROOT, 'public/assets/css/home-v2.css'), 'utf8');

const HERO_PATTERN = /<section class="hero hero-modern">[\s\S]*?\n {6}<\/section>/;

function extractHero(html) {
  const match = html.match(HERO_PATTERN);
  return match ? match[0] : null;
}

function normalise(markup) {
  return markup.replace(/\s+/g, ' ').trim();
}

/**
 * Hooks the shared collage module and search bar script look up by name.
 *
 * `id="credit-venues"` and its siblings used to be listed here too, but
 * neither `hero-collage.js` nor anything else ever actually read them —
 * confirmed by grepping the whole repo — so they were dead markup on both
 * pages. V1 has since dropped those spans entirely (the collage labels are
 * plain text now, no credit overlay); V2 keeps its own copies but already
 * hides them via `.home-v2-page .hero-collage-credit { display: none; }`
 * rather than a script wiring into them by id.
 */
const SHARED_HERO_HOOKS = [
  'id="hero-pexels-video"',
  'id="hero-video-source"',
  'id="hero-video-credit"',
  'class="hero-video-card"',
  'id="collage-venues"',
  'id="collage-catering"',
  'id="collage-entertainment"',
  'id="collage-photography"',
  'class="ef-search-bar__form"',
  'class="ef-search-bar__input"',
  'class="ef-search-bar__select"',
];

describe('homepage V2 hero parity with V1', () => {
  test('V2 renders the V1 hero markup, not the retired hv2 hero', () => {
    expect(homeV2Html).toContain('<section class="hero hero-modern">');
    expect(homeV2Html).toContain('ef-search-bar__form');
    expect(homeV2Html).toContain('ef-quick-tags__tag');
    expect(homeV2Html).toContain('hero-highlight-text');
    expect(homeV2Html).toContain('hero-collage');

    // The old V2 hero and its search form are gone, so home-v2.js's hero
    // handlers no-op and ef-search-bar.js binds exactly one form.
    expect(homeV2Html).not.toContain('class="hv2-hero"');
    expect(homeV2Html).not.toContain('hv2-search__field');
    expect(homeV2Html).not.toContain('hv2-popular');
  });

  test('both heroes still expose every hook the shared hero scripts look up', () => {
    // The two heroes no longer match — V2 carries its own design. What has to
    // stay identical is the set of ids and class names `hero-collage.js`,
    // `home-v2-hero.js` and `ef-search-bar.js` query, because both pages drive
    // the same modules.
    const v1Hero = extractHero(indexHtml);
    const v2Hero = extractHero(homeV2Html);

    expect(v1Hero).toBeTruthy();
    expect(v2Hero).toBeTruthy();

    for (const hook of SHARED_HERO_HOOKS) {
      expect(normalise(v1Hero)).toContain(hook);
      expect(normalise(v2Hero)).toContain(hook);
    }

    // Every collage card keeps its category, which is how the widget maps
    // admin-configured media onto frames — and how the V2 design places them.
    for (const category of ['venues', 'catering', 'entertainment', 'photography']) {
      expect(v2Hero).toContain(`data-category="${category}"`);
    }
  });

  test('V2 loads the stylesheets and scripts the ported hero depends on', () => {
    expect(homeV2Html).toMatch(/\/assets\/css\/hero-modern\.css\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/css\/ef-search-bar\.css\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/css\/eventflow-brand\.css\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/css\/home-v2-hero-parity\.css\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/css\/home-v2-hero-design\.css\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/js\/ef-search-bar\.js\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/js\/collage\/hero-collage\.js\?v=/);
    expect(homeV2Html).toMatch(/\/assets\/js\/pages\/home-v2-hero\.js\?v=/);
  });

  test('the shared collage module loads before the page script that calls it', () => {
    const moduleIndex = homeV2Html.indexOf('/assets/js/collage/hero-collage.js');
    const bootstrapIndex = homeV2Html.indexOf('/assets/js/pages/home-v2-hero.js');

    expect(moduleIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeGreaterThan(moduleIndex);
  });

  test('V2 does not pull in the global stylesheets that would restyle its lower sections', () => {
    // modern-landing.css restyles html, .ef-section, .ef-card and .container
    // globally with !important; its hero rules are transplanted into
    // home-v2-hero-parity.css instead. styles.css and design-system.css are
    // base layers for the same reason.
    expect(homeV2Html).not.toContain('/assets/css/modern-landing.css');
    expect(homeV2Html).not.toContain('/assets/css/styles.css');
    expect(homeV2Html).not.toContain('/assets/css/design-system.css');
  });

  test('every rule in the hero parity layer is scoped to the V2 page', () => {
    const selectors = heroParityCss
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('}')
      .map(block => block.split('{')[0].trim())
      .filter(Boolean)
      .flatMap(group => group.split(','))
      .map(selector => selector.trim())
      .filter(selector => selector && !selector.startsWith('@') && !/^\d/.test(selector));

    const unscoped = selectors.filter(selector => !selector.includes('.home-v2-page'));
    expect(unscoped).toEqual([]);
  });

  test('home-v2.css stays untouched by the hero port because homepage V3 shares it', () => {
    // The template renderer builds V3 from index.html + home-v2.css, and most
    // of that file's rules are unscoped. The hero port therefore uses V1's
    // class names rather than editing any hv2-* hero rule.
    expect(homeV2Css).toContain('.hv2-hero {');
    expect(homeV2Css).toContain('.hv2-search {');
  });

  test('Community is reachable from the V2 header, mobile menu and hero', () => {
    const desktopNav = homeV2Html.match(/<nav class="hv2-nav"[\s\S]*?<\/nav>/)[0];
    const mobileNav = homeV2Html.match(/<nav class="hv2-mobile-nav"[\s\S]*?<\/nav>/)[0];
    const heroCtas = homeV2Html.match(/<div class="hero-modern-ctas">[\s\S]*?<\/div>/)[0];

    expect(desktopNav).toContain('href="/community"');
    expect(mobileNav).toContain('href="/community"');
    expect(heroCtas).toContain('href="/community"');

    // Community sits between Marketplace and Guides, matching V1's ordering.
    expect(desktopNav.indexOf('/community')).toBeGreaterThan(desktopNav.indexOf('/marketplace'));
    expect(desktopNav.indexOf('/community')).toBeLessThan(desktopNav.indexOf('/guides'));
  });

  test('the header brand is the wordmark lockup, matching V1', () => {
    expect(homeV2Html).toContain(
      '<a class="hv2-brand ef-brand" href="/" aria-label="EventFlow home">'
    );
    expect(homeV2Html).toContain('<span class="ef-brand-text">EventFlow</span>');
  });

  test('the signed-out auth pill reads "Log in" before scripts run', () => {
    // home-v2-navbar-parity.js sets this at runtime; matching it in the static
    // HTML avoids a first-paint text flash.
    expect(homeV2Html).toMatch(/id="hv2-auth-link"[^>]*>Log in</);
  });
});
