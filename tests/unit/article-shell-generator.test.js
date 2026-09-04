/**
 * Every guide article carries its own copy of the site header, the mobile
 * bottom navigation and the footer. Nothing enforced that the 34 copies stayed
 * in step, and they did not: six different headers, two bottom navigations and
 * seven footers, and not one of the 34 had the Events or Community links that
 * index.html, guides.html, suppliers.html and pricing.html have all carried for
 * months. Nothing was broken, so nobody saw it.
 *
 * `scripts/generate-article-shells.mjs` now owns those three blocks and the
 * output is committed. `--check` regenerates in memory and compares, so drift
 * fails here instead of shipping.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-article-shells.mjs');
const ARTICLES = path.join(ROOT, 'public/articles');

/**
 * Read every committed article.
 * @returns {Array<{name: string, html: string}>} The articles.
 */
function articles() {
  return fs
    .readdirSync(ARTICLES)
    .filter(name => name.endsWith('.html'))
    .sort()
    .map(name => ({ name, html: fs.readFileSync(path.join(ARTICLES, name), 'utf8') }));
}

/**
 * Extract one chrome block from a page.
 * @param {string} html The page source.
 * @param {RegExp} pattern The block pattern.
 * @returns {string|null} The block, or null when absent.
 */
function block(html, pattern) {
  const match = html.match(pattern);
  return match ? match[0] : null;
}

const HEADER = /<header class="ef-header"[\s\S]*?<\/header>/;
const BOTTOM_NAV = /<nav aria-label="Mobile bottom navigation"[\s\S]*?<\/nav>/;
const FOOTER = /<footer class="footer"[\s\S]*?<\/footer>/;

describe('the committed article shells match their template', () => {
  it('reports no drift', () => {
    let output = '';
    let failed = false;
    try {
      output = execFileSync('node', [GENERATOR, '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      failed = true;
      output = `${error.stdout || ''}${error.stderr || ''}`;
    }
    expect(failed ? output : '').toBe('');
    expect(output).toContain('match the template');
  });

  it('does not write anything in --check mode', () => {
    const target = path.join(ARTICLES, 'event-travel-costs-guide.html');
    const before = fs.readFileSync(target, 'utf8');
    execFileSync('node', [GENERATOR, '--check'], { cwd: ROOT, stdio: 'ignore' });
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
  });
});

describe('every article ships one and the same chrome', () => {
  const all = articles();

  it('has articles to check', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each([
    ['site header', HEADER],
    ['mobile bottom navigation', BOTTOM_NAV],
    ['footer', FOOTER],
  ])('%s is byte-identical across all articles', (_name, pattern) => {
    const variants = new Map();
    for (const article of all) {
      const markup = block(article.html, pattern);
      expect(markup).not.toBeNull();
      if (!variants.has(markup)) {
        variants.set(markup, []);
      }
      variants.get(markup).push(article.name);
    }
    // On failure, name the odd files out rather than dumping two blobs of HTML.
    const groups = [...variants.values()].sort((a, b) => b.length - a.length);
    expect(groups.slice(1).flat()).toEqual([]);
  });
});

describe('article navigation matches the rest of the site', () => {
  const all = articles();
  const canonical = fs.readFileSync(path.join(ROOT, 'public/guides.html'), 'utf8');

  it('uses the header from guides.html verbatim', () => {
    // The generator reads it from there; this states the contract so a future
    // reader knows the drift check above is comparing against a live page.
    const expected = block(canonical, HEADER);
    expect(expected).not.toBeNull();
    for (const article of all) {
      expect(block(article.html, HEADER)).toBe(expected);
    }
  });

  it.each(['/public-calendar', '/community', '/pricing', '/for-suppliers', '/faq'])(
    'links to %s from every article',
    href => {
      const missing = all.filter(a => !a.html.includes(`href="${href}"`)).map(a => a.name);
      expect(missing).toEqual([]);
    }
  );

  it('does not leave a version label no article script can fill', () => {
    // `#ef-version-label` is only ever populated by admin-shared.js and
    // home-init.js. No article loads either, so the block read
    // "Version: loading…" on every guide until the footer was regenerated.
    const stuck = all.filter(a => a.html.includes('ef-version-label')).map(a => a.name);
    expect(stuck).toEqual([]);
  });
});
