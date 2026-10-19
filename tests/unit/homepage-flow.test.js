'use strict';

/**
 * Homepage flow layer.
 *
 * homepage-flow.css sits on top of the homepage's separately authored layers and
 * only handles what lies between sections: width, rhythm, plain section labels and
 * flat colour bands. These tests keep it wired in, scoped to the production
 * homepage, readable, and free of decoration.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const index = read('public/index.html');
const css = read('public/assets/css/homepage-flow.css');
const homeInit = read('public/assets/js/pages/home-init.js');
const approvedLower = read('public/assets/js/pages/homepage-approved-lower.js');
const approvedLowerCss = read('public/assets/css/homepage-approved-lower.css');

const variable = name => {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(match).not.toBeNull();
  return match[1];
};

const luminance = hex => {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('homepage flow layer wiring', () => {
  test('is loaded by the production homepage with a cache-busting version', () => {
    expect(index).toMatch(/\/assets\/css\/homepage-flow\.css\?v=\d+/);
  });

  test('loads after the layers it corrects, so it wins the cascade', () => {
    const at = needle => index.indexOf(needle);
    [
      'homepage-approved-lower.css',
      'home-wedding-showcase.css',
      'homepage-locations-refresh.css',
    ].forEach(sheet => expect(at('homepage-flow.css')).toBeGreaterThan(at(sheet)));
  });

  test('the homepage body carries the scope class from first paint, not only after the script runs', () => {
    expect(index).toMatch(/<body class="ef-home-flow ef-home-guidance">/);
  });

  test('every rule is scoped to the production homepage', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('{')
      .slice(0, -1)
      .map(part => part.split('}').pop().trim())
      .filter(part => part && !part.startsWith('@'))
      .flatMap(part => part.split(/,(?![^(]*\))/).map(sel => sel.trim()));
    expect(selectors.filter(sel => !/body\.ef-home-flow|^\.ef-flow-/.test(sel))).toEqual([]);
  });

  test('nothing moves on its own: no script, keyframes, animation, filters or pill shapes', () => {
    expect(index).not.toContain('homepage-flow.js');
    expect(css).not.toMatch(/@keyframes|animation:|filter:|backdrop-filter/);
    // a single 999px radius is a pill; the wedding arch uses four values and is allowed
    expect(css).not.toMatch(/border-radius:\s*999px\s*;/);
  });
});

describe('homepage flow readability', () => {
  test('section labels meet WCAG AA contrast on every band they sit on', () => {
    const label = variable('flow-label');
    [variable('flow-mint'), '#ffffff'].forEach(band =>
      expect(contrast(label, band)).toBeGreaterThanOrEqual(4.5)
    );
    expect(contrast(variable('flow-label-wedding'), variable('flow-blush'))).toBeGreaterThanOrEqual(
      4.5
    );
  });

  test('leaves the supplier panel label alone, since it sits on a dark panel', () => {
    expect(css).toContain('section:not(.ef-approved-supplier-section)');
  });

  test('colour bands run edge to edge on phones, past the global 10px body padding', () => {
    expect(css).toMatch(
      /@media \(max-width: 600px\)\s*\{\s*body\.ef-home-flow\s*\{\s*padding-left: 0;\s*padding-right: 0;/
    );
  });

  test('narrow phones get the locations link at a readable size', () => {
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*--btn-fs:\s*1[2-9]px/);
  });
});

describe('homepage guidance', () => {
  const seams = [
    ...index.matchAll(/<div class="ef-flow-seam"><a href="#([^"]+)" aria-label="Next: ([^"]+)"/g),
  ];

  test('every section seam has a pointer that leads to a real section', () => {
    expect(seams.length).toBeGreaterThanOrEqual(5);
    seams.forEach(([, target]) => {
      expect(index).toMatch(new RegExp(`id="${target}"`));
    });
  });

  test('every pointer target clears the sticky header, and is a section rather than just a heading', () => {
    const offset = css.match(/:is\(([^)]*)\)\s*\{\s*scroll-margin-top:\s*(\d+)px/);
    expect(offset).not.toBeNull();
    expect(Number(offset[2])).toBeGreaterThanOrEqual(76);
    const covered = offset[1].split(',').map(sel => sel.trim());
    seams.forEach(([, target]) => {
      expect(covered).toContain(`#${target}`);
      expect(index).toMatch(new RegExp(`<(section|div)[^>]*\\bid="${target}"`));
    });
  });

  test('pointers carry a readable name and keep their words out of the accessibility tree', () => {
    expect(index).toMatch(/class="ef-flow-seam__label" aria-hidden="true">Next: /);
    seams.forEach(([, , label]) => expect(label.length).toBeGreaterThan(3));
  });

  test('the early-access steps end with something to do', () => {
    expect(approvedLower).toContain('ef-approved-step-cta__primary" href="/start"');
    expect(approvedLower).toContain('ef-approved-step-cta__secondary" href="/suppliers"');
  });

  test('category cards say they can be clicked, without repeating themselves for screen readers', () => {
    expect(approvedLower).toMatch(/ef-approved-category-go" aria-hidden="true"/);
  });

  test('every guidance rule sits behind the guidance class, so switching it off leaves the plain page', () => {
    const rules = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('{')
      .slice(0, -1)
      .map(part => part.split('}').pop().trim())
      .flatMap(part => part.split(/,(?![^(]*\))/).map(sel => sel.trim()))
      .filter(sel => /ef-flow-seam|ef-approved-category-go|ef-approved-step-cta/.test(sel));
    expect(rules.length).toBeGreaterThan(10);
    const ungated = rules.filter(
      sel => !/ef-home-guidance/.test(sel) && !/:not\(\.ef-home-guidance\)/.test(sel)
    );
    expect(ungated).toEqual([]);
  });

  test('with the class absent, the pointers, card cues and closing call to action are hidden', () => {
    expect(css).toMatch(
      /body\.ef-home-flow:not\(\.ef-home-guidance\)\s+:is\([^)]*\.ef-flow-seam[^)]*\.ef-approved-category-go[^)]*\.ef-approved-step-cta[^)]*\)\s*\{[^}]*display:\s*none\s*!important/
    );
  });

  test('the pointers keep clear of the wedding section markup the SEO tests pin', () => {
    const start = index.indexOf('<!-- hws:start');
    const end = index.indexOf('<!-- hws:end -->');
    expect(index.slice(start, end)).not.toContain('ef-flow-seam');
  });
});

describe('empty package sections', () => {
  const carousel = homeInit.slice(homeInit.indexOf('async function loadPackagesCarousel'));
  const catchAt = carousel.indexOf('} catch (error) {\n    // Issue 5 Fix');

  test('are hidden when the endpoint is missing or returns no items', () => {
    const hides = carousel.slice(0, catchAt).match(/setSectionHidden\(true\)/g) || [];
    expect(hides).toHaveLength(2);
  });

  test('stay visible on errors, where the retry button has to be on screen', () => {
    expect(catchAt).toBeGreaterThan(-1);
    expect(carousel.slice(catchAt)).not.toContain('setSectionHidden(true)');
    expect(carousel).toContain('setSectionHidden(false)');
  });

  test('hiding wins over the sections own display rule', () => {
    expect(css).toMatch(/\.home-featured-section\[hidden\][\s\S]*display: none !important/);
  });
});

describe('category cards without a photo', () => {
  test('render a plain tinted icon panel instead of the generic placeholder image', () => {
    expect(approvedLower).toContain('ef-approved-category-art');
    expect(approvedLower.slice(approvedLower.indexOf('const renderApprovedCategories'))).toMatch(
      /category\.placeholder\s*\?/
    );
    expect(approvedLowerCss).toContain('.ef-approved-category-art');
    expect(approvedLowerCss).not.toMatch(/ef-approved-category-art--/);
  });
});

describe('homepage search landmark', () => {
  test('is labelled so it can be told apart from other landmarks', () => {
    expect(index).toMatch(/class="ef-search-bar" role="search" aria-label="[^"]+"/);
  });
});
