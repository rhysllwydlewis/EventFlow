'use strict';

/**
 * Browser-side half of the seasonal navbar theme, run against the real files in
 * a JSDOM window: the artwork (every theme must be well-formed SVG and must not
 * be able to block or move anything), the loader (inert unless the server names
 * a theme), the navbar hook that loads it, and the admin card that edits it.
 *
 * jsdom cannot be loaded through jest's module system here, so the DOM work
 * happens in tests/helpers/seasonal-theme-dom.js (a child process, as in the
 * other jsdom-driven tests) and this file asserts on the facts it reports.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const THEMES = [
  'halloween',
  'bonfire',
  'remembrance',
  'christmas',
  'new-year',
  'chinese-new-year',
  'valentines',
  'mothers-day',
  'easter',
  'fathers-day',
];

let report;

beforeAll(() => {
  report = JSON.parse(
    execFileSync(process.execPath, [path.join(root, 'tests', 'helpers', 'seasonal-theme-dom.js')], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  );
}, 60000);

describe('seasonal artwork', () => {
  it('knows exactly the ten themes the server can name', () => {
    const { THEME_KEYS } = require('../../services/seasonalTheme.service');
    expect([...report.art.themes].sort()).toEqual([...THEMES].sort());
    // Keep the browser and server lists from drifting apart.
    expect([...report.art.themes].sort()).toEqual([...THEME_KEYS].sort());
  });

  it.each(
    THEMES.flatMap(key => [
      [key, 'moving'],
      [key, 'still'],
    ])
  )('%s (%s) draws only well-formed SVG with no dangling references', (key, mode) => {
    const built = report.art.perTheme[key][mode];
    for (const piece of ['mark', 'left', 'right', 'corner']) {
      const analysis = built[piece];
      if (!analysis) {
        continue;
      }
      expect(analysis.wellFormed).toBe(true);
      expect(analysis.startsWithSvg).toBe(true);
      expect(analysis.badValue).toBe(false);
      expect(analysis.dangling).toEqual([]);
      // Declarative SMIL only: no script and no external loads.
      expect(analysis.forbidden).toBe(false);
    }
    expect(built.mark.viewBox).toBe('0 0 40 40');
    if (built.left) {
      expect(built.left.viewBox).toBe('0 0 300 17');
      expect(built.right.viewBox).toBe('0 0 300 17');
    }
    if (built.corner) {
      expect(built.corner.viewBox).toBe('0 0 80 64');
    }
  });

  it('animates only when asked to', () => {
    for (const key of THEMES.filter(theme => theme !== 'remembrance')) {
      const still = report.art.perTheme[key].still;
      const moving = report.art.perTheme[key].moving;
      const animated = built =>
        ['mark', 'left', 'right', 'corner'].some(piece => built[piece] && built[piece].animated);
      expect(animated(still)).toBe(false);
      expect(animated(moving)).toBe(true);
    }
  });

  it('keeps Remembrance to a single still mark', () => {
    const moving = report.art.perTheme.remembrance.moving;
    expect(moving.mark.animated).toBe(false);
    expect(moving.left).toBeNull();
    expect(moving.right).toBeNull();
    expect(moving.corner).toBeNull();
  });

  it('gives only Halloween a corner web', () => {
    expect(report.art.perTheme.halloween.moving.corner).not.toBeNull();
    for (const key of THEMES.filter(theme => theme !== 'halloween')) {
      expect(report.art.perTheme[key].moving.corner).toBeNull();
    }
  });

  it('prefixes the ids of the inlined mark so they cannot clash with other SVGs on the page', () => {
    for (const key of THEMES) {
      for (const id of report.art.perTheme[key].moving.mark.ids) {
        expect(id).toMatch(/^efs-/);
      }
    }
  });

  it('is deterministic, so a page draws the same artwork every load', () => {
    for (const key of THEMES) {
      expect(report.art.perTheme[key].deterministic).toBe(true);
    }
  });

  it.each(['nope', 'constructor', '__proto__', '', 'undefined', 'null'])(
    'refuses the unknown theme "%s"',
    key => {
      expect(report.art.unknown[key]).toEqual({ build: null, apply: false });
    }
  );
});

describe('applying a theme to the header', () => {
  it('adds decoration behind the content and one mark after the wordmark', () => {
    const facts = report.apply.halloween;
    expect(report.apply.applied).toBe(true);
    expect(facts.classes).toEqual(expect.arrayContaining(['ef-season-on', 'ef-season-halloween']));
    expect(facts.decoClass).toBe('ef-season-deco');
    expect(facts.decoAriaHidden).toBe('true');
    expect(facts.edges).toHaveLength(2);
    expect(facts.corners).toBe(1);
    facts.layers.forEach(layer => {
      expect(layer.image).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(layer.ariaHidden).toBe('true');
    });
    expect(facts.markCount).toBe(1);
    expect(facts.mark).toMatchObject({ ariaHidden: 'true', hasSvg: true });
  });

  it('sizes and places the mark from the wordmark so it follows the logo', () => {
    expect(report.apply.bonfire.mark).toMatchObject({
      width: '33.6px',
      height: '33.6px',
      left: `${Math.round((8 + 168 * 1.012) * 10) / 10}px`,
      top: `${Math.round((12 - 168 * 0.05) * 10) / 10}px`,
    });
  });

  it('puts the edge art on the edge the theme asks for', () => {
    expect(report.apply.christmas.edges).toEqual(['top', 'top']);
    expect(report.apply.easter.edges).toEqual(['bottom', 'bottom']);
  });

  it('draws no edge art for Remembrance, only the mark', () => {
    expect(report.apply.remembrance.edges).toEqual([]);
    expect(report.apply.remembrance.markCount).toBe(1);
  });

  it('replaces rather than stacks when applied again', () => {
    expect(report.apply.reapplied.decoCount).toBe(1);
    expect(report.apply.reapplied.markCount).toBe(1);
    expect(report.apply.reapplied.classes).not.toContain('ef-season-halloween');
    expect(report.apply.reapplied.classes).toContain('ef-season-christmas');
  });

  it('clears back to exactly the original header', () => {
    expect(report.apply.clearedEqualsOriginal).toBe(true);
  });

  it('makes a statically positioned header positioned, and restores it on clear', () => {
    expect(report.apply.staticHeaderBecomesRelative).toBe('relative');
    expect(report.apply.staticHeaderRestored).toBe('static');
  });

  it('sets the rules that matter inline, so decoration cannot shift the header or catch a click before the stylesheet arrives', () => {
    expect(report.apply.decoCriticalInline).toEqual({
      position: 'absolute',
      pointerEvents: 'none',
      zIndex: '-1',
    });
    expect(report.apply.markIsAbsoluteInline).toBe('absolute');
  });

  it('positions the brand link itself when the page has not, and puts it back on clear', () => {
    expect(report.apply.brandStaticBecomesRelative).toBe('relative');
    expect(report.apply.brandStaticRestored).toBe('static');
  });

  it('hides the mark when the wordmark has no width', () => {
    expect(report.apply.zeroWidth.mark.hidden).toBe(true);
  });

  it('repositions the mark when the wordmark is resized', () => {
    expect(report.apply.afterResize.mark.width).toBe('23.2px');
  });

  it('copes with a header that has no brand', () => {
    expect(report.apply.noBrandApplied).toBe(true);
    expect(report.apply.noBrandFacts.markCount).toBe(0);
    expect(report.apply.noBrandAfterClear.decoCount).toBe(0);
  });
});

describe('loader', () => {
  it('asks the server once and dresses the header when a theme is named', () => {
    const run = report.loader.named;
    expect(run.fetched).toEqual(['/api/public/seasonal-theme']);
    expect(run.applyCalls).toEqual([
      { isHeader: true, theme: 'halloween', options: { animate: true } },
    ]);
    expect(run.stylesheet).toMatch(/\/assets\/css\/seasonal-theme\.css\?v=/);
  });

  it('turns animation off for visitors who prefer reduced motion', () => {
    expect(report.loader.reduced.applyCalls).toEqual([
      { isHeader: true, theme: 'bonfire', options: { animate: false } },
    ]);
  });

  it('does not touch the header until the stylesheet has loaded', () => {
    expect(report.loader.named.applyCallsBeforeStylesheet).toBe(0);
    expect(report.loader.named.applyCalls).toHaveLength(1);
    expect(report.loader.stylesheetNeverArrives.applyCalls).toEqual([]);
  });

  it('leaves the header alone if the stylesheet fails to load', () => {
    expect(report.loader.stylesheetFails.applyCalls).toEqual([]);
  });

  it('does nothing, and downloads nothing, when there is no theme', () => {
    const run = report.loader.none;
    expect(run.applyCalls).toEqual([]);
    expect(run.stylesheet).toBeNull();
    expect(run.artScript).toBe(false);
  });

  it('never calls the server on a page with no public header', () => {
    expect(report.loader.noHeader.fetchCalls).toBe(0);
  });

  it.each(['nonString', 'traversal', 'uppercase', 'scriptLike', 'empty'])(
    'ignores an unusable answer (%s)',
    label => {
      expect(report.loader.invalid[label].applyCalls).toEqual([]);
      expect(report.loader.invalid[label].stylesheet).toBeNull();
    }
  );

  it('stays plain when the request fails or returns an error', () => {
    expect(report.loader.offline.applyCalls).toEqual([]);
    expect(report.loader.errorStatus.applyCalls).toEqual([]);
  });

  it('waits for a header that is added after the script runs', () => {
    expect(report.loader.lateHeader.applyCalls).toEqual([
      { isHeader: true, theme: 'easter', options: { animate: true } },
    ]);
  });

  it('runs only once per page', () => {
    expect(report.loader.twice.fetchCalls).toBe(1);
  });
});

describe('navbar hook', () => {
  it('navbar.js loads the loader, at the version the new files ship with', () => {
    expect(read('public/assets/js/navbar.js')).toMatch(
      /\/assets\/js\/seasonal-theme\.js\?v=1\.0\.0/
    );
    expect(read('public/assets/js/seasonal-theme.js')).toMatch(/const ASSET_VERSION = '1\.0\.0'/);
  });

  it('every page that loads navbar.js references one and the same version of it', () => {
    const versions = new Set();
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.html')) {
          for (const match of fs
            .readFileSync(full, 'utf8')
            .matchAll(/\/assets\/js\/navbar\.js(\?v=[\w.]+)?/g)) {
            versions.add(match[1] || '(none)');
          }
        }
      }
    };
    walk(path.join(root, 'public'));

    // One shared version, so a returning visitor can never get a mix of old and new pages.
    expect(versions.size).toBe(1);
    expect([...versions][0]).toMatch(/^\?v=\d+\.\d+\.\d+$/);
  });
});

describe('admin card', () => {
  it('matches the markup it is written for, and is loaded by the settings page', () => {
    expect(report.admin.initial.markupHasIds).toBe(true);
    expect(read('public/admin-settings.html')).toMatch(
      /pages\/admin-seasonal-theme-init\.js\?v=1\.0\.0/
    );
  });

  it('shows what is live and what happens next, and hides the manual controls while auto is on', () => {
    const card = report.admin.initial;
    expect(card.statusText).toContain('Live now: Halloween (automatic)');
    expect(card.statusText).toContain(
      'Next change: Mon 2 Nov 2026 at 00:00, switching to Bonfire Night.'
    );
    expect(card.autoChecked).toBe(true);
    expect(card.manualHidden).toBe(true);
  });

  it('lists every occasion with its dates, ticked unless skipped', () => {
    const card = report.admin.skipped;
    expect(card.occasions).toEqual([
      { key: 'halloween', checked: true },
      { key: 'bonfire', checked: true },
      { key: 'christmas', checked: true },
      { key: 'easter', checked: false },
    ]);
    expect(card.occasionText).toContain('20 Oct to 1 Nov');
    expect(card.occasionText).toContain('moves yearly');
    expect(card.manualOptions).toEqual(['', 'halloween', 'bonfire', 'christmas', 'easter']);
  });

  it('keeps the current theme selected when auto is turned off, so nothing jumps', () => {
    expect(report.admin.autoOff.manualHidden).toBe(false);
    expect(report.admin.autoOff.manualTheme).toBe('halloween');
  });

  it('saves exactly what the form says, including skipped occasions', () => {
    const put = report.admin.saveAuto.calls.find(call => call.method === 'PUT');
    expect(put.url).toBe('/api/admin/settings/seasonal-theme');
    expect(put.body).toEqual({
      auto: true,
      manualTheme: null,
      returnToAutoOn: null,
      excluded: ['christmas'],
    });
    expect(report.admin.saveAuto.csrfFetches).toBe(1);
    expect(report.admin.saveAuto.toasts).toEqual([]);
  });

  it('saves a manual theme with a return date', () => {
    const put = report.admin.saveManual.calls.find(call => call.method === 'PUT');
    expect(put.body).toEqual({
      auto: false,
      manualTheme: 'easter',
      returnToAutoOn: '2026-12-05',
      excluded: [],
    });
  });

  it('warns when a manual theme is outside its usual dates', () => {
    const card = report.admin.manualOutside;
    expect(card.warning).toBe(
      'Halloween usually runs 20 Oct to 1 Nov, so it stays on until you change it.'
    );
    expect(card.statusText).toContain('Nothing will change by itself.');
  });

  it('names the return date in that warning when there is one', () => {
    expect(report.admin.manualWithReturn.warning).toBe(
      'Halloween usually runs 20 Oct to 1 Nov, so it stays on until Sat 5 Dec 2026.'
    );
  });

  it('does not warn for a manual theme that is inside its dates', () => {
    expect(report.admin.manualInside.warning).toBeNull();
  });

  it('tells an admin when the Chinese New Year dates are running out, and only then', () => {
    expect(report.admin.tableRunningOut.tableNoteHidden).toBe(false);
    expect(report.admin.tableRunningOut.tableNoteText).toContain('up to 2035');
    expect(report.admin.tableFine.tableNoteHidden).toBe(true);
  });

  it('says so, rather than staying on "Loading", if the settings cannot be read', () => {
    expect(report.admin.loadFails.statusText).toMatch(/Could not load/);
  });
});
