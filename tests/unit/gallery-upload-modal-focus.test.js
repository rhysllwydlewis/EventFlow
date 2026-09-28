/**
 * Upload-modal focus trap (see PR #1707's follow-up,
 * https://github.com/rhysllwydlewis/EventFlow/issues/1716):
 *
 * `syncModalAccessibility()` in gallery-init.js schedules a focus-into-modal
 * via `setTimeout(..., 0)` on open, with no cancellation if the modal closes
 * again before that macrotask runs — a fast open/close could still steal
 * focus back into the now-hidden modal, clobbering the restore-to-trigger
 * that had just happened on close. Its `MutationObserver` also only reacted
 * to whether *any* attribute mutation happened, not to whether visibility
 * actually changed, so an unrelated future class toggle on the modal would
 * re-capture `document.activeElement` and re-arm that same timeout,
 * overriding wherever focus already was inside the modal.
 *
 * This exercises the real script in jsdom, driving the modal purely through
 * the `visible` class toggle the script itself watches (its actual
 * accessibility trigger), rather than the full upload UI.
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
  <button id="triggerBtn">Open</button>
  <div id="dropzone"></div>
  <input id="fileInput" type="file" />
  <span id="fileCount"></span>
  <button id="uploadBtn"></button>
  <div id="emptyState"></div>
  <select id="filterStatus"></select>
  <select id="filterType"></select>
  <div id="galleryGrid"></div>
  <div id="lightbox">
    <img id="lightboxImage" />
    <button id="lightboxClose"></button>
    <button id="lightboxPrev"></button>
    <button id="lightboxNext"></button>
  </div>
  <div id="loading"></div>
  <span id="photoCount"></span>
  <div id="progressContainer"><div id="progressFill"></div></div>
  <button id="browseFilesBtn"></button>
  <div id="uploadModal">
    <h2 id="uploadModalTitle">Upload</h2>
    <button id="modalFirstFocusable">First</button>
    <select id="uploadTarget"></select>
    <button id="modalClose">Close</button>
    <button id="modalCancel">Cancel</button>
    <button id="modalConfirm">Confirm</button>
  </div>
</body>`;

// jsdom has no layout engine, so getClientRects() is always empty — the
// script's own focusable-element filter would treat every element as
// invisible without this, unrelated to the bug under test.
const PATCH_CLIENT_RECTS = `window.Element.prototype.getClientRects = function () { return [1]; };`;

describe('gallery upload modal — focus trap timing', () => {
  test('closing before the open-focus timeout fires does not steal focus back into the hidden modal', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/pages/gallery-init.js', 'utf8');
      const dom = new JSDOM(${JSON.stringify(BASE_HTML)}, {
        url: 'https://event-flow.test/gallery',
        runScripts: 'dangerously',
      });
      const { window } = dom;
      const { document } = window;

      ${PATCH_CLIENT_RECTS}
      window.alert = () => {};
      window.fetch = () => Promise.resolve({ ok: false });

      dom.window.eval(script);

      const triggerBtn = document.getElementById('triggerBtn');
      const uploadModal = document.getElementById('uploadModal');
      triggerBtn.focus();

      (async () => {
        // Open, then close again on the very next microtask — well before
        // the open branch's setTimeout(..., 0) has had a chance to run.
        uploadModal.classList.add('visible');
        await new Promise(resolve => queueMicrotask(resolve));
        uploadModal.classList.remove('visible');
        await new Promise(resolve => queueMicrotask(resolve));

        // Flush macrotasks so the stale open-focus timeout, if unguarded,
        // would fire here.
        await new Promise(resolve => window.setTimeout(resolve, 10));

        if (document.activeElement.id !== 'triggerBtn') {
          throw new Error(
            'expected focus to remain restored on the trigger, but it moved to: ' +
              document.activeElement.id
          );
        }
        console.log('focus race smoke passed');
      })().catch(err => {
        console.error(err.stack || String(err));
        process.exit(1);
      });
    `);

    expect(output).toContain('focus race smoke passed');
  });

  test('an unrelated class mutation while open does not recapture focus', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/pages/gallery-init.js', 'utf8');
      const dom = new JSDOM(${JSON.stringify(BASE_HTML)}, {
        url: 'https://event-flow.test/gallery',
        runScripts: 'dangerously',
      });
      const { window } = dom;
      const { document } = window;

      ${PATCH_CLIENT_RECTS}
      window.alert = () => {};
      window.fetch = () => Promise.resolve({ ok: false });

      dom.window.eval(script);

      const triggerBtn = document.getElementById('triggerBtn');
      const uploadModal = document.getElementById('uploadModal');
      const modalConfirm = document.getElementById('modalConfirm');
      triggerBtn.focus();

      (async () => {
        uploadModal.classList.add('visible');
        await new Promise(resolve => window.setTimeout(resolve, 10));

        // Simulate the supplier having tabbed away from the initial
        // auto-focused element to somewhere else inside the still-open modal.
        modalConfirm.focus();

        // A class mutation unrelated to 'visible' (attributeFilter only
        // narrows to the whole 'class' attribute, not this specific token).
        uploadModal.classList.add('shake');
        await new Promise(resolve => window.setTimeout(resolve, 10));

        if (document.activeElement.id !== 'modalConfirm') {
          throw new Error(
            'expected focus to stay where the supplier left it, but it moved to: ' +
              document.activeElement.id
          );
        }
        console.log('overbroad mutation smoke passed');
      })().catch(err => {
        console.error(err.stack || String(err));
        process.exit(1);
      });
    `);

    expect(output).toContain('overbroad mutation smoke passed');
  });
});
