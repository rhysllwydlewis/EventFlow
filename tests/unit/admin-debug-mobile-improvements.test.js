'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('admin debug mobile improvements', () => {
  test('loads the isolated mobile enhancement assets from the existing debug bundle', () => {
    const loader = read('public/assets/js/pages/admin-debug-background-jobs.js');
    expect(loader).toContain('/assets/css/admin-debug-mobile-improvements.css');
    expect(loader).toContain('/assets/js/pages/admin-debug-mobile-improvements.js');
    expect(loader).toContain('data-admin-debug-mobile-improvements');
    const html = read('public/admin-debug.html');
    expect(html).toContain('/assets/js/pages/admin-debug-background-jobs.js?v=18.6.0');
  });

  test('adds scrollable tabs, mutually exclusive summary figures and grouped results', () => {
    const script = read('public/assets/js/pages/admin-debug-mobile-improvements.js');
    expect(script).toContain("tabs.classList.add('sc-tabs--mobile-enhanced')");
    expect(script).toContain("button.scrollIntoView({ behavior: 'smooth'");
    expect(script).toContain("['Clean passes', counts.passed");
    expect(script).toContain("['Protected', counts.protected");
    expect(script).toContain("['Needs attention'");
    expect(script).toContain("label: 'Expected authentication redirects'");
    expect(script).toContain("label: 'Successful checks'");
  });

  test('groups rendered checks and filters them without treating followed login redirects as failures', () => {
    runNodeSmoke(String.raw`
      const assert = require('assert');
      const fs = require('fs');
      const { JSDOM } = require('jsdom');
      const html = [
        '<!doctype html><body>',
        '<nav class="sc-tabs">',
        '<button class="sc-tab-btn" aria-selected="true" aria-controls="tab-overview">Overview</button>',
        '<button class="sc-tab-btn" aria-selected="false" aria-controls="tab-background-jobs">Background Jobs</button>',
        '</nav>',
        '<div id="tab-overview"></div><div id="tab-background-jobs"></div>',
        '<div id="sc-stats-bar"></div>',
        '<div id="sc-summary"><div class="sc-summary-card"><div class="sc-summary-meta"><p class="sc-summary-title">PASS</p><p class="sc-summary-subtitle">All 3 checks passed (1 with warnings) · 17 Jul 2026, 08:00 · 1.2s</p></div><div class="sc-summary-env">production</div></div></div>',
        '<div id="sc-checks-list">',
        '<div class="sc-check-row"><span class="sc-check-status" aria-label="Pass">✅</span><span class="sc-check-name">Homepage</span><span class="sc-check-type">page</span><span class="sc-check-code">200</span><span class="sc-check-dur">100ms</span><span class="sc-check-ok">OK</span></div>',
        '<div class="sc-check-row sc-check-row--warn"><span class="sc-check-status" aria-label="Pass">⚠️</span><span class="sc-check-name">Admin dashboard</span><span class="sc-check-type">page</span><span class="sc-check-code">200</span><span class="sc-check-dur">80ms</span><span class="sc-check-warn" title="Auth redirect (unauthenticated — use admin-health-api for confirmed admin health)">WARN</span><span class="sc-check-redirect" title="Redirected to: https://event-flow.co.uk/login">redirect</span></div>',
        '<div class="sc-check-row"><span class="sc-check-status" aria-label="Fail">❌</span><span class="sc-check-name">Health API</span><span class="sc-check-type">api</span><span class="sc-check-code">500</span><span class="sc-check-dur">20ms</span><span class="sc-check-err">Server error</span></div>',
        '</div>',
        '</body>',
      ].join('');
      const dom = new JSDOM(html, {
        url: 'https://event-flow.co.uk/admin-debug',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
      });
      dom.window.HTMLElement.prototype.scrollIntoView = function () {};
      dom.window.requestAnimationFrame = callback => callback();
      dom.window.eval(fs.readFileSync('public/assets/js/pages/admin-debug-mobile-improvements.js', 'utf8'));

      const document = dom.window.document;
      const labels = [...document.querySelectorAll('#sc-stats-bar .sc-stat-label')].map(node => node.textContent);
      const values = [...document.querySelectorAll('#sc-stats-bar .sc-stat-value')].map(node => node.textContent);
      assert.deepStrictEqual(labels, ['Total', 'Clean passes', 'Protected', 'Needs attention']);
      assert.deepStrictEqual(values, ['3', '1', '1', '1']);
      assert.strictEqual(document.querySelectorAll('.sc-check-group--attention .sc-check-row').length, 1);
      assert.strictEqual(document.querySelectorAll('.sc-check-group--protected .sc-check-row').length, 1);
      assert.strictEqual(document.querySelectorAll('.sc-check-group--passed .sc-check-row').length, 1);
      assert.strictEqual(document.querySelector('.sc-check-row--protected .sc-check-info').textContent, 'PROTECTED');
      assert.strictEqual(document.querySelector('.sc-check-group--protected').open, false);
      assert.strictEqual(document.querySelector('.sc-check-group--passed').open, false);
      assert(document.querySelector('.sc-summary-subtitle').textContent.includes('1 protected'));

      document.querySelector('[data-filter="protected"]').click();
      assert.strictEqual(document.querySelector('.sc-check-group--protected').hidden, false);
      assert.strictEqual(document.querySelector('.sc-check-group--protected').open, true);
      assert.strictEqual(document.querySelector('.sc-check-group--attention').hidden, true);
      assert.strictEqual(document.querySelector('.sc-check-group--passed').hidden, true);
    `);
  });

  test('only reclassifies EventFlow auth warnings that point to authentication routes', () => {
    const script = read('public/assets/js/pages/admin-debug-mobile-improvements.js');
    expect(script).toContain('AUTH_REDIRECT_PATTERN');
    expect(script).toContain('/^Auth redirect\\b/i');
    expect(script).toContain("result.textContent = 'PROTECTED'");
    expect(script).toContain("status.setAttribute('aria-label', 'Protected route')");
  });

  test('keeps existing text sizes while improving narrow-screen hierarchy', () => {
    const styles = read('public/assets/css/admin-debug-mobile-improvements.css');
    expect(styles).not.toMatch(/font-size\s*:/);
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('.sc-check-groups .sc-check-group {');
    expect(styles).not.toMatch(/^\s*\.sc-check-group(?!s)/m);
    expect(styles).toContain('position: sticky');
    expect(styles).toContain('grid-template-columns: auto minmax(0, 1fr)');
    expect(styles).toContain('.sc-summary-card.sc-summary-card--mobile-enhanced');
    expect(styles).toContain("[class*='floating'][style*='position: fixed']");
  });
});
