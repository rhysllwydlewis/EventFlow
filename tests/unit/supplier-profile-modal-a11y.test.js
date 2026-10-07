/**
 * The public-profile owner-edit modals registered their Escape handler with
 * `{ once: true }`, so the first keypress of any kind (typically Tab) spent it
 * and Escape then stopped closing the dialog. They also had no focus trap,
 * no scroll lock and did not return focus to the control that opened them.
 * They now use the shared EFModalA11y helper.
 *
 * Both halves run in jsdom: the helper's new options on their own, and the
 * real owner-edit script opening its real name modal.
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

describe('EFModalA11y.enhance options', () => {
  test('lockScroll locks the page while open and restores it afterwards', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const dom = new JSDOM('<!doctype html><body style="overflow: auto"><button id="t">open</button></body>', { runScripts: 'dangerously' });
      const { window } = dom;
      window.eval(fs.readFileSync('public/assets/js/utils/modal-a11y.js', 'utf8'));
      const { document } = window;

      const trigger = document.getElementById('t');
      trigger.focus();
      const overlay = document.createElement('div');
      overlay.innerHTML = '<button id="a">a</button><button id="b">b</button>';
      document.body.appendChild(overlay);
      window.EFModalA11y.enhance(overlay, { lockScroll: true });

      if (document.body.style.overflow !== 'hidden') throw new Error('page was not scroll-locked');
      overlay.remove();

      setTimeout(() => {
        if (document.body.style.overflow !== 'auto') throw new Error('overflow not restored: ' + document.body.style.overflow);
        if (document.activeElement !== trigger) throw new Error('focus not returned to the trigger');
        console.log('lockScroll ok');
      }, 20);
    `);
    expect(output).toContain('lockScroll ok');
  });

  test('onEscape replaces the default removal', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' });
      const { window } = dom;
      window.eval(fs.readFileSync('public/assets/js/utils/modal-a11y.js', 'utf8'));
      const { document } = window;

      const overlay = document.createElement('div');
      overlay.innerHTML = '<button>a</button>';
      document.body.appendChild(overlay);
      let calls = 0;
      window.EFModalA11y.enhance(overlay, { onEscape: () => { calls++; } });
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (calls !== 1) throw new Error('onEscape not called');
      if (!overlay.isConnected) throw new Error('overlay was removed despite onEscape');
      console.log('onEscape ok');
    `);
    expect(output).toContain('onEscape ok');
  });
});

describe('supplier profile owner-edit modal', () => {
  test('Escape still closes after Tab, the page is scroll-locked, and focus returns to the trigger', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const dom = new JSDOM(
        '<!doctype html><body>' +
          '<div class="hero-media"></div><h1 id="hero-title">Name</h1>' +
          '<div id="sp-section-about"></div><div id="sp-section-gallery"></div>' +
          '<div id="sp-section-packages"></div><div id="sp-sidebar-details"></div>' +
        '</body>',
        { url: 'https://event-flow.test/supplier/name', runScripts: 'dangerously' }
      );
      const { window } = dom;
      window.__supplierData = { id: 'sup_1', ownerUserId: 'usr_1', name: 'Name', category: 'Photography', bannerUrl: '' };
      window.fetch = async url => {
        if (String(url) === '/api/v1/auth/me') return { ok: true, json: async () => ({ user: { id: 'usr_1' } }) };
        throw new Error('unexpected fetch: ' + url);
      };
      window.eval(fs.readFileSync('public/assets/js/utils/modal-a11y.js', 'utf8'));
      window.eval(fs.readFileSync('public/assets/js/supplier-profile-owner-edit.js', 'utf8'));

      const waitFor = (assertion, timeoutMs = 2000) => new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          try { resolve(assertion()); }
          catch (error) {
            if (Date.now() - started > timeoutMs) reject(error);
            else setTimeout(tick, 10);
          }
        };
        tick();
      });
      const key = (k, extra = {}) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

      (async () => {
        const { document } = window;
        await waitFor(() => { if (!document.querySelector('.sp-name-edit-btn')) throw new Error('edit button never appeared'); });

        const trigger = document.querySelector('.sp-name-edit-btn');
        trigger.focus();
        trigger.click();
        await waitFor(() => { if (!document.querySelector('.sp-modal-overlay')) throw new Error('modal never opened'); });
        await waitFor(() => { if (document.activeElement.id !== 'spBizName') throw new Error('first field not focused'); });

        if (document.body.style.overflow !== 'hidden') throw new Error('page not scroll-locked while modal open');

        // The regression: Tab used to spend the one-shot Escape listener.
        key('Tab');
        key('Tab', { shiftKey: true });

        // Focus trap: Tab from the last control wraps to the first.
        const focusables = [...document.querySelector('.sp-modal-overlay').querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
        focusables[focusables.length - 1].focus();
        key('Tab');
        if (document.activeElement !== focusables[0]) throw new Error('Tab did not wrap to the first control');

        key('Escape');
        await waitFor(() => { if (document.querySelector('.sp-modal-overlay')) throw new Error('Escape did not close the modal after Tab'); });
        await waitFor(() => { if (document.body.style.overflow === 'hidden') throw new Error('scroll lock not released'); });
        await waitFor(() => { if (document.activeElement !== trigger) throw new Error('focus not returned to the trigger'); });

        console.log('owner-edit modal a11y ok');
      })().catch(error => { console.error(error); process.exit(1); });
    `);
    expect(output).toContain('owner-edit modal a11y ok');
  });
});
