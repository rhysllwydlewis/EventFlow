/**
 * Dashboard deep links (P1 item of
 * docs/audits/SUPPLIER_PROFILE_EDITING_CORRECTNESS_HANDOFF.md):
 *
 * The public owner-edit overlay sends suppliers back to
 * /dashboard-supplier#photos and #packages, but neither fragment ever
 * matched a real element id on the dashboard page — the browser landed
 * with no scroll and the supplier had to hunt for the right card
 * themselves. dashboard-supplier-actions.js now routes both fragments to
 * their real sections, expanding a collapsed card first where needed.
 *
 * This exercises the real script in jsdom: load it with each hash present
 * at page load, and confirm it expands the right collapsed section and
 * scrolls the right target into view.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const BASE_HTML = `<!doctype html><body>
  <div id="profile-form-section" class="form-section-collapsible">
    <button type="button" id="toggle-profile-form" aria-expanded="false"></button>
    <div class="form-row">
      <div id="sup-photo-drop" class="photo-drop-zone">Drag &amp; drop</div>
    </div>
    <input id="sup-name" />
  </div>
  <div id="packages-section" class="card sd-card" data-default-expanded="true">
    <button type="button" class="card-collapse-btn" aria-expanded="false"></button>
    <div id="my-packages" class="section"></div>
  </div>
</body>`;

describe('dashboard-supplier deep links', () => {
  test('#photos expands the profile form and scrolls to the photo drop zone', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/pages/dashboard-supplier-actions.js', 'utf8');
      const dom = new JSDOM(${JSON.stringify(BASE_HTML)}, {
        url: 'https://event-flow.test/dashboard-supplier#photos',
        runScripts: 'dangerously',
      });
      const { window } = dom;
      const { document } = window;

      const scrolled = [];
      window.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
      const clicked = [];
      const originalClick = window.HTMLElement.prototype.click;
      window.HTMLElement.prototype.click = function () { clicked.push(this.id); return originalClick.call(this); };

      dom.window.eval(script);
      document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

      if (!clicked.includes('toggle-profile-form')) {
        throw new Error('#photos did not expand the collapsed profile form: ' + JSON.stringify(clicked));
      }
      if (!scrolled.includes('sup-photo-drop')) {
        throw new Error('#photos did not scroll to the photo drop zone: ' + JSON.stringify(scrolled));
      }
      // Must not touch the unrelated packages card.
      if (clicked.some(id => id.includes('package'))) {
        throw new Error('#photos unexpectedly touched the packages card');
      }

      console.log('dashboard photos deep link smoke passed');
    `);

    expect(output).toContain('dashboard photos deep link smoke passed');
  });

  test('#packages expands the collapsed packages card and scrolls to the package list', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/pages/dashboard-supplier-actions.js', 'utf8');
      const dom = new JSDOM(${JSON.stringify(BASE_HTML)}, {
        url: 'https://event-flow.test/dashboard-supplier#packages',
        runScripts: 'dangerously',
      });
      const { window } = dom;
      const { document } = window;

      const scrolled = [];
      window.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
      const clicked = [];
      const originalClick = window.HTMLElement.prototype.click;
      window.HTMLElement.prototype.click = function () { clicked.push(this.className); return originalClick.call(this); };

      dom.window.eval(script);
      document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

      if (!clicked.includes('card-collapse-btn')) {
        throw new Error('#packages did not expand the collapsed packages card: ' + JSON.stringify(clicked));
      }
      if (!scrolled.includes('my-packages')) {
        throw new Error('#packages did not scroll to the package list: ' + JSON.stringify(scrolled));
      }
      if (scrolled.includes('sup-photo-drop')) {
        throw new Error('#packages unexpectedly touched the photo drop zone');
      }

      console.log('dashboard packages deep link smoke passed');
    `);

    expect(output).toContain('dashboard packages deep link smoke passed');
  });

  test('an unrelated hash does not touch either section', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/pages/dashboard-supplier-actions.js', 'utf8');
      const dom = new JSDOM(${JSON.stringify(BASE_HTML)}, {
        url: 'https://event-flow.test/dashboard-supplier#reviews',
        runScripts: 'dangerously',
      });
      const { window } = dom;
      const { document } = window;

      const scrolled = [];
      window.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
      const clicked = [];
      const originalClick = window.HTMLElement.prototype.click;
      window.HTMLElement.prototype.click = function () { clicked.push(this.id || this.className); return originalClick.call(this); };

      dom.window.eval(script);
      document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

      if (clicked.length > 0 || scrolled.length > 0) {
        throw new Error('an unrelated hash should not click or scroll anything: ' + JSON.stringify({ clicked, scrolled }));
      }

      console.log('dashboard unrelated hash smoke passed');
    `);

    expect(output).toContain('dashboard unrelated hash smoke passed');
  });
});
