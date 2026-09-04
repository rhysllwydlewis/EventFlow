/**
 * The premium template is only a template if starting a second article is
 * cheap and hard to get wrong. `scripts/new-article.mjs` is that path, so it
 * has to keep emitting a page that is actually valid — not a stub that needs
 * repairing before it renders.
 *
 * This runs the real scaffold, then holds its output to the same standards the
 * committed articles are held to: canonical chrome, no drift, no hand-written
 * section numbers, and the structure the runtime expects.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SCAFFOLD = path.join(ROOT, 'scripts/new-article.mjs');
const SHELLS = path.join(ROOT, 'scripts/generate-article-shells.mjs');
const SLUG = 'zz-scaffold-fixture';
const TARGET = path.join(ROOT, 'public/articles', `${SLUG}.html`);

/**
 * Run the scaffold for the fixture slug.
 * @param {string[]} extra Additional CLI arguments.
 * @returns {string} Combined stdout.
 */
function scaffold(extra = []) {
  return execFileSync(
    'node',
    [
      SCAFFOLD,
      '--slug',
      SLUG,
      '--title',
      'Scaffold Fixture',
      '--description',
      'A fixture article written by the scaffold test.',
      '--kicker',
      'Testing',
      ...extra,
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
}

describe('scripts/new-article.mjs', () => {
  let html = '';

  beforeAll(() => {
    if (fs.existsSync(TARGET)) {
      fs.unlinkSync(TARGET);
    }
    scaffold();
    html = fs.readFileSync(TARGET, 'utf8');
  });

  afterAll(() => {
    if (fs.existsSync(TARGET)) {
      fs.unlinkSync(TARGET);
    }
  });

  it('writes a complete document with no unresolved placeholders', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).not.toMatch(/CHROME_(HEADER|FOOTER|BOTTOM_NAV)/);
  });

  it('opts into the template and its assets', () => {
    expect(html).toContain('<body class="gp-page">');
    expect(html).toContain('<article class="gp gp--numbered" data-gp-article>');
    expect(html).toContain('/assets/css/guide-premium.css');
    expect(html).toContain('/assets/js/pages/guide-premium.js');
  });

  it('carries the canonical site chrome, not a copy of its own', () => {
    const guides = fs.readFileSync(path.join(ROOT, 'public/guides.html'), 'utf8');
    const header = guides.match(/<header class="ef-header"[\s\S]*?<\/header>/);
    expect(header).not.toBeNull();
    expect(html).toContain(header[0]);
    expect(html).toContain('ef-bottom-nav');
    expect(html).toContain('<footer class="footer"');
  });

  it('is drift-free the moment it is written', () => {
    // The whole point of sharing one chrome source between the scaffold and the
    // shell generator: a new article never needs a follow-up rewrite.
    const output = execFileSync('node', [SHELLS, '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(output).toContain('match the template');
  });

  it('never hand-writes section numbers', () => {
    expect(html).not.toContain('gp-section__num');
    expect((html.match(/data-gp-section/g) || []).length).toBeGreaterThan(1);
  });

  it('ships both print controls and one contents entry per section', () => {
    expect((html.match(/data-gp-print/g) || []).length).toBe(2);
    const sectionIds = [...html.matchAll(/data-gp-section id="([^"]+)"/g)].map(m => m[1]);
    const tocTargets = [...html.matchAll(/class="gp-toc__link" href="#([^"]+)"/g)].map(m => m[1]);
    expect(tocTargets).toEqual(sectionIds);
  });

  it('drops the numbering modifier when asked', () => {
    fs.unlinkSync(TARGET);
    scaffold(['--no-numbers']);
    const plain = fs.readFileSync(TARGET, 'utf8');
    expect(plain).toContain('<article class="gp" data-gp-article>');
    // Not a whole-document check: the scaffold's own explanatory copy names the
    // modifier in a <code> element, which is the point of it being there.
    expect(plain).not.toMatch(/<article[^>]*gp--numbered/);
  });

  it('refuses to overwrite an article that already exists', () => {
    expect(() => scaffold()).toThrow();
    expect(fs.existsSync(TARGET)).toBe(true);
  });

  it('rejects a slug that would not make a clean URL', () => {
    expect(() =>
      execFileSync(
        'node',
        [SCAFFOLD, '--slug', 'Not A Slug', '--title', 'x', '--description', 'y'],
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }
      )
    ).toThrow();
  });
});

describe('scripts/new-article.mjs — JSON-LD survives an awkward title', () => {
  // A hand-written `"headline": "${title}"` string only breaks on characters a
  // real title can plausibly contain: a quote (survives HTML-escaping as the
  // literal text &quot; instead of becoming a real character), a backslash (not
  // a valid JSON escape on its own — invalidates the whole block), and
  // `</script>` (ends the tag early regardless of what is "inside" the JSON,
  // because the HTML parser reads raw text, not JSON).
  const slug = 'zz-json-ld-fixture';
  const target = path.join(ROOT, 'public/articles', `${slug}.html`);
  const title = 'The "Best" Guide \\d </script><script>alert(1)</script>';
  const description = 'Line one\nLine two & more';
  let html = '';
  let jsonLd;

  beforeAll(() => {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    execFileSync(
      'node',
      [SCAFFOLD, '--slug', slug, '--title', title, '--description', description],
      { cwd: ROOT, encoding: 'utf8' }
    );
    html = fs.readFileSync(target, 'utf8');
    const match = html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
    jsonLd = match ? match[1] : null;
  });

  afterAll(() => {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  });

  it('emits exactly one ld+json block, and it is present', () => {
    expect(jsonLd).not.toBeNull();
    expect((html.match(/application\/ld\+json/g) || []).length).toBe(1);
  });

  it('is valid JSON', () => {
    expect(() => JSON.parse(jsonLd)).not.toThrow();
  });

  it('round-trips the title and description exactly, not HTML-entity-mangled', () => {
    const data = JSON.parse(jsonLd);
    expect(data.headline).toBe(title);
    expect(data.description).toBe(description);
  });

  it('never lets the title end the script tag early', () => {
    // The literal case-insensitive byte sequence, wherever it sits in the
    // document, would close the tag as far as the HTML parser is concerned —
    // this is not a JSON-escaping question.
    expect(jsonLd.toLowerCase()).not.toContain('</script');
  });

  it('does not inject the title as live markup elsewhere on the page', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
