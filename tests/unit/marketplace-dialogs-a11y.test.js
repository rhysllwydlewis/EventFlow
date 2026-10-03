/**
 * Marketplace overlays (listing detail, location, create listing): dialog
 * semantics, focus-in/restore, Escape-listener cleanup, and the close-button
 * padding reset that stops `.ef-cta`'s `!important` padding squeezing the ×.
 * marketplace.js is one big IIFE, so the shared helpers are extracted from
 * source and run in a plain node child process under jsdom.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync('public/assets/js/marketplace.js', 'utf8');
const start = src.indexOf('  // Dialog semantics + focus handling');
const end = src.indexOf('  function buildInitialMarketplaceMessage');
const dom = new JSDOM('<!doctype html><body><button id="trigger">Open</button></body>', {
  runScripts: 'outside-only',
});
dom.window.eval(src.slice(start, end) + '\\nwindow.__H = { enhanceDialog, closeModal };');
const doc = dom.window.document;
const { enhanceDialog, closeModal } = dom.window.__H;
const out = {};

const trigger = doc.getElementById('trigger');
trigger.focus();
const overlay = doc.createElement('div');
overlay.innerHTML = '<div><h3 id="t">Title</h3><button class="x">x</button><input id="i"></div>';
doc.body.appendChild(overlay);
let removed = 0;
overlay._cleanup = () => { removed++; };
enhanceDialog(overlay, 't', '#i');
out.role = overlay.getAttribute('role');
out.ariaModal = overlay.getAttribute('aria-modal');
out.labelledBy = overlay.getAttribute('aria-labelledby');
out.focusIn = doc.activeElement.id === 'i';
closeModal(overlay);
closeModal(overlay);
out.cleanupCalls = removed;
out.focusRestored = doc.activeElement === trigger;
console.log(JSON.stringify(out));
`;

describe('marketplace dialogs a11y', () => {
  const out = JSON.parse(
    execFileSync('node', ['-e', SCRIPT], { cwd: path.join(__dirname, '../..') }).toString()
  );
  const js = fs.readFileSync(path.join(__dirname, '../../public/assets/js/marketplace.js'), 'utf8');
  const css = fs.readFileSync(
    path.join(__dirname, '../../public/assets/css/marketplace.css'),
    'utf8'
  );

  test('enhanceDialog sets dialog semantics and moves focus in', () => {
    expect(out.role).toBe('dialog');
    expect(out.ariaModal).toBe('true');
    expect(out.labelledBy).toBe('t');
    expect(out.focusIn).toBe(true);
  });

  test('closeModal runs cleanup once and restores focus', () => {
    expect(out.cleanupCalls).toBe(1);
    expect(out.focusRestored).toBe(true);
  });

  test('all three overlays are wired up with labelled headings', () => {
    expect(js).toMatch(/enhanceDialog\(overlay, 'listing-detail-title'/);
    expect(js).toMatch(/enhanceDialog\(overlay, 'location-modal-title'/);
    expect(js).toMatch(/labelledBy: 'list-item-modal-title'/);
    for (const id of ['listing-detail-title', 'location-modal-title', 'list-item-modal-title']) {
      expect(js).toContain(`id="${id}"`);
    }
  });

  test('.ef-cta close buttons reset padding with !important', () => {
    expect(js).toMatch(/padding: 0 !important;\s*\n\s*width: 32px/);
    expect(css).toMatch(/\.location-modal-close \{[^}]*padding: 0 !important/);
  });
});
