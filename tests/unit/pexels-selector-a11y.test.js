/**
 * Pexels photo selector (admin-locations, supplier profile customization):
 * dialog semantics, focus handling and Escape-to-close via EFModalA11y.
 * Runs in a plain node child process because jsdom is ESM-only under Jest.
 */

'use strict';

const { execFileSync } = require('child_process');

const SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body><button id="trigger">Pick</button></body>', {
  runScripts: 'outside-only',
});
dom.window.eval(fs.readFileSync('public/assets/js/utils/modal-a11y.js', 'utf8'));
dom.window.eval(fs.readFileSync('public/assets/js/components/pexels-selector.js', 'utf8'));
const doc = dom.window.document;
const out = {};
const Cls = dom.window.PexelsSelector || dom.window.eval('typeof PexelsSelector !== "undefined" ? PexelsSelector : null');
const sel = new Cls();
sel.fetchCuratedContent = () => {};
doc.getElementById('trigger').focus();
sel.open(() => {});
const w = doc.querySelector('.pexels-modal-wrapper');
out.role = w.getAttribute('role');
out.ariaModal = w.getAttribute('aria-modal');
out.label = doc.getElementById(w.getAttribute('aria-labelledby')).textContent;
out.focus = doc.activeElement.className;
doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
out.removed = !doc.querySelector('.pexels-modal-wrapper');
setTimeout(() => {
  out.restored = doc.activeElement.id;
  console.log(JSON.stringify(out));
}, 10);
`;

describe('pexels selector dialog accessibility', () => {
  test('has dialog semantics, focuses search, closes on Escape and restores focus', () => {
    const out = JSON.parse(execFileSync('node', ['-e', SCRIPT], { encoding: 'utf8' }));
    expect(out.role).toBe('dialog');
    expect(out.ariaModal).toBe('true');
    expect(out.label).toBe('Select Stock Photo');
    expect(out.focus).toBe('search-field');
    expect(out.removed).toBe(true);
    expect(out.restored).toBe('trigger');
  });
});
