/**
 * Supplier page lightbox: dialog semantics, Escape-to-close, scroll-lock and
 * key-listener cleanup. Runs in a plain node child process (jsdom is ESM-only).
 */

'use strict';

const { execFileSync } = require('child_process');

const SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body><button id="trigger">Open</button></body>', {
  runScripts: 'outside-only',
});
const w = dom.window;
w.eval(fs.readFileSync('public/assets/js/utils/modal-a11y.js', 'utf8'));
const src = fs.readFileSync('public/assets/js/app.js', 'utf8');
const m = src.match(/function openLightbox[\\s\\S]*?\\n}\\n/);
w.eval('function escapeHtml(s){return String(s).replace(/&/g,"&amp;")}' + m[0] + ';window.openLightbox=openLightbox;');
const doc = w.document;
const out = {};
doc.getElementById('trigger').focus();
w.openLightbox(['/a.jpg?x=1&y=2', '/b.jpg'], 0);
const lb = doc.querySelector('.lightbox-modal');
out.role = lb.getAttribute('role');
out.modal = lb.getAttribute('aria-modal');
out.label = lb.getAttribute('aria-label');
out.overflow = doc.body.style.overflow;
doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
out.src = lb.querySelector('.lightbox-image').getAttribute('src');
doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
out.removed = !doc.querySelector('.lightbox-modal');
setTimeout(() => {
  out.overflowAfter = doc.body.style.overflow;
  out.restored = doc.activeElement.id;
  console.log(JSON.stringify(out));
}, 10);
`;

describe('supplier photo lightbox accessibility', () => {
  test('is a labelled dialog, closes on Escape, unlocks scroll, restores focus', () => {
    const out = JSON.parse(execFileSync('node', ['-e', SCRIPT], { encoding: 'utf8' }));
    expect(out.role).toBe('dialog');
    expect(out.modal).toBe('true');
    expect(out.label).toBe('Photo gallery');
    expect(out.overflow).toBe('hidden');
    expect(out.src).toBe('/b.jpg');
    expect(out.removed).toBe(true);
    expect(out.overflowAfter).toBe('');
    expect(out.restored).toBe('trigger');
  });
});
