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
