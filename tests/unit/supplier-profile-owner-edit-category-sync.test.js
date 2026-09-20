/**
 * The public-profile owner-edit overlay's name/category modal had two bugs:
 *
 * 1. After a save it merged the *outbound patch* onto window.__supplierData
 *    instead of the server's canonical response, so server-side
 *    normalisation/derived fields (and anything the server unset) never
 *    reached the client.
 * 2. A category change only rerendered the hero section, leaving the
 *    sidebar's category display and the automatic theme (both
 *    category-dependent) stale until the next full page load.
 *
 * This exercises the real script in jsdom end to end: open the modal, change
 * the category, save, and confirm both are fixed.
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

describe('supplier profile owner-edit: category save', () => {
  test('merges the canonical server response and rerenders every category-dependent section', () => {
    const output = runNodeSmoke(String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const script = fs.readFileSync('public/assets/js/supplier-profile-owner-edit.js', 'utf8');
      const dom = new JSDOM(
        '<!doctype html><body>' +
          '<div class="hero-media"></div>' +
          '<h1 id="hero-title">Old Name</h1>' +
          '<div id="sp-section-about"></div>' +
          '<div id="sp-section-gallery"></div>' +
          '<div id="sp-section-packages"></div>' +
          '<div id="sp-sidebar-details"></div>' +
        '</body>',
        { url: 'https://event-flow.test/supplier/old-name', runScripts: 'dangerously' }
      );
      const { window } = dom;

      window.__supplierData = {
        id: 'sup_1',
        ownerUserId: 'usr_1',
        name: 'Old Name',
        category: 'Photography',
        bannerUrl: '',
      };

      const rerenderCalls = [];
      window.__spRerender = {
        hero: () => rerenderCalls.push('hero'),
        about: () => rerenderCalls.push('about'),
        gallery: () => rerenderCalls.push('gallery'),
        sidebar: () => rerenderCalls.push('sidebar'),
        badges: () => rerenderCalls.push('badges'),
        all: () => rerenderCalls.push('all'),
      };

      const patchCalls = [];
      window.fetch = async (url, options = {}) => {
        if (String(url) === '/api/v1/auth/me') {
          return { ok: true, json: async () => ({ user: { id: 'usr_1' } }) };
        }
        if (String(url).includes('/api/me/suppliers/sup_1')) {
          patchCalls.push(JSON.parse(options.body));
          // The canonical response includes server-side normalisation the
          // outbound patch never had: a geocoded/derived field the request
          // didn't send, proving the client must use this, not the patch.
          return {
            ok: true,
            json: async () => ({
              ok: true,
              supplier: {
                id: 'sup_1',
                ownerUserId: 'usr_1',
                name: 'New Name',
                category: 'Venues',
                bannerUrl: '',
                updatedAt: '2027-01-01T00:00:00.000Z',
              },
            }),
          };
        }
        throw new Error('unexpected fetch: ' + url);
      };

      dom.window.eval(script);

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

        await waitFor(() => {
          if (!document.querySelector('.sp-name-edit-btn')) throw new Error('name edit button never appeared (boot() did not run)');
        });

        document.querySelector('.sp-name-edit-btn').click();

        await waitFor(() => {
          if (!document.querySelector('#spCategory')) throw new Error('category modal never opened');
        });

        const categorySelect = document.querySelector('#spCategory');
        if (categorySelect.tagName !== 'SELECT') throw new Error('category field is not a canonical <select> (still free text)');
        if (![...categorySelect.options].some(o => o.value === 'Venues')) throw new Error('Venues option missing from category select');

        document.querySelector('#spBizName').value = 'New Name';
        categorySelect.value = 'Venues';

        document.querySelector('.js-modal-save').click();

        await waitFor(() => {
          if (patchCalls.length !== 1) throw new Error('PATCH was not sent');
        });

        await waitFor(() => {
          if (rerenderCalls.length === 0) throw new Error('no rerender happened yet');
        });

        if (patchCalls[0].category !== 'Venues') throw new Error('wrong category sent in patch');

        // Bug 1: must reflect the canonical response, not the outbound patch.
        if (window.__supplierData.updatedAt !== '2027-01-01T00:00:00.000Z') {
          throw new Error('client data was not merged from the canonical server response');
        }

        // Bug 2: a category change must rerender every category-dependent
        // section (hero + sidebar + theme), not just the hero.
        if (!rerenderCalls.includes('all')) {
          throw new Error('category save did not trigger a full rerender (sidebar/theme left stale): ' + JSON.stringify(rerenderCalls));
        }

        console.log('owner-edit category sync smoke passed');
      })().catch(error => { console.error(error); process.exit(1); });
    `);

    expect(output).toContain('owner-edit category sync smoke passed');
  });
});
