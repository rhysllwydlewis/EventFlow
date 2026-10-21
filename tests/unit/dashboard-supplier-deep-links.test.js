/**
 * Dashboard deep links (P1 item of
 * docs/audits/SUPPLIER_PROFILE_EDITING_CORRECTNESS_HANDOFF.md):
 *
 * The public owner-edit overlay sends suppliers back to
 * /dashboard/supplier#photos and #packages. supplier-dashboard-home.js routes both fragments to
 * their real sections: #photos opens the profile form on the photo drop zone, #packages scrolls
 * to the package list.
 *
 * This exercises the real script in jsdom: load it with each hash present at page load, and
 * confirm it opens the right form and scrolls the right target into view.
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
  <div id="packages-section">
    <div id="my-packages"></div>
  </div>
</body>`;

/** Runs the home script with the given hash and prints what it clicked and scrolled to. */
const scenario = hash => String.raw`
  const { JSDOM } = require('jsdom');
  const fs = require('fs');
  const script = fs.readFileSync('public/assets/js/pages/supplier-dashboard-home.js', 'utf8');
  const dom = new JSDOM(${JSON.stringify(BASE_HTML)}, {
    url: 'https://event-flow.test/dashboard/supplier${hash}',
    runScripts: 'dangerously',
  });
  const { window } = dom;
  const { document } = window;
  window.console.error = () => {};
  window.matchMedia = () => ({ matches: false });

  const scrolled = [];
  window.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  const clicked = [];
  const originalClick = window.HTMLElement.prototype.click;
  window.HTMLElement.prototype.click = function () { clicked.push(this.id || this.className); return originalClick.call(this); };

  window.eval(script);
  document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
  setTimeout(() => process.stdout.write(JSON.stringify({ clicked, scrolled })), 400);
`;

const run = hash => JSON.parse(runNodeSmoke(scenario(hash)));

describe('dashboard-supplier deep links', () => {
  test('#photos opens the profile form and scrolls to the photo drop zone', () => {
    const { clicked, scrolled } = run('#photos');
    expect(clicked).toContain('toggle-profile-form');
    expect(scrolled).toContain('sup-photo-drop');
    // Must not touch the packages section.
    expect(scrolled).not.toContain('my-packages');
  });

  test('#packages scrolls to the package list without opening a form', () => {
    const { clicked, scrolled } = run('#packages');
    expect(scrolled).toContain('my-packages');
    expect(scrolled).not.toContain('sup-photo-drop');
    expect(clicked).toEqual([]);
  });

  test('an unrelated hash does not touch either section', () => {
    const { clicked, scrolled } = run('#reviews');
    expect(clicked).toEqual([]);
    expect(scrolled).toEqual([]);
  });
});
