'use strict';

/**
 * Invariants for the customer budget page (public/budget.html).
 *
 * The page is one HTML file, one page-scoped stylesheet (budget-page.css, every selector under
 * .bp), one maths module (budget-calc.js) and one page script (pages/budget-page.js). These
 * checks keep it that way and guard the contracts the script relies on.
 */

const fs = require('fs');
const postcss = require('postcss');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const read = rel => fs.readFileSync(path.join(PUBLIC, rel), 'utf8');

const html = read('budget.html');
const css = read('assets/css/budget-page.css');
const js = read('assets/js/pages/budget-page.js');
const calc = read('assets/js/budget-calc.js');

const mainHtml = html.slice(html.indexOf('<main'), html.indexOf('</main>') + 7);

describe('budget page assets', () => {
  const refs = [
    ...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="(\/assets\/[^"?]+)(\?[^"]*)?"/g),
  ];
  const assetPaths = refs.map(m => m[1]);

  test('every referenced local asset exists', () => {
    for (const asset of assetPaths) {
      expect(fs.existsSync(path.join(PUBLIC, asset))).toBe(true);
    }
  });

  test('the page-specific files carry a ?v= cache-buster', () => {
    for (const asset of [
      '/assets/css/budget-page.css',
      '/assets/js/budget-calc.js',
      '/assets/js/pages/budget-page.js',
    ]) {
      const ref = refs.find(m => m[1] === asset);
      expect(ref).toBeDefined();
      expect(ref[2]).toMatch(/^\?v=\d+\.\d+\.\d+$/);
    }
  });

  test('exactly one page stylesheet, and the layered old ones are gone', () => {
    expect(assetPaths.filter(p => /budget/.test(p) && p.endsWith('.css'))).toEqual([
      '/assets/css/budget-page.css',
    ]);
    expect(assetPaths).not.toContain('/assets/css/eventflow-17.0.0.css');
    expect(assetPaths).not.toContain('/assets/css/animations.css');
  });

  test('the old budget scripts, Chart.js and the modal helper are no longer loaded', () => {
    expect(html).not.toMatch(/chart\.js|chart\.umd/i);
    expect(html).not.toContain('/assets/js/budget.js');
    expect(html).not.toContain('budget-init.js');
    expect(html).not.toContain('modal-a11y');
    expect(fs.existsSync(path.join(PUBLIC, 'assets/js/budget.js'))).toBe(false);
    expect(fs.existsSync(path.join(PUBLIC, 'assets/js/pages/budget-init.js'))).toBe(false);
  });

  test('budget-calc.js loads before the page script', () => {
    expect(html.indexOf('budget-calc.js')).toBeGreaterThan(-1);
    expect(html.indexOf('budget-calc.js')).toBeLessThan(html.indexOf('budget-page.js'));
  });
});

describe('budget-page.css', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('every selector is scoped under .bp', () => {
    const unscoped = [];
    postcss.parse(css).walkRules(rule => {
      if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) {
        return;
      }
      rule.selectors.forEach(sel => {
        if (!/^\.bp(?![\w-])/.test(sel.trim())) {
          unscoped.push(sel.trim());
        }
      });
    });
    expect(unscoped).toEqual([]);
  });

  test('no gradients, and !important only to make [hidden] win', () => {
    expect(stripped).not.toMatch(/linear-gradient|radial-gradient/);
    const important = [];
    postcss.parse(css).walkDecls(decl => {
      if (decl.important) {
        important.push(decl.parent.selector);
      }
    });
    expect(important).toEqual(['.bp [hidden]']);
  });

  test('keeps a reduced-motion safe default: animation only inside no-preference', () => {
    const withoutGuarded = stripped.replace(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}\n/g,
      ''
    );
    expect(withoutGuarded).not.toMatch(/animation:/);
    expect(withoutGuarded).not.toMatch(/transition-duration|transition:\s*(opacity|visibility)/);
  });

  test('type sizes stay on the site scale', () => {
    const scale = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
    const sizes = [...stripped.matchAll(/font-size:\s*([\d.]+)px/g)].map(m => parseFloat(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(sizes.filter(s => !scale.includes(s))).toEqual([]);
  });

  test('visible keyboard focus is defined for the controls', () => {
    expect(stripped).toMatch(/:focus-visible/);
  });
});

describe('budget.html markup', () => {
  test('has no inline styles, onclick handlers or emoji in the page content', () => {
    expect(mainHtml).not.toMatch(/\sstyle=/);
    expect(mainHtml).not.toMatch(/\sonclick=/i);
    expect(mainHtml).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  test('one h1, a main landmark, and dialogs that are labelled', () => {
    expect((mainHtml.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).toContain('id="main-content"');
    for (const dialog of mainHtml.match(/<dialog\b[^>]*>/g)) {
      expect(dialog).toMatch(/aria-labelledby="[^"]+"/);
    }
  });

  test('every form control has a label', () => {
    const controls = [...mainHtml.matchAll(/<(input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)];
    expect(controls.length).toBeGreaterThan(8);
    for (const [tag, , id] of controls) {
      const labelled =
        new RegExp(`<label[^>]*for="${id}"`).test(mainHtml) || /aria-label="[^"]+"/.test(tag);
      expect({ id, labelled }).toEqual({ id, labelled: true });
    }
  });

  test('titles the page and keeps it out of search indexes', () => {
    expect(html).toMatch(/<title>Budget[^<]*EventFlow<\/title>/);
    expect(html).toContain('noindex');
  });
});

describe('budget-page.js contracts', () => {
  test('every element id the script looks up exists in the page', () => {
    const wanted = new Set(
      [...js.matchAll(/(?<![A-Za-z])byId\('([a-z0-9-]+)'\)/gi)].map(m => m[1])
    );
    const missing = [...wanted].filter(id => !new RegExp(`id="${id}"`).test(html));
    expect(missing).toEqual([]);
  });

  test('uses the plan endpoints the dashboard reads from, with CSRF on writes', () => {
    expect(js).toContain('/api/me/plans');
    expect(js).toMatch(/planUrl\(state\.plan, '\/budget'\)/);
    expect(js).toMatch(/method: 'PATCH'/);
    expect(js).toContain('X-CSRF-Token');
  });

  test('never asks the API for a page larger than 100 (the /api pagination cap)', () => {
    const limits = [...js.matchAll(/limit=(\d+)/g)].map(m => Number(m[1]));
    expect(limits.filter(n => n > 100)).toEqual([]);
  });

  test('builds markup from escaped text only', () => {
    expect(js).toMatch(/function esc\(/);
    expect(js).not.toMatch(/onclick=/);
    expect(js).not.toMatch(/\$\{state\.error\}/);
    expect(js).not.toMatch(/\$\{err\.message\}/);
  });

  test('no leftovers from the old page', () => {
    for (const gone of [
      'BudgetManager',
      'budgetManager',
      'Chart(',
      'showToast(',
      'confetti',
      'new Modal(',
    ]) {
      expect(js).not.toContain(gone);
    }
  });

  test('keeps the dashboard in sync through its localStorage key', () => {
    expect(js).toContain("'eventflow_custom_budget'");
    expect(js).toContain("'ef_budget'"); // legacy data is still read so nobody loses it
  });

  test('shares the maths with the tests through one module', () => {
    expect(js).toContain('window.EFBudgetCalc');
    expect(calc).toContain('module.exports');
    expect(calc.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bdocument\b|\bwindow\b/);
  });
});

describe('budget page styling invariants', () => {
  test('no pill radii, so buttons, badges and bars match the other customer pages', () => {
    expect(css).not.toMatch(/border-radius:\s*(999|9999)/);
  });

  test('links back to the dashboard and cancels the phone body gutter so the page is full width', () => {
    expect(mainHtml).toContain('href="/dashboard/customer"');
    expect(css).toMatch(/@media \(max-width: 600px\) \{[^}]*\.bp \{[^}]*margin-left: -10px;/);
  });

  test('an ended session offers a log-in link that returns to the budget, not a retry', () => {
    expect(js).toContain('state.signedOut = err.status === 401 || err.status === 403;');
    expect(js).toContain('/auth?redirect=%2Fbudget');
  });

  test('starts on the dashboard focus plan and shares the remembered plan with the guest list', () => {
    expect(js).toContain("PLAN_PICK_KEY = 'ef_customer_plan'");
    expect(js).toContain('function pickFocusPlan(');
    expect(js).toMatch(/plans\.find\(plan => plan\.id === wanted\) \|\| pickFocusPlan\(plans\)/);
  });

  test('plan dates are read as calendar days, so they do not shift a day west of Greenwich', () => {
    expect(js).toMatch(
      /new Date\(Number\(match\[1\]\), Number\(match\[2\]\) - 1, Number\(match\[3\]\)\)/
    );
  });

  test('the export menu opens rightwards on phones, where Export sits at the left edge', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toMatch(/\.bp \.bp-menu__panel \{[^}]*right: auto;[^}]*left: 0;/);
  });

  test('long notes are clamped in the table and the plan select cannot outgrow its row', () => {
    expect(css).toMatch(/-webkit-line-clamp: 2;/);
    expect(css).toMatch(/\.bp \.bp-select-wrap \.bp-select \{[^}]*max-width: 100%;/);
  });

  test('the tables undo the global nowrap that mobile-optimizations.css gives every table', () => {
    const rule = css.match(/\.bp \.bp-table \{[\s\S]*?\n\}/)[0];
    expect(rule).toMatch(/white-space: normal;/);
  });

  test('saves send the version they started from, so a second tab cannot overwrite silently', () => {
    expect(js).toMatch(/baseVersion: state\.plan\.budgetUpdatedAt \|\| ''/);
    expect(js).toMatch(/state\.plan\.budgetUpdatedAt = data\.budgetUpdatedAt/);
  });

  test('switching plans updates the address, so a reload does not jump back to the linked plan', () => {
    expect(js).toMatch(/url\.searchParams\.set\('plan', id\)/);
    expect(js).toMatch(/writeStorage\(PLAN_PICK_KEY, plan\.id\);\s*showPlanInUrl\(plan\.id\);/);
  });

  test('the header matches the other customer pages: title, then the plan line, 28px and 24px on phones', () => {
    expect(html).toMatch(
      /<h1 class="bp-title">Budget<\/h1>\s*<p class="bp-plan-line" id="bp-plan-line">/
    );
    expect(css).toMatch(/\.bp \.bp-title \{[^}]*font-size: 28px;[^}]*font-weight: 700;/);
    expect(css).toMatch(/\.bp \.bp-title \{\s*font-size: 24px;/);
  });

  test('the PDF library is served from our own origin, because the CSP does not allow cdnjs', () => {
    const utility = read('assets/js/export-utility.js');
    const policy = fs.readFileSync(path.join(__dirname, '../../middleware/security.js'), 'utf8');
    expect(policy).not.toContain('cdnjs.cloudflare.com');
    expect(utility).not.toContain('cdnjs.cloudflare.com/ajax/libs/jspdf');
    expect(utility).toContain('/assets/js/vendor/jspdf.umd.min.js');
    expect(fs.existsSync(path.join(PUBLIC, 'assets/js/vendor/jspdf.umd.min.js'))).toBe(true);
    expect(html).toMatch(/export-utility\.js\?v=/);
  });
});
