/**
 * The Profile Customisation page used to carry two controllers: the external
 * module (public/supplier/js/profile-customization.js) and an inline script in
 * the HTML that re-implemented the colour controls, live preview, completion
 * meter, dirty state and save bar. The external module cloned its controls to
 * strip the inline script's listeners, and because the inline script attached
 * its input listeners 800ms later, its preview output silently overwrote the
 * external module's on every keystroke.
 *
 * One module now owns the page. This loads the real HTML and the real
 * controller in jsdom, the way a browser would, and checks that each
 * interaction happens once and that the module's own output is what is shown.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HTML_PATH = 'public/supplier/profile-customization.html';
const CONTROLLER_PATH = 'public/supplier/js/profile-customization.js';

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('profile customisation page: single controller', () => {
  const html = fs.readFileSync(path.join(__dirname, '../..', HTML_PATH), 'utf8');

  test('the HTML carries no inline controller, only the external module', () => {
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1])
      // The page identifier assignment is configuration, not behaviour.
      .filter(body => body.replace(/window\.__EF_PAGE__\s*=\s*'[^']*';?/, '').trim() !== '');

    for (const body of inlineScripts) {
      expect(body).not.toMatch(/customization-form|updateLivePreview|updateCompletion|markDirty/);
    }
    expect(html).toContain('js/profile-customization.js');
  });

  test('the controller version is cache-busted', () => {
    expect(html).toMatch(/js\/profile-customization\.js\?v=\d/);
  });

  test('every interaction runs once and the module’s own preview is what is shown', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const html = fs.readFileSync(${JSON.stringify(HTML_PATH)}, 'utf8');
      const controller = fs.readFileSync(${JSON.stringify(CONTROLLER_PATH)}, 'utf8');

      // runScripts:'dangerously' executes any inline script, as a browser would.
      // Subresources are not fetched, so the external module is evaluated by hand.
      const dom = new JSDOM(html, { url: 'https://event-flow.test/supplier/profile-customization', runScripts: 'dangerously' });
      const { window } = dom;
      const { document } = window;

      const patches = [];
      window.__CSRF_TOKEN__ = 'csrf-token';
      window.fetch = async (url, options = {}) => {
        const u = String(url);
        if (u === '/api/v1/auth/me') return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'supplier' } }) };
        if (u === '/api/me/suppliers') {
          return { ok: true, status: 200, json: async () => ({ items: [{ id: 'sup_1', name: 'Acme Events', bannerUrl: '', tagline: '', themeColor: '', highlights: [], featuredServices: [], socialLinks: {} }] }) };
        }
        if (u.startsWith('/api/me/suppliers/sup_1') && options.method === 'PATCH') {
          patches.push(JSON.parse(options.body));
          return { ok: true, status: 200, json: async () => ({ ok: true, supplier: { id: 'sup_1' } }) };
        }
        throw new Error('unexpected fetch: ' + u);
      };
      window.eval(controller);

      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (assertion, timeoutMs = 3000) => {
        const started = Date.now();
        for (;;) {
          try { return assertion(); }
          catch (error) {
            if (Date.now() - started > timeoutMs) throw error;
            await sleep(25);
          }
        }
      };
      const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));

      (async () => {
        await waitFor(() => { if (!document.querySelector('#preview-name').textContent.includes('Acme')) throw new Error('supplier never loaded'); });
        // Long enough for a late-attached duplicate controller to have run.
        await sleep(1200);

        // 1. The module's empty-state placeholder survives (a duplicate controller wiped it).
        const highlights = document.getElementById('preview-highlights');
        if (!highlights.querySelector('.pc-preview-placeholder')) throw new Error('highlights placeholder missing: ' + highlights.innerHTML);

        // 2. Typing updates the preview, once, with the module's own output.
        const hl = document.getElementById('sup-highlight-1');
        hl.value = 'Award-winning service';
        fire(hl, 'input');
        await sleep(50);
        if (highlights.querySelectorAll('.pc-preview-highlight').length !== 1) throw new Error('expected one highlight, got: ' + highlights.innerHTML);

        // 3. Social links render as real brand icons, not single letters.
        const fb = document.getElementById('sup-social-facebook');
        fb.value = 'facebook.com/acme';
        fire(fb, 'input');
        await sleep(50);
        const dots = document.getElementById('preview-social-dots');
        if (dots.children.length !== 1) throw new Error('expected one social dot, got: ' + dots.innerHTML);
        if (!dots.querySelector('svg')) throw new Error('social dot is not an icon: ' + dots.innerHTML);

        // 4. A colour preset marks the form dirty and shows the save bar.
        const preset = document.querySelectorAll('.color-preset')[1];
        preset.click();
        await sleep(50);
        if (!document.body.classList.contains('pc-has-unsaved')) throw new Error('form not marked dirty');
        if (!document.getElementById('pc-save-bar').classList.contains('pc-save-bar--visible')) throw new Error('save bar not shown');
        if (!preset.classList.contains('active')) throw new Error('preset not marked active');

        // 5. One save click sends exactly one PATCH.
        document.getElementById('pc-save-bar-save').click();
        await waitFor(() => { if (patches.length < 1) throw new Error('no PATCH sent'); });
        await sleep(500);
        if (patches.length !== 1) throw new Error('expected 1 PATCH, got ' + patches.length);
        if (patches[0].themeMode !== 'custom') throw new Error('chosen colour was not saved as custom');
        await waitFor(() => { if (document.body.classList.contains('pc-has-unsaved')) throw new Error('still dirty after save'); });

        // 6. Discard restores the saved values and clears the dirty state.
        hl.value = 'Something unsaved';
        fire(hl, 'input');
        await sleep(50);
        if (!document.body.classList.contains('pc-has-unsaved')) throw new Error('edit not marked dirty');
        document.getElementById('pc-save-bar-discard').click();
        await sleep(50);
        if (document.body.classList.contains('pc-has-unsaved')) throw new Error('discard left the form dirty');

        console.log('single controller ok');
        process.exit(0);
      })().catch(error => { console.error(error); process.exit(1); });
    `);
    expect(output).toContain('single controller ok');
  });
});
