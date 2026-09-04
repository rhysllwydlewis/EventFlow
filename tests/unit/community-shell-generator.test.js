/**
 * The community HTML shells are generated from one template
 * (`scripts/generate-community-pages.mjs`) and committed. Nothing enforced that
 * the two stayed in step, and they did not: the template kept emitting the
 * pre-redesign hero band for `/community` long after the committed shell had
 * been rebuilt around the `.efc-stage` composition. Running the generator would
 * have silently reverted the redesign, and the only signal would have been the
 * next person wondering where the homepage went.
 *
 * `--check` regenerates in memory and compares, so drift fails here instead.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-community-pages.mjs');
const PUBLIC = path.join(ROOT, 'public');

/**
 * Every page this generator produces.
 * @returns {Array<{name: string, html: string}>} The committed pages.
 */
function generatedPages() {
  return fs
    .readdirSync(PUBLIC)
    .filter(name => /^(community|admin-community)/.test(name) && name.endsWith('.html'))
    .sort()
    .map(name => ({ name, html: fs.readFileSync(path.join(PUBLIC, name), 'utf8') }));
}

describe('the committed community shells match their template', () => {
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
    const target = path.join(ROOT, 'public/community.html');
    const before = fs.readFileSync(target, 'utf8');
    execFileSync('node', [GENERATOR, '--check'], { cwd: ROOT, stdio: 'ignore' });
    expect(fs.readFileSync(target, 'utf8')).toBe(before);
  });

  it('keeps the redesigned hero in the template, not just in the committed file', () => {
    // The specific regression this suite exists for. If someone reverts the
    // template to the shared `hero()` band, the drift check above catches it —
    // but this says plainly which markup is load-bearing.
    const template = fs.readFileSync(GENERATOR, 'utf8');
    expect(template).toContain('efc-stage__card');
    expect(template).toContain('efc-catstrip');
  });
});

describe('the notification bell every community page renders actually opens something', () => {
  // Every page here (admin-community.html included) renders #ef-notification-btn
  // in its header. Before this, none of them loaded notifications.js or carried
  // a #notification-dropdown for it to open — the same dead-button bug the 34
  // guide articles had (see article-chrome.mjs) — so clicking it did nothing.
  const pages = generatedPages();

  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThanOrEqual(12);
  });

  test.each(pages.map(page => [page.name, page.html]))(
    '%s renders the bell, the dropdown it opens, and the script that runs it',
    (_name, html) => {
      expect(html).toContain('id="ef-notification-btn"');
      expect(html).toContain('id="notification-dropdown"');
      expect(html).toContain('<script src="/assets/js/notifications.js" defer></script>');
    }
  );

  test.each(pages.map(page => [page.name, page.html]))(
    '%s renders exactly one notification dropdown',
    (_name, html) => {
      expect((html.match(/id="notification-dropdown"/g) || []).length).toBe(1);
    }
  );
});
