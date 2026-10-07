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

describe('EFModalA11y.enhance dialog stacking and focus restore', () => {
  const run = body =>
    runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const dom = new JSDOM('<!doctype html><body><button id="t">open</button></body>', { runScripts: 'dangerously' });
      const { window } = dom;
      window.eval(fs.readFileSync('public/assets/js/utils/modal-a11y.js', 'utf8'));
      const { document } = window;
      const esc = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const mount = html => { const el = document.createElement('div'); el.innerHTML = html; document.body.appendChild(el); return el; };
      ${body}
    `);

  test('restoreFocus targets the replacement when the trigger was rerendered away', () => {
    const output = run(String.raw`
      const trigger = document.getElementById('t');
      trigger.focus();
      const overlay = mount('<button>a</button>');
      window.EFModalA11y.enhance(overlay, { restoreFocus: () => document.querySelector('#t') });
      // A save rerenders the section: the original trigger is replaced.
      const fresh = document.createElement('button');
      fresh.id = 't';
      trigger.replaceWith(fresh);
      overlay.remove();
      setTimeout(() => {
        if (document.activeElement !== fresh) throw new Error('focus did not go to the replacement trigger');
        console.log('restoreFocus ok');
      }, 20);
    `);
    expect(output).toContain('restoreFocus ok');
  });

  test('Escape is left to a dialog that opened after this one', () => {
    const output = run(String.raw`
      // Like the keyboard shortcuts help: present but hidden when we open.
      const other = mount('<div role="dialog" id="other" style="display:none"><button>x</button></div>').firstChild;
      const overlay = mount('<button>a</button>');
      let closed = 0, otherSaw = 0;
      window.EFModalA11y.enhance(overlay, { onEscape: () => { closed++; } });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') otherSaw++; });

      other.style.display = 'flex';
      esc();
      if (closed !== 0) throw new Error('closed the dialog underneath');
      if (otherSaw !== 1) throw new Error('the dialog on top never received Escape');

      other.style.display = 'none';
      esc();
      if (closed !== 1) throw new Error('did not close once the other dialog was gone');
      console.log('yield ok');
    `);
    expect(output).toContain('yield ok');
  });

  test('a dialog that was already open beforehand does not block Escape', () => {
    const output = run(String.raw`
      // Like a cookie banner: visible before this dialog opens.
      mount('<div role="dialog" aria-modal="true" id="banner"><button>ok</button></div>');
      const overlay = mount('<button>a</button>');
      let closed = 0;
      window.EFModalA11y.enhance(overlay, { onEscape: () => { closed++; } });
      esc();
      if (closed !== 1) throw new Error('an already-open banner blocked Escape');
      console.log('banner ok');
    `);
    expect(output).toContain('banner ok');
  });

  test('with two enhanced overlays only the topmost handles Escape', () => {
    const output = run(String.raw`
      const first = mount('<button>a</button>');
      const second = mount('<button>b</button>');
      const closed = [];
      window.EFModalA11y.enhance(first, { onEscape: () => closed.push('first') });
      window.EFModalA11y.enhance(second, { onEscape: () => { closed.push('second'); second.remove(); } });
      esc();
      if (closed.join() !== 'second') throw new Error('wrong overlay handled Escape: ' + closed.join());
      setTimeout(() => {
        esc();
        if (closed.join() !== 'second,first') throw new Error('first overlay not handled after second closed: ' + closed.join());
        console.log('stack ok');
      }, 20);
    `);
    expect(output).toContain('stack ok');
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

  test('focus returns to the replacement edit button when a save rerendered the trigger away', () => {
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

      (async () => {
        const { document } = window;
        await waitFor(() => { if (!document.querySelector('.sp-name-edit-btn')) throw new Error('edit button never appeared'); });

        const trigger = document.querySelector('.sp-name-edit-btn');
        trigger.focus();
        trigger.click();
        await waitFor(() => { if (!document.querySelector('.sp-modal-overlay')) throw new Error('modal never opened'); });

        // What a successful save does: rerender the section, replacing the trigger.
        const fresh = trigger.cloneNode(true);
        trigger.replaceWith(fresh);

        document.querySelector('.js-modal-cancel').click();
        await waitFor(() => { if (document.querySelector('.sp-modal-overlay')) throw new Error('modal did not close'); });
        await waitFor(() => { if (document.activeElement !== fresh) throw new Error('focus did not go to the replacement edit button'); });

        console.log('replacement focus ok');
      })().catch(error => { console.error(error); process.exit(1); });
    `);
    expect(output).toContain('replacement focus ok');
  });
});
