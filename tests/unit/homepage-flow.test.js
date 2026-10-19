'use strict';

/**
 * Homepage flow layer.
 *
 * homepage-flow.css / homepage-flow.js sit on top of the homepage's separately
 * authored layers and only handle what lies between sections: width, rhythm,
 * eyebrows, colour bands, curved seams and decoration. These tests keep the
 * layer wired in, scoped to the production homepage, and harmless: it never
 * changes what a section says, and it can run twice without doubling up.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const index = read('public/index.html');
const css = read('public/assets/css/homepage-flow.css');
const homeInit = read('public/assets/js/pages/home-init.js');
const approvedLower = read('public/assets/js/pages/homepage-approved-lower.js');

const SECTIONS = [
  ['hero', 'hero-modern'],
  ['categories', 'ef-approved-category-section'],
  ['locations', 'ef-home-locations'],
  ['wedding', 'hws'],
  ['guides', 'ef-approved-guides-section'],
  ['marketplace', 'ef-approved-marketplace-section'],
  ['steps', 'ef-approved-steps-section'],
  ['supplier', 'ef-approved-supplier-section'],
];

// jsdom ships as ESM, which Jest's CommonJS runtime cannot load in-process, so
// the page is built and measured in a child Node process (as other tests here do).
const runInDom = ({ homepage = true } = {}) => {
  const program = `
    const { JSDOM } = require('jsdom');
    const fs = require('fs');
    const sections = ${JSON.stringify(SECTIONS.map(([, cls]) => cls))};
    const body = sections.map(cls => {
      const heading = cls === 'ef-approved-category-section'
        ? '<div class="ef-approved-heading"><h2>Explore trusted suppliers</h2></div>'
        : cls === 'hws' ? '<h2>Your wedding website, RSVPs and seating plan, all in one place</h2>' : '';
      return '<section class="' + cls + '">' + heading + '</section>';
    }).join('');
    const dom = new JSDOM('<body class="${homepage ? 'ef-approved-lower-home' : ''}"><main>' + body + '</main>' +
      '<footer><section class="ef-nl-wrap"><div class="ef-nl-card"></div></section></footer></body>', { runScripts: 'outside-only' });
    const { window } = dom;
    window.eval(fs.readFileSync(process.argv[1], 'utf8'));
    // The script initialises on DOMContentLoaded and again on load; snapshot the
    // page between the two so the second pass can be compared with the first.
    let afterFirst = null;
    window.document.addEventListener('DOMContentLoaded', () => {
      afterFirst = window.document.body.innerHTML;
    });
    (async () => {
    await new Promise(resolve => window.addEventListener('load', () => setTimeout(resolve, 0)));
    const doc = window.document;
    const wave = doc.querySelector('.ef-nl-wrap .ef-flow-wave--bottom path');
    console.log(JSON.stringify({
      decorPerSection: sections.map(cls => doc.querySelectorAll('.' + cls + ' > .ef-flow-decor').length),
      footerDecor: doc.querySelectorAll('.ef-nl-wrap > .ef-flow-decor').length,
      marks: doc.querySelectorAll('.ef-flow-mark').length,
      anything: doc.querySelectorAll('.ef-flow-decor, .ef-flow-mark').length,
      weddingText: doc.querySelector('.hws h2').textContent,
      categoryText: doc.querySelector('.ef-approved-heading h2').textContent,
      categoryMark: (doc.querySelector('.ef-approved-heading h2 .ef-flow-mark') || {}).textContent || null,
      footerFill: wave ? wave.getAttribute('fill') : null,
      gradientDefined: !!doc.getElementById('ef-flow-footer-gradient'),
      unchangedBySecondPass: afterFirst !== null && doc.body.innerHTML === afterFirst,
    }));
    })();
  `;
  const out = execFileSync(
    process.execPath,
    ['-e', program, path.join(ROOT, 'public/assets/js/pages/homepage-flow.js')],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return JSON.parse(out.trim().split('\n').pop());
};

describe('homepage flow layer wiring', () => {
  test('is loaded by the production homepage with cache-busting versions', () => {
    expect(index).toMatch(/\/assets\/css\/homepage-flow\.css\?v=\d+/);
    expect(index).toMatch(/\/assets\/js\/pages\/homepage-flow\.js\?v=\d+/);
  });

  test('loads after the layers it corrects, so it wins the cascade and sees the rewritten page', () => {
    const at = needle => index.indexOf(needle);
    [
      'homepage-approved-lower.css',
      'home-wedding-showcase.css',
      'homepage-locations-refresh.css',
    ].forEach(sheet => expect(at('homepage-flow.css')).toBeGreaterThan(at(sheet)));
    ['homepage-approved-lower.js', 'eventflow-footer.js'].forEach(file =>
      expect(at('homepage-flow.js')).toBeGreaterThan(at(file))
    );
  });

  test('every rule is scoped to the production homepage or to its own classes', () => {
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/url\("[^"]*"\)/g, 'url()')
      .split('{')
      .slice(0, -1)
      .map(part => part.split('}').pop().trim())
      .filter(part => part && !part.startsWith('@') && !/^[\d%.,\s]+$|^(from|to)$/.test(part))
      .flatMap(part => part.split(/,(?![^(]*\))/).map(sel => sel.trim()));
    const unscoped = selectors.filter(
      sel => !/ef-approved-lower-home|\.ef-flow-/.test(sel) && !/^\.hws \.ef-flow-/.test(sel)
    );
    expect(unscoped).toEqual([]);
  });

  test('declares a reduced-motion path for the floating decoration', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*{\s*\.ef-flow-bit\s*{[^}]*animation/
    );
  });
});

describe('homepage flow script', () => {
  test('adds one decoration layer to every section and marks each heading', () => {
    const result = runInDom();
    expect(result.decorPerSection).toEqual(SECTIONS.map(() => 1));
    expect(result.footerDecor).toBe(1);
    expect(result.marks).toBe(2);
  });

  test('keeps heading text exactly as written', () => {
    const result = runInDom();
    expect(result.weddingText).toBe(
      'Your wedding website, RSVPs and seating plan, all in one place'
    );
    expect(result.categoryText).toBe('Explore trusted suppliers');
    expect(result.categoryMark).toBe('trusted suppliers');
  });

  test('is idempotent: the second pass after load adds nothing', () => {
    const result = runInDom();
    expect(result.unchangedBySecondPass).toBe(true);
    expect(result.decorPerSection).toEqual(SECTIONS.map(() => 1));
  });

  test('does nothing unless the production homepage has claimed the page', () => {
    expect(runInDom({ homepage: false }).anything).toBe(0);
  });

  test('paints the footer seam from a gradient it defines itself', () => {
    const result = runInDom();
    expect(result.footerFill).toBe('url(#ef-flow-footer-gradient)');
    expect(result.gradientDefined).toBe(true);
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
  test('render a coloured icon panel instead of the generic placeholder image', () => {
    expect(approvedLower).toContain('ef-approved-category-art');
    expect(approvedLower).toContain("tone: 'blue'");
    const cards = approvedLower.slice(approvedLower.indexOf('const renderApprovedCategories'));
    expect(cards).toMatch(/category\.tone\s*\?/);
    expect(read('public/assets/css/homepage-approved-lower.css')).toContain(
      '.ef-approved-category-art'
    );
  });
});
