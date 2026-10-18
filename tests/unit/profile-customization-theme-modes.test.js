/**
 * The Profile Customisation page offers the same three theme modes the public
 * profile resolves (automatic, preset, custom), shows what the saved theme
 * actually looks like, and saves exactly the fields the server's PATCH contract
 * expects for the chosen mode.
 *
 * Before this the page only knew custom colours: a preset or automatic supplier
 * opened as default teal, and any theme change was saved as `custom`. This loads
 * the real HTML, the shared theme module and the real controller in jsdom, the
 * way the browser does.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { buildSupplierThemeMutation } = require('../../utils/supplierTheme');

const HTML_PATH = 'public/supplier/profile-customization.html';
const CONTROLLER_PATH = 'public/supplier/js/profile-customization.js';
const THEME_CORE_PATH = 'public/assets/js/shared/supplier-theme-core.js';

/**
 * Runs `scenario` against the page with `supplier` loaded. The scenario receives
 * { window, document, core, patches, save, sleep } and returns JSON-able data.
 * @param {Object} supplier The supplier record the page loads.
 * @param {string} scenario Source of an async function body.
 * @returns {{result: *, patches: Object[]}} What the scenario returned and every PATCH body sent.
 */
function runPage(supplier, scenario) {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      String.raw`
      const { JSDOM } = require('jsdom');
      const fs = require('fs');
      const html = fs.readFileSync(${JSON.stringify(HTML_PATH)}, 'utf8');
      const controller = fs.readFileSync(${JSON.stringify(CONTROLLER_PATH)}, 'utf8');
      const themeCore = fs.readFileSync(${JSON.stringify(THEME_CORE_PATH)}, 'utf8');
      const supplier = ${JSON.stringify({ id: 'sup_1', name: 'Acme Events', ...supplier })};

      const dom = new JSDOM(html, { url: 'https://event-flow.test/supplier/profile-customization', runScripts: 'dangerously' });
      const { window } = dom;
      const { document } = window;

      const patches = [];
      window.__CSRF_TOKEN__ = 'csrf-token';
      window.fetch = async (url, options = {}) => {
        const u = String(url);
        if (u === '/api/v1/auth/me') return { ok: true, status: 200, json: async () => ({ user: { id: 'u1', role: 'supplier' } }) };
        if (u === '/api/me/suppliers') return { ok: true, status: 200, json: async () => ({ items: [supplier] }) };
        if (u.startsWith('/api/me/suppliers/sup_1') && options.method === 'PATCH') {
          patches.push(JSON.parse(options.body));
          return { ok: true, status: 200, json: async () => ({ ok: true, supplier: { id: 'sup_1' } }) };
        }
        throw new Error('unexpected fetch: ' + u);
      };
      window.eval(themeCore);
      window.eval(controller);

      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const core = window.EFSupplierTheme;
      const save = async () => {
        const before = patches.length;
        document.getElementById('pc-save-bar-save').click();
        for (let i = 0; i < 100 && patches.length === before; i++) await sleep(25);
        if (patches.length === before) throw new Error('no PATCH sent');
        await sleep(100);
      };
      // jsdom normalises colours when they are assigned, so compare like with like.
      const paint = value => { const el = document.createElement('div'); el.style.background = value; return el.style.background; };
      const paintColour = value => { const el = document.createElement('div'); el.style.color = value; return el.style.color; };

      (async () => {
        for (let i = 0; i < 120 && !document.querySelector('#preview-name').textContent.includes('Acme'); i++) await sleep(25);
        const result = await (async () => { ${scenario} })();
        console.log('RESULT:' + JSON.stringify({ result, patches }));
        process.exit(0);
      })().catch(error => { console.error(error); process.exit(1); });
    `,
    ],
    {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return JSON.parse(output.split('RESULT:')[1]);
}

const PAGE_STATE = String.raw`
  const checked = document.querySelector('input[name="themeMode"]:checked');
  const visiblePanels = ['automatic', 'preset', 'custom'].filter(m => !document.getElementById('pc-theme-panel-' + m).hidden);
  const activePreset = document.querySelector('.pc-theme-preset.active');
`;

describe('profile customisation theme modes', () => {
  test('a legacy preset record opens as its preset, not default teal, and saves untouched', () => {
    const { result, patches } = runPage(
      { heroPreset: 'midnight', category: 'Venues' },
      String.raw`
        ${PAGE_STATE}
        const out = {
          mode: checked && checked.value,
          visiblePanels,
          activePreset: activePreset && activePreset.dataset.preset,
          presetCount: document.querySelectorAll('.pc-theme-preset').length,
          bannerMatchesPreset: document.getElementById('preview-banner').style.background === paint(core.HERO_PRESET_GRADIENTS.midnight),
        };
        // An unrelated edit must not rewrite the theme.
        const tagline = document.getElementById('sup-tagline');
        tagline.value = 'New tagline';
        tagline.dispatchEvent(new window.Event('input', { bubbles: true }));
        await save();
        return out;
      `
    );

    expect(result).toEqual({
      mode: 'preset',
      visiblePanels: ['preset'],
      activePreset: 'midnight',
      presetCount: require('../../utils/supplierTheme').HERO_PRESETS.length,
      bannerMatchesPreset: true,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]).not.toHaveProperty('themeMode');
    expect(patches[0]).not.toHaveProperty('themeColor');
    expect(patches[0]).not.toHaveProperty('heroPreset');
  });

  test('an automatic supplier previews its category colour and says so', () => {
    const { result } = runPage(
      { category: 'Photography', themeColor: '#EC4899', themeMode: 'automatic' },
      String.raw`
        ${PAGE_STATE}
        const services = document.getElementById('sup-featured-services');
        services.value = 'Portraits';
        services.dispatchEvent(new window.Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          mode: checked && checked.value,
          visiblePanels,
          note: document.getElementById('pc-theme-auto-note').textContent,
          bannerMatchesCategoryArtwork: document.getElementById('preview-banner').style.background === paint(core.CATEGORY_HERO_GRADIENTS.photography),
          tagColourMatches: document.querySelector('.pc-preview-tag').style.color === paintColour('#1A3A5C'),
        };
      `
    );

    expect(result.mode).toBe('automatic');
    expect(result.visiblePanels).toEqual(['automatic']);
    expect(result.note).toContain('Photography');
    expect(result.bannerMatchesCategoryArtwork).toBe(true);
    expect(result.tagColourMatches).toBe(true);
  });

  test('each mode saves the fields the server expects for that mode and nothing stale', () => {
    const { result, patches } = runPage(
      { category: 'Venues', themeMode: 'custom', themeColor: '#EC4899' },
      String.raw`
        ${PAGE_STATE}
        const steps = {};
        // custom -> preset: defaults to the first preset, then a chosen one.
        document.querySelector('input[name="themeMode"][value="preset"]').click();
        await save();
        document.querySelector('.pc-theme-preset[data-preset="ocean"]').click();
        await save();
        // preset -> automatic: no colour or preset sent.
        document.querySelector('input[name="themeMode"][value="automatic"]').click();
        await save();
        // automatic -> custom: seeds from the colour shown now (the category accent).
        document.querySelector('input[name="themeMode"][value="custom"]').click();
        steps.seededColour = document.getElementById('sup-theme-color-hex').value;
        await save();
        // a swatch click is a custom choice.
        document.querySelector('.color-preset[data-color="#3B82F6"]').click();
        await save();
        return steps;
      `
    );

    expect(patches.map(patch => patch.themeMode)).toEqual([
      'preset',
      'preset',
      'automatic',
      'custom',
      'custom',
    ]);
    expect(patches[0].heroPreset).toBe(require('../../utils/supplierTheme').HERO_PRESETS[0].id);
    expect(patches[1].heroPreset).toBe('ocean');
    expect(patches[2]).not.toHaveProperty('themeColor');
    expect(patches[2]).not.toHaveProperty('heroPreset');
    expect(patches[3]).not.toHaveProperty('heroPreset');
    expect(patches[3].themeColor).toBe(result.seededColour);
    expect(result.seededColour).toBe('#4A5568'); // Venues category accent
    expect(patches[4].themeColor).toBe('#3B82F6');

    // Every payload the page can produce is accepted by the server contract.
    for (const patch of patches) {
      expect(buildSupplierThemeMutation(patch, {}).error).toBeUndefined();
    }
  });

  test('discarding restores the saved theme, including its mode', () => {
    const { result } = runPage(
      { heroPreset: 'forest' },
      String.raw`
        document.querySelector('input[name="themeMode"][value="custom"]').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        document.getElementById('pc-save-bar-discard').click();
        await new Promise(resolve => setTimeout(resolve, 50));
        ${PAGE_STATE}
        return { mode: checked && checked.value, activePreset: activePreset && activePreset.dataset.preset };
      `
    );

    expect(result).toEqual({ mode: 'preset', activePreset: 'forest' });
  });
  test('typing a hex colour is not overwritten half-way and only a valid colour is saved', () => {
    const { result, patches } = runPage(
      { themeMode: 'custom', themeColor: '#0B8073' },
      String.raw`
        const hex = document.getElementById('sup-theme-color-hex');
        hex.value = '#12';
        hex.dispatchEvent(new window.Event('input', { bubbles: true }));
        await sleep(50);
        const partial = { value: hex.value, dirty: document.body.classList.contains('pc-has-unsaved') };
        hex.value = '#123456';
        hex.dispatchEvent(new window.Event('input', { bubbles: true }));
        await sleep(50);
        await save();
        return partial;
      `
    );

    expect(result).toEqual({ value: '#12', dirty: false });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ themeMode: 'custom', themeColor: '#123456' });
  });
});
