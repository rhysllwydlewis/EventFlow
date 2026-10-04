/**
 * Quote request modal (marketplace/suppliers): dialog semantics, focus
 * handling, escaping of supplier names, and re-opening after a successful
 * send. The component is an ES module and jsdom is ESM-only under Jest, so
 * the scenario runs in a plain node child process (same approach as
 * gallery-upload-modal-focus.test.js) and reports observations as JSON.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const src = fs
  .readFileSync('public/assets/js/components/quote-request-modal.js', 'utf8')
  .replace(/^import .*$/m, 'const trackQuoteRequestSubmitted = () => {};')
  .replace(/\\n\\/\\/ Initialize on DOM ready[\\s\\S]*$/, '\\nwindow.__Q = QuoteRequestModal;');
const dom = new JSDOM('<!doctype html><body><button id="trigger">Request</button></body>', {
  runScripts: 'outside-only',
});
dom.window.eval(src);
const doc = dom.window.document;
const modal = new dom.window.__Q();
const out = {};
const el = doc.getElementById('quote-request-modal');
out.closedRole = el.getAttribute('role');
out.closedInert = el.hasAttribute('inert');
const label = doc.getElementById(el.getAttribute('aria-labelledby'));
out.label = label && label.textContent;

const trigger = doc.getElementById('trigger');
trigger.focus();
modal.open([{ id: '1', name: '<img src=x onerror=alert(1)>', category: '<b>x</b>' }]);
out.role = el.getAttribute('role');
out.ariaModal = el.getAttribute('aria-modal');
out.openInert = el.hasAttribute('inert');
out.focusOnOpen = doc.activeElement.classList.contains('quote-modal-close-btn');
const list = doc.getElementById('quote-suppliers-list');
out.injectedImg = !!list.querySelector('img');
out.injectedB = !!list.querySelector('b');
out.listText = list.textContent;
doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
out.closedByEscape = modal.isOpen === false;
out.focusRestored = doc.activeElement === trigger;
out.reclosedInert = el.hasAttribute('inert') && !el.hasAttribute('role');

modal.open([{ id: '1', name: 'A' }]);
const sameEl = doc.getElementById('quote-request-modal');
modal.showSuccess(1);
modal.close();
// A late success response after closing must not steal focus back.
trigger.focus();
modal.showSuccess(1);
out.lateSuccessKeepsFocus = doc.activeElement === trigger;
try {
  modal.open([{ id: '2', name: 'B' }]);
  out.reopenOk = true;
} catch (e) {
  out.reopenOk = false;
}
out.sameElement = doc.getElementById('quote-request-modal') === sameEl;
out.modalCount = doc.querySelectorAll('#quote-request-modal').length;
out.formBack = !!doc.getElementById('quote-request-form');
out.reopenList = doc.getElementById('quote-suppliers-list').textContent;
console.log(JSON.stringify(out));
`;

describe('QuoteRequestModal accessibility and robustness', () => {
  let out;
  beforeAll(() => {
    out = JSON.parse(
      execFileSync(process.execPath, ['-e', SCRIPT], {
        cwd: path.join(__dirname, '../..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  });

  test('is inert and role-less while closed (no AT exposure, no observer trap)', () => {
    expect(out.closedRole).toBeNull();
    expect(out.closedInert).toBe(true);
    expect(out.reclosedInert).toBe(true);
  });

  test('exposes dialog semantics labelled by its heading while open', () => {
    expect(out.role).toBe('dialog');
    expect(out.ariaModal).toBe('true');
    expect(out.openInert).toBe(false);
    expect(out.label).toBe('Request Quotes');
  });

  test('success view does not steal focus once closed', () => {
    expect(out.lateSuccessKeepsFocus).toBe(true);
  });

  test('moves focus in on open, Escape closes and restores focus', () => {
    expect(out.focusOnOpen).toBe(true);
    expect(out.closedByEscape).toBe(true);
    expect(out.focusRestored).toBe(true);
  });

  test('escapes supplier names and categories', () => {
    expect(out.injectedImg).toBe(false);
    expect(out.injectedB).toBe(false);
    expect(out.listText).toContain('<img src=x onerror=alert(1)>');
  });

  test('can be re-opened after the success view replaced the form', () => {
    expect(out.reopenOk).toBe(true);
    expect(out.sameElement).toBe(true);
    expect(out.modalCount).toBe(1);
    expect(out.formBack).toBe(true);
    expect(out.reopenList).toContain('B');
  });
});
