'use strict';

/**
 * Customer dashboard home (public/dashboard-customer.html) structural invariants.
 *
 * The page used to be nine stacked stylesheets, three layers of runtime DOM
 * patching and the same facts drawn twice. These tests keep it consolidated:
 *   - one page stylesheet, scoped so it cannot leak
 *   - every element id the scripts read still exists, and each id exists once
 *   - no repeated section headings (the old page showed budget and progress twice)
 *   - the removed layers stay removed
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const html = read('public/dashboard-customer.html');
const css = read('public/assets/css/customer-dashboard-home.css');
const homeJs = read('public/assets/js/pages/customer-dashboard-home.js');
const initJs = read('public/assets/js/pages/dashboard-customer-init.js');

/** The <main> element, where the page's own content lives. */
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

/** The markup with every HTML comment removed, so ids inside comments are not counted. */
const withoutComments = markup => {
  let result = '';
  let position = 0;
  for (;;) {
    const start = markup.indexOf('<!--', position);
    if (start === -1) {
      return result + markup.slice(position);
    }
    result += markup.slice(position, start);
    const end = markup.indexOf('-->', start + 4);
    if (end === -1) {
      return result;
    }
    position = end + 3;
  }
};

/** Every element id in a piece of markup, ignoring commented-out markup. */
const idsIn = markup => [...withoutComments(markup).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

describe('customer dashboard home: stylesheets', () => {
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);

  test('exactly one customer-dashboard stylesheet is linked, and it is versioned', () => {
    const dashboardSheets = links.filter(href => /customer-dashboard-/.test(href));
    expect(dashboardSheets).toHaveLength(1);
    expect(dashboardSheets[0]).toMatch(/customer-dashboard-home\.css\?v=\d+\.\d+\.\d+$/);
  });

  test('the layered patch sheets are not linked from this page', () => {
    const banned = [
      'customer-dashboard-improvements',
      'customer-dashboard-liquid-glass',
      'customer-dashboard-welcome',
      'customer-dashboard-polish',
      'dashboard-overhaul',
      'dashboard-mobile',
      'dashboard-animations',
      'card-collapse',
      'account-type-notice',
      'liquid-glass',
      'messaging-glass',
      'p3-features',
    ];
    banned.forEach(name => {
      expect(links.filter(href => href.includes(name))).toEqual([]);
    });
  });

  test('the files that only this page used are gone', () => {
    [
      'public/assets/css/customer-dashboard-improvements.css',
      'public/assets/css/customer-dashboard-liquid-glass.css',
      'public/assets/css/customer-dashboard-welcome-card.css',
      'public/assets/css/customer-dashboard-welcome-scale.css',
      'public/assets/css/customer-dashboard-polish.css',
      'public/assets/css/account-type-notice.css',
      'public/assets/js/customer-dashboard-mop-up.js',
      'public/assets/js/customer-dashboard-polish.js',
      'public/assets/js/customer-dashboard-enhancements.js',
      'public/assets/js/dashboard-customer-overhaul.js',
      'public/assets/js/pages/dashboard-customer-module.js',
    ].forEach(file => expect(exists(file)).toBe(false));
  });

  test('shared stylesheets other dashboards still use were not deleted', () => {
    ['dashboard-overhaul.css', 'dashboard-mobile.css', 'card-collapse.css'].forEach(file =>
      expect(exists(`public/assets/css/${file}`)).toBe(true)
    );
    expect(exists('public/assets/js/card-collapse.js')).toBe(true);
    expect(exists('public/assets/js/dashboard-widgets.js')).toBe(true);
  });

  test('dashboard-guard no longer injects the removed mop-up and polish scripts', () => {
    const guard = read('public/assets/js/dashboard-guard.js');
    expect(guard).not.toMatch(/mop-up|customer-dashboard-polish/);
    expect(html).toMatch(/dashboard-guard\.js\?v=17\.1\.0/);
  });
});

describe('customer dashboard home: stylesheet scoping', () => {
  /** Splits a selector list on commas that are not inside :where(...) / :not(...) parentheses. */
  function splitTopLevel(list) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const char of list) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
      }
      if (char === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    parts.push(current.trim());
    return parts.filter(Boolean);
  }

  /** Selectors of every style rule, ignoring @keyframes steps and comments. */
  function selectors(source) {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const out = [];
    let depth = 0;
    let buffer = '';
    const stack = [];
    for (const char of stripped) {
      if (char === '{') {
        const head = buffer.trim();
        stack.push(head);
        if (!head.startsWith('@') && !stack.some(h => h.startsWith('@keyframes'))) {
          splitTopLevel(head).forEach(sel => out.push(sel));
        }
        buffer = '';
        depth += 1;
      } else if (char === '}') {
        stack.pop();
        depth -= 1;
        buffer = '';
      } else if (char === ';') {
        buffer = '';
      } else {
        buffer += char;
      }
    }
    expect(depth).toBe(0);
    return out.filter(Boolean);
  }

  test('every selector is scoped under .cdh-page', () => {
    const unscoped = selectors(css).filter(sel => !sel.startsWith('.cdh-page'));
    expect(unscoped).toEqual([]);
  });

  test('the page body carries the scope class', () => {
    expect(html).toMatch(/<body class="[^"]*\bcdh-page\b/);
  });

  test('stays on the site type scale', () => {
    const scale = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map(m => parseFloat(m[1]));
    expect(sizes.length).toBeGreaterThan(20);
    sizes.forEach(px => expect(scale).toContain(px));
    expect(css).not.toMatch(/font-size:\s*[0-9.]+rem/);
  });

  test('the calendar fallback keeps heading order and readable out-of-month days', () => {
    const calendar = read('public/assets/js/calendar-view.js');
    expect(calendar).not.toContain('<h4');
    expect(css).not.toContain('#8a93a3');
  });

  test('no pill radii, so badges and bars match the other customer pages', () => {
    expect(css).not.toMatch(/border-radius:\s*(999|9999)/);
  });

  test('calms motion for people who ask for it', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  test('no nested decorative gradients on cards', () => {
    // The only gradient allowed is the skeleton shimmer.
    const gradients = css.match(/(?:linear|radial)-gradient\([^)]*\)/g) || [];
    gradients.forEach(g => expect(g).toMatch(/#efede8|#f7f6f3/));
  });
});

describe('customer dashboard home: structure', () => {
  test('exactly one h1, and no repeated section headings', () => {
    expect(main.match(/<h1\b/g)).toHaveLength(1);
    const headings = [...main.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(m =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    );
    expect(headings.length).toBeGreaterThanOrEqual(8);
    expect(new Set(headings).size).toBe(headings.length);
  });

  test('budget and progress are shown once: no second tracker, ring or KPI row', () => {
    ['budget-tracker-widget', 'progress-ring-widget', 'customer-budget-kpis'].forEach(id =>
      expect(html).not.toContain(`id="${id}"`)
    );
    ['customer-milestones-widget', 'customer-event-countdown', 'customer-stats-grid'].forEach(id =>
      expect(html).not.toContain(`id="${id}"`)
    );
    expect(main.match(/id="budget-settings-form"/g)).toHaveLength(1);
  });

  test('no duplicate ids anywhere in the page', () => {
    const ids = idsIn(html);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  test('every id the page scripts read from the static page exists', () => {
    const required = [
      // init script
      'welcome-heading',
      'customer-plans-list',
      'saved-suppliers-status',
      'openPlanBtn',
      'events-calendar',
      'budget-settings-form',
      'custom-budget-input',
      'budget-status',
      // home module
      'cdh-lede',
      'cdh-next-action',
      'cdh-secondary-action',
      'cdh-summary-grid',
      'cdh-steps-body',
      'cdh-steps-sub',
      'budget-settings-panel',
      'budget-settings-cancel',
      'recommendations-widget',
      // calendar-view.js
      'cal-add-entry-btn',
      'calendar-next-up',
      'cal-legend',
      // customer-tickets.js
      'tickets-cust',
      'createTicketBtn',
      // messenger widget + unread badge manager
      'messenger-dashboard-widget',
      'unreadMessageBadge',
      // wedding website app
      'wedding-website-dashboard-card',
      'wedding-website-status-pill',
      'wedding-website-dashboard-root',
      // account type notice
      'account-type-notice',
      'account-type-notice-dismiss',
    ];
    const present = new Set(idsIn(html));
    expect(required.filter(id => !present.has(id))).toEqual([]);
  });

  test('every getElementById in the home and init scripts resolves to the page or is created by a script', () => {
    const created = new Set([
      // built by scripts at run time
      'email-verify-banner',
      'cdh-plan-edit-dialog',
      'cdh-pf-name',
      'cdh-plan-delete-dialog',
      'cdh-del-confirm',
    ]);
    const present = new Set(idsIn(html));
    // home module keeps its ids in one object
    const homeIds = [...homeJs.matchAll(/^\s{4}\w+: '([\w-]+)',?$/gm)].map(m => m[1]);
    const direct = [...initJs.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]);
    const missing = [...homeIds, ...direct].filter(id => !present.has(id) && !created.has(id));
    expect(missing).toEqual([]);
  });

  test('the plan sections each appear once, in the planned set', () => {
    const titles = [...main.matchAll(/class="cdh-card__title"[^>]*>([\s\S]*?)<\/h2>/g)].map(m =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    expect(titles).toEqual([
      'Next steps',
      'Wedding Website &amp; RSVPs',
      'Calendar',
      'Your plans',
      'Messages',
      'Saved suppliers',
      'Support',
    ]);
  });

  test('no emoji used as decoration in the page markup or the home module', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(main)).toBe(false);
    expect(emoji.test(homeJs)).toBe(false);
  });

  test('no accordion hides primary content: details only wraps completed steps', () => {
    expect(main).not.toMatch(/<details/);
    expect(homeJs.match(/<details/g)).toHaveLength(1);
    expect(homeJs).toMatch(/completed<\/summary>/);
  });

  test('scripts loaded in an order that lets the init script find the home module', () => {
    const home = html.indexOf('customer-dashboard-home.js');
    const init = html.indexOf('dashboard-customer-init.js');
    expect(home).toBeGreaterThan(-1);
    expect(init).toBeGreaterThan(home);
    expect(html).toMatch(/customer-dashboard-home\.js\?v=\d/);
    expect(html).toMatch(/dashboard-customer-init\.js\?v=\d/);
    expect(html).toMatch(/calendar-view\.js\?v=\d/);
    expect(html).toMatch(/recommendations-widget\.js\?v=\d/);
  });
});

describe('customer dashboard home: data handling', () => {
  test('summary figures are derived from one focus plan, not summed across plans', () => {
    expect(homeJs).toContain('function pickFocusPlan(');
    expect(homeJs).toMatch(/calculateSpent\(plan\)/);
  });

  test('the budget form edits the same plan the summary describes', () => {
    expect(initJs).toMatch(/const primaryPlan = focusPlan\(\)/);
    expect(initJs).toContain('pickFocusPlan');
  });

  test('a failed plans request shows an error state, not an empty dashboard', () => {
    expect(homeJs).toContain('function renderLoadError(');
    expect(homeJs).toMatch(/if \(!Array\.isArray\(plans\)\)/);
  });

  test('a failed plans request does not offer to create a plan', () => {
    const body = homeJs.slice(homeJs.indexOf('function renderLoadError('));
    expect(body.slice(0, body.indexOf('renderSteps(null)'))).toMatch(/primary\.hidden = true/);
    expect(homeJs).toMatch(/primary\.hidden = false/);
  });

  test('the primary action starts hidden so it never flashes the wrong label while plans load', () => {
    expect(html).toMatch(/id="cdh-next-action"[^>]*\bhidden\b/);
  });

  test('the budget tile links to the budget page for the focus plan', () => {
    expect(homeJs).toContain('/budget?plan=${encodeURIComponent(plan.id)}');
  });

  test('the plan editor and delete confirmation are native dialogs, not inline-styled overlays', () => {
    expect(initJs).toContain("document.createElement('dialog')");
    expect(initJs).toContain('dialog.showModal()');
    expect(initJs).not.toMatch(/overlay\.style\.cssText|position:fixed;inset:0/);
    expect(css).toMatch(/\.cdh-page \.cdh-dialog::backdrop/);
  });

  test('the recommendations widget does not start itself', () => {
    const widget = read('public/assets/js/recommendations-widget.js');
    expect(widget).not.toMatch(/addEventListener\('DOMContentLoaded', initRecommendations\)/);
    expect(homeJs).toContain('window.RecommendationsWidget.init()');
  });

  test('page scripts do not carry inline decorative styling for the cards they render', () => {
    expect(initJs).not.toMatch(/style="margin-top:0\.75rem;display:flex/);
    expect(read('public/assets/js/recommendations-widget.js')).not.toMatch(/style="/);
  });
});
