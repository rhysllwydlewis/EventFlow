'use strict';

/**
 * DOM scenarios for the seasonal navbar theme, run in a plain Node process.
 *
 * jsdom cannot be loaded through jest's module system in this repo, so (like
 * the other jsdom-driven tests) the browser code is exercised here in a child
 * process and the facts are handed back as JSON for
 * tests/unit/seasonal-theme-frontend.test.js to assert on.
 *
 * Usage: node tests/helpers/seasonal-theme-dom.js   (prints one JSON document)
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ART = read('public/assets/js/seasonal-theme-art.js');
const LOADER = read('public/assets/js/seasonal-theme.js');
const ADMIN_INIT = read('public/assets/js/pages/admin-seasonal-theme-init.js');
// The page's own scripts are never run: JSDOM is created with runScripts: 'outside-only'.
const ADMIN_PAGE = read('public/admin-settings.html');

const HEADER_HTML = `
  <header class="ef-header">
    <div class="ef-container"><div class="ef-header-content">
      <a href="/" class="ef-brand"><span class="ef-brand-text">EventFlow</span></a>
      <nav><a class="ef-nav-link" href="/start">Plan</a></nav>
    </div></div>
  </header>`;

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function windowWith(html = HEADER_HTML, { readyState, wordmarkWidth = 168 } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://eventflow.test/',
  });
  const { window } = dom;
  const brand = window.document.querySelector('.ef-brand');
  const wordmark = window.document.querySelector('.ef-brand-text');
  let width = wordmarkWidth;
  if (brand && wordmark) {
    // JSDOM has no layout, so give the brand and wordmark the boxes the live CSS gives them
    // (8px of padding either side of the wordmark, 12px from the top of the brand).
    brand.getBoundingClientRect = () => ({ left: 0, top: 0, width: width + 16, height: 64 });
    wordmark.getBoundingClientRect = () => ({ left: 8, top: 12, width, height: 40 });
  }
  window.setWordmarkWidth = value => {
    width = value;
  };
  if (readyState) {
    Object.defineProperty(window.document, 'readyState', { value: readyState, configurable: true });
  }
  return window;
}

/* ---------------- Artwork ---------------- */

function analyse(window, markup) {
  const doc = new window.DOMParser().parseFromString(markup, 'image/svg+xml');
  const defined = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = [...markup.matchAll(/url\(#([^)]+)\)/g)].map(match => match[1]);
  return {
    wellFormed: doc.getElementsByTagName('parsererror').length === 0,
    startsWithSvg: markup.startsWith('<svg '),
    badValue: /NaN|undefined|null/.test(markup),
    dangling: used.filter(id => !defined.has(id)),
    forbidden: /<script|onload=|href="http|xlink:href/i.test(markup),
    animated: /<animate/.test(markup),
    ids: [...defined],
    viewBox: (/viewBox="([^"]+)"/.exec(markup) || [])[1],
  };
}

function artReport() {
  const window = windowWith();
  window.eval(ART);
  const art = window.EFSeasonalArt;
  const report = { themes: art.themes, perTheme: {}, unknown: Object.create(null) };

  for (const key of art.themes) {
    report.perTheme[key] = {};
    for (const motion of [true, false]) {
      const built = art.build(key, motion);
      report.perTheme[key][motion ? 'moving' : 'still'] = {
        pos: built.pos,
        mark: analyse(window, built.mark),
        left: built.left && analyse(window, built.left),
        right: built.right && analyse(window, built.right),
        corner: built.corner && analyse(window, built.corner),
      };
    }
    report.perTheme[key].deterministic =
      JSON.stringify(art.build(key, true)) === JSON.stringify(art.build(key, true));
  }

  const header = window.document.querySelector('.ef-header');
  for (const key of ['nope', 'constructor', '__proto__', '', undefined, null]) {
    report.unknown[String(key)] = { build: art.build(key, true), apply: art.apply(header, key) };
  }
  return report;
}

/* ---------------- Applying to the header ---------------- */

function layerFacts(header) {
  const deco = header.firstElementChild;
  const mark = header.querySelector('.ef-brand .ef-season-mark');
  return {
    classes: [...header.classList],
    decoClass: deco && deco.className,
    decoAriaHidden: deco && deco.getAttribute('aria-hidden'),
    decoCount: header.querySelectorAll('.ef-season-deco').length,
    edges: [...header.querySelectorAll('.ef-season-edge')].map(edge => edge.dataset.pos),
    corners: header.querySelectorAll('.ef-season-corner').length,
    layers: [...header.querySelectorAll('.ef-season-layer')].map(layer => ({
      image: layer.style.backgroundImage.slice(0, 32),
      ariaHidden: layer.getAttribute('aria-hidden'),
    })),
    markCount: header.querySelectorAll('.ef-season-mark').length,
    mark: mark && {
      ariaHidden: mark.getAttribute('aria-hidden'),
      hasSvg: !!mark.querySelector('svg'),
      width: mark.style.width,
      height: mark.style.height,
      left: mark.style.left,
      top: mark.style.top,
      hidden: mark.hidden,
    },
  };
}

function applyReport() {
  const out = {};
  const fresh = options => {
    const window = windowWith(options && options.html, options);
    window.eval(ART);
    return {
      window,
      art: window.EFSeasonalArt,
      header: window.document.querySelector('.ef-header'),
    };
  };

  let s = fresh();
  out.applied = s.art.apply(s.header, 'halloween', { animate: false });
  out.halloween = layerFacts(s.header);

  s = fresh();
  s.art.apply(s.header, 'bonfire', { animate: false });
  out.bonfire = layerFacts(s.header);

  s = fresh();
  s.art.apply(s.header, 'christmas', { animate: false });
  out.christmas = layerFacts(s.header);
  s.art.apply(s.header, 'easter', { animate: false });
  out.easter = layerFacts(s.header);

  s = fresh();
  s.art.apply(s.header, 'remembrance', { animate: false });
  out.remembrance = layerFacts(s.header);

  s = fresh();
  s.art.apply(s.header, 'halloween', { animate: false });
  s.art.apply(s.header, 'christmas', { animate: false });
  out.reapplied = { ...layerFacts(s.header) };

  s = fresh();
  const before = s.header.outerHTML;
  s.art.apply(s.header, 'halloween', { animate: true });
  s.art.clear(s.header);
  out.clearedEqualsOriginal = s.header.outerHTML === before;

  s = fresh();
  s.header.style.position = 'static';
  s.art.apply(s.header, 'halloween', { animate: false });
  out.staticHeaderBecomesRelative = s.header.style.position;
  s.art.clear(s.header);
  out.staticHeaderRestored = s.header.style.position;

  s = fresh();
  const brandEl = s.header.querySelector('.ef-brand');
  brandEl.style.position = 'static';
  s.art.apply(s.header, 'halloween', { animate: false });
  out.brandStaticBecomesRelative = brandEl.style.position;
  out.markIsAbsoluteInline = s.header.querySelector('.ef-season-mark').style.position;
  const decoStyle = s.header.querySelector('.ef-season-deco').style;
  out.decoCriticalInline = {
    position: decoStyle.position,
    pointerEvents: decoStyle.pointerEvents,
    zIndex: decoStyle.zIndex,
  };
  s.art.clear(s.header);
  out.brandStaticRestored = brandEl.style.position;

  s = fresh({ wordmarkWidth: 0 });
  s.art.apply(s.header, 'halloween', { animate: false });
  out.zeroWidth = layerFacts(s.header);

  s = fresh();
  s.art.apply(s.header, 'bonfire', { animate: false });
  s.window.setWordmarkWidth(116);
  s.window.dispatchEvent(new s.window.Event('resize'));
  out.afterResize = layerFacts(s.header);

  const bare = fresh({ html: '<header class="ef-header"><nav></nav></header>' });
  out.noBrandApplied = bare.art.apply(bare.header, 'halloween', { animate: false });
  out.noBrandFacts = layerFacts(bare.header);
  bare.art.clear(bare.header);
  out.noBrandAfterClear = layerFacts(bare.header);
  return out;
}

/* ---------------- Loader ---------------- */

async function loaderScenario({
  html,
  response,
  fetchImpl,
  reduceMotion = false,
  readyState = 'complete',
  stylesheet = 'load',
  after,
} = {}) {
  const window = windowWith(html, { readyState });
  window.matchMedia = () => ({ matches: reduceMotion });
  const applyCalls = [];
  let fetchCalls = 0;
  const fetched = [];
  window.fetch =
    fetchImpl ||
    (async url => {
      fetchCalls += 1;
      fetched.push(url);
      return { ok: true, json: async () => response || { theme: null } };
    });
  window.EFSeasonalArt = {
    apply(header, theme, options) {
      applyCalls.push({
        isHeader: header === window.document.querySelector('.ef-header'),
        theme,
        options,
      });
      return true;
    },
  };
  window.eval(LOADER);
  if (after) {
    after(window);
  }
  await flush();
  await flush();
  const link = window.document.querySelector('link[data-eventflow-seasonal]');
  // JSDOM loads nothing itself, so play the part of the network for the stylesheet.
  const applyCallsBeforeStylesheet = applyCalls.length;
  if (link && stylesheet !== 'never') {
    link.dispatchEvent(new window.Event(stylesheet));
    await flush();
    await flush();
  }
  return {
    applyCallsBeforeStylesheet,
    fetchCalls,
    fetched,
    applyCalls,
    stylesheet: link && link.href,
    artScript: !!window.document.querySelector('script[src*="seasonal-theme-art"]'),
  };
}

async function loaderReport() {
  const out = {};
  out.named = await loaderScenario({ response: { theme: 'halloween' } });
  out.reduced = await loaderScenario({ response: { theme: 'bonfire' }, reduceMotion: true });
  out.none = await loaderScenario({ response: { theme: null } });
  out.noHeader = await loaderScenario({
    html: '<main>admin</main>',
    response: { theme: 'halloween' },
  });
  out.invalid = {};
  for (const [label, body] of [
    ['nonString', { theme: 7 }],
    ['traversal', { theme: '../../evil' }],
    ['uppercase', { theme: 'Halloween' }],
    ['scriptLike', { theme: '<script>' }],
    ['empty', {}],
  ]) {
    out.invalid[label] = await loaderScenario({ response: body });
  }
  out.offline = await loaderScenario({
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  out.errorStatus = await loaderScenario({
    fetchImpl: async () => ({ ok: false, json: async () => ({ theme: 'halloween' }) }),
  });
  out.lateHeader = await loaderScenario({
    html: '',
    response: { theme: 'easter' },
    readyState: 'loading',
    after: window => window.document.body.insertAdjacentHTML('beforeend', HEADER_HTML),
  });

  out.stylesheetNeverArrives = await loaderScenario({
    response: { theme: 'halloween' },
    stylesheet: 'never',
  });
  out.stylesheetFails = await loaderScenario({
    response: { theme: 'halloween' },
    stylesheet: 'error',
  });

  const twice = await loaderScenario({
    response: { theme: 'halloween' },
    after: window => window.eval(LOADER),
  });
  out.twice = { fetchCalls: twice.fetchCalls };
  return out;
}

/* ---------------- Admin card ---------------- */

const adminState = (overrides = {}) => ({
  settings: { auto: true, manualTheme: null, returnToAutoOn: null, excluded: [] },
  resolved: { theme: 'halloween', source: 'auto' },
  ukDate: '2026-10-23',
  next: { date: '2026-11-02', theme: 'bonfire' },
  chineseNewYearTableEndsIn: 2035,
  occasions: [
    { key: 'halloween', name: 'Halloween', moves: false, start: '2026-10-20', end: '2026-11-01' },
    { key: 'bonfire', name: 'Bonfire Night', moves: false, start: '2026-11-02', end: '2026-11-06' },
    { key: 'christmas', name: 'Christmas', moves: false, start: '2026-12-01', end: '2026-12-26' },
    { key: 'easter', name: 'Easter', moves: true, start: '2027-03-18', end: '2027-03-29' },
  ],
  ...overrides,
});

async function adminScenario(initial, act) {
  const dom = new JSDOM(ADMIN_PAGE, {
    runScripts: 'outside-only',
    url: 'https://eventflow.test/admin-settings',
  });
  const { window } = dom;
  const calls = [];
  const toasts = [];
  let csrf = 0;
  window.AdminShared = {
    adminFetch: async (url, options = {}) => {
      calls.push({ url, method: options.method, body: options.body });
      if (initial === 'fail') {
        throw new Error('boom');
      }
      return options.method === 'PUT' ? { success: true, ...adminState() } : initial;
    },
    fetchCSRFToken: async () => {
      csrf += 1;
      return 'token';
    },
    safeAction: async (button, action) => action(),
    showToast: (message, type) => toasts.push({ message, type }),
    debugError: () => {},
  };
  window.eval(ADMIN_INIT);
  await flush();
  const $ = selector => window.document.querySelector(selector);
  if (act) {
    await act(window, $);
    await flush();
  }
  const note = $('#seasonalTableNote');
  return {
    calls,
    toasts,
    csrfFetches: csrf,
    markupHasIds: [
      'seasonalAuto',
      'seasonalStatus',
      'seasonalManual',
      'seasonalManualTheme',
      'seasonalReturn',
      'seasonalOccasionList',
      'saveSeasonalTheme',
    ].every(id => !!$(`#${id}`)),
    statusText: $('#seasonalStatus').textContent,
    warning:
      $('#seasonalStatus .seasonal-warning') && $('#seasonalStatus .seasonal-warning').textContent,
    autoChecked: $('#seasonalAuto').checked,
    manualHidden: $('#seasonalManual').hidden,
    manualTheme: $('#seasonalManualTheme').value,
    manualOptions: [...window.document.querySelectorAll('#seasonalManualTheme option')].map(
      option => option.value
    ),
    occasions: [
      ...window.document.querySelectorAll('#seasonalOccasionList input[data-occasion]'),
    ].map(box => ({
      key: box.dataset.occasion,
      checked: box.checked,
    })),
    occasionText: $('#seasonalOccasionList').textContent,
    tableNoteHidden: note.hidden,
    tableNoteText: note.textContent,
  };
}

async function adminReport() {
  const out = {};
  out.initial = await adminScenario(adminState());
  out.skipped = await adminScenario(
    adminState({
      settings: { auto: true, manualTheme: null, returnToAutoOn: null, excluded: ['easter'] },
    })
  );
  out.autoOff = await adminScenario(adminState(), (window, $) => {
    $('#seasonalAuto').checked = false;
    $('#seasonalAuto').dispatchEvent(new window.Event('change'));
  });
  out.saveAuto = await adminScenario(adminState(), (window, $) => {
    window.document.querySelector('input[data-occasion="christmas"]').checked = false;
    $('#saveSeasonalTheme').click();
  });
  out.saveManual = await adminScenario(adminState(), (window, $) => {
    $('#seasonalAuto').checked = false;
    $('#seasonalAuto').dispatchEvent(new window.Event('change'));
    $('#seasonalManualTheme').value = 'easter';
    $('#seasonalReturn').value = '2026-12-05';
    $('#saveSeasonalTheme').click();
  });
  out.manualOutside = await adminScenario(
    adminState({
      settings: { auto: false, manualTheme: 'halloween', returnToAutoOn: null, excluded: [] },
      resolved: { theme: 'halloween', source: 'manual' },
      ukDate: '2026-12-01',
      next: null,
    })
  );
  out.manualInside = await adminScenario(
    adminState({
      settings: { auto: false, manualTheme: 'halloween', returnToAutoOn: null, excluded: [] },
      resolved: { theme: 'halloween', source: 'manual' },
    })
  );
  out.manualWithReturn = await adminScenario(
    adminState({
      settings: {
        auto: false,
        manualTheme: 'halloween',
        returnToAutoOn: '2026-12-05',
        excluded: [],
      },
      resolved: { theme: 'halloween', source: 'manual' },
      ukDate: '2026-12-01',
      next: { date: '2026-12-05', theme: 'christmas' },
    })
  );
  out.tableRunningOut = await adminScenario(adminState({ ukDate: '2033-06-01' }));
  out.tableFine = await adminScenario(adminState());
  out.loadFails = await adminScenario('fail');
  return out;
}

async function main() {
  const result = {
    art: artReport(),
    apply: applyReport(),
    loader: await loaderReport(),
    admin: await adminReport(),
  };
  process.stdout.write(JSON.stringify(result));
}

main().catch(error => {
  process.stderr.write(String(error && error.stack ? error.stack : error));
  process.exit(1);
});
