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

  test('shared files other pages still use were not deleted', () => {
    // The supplier dashboard redesign deleted card-collapse, dashboard-overhaul and dashboard-mobile's
    // other users; these two are still linked by mobile-preview.html.
    ['dashboard-mobile.css', 'dashboard-hero.css'].forEach(file =>
      expect(exists(`public/assets/css/${file}`)).toBe(true)
    );
    expect(exists('public/assets/js/dashboard-widgets.js')).toBe(true);
  });

  test('dashboard-guard no longer injects the removed mop-up and polish scripts', () => {
    const guard = read('public/assets/js/dashboard-guard.js');
    expect(guard).not.toMatch(/mop-up|customer-dashboard-polish/);
    expect(html).toMatch(/dashboard-guard\.js\?v=\d+\.\d+\.\d+/);
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

  test('the ticket dialogs get the same dark backdrop and square buttons as the other dialogs', () => {
    expect(css).toMatch(/\.cdh-page \.modal-overlay \{[^}]*rgba\(23, 32, 47, 0\.5\) !important/);
    expect(css).toMatch(
      /\.cdh-page \.modal-overlay \.btn \{[^}]*border-radius: var\(--cdh-radius-sm\) !important/
    );
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
      'cdh-signin-check-error',
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

  test('saved suppliers decode the entities the shortlist stores and never link every row to /suppliers', () => {
    expect(initJs).toContain('escapeHtml(decodeEntities(item.name');
    expect(initJs).toContain('function savedSupplierHref(');
    expect(initJs).toContain("'/suppliers?filter=saved'");
  });

  test('the guests tile counts people attending, as the guest list page does', () => {
    expect(homeJs).toContain('rsvp.partySizeTotal');
  });

  test('summary links open the guest list and budget on the plan the summary describes', () => {
    expect(homeJs).toContain('/guests?plan=${encodeURIComponent(plan.id)}');
    expect(homeJs).toContain('/budget?plan=${encodeURIComponent(plan.id)}');
  });

  test('the page scrolls to the section named in the URL hash once it has loaded', () => {
    expect(initJs).toContain('function scrollToHashTarget(');
    expect(initJs).toMatch(/setupEventHandlers\(\);\s+scrollToHashTarget\(\);/);
  });

  test('checklist steps that fill in an existing plan open the plan editor on their field', () => {
    expect(homeJs).toContain("'set-date': 'cdh-pf-date'");
    expect(homeJs).toContain("'set-guests': 'cdh-pf-guests'");
    expect(homeJs).toContain("'set-location': 'cdh-pf-location'");
    expect(homeJs).toContain('normaliseSteps(stepsData, plan)');
    expect(initJs).toContain('showEditPlanModal(plan, reloadDashboard, event.detail?.field)');
  });

  test('the plan editor never writes a guest count over a plan that keeps its guest list in `guests`', () => {
    expect(initJs).toContain('const guestCountEditable = !Array.isArray(plan.guests);');
    expect(initJs).toMatch(/if \(guestsInput\) \{\s+changes\.guests =/);
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

describe('what the suggestions panel is told about the plan', () => {
  const vm = require('vm');
  const dashboard = (() => {
    const window = { location: { search: '', hash: '', pathname: '/' }, addEventListener() {} };
    const document = {
      getElementById: () => null,
      addEventListener() {},
      readyState: 'loading',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    vm.runInNewContext(homeJs, {
      window,
      document,
      console,
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout,
    });
    return window.CustomerDashboardHome;
  })();
  const needed = plan => dashboard.neededSupplierCategories(plan);
  const lines = (...categories) => categories.map(category => ({ category, item: 'x' }));

  test('a plan with no budget lines still needs everything, so suggestions start broad', () => {
    expect(needed({ eventType: 'party', budgetItems: [] })).toEqual(
      expect.arrayContaining(['Venues', 'Catering', 'Photography', 'Entertainment', 'Decor'])
    );
    expect(needed(null)).toEqual(expect.arrayContaining(['Venues', 'Catering']));
  });

  test('a category with a budget line is no longer needed', () => {
    const list = needed({ eventType: 'party', budgetItems: lines('Venue', 'Catering') });
    expect(list).not.toContain('Venues');
    expect(list).not.toContain('Catering');
    expect(list).toEqual(expect.arrayContaining(['Photography', 'Entertainment', 'Decor']));
  });

  test('one budget category covers every supplier category it stands for', () => {
    expect(needed({ budgetItems: lines('Photography') })).not.toEqual(
      expect.arrayContaining(['Photography'])
    );
    expect(needed({ budgetItems: lines('Photography') })).not.toContain('Videography');
    expect(needed({ budgetItems: lines('Decor') })).not.toContain('Florist');
  });

  test('a budget line named like the supplier category counts too, whatever its case', () => {
    expect(needed({ budgetItems: lines('venues', ' CATERING ') })).not.toEqual(
      expect.arrayContaining(['Venues'])
    );
  });

  test('attire (bridalwear) is only needed for a wedding', () => {
    expect(needed({ eventType: 'wedding', budgetItems: [] })).toContain('Bridalwear');
    expect(needed({ eventType: 'corporate', budgetItems: [] })).not.toContain('Bridalwear');
  });

  test('a wedding is recognised the way the guest list recognises one', () => {
    expect(needed({ name: 'Our Wedding', budgetItems: [] })).toContain('Bridalwear');
    expect(needed({ eventName: 'Sam and Alex wedding', budgetItems: [] })).toContain('Bridalwear');
    expect(needed({ weddingWebsite: { slug: 'sam-alex' }, budgetItems: [] })).toContain(
      'Bridalwear'
    );
    expect(needed({ name: 'Office party', budgetItems: [] })).not.toContain('Bridalwear');
  });

  test('a budget line you wrote yourself still counts when its category names the thing', () => {
    const list = needed({
      eventType: 'party',
      budgetItems: lines('Venue hire', 'Photography & video', 'Catering and drinks', 'Decoration'),
    });
    expect(list).not.toEqual(expect.arrayContaining(['Venues']));
    expect(list).not.toEqual(expect.arrayContaining(['Photography']));
    expect(list).not.toContain('Videography');
    expect(list).not.toContain('Catering');
    expect(list).not.toContain('Decor');
    expect(list).not.toContain('Florist');
    expect(list).toEqual(expect.arrayContaining(['Entertainment', 'Transport']));
  });

  test('a blank or unrelated category covers nothing', () => {
    const list = needed({ eventType: 'party', budgetItems: lines('', '   ', 'Other', 'Misc') });
    expect(list).toEqual(expect.arrayContaining(['Venues', 'Catering', 'Photography']));
  });

  test('a plan that has covered everything needs nothing', () => {
    const all = lines('Venue', 'Catering', 'Photography', 'Entertainment', 'Decor', 'Transport');
    expect(needed({ eventType: 'party', budgetItems: all })).toEqual([]);
  });

  test('odd budget lines are ignored rather than breaking the panel', () => {
    expect(() => needed({ budgetItems: [null, {}, { category: 42 }, 'x'] })).not.toThrow();
  });

  test('only real supplier categories are ever sent', () => {
    const { VALID_CATEGORIES } = require('../../models/Supplier');
    needed({ eventType: 'wedding', budgetItems: [] }).forEach(name => {
      expect(VALID_CATEGORIES).toContain(name);
    });
  });

  test('the panel is told the location and the categories still needed, not an event type or a total', () => {
    const loader = homeJs.slice(homeJs.indexOf('function loadSuggestions('));
    const body = loader.slice(0, loader.indexOf('window.RecommendationsWidget.init()'));
    expect(body).toContain('widget.dataset.location = plan.location');
    expect(body).toContain('widget.dataset.needed = needed.join');
    expect(body).not.toContain('dataset.eventType');
    expect(body).not.toContain('dataset.budget');
  });
});

describe('the account-type notice', () => {
  const notice = html.slice(
    html.indexOf('<div id="account-type-notice"'),
    html.indexOf('</main>', html.indexOf('<div id="account-type-notice"'))
  );
  const noticeHtml = notice;
  const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at) + 1);
  };

  test('says it in one short sentence, with the rest of the message only where there is room', () => {
    expect(noticeHtml).toMatch(/Want to list a business\?/);
    expect(noticeHtml).toMatch(
      /<span class="cdh-notice__more"> Switch to a supplier account\.<\/span>/
    );
    expect(noticeHtml).not.toMatch(/You’re signed up as a/);
    const text = noticeHtml.match(/<p class="cdh-notice__text">([\s\S]*?)<\/p>/)[1];
    // The only markup inside the sentence is the one span, so remove exactly that.
    const spoken = text
      .replace('<span class="cdh-notice__more">', '')
      .replace('</span>', '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(spoken).toBe('Want to list a business? Switch to a supplier account.');
    expect(spoken).not.toContain('<');
    expect(spoken.length).toBeLessThan(60);
  });

  test('keeps the "details come with you" reassurance on the button', () => {
    expect(noticeHtml).toMatch(/title="Your details come with you"/);
  });

  test('Switch and Dismiss are one group, next to each other, and Dismiss is a labelled button', () => {
    const actions = noticeHtml.match(
      /<div class="cdh-notice__actions">([\s\S]*?)<\/div>\s*<\/div>/
    )[1];
    expect(actions).toMatch(/class="cdh-notice__cta"[^>]*href="\/settings#account-type-card"/);
    expect(actions.indexOf('cdh-notice__cta')).toBeLessThan(actions.indexOf('cdh-notice__dismiss'));
    expect(actions).toMatch(
      /<button type="button" class="cdh-notice__dismiss" id="account-type-notice-dismiss">\s*Dismiss\s*<\/button>/
    );
    expect(noticeHtml).not.toMatch(/aria-label="Dismiss account type notice"/);
  });

  test('on the narrowest phones the label shortens to "Switch" but keeps its full accessible name', () => {
    expect(noticeHtml).toMatch(/aria-label="Switch to Supplier"/);
    // One inline label holds both parts, so the space between them survives inside the flex link.
    expect(noticeHtml).toContain(
      '<span class="cdh-notice__cta-label">Switch<span class="cdh-notice__cta-more"> to Supplier</span></span>'
    );
    expect(css).toMatch(
      /@container cdh-notice \(max-width: 259px\) \{\s*\.cdh-page \.cdh-notice__cta-more \{\s*display: none;/
    );
  });

  test('on a phone the main button gets the room and Dismiss stays as wide as its word', () => {
    const phone = css.slice(css.indexOf('@container cdh-notice (max-width: 459px)'));
    expect(phone).toMatch(/grid-template-columns: 1fr auto;/);
    expect(phone).not.toMatch(/grid-template-columns: 1fr 1fr;/);
  });

  test('the other banner on the page keeps its text filling the row', () => {
    // dashboard-customer-init.js builds a .cdh-banner with a .cdh-banner__text; it shares no rule
    // with the notice, so the notice's own rules must not stand in for it.
    expect(rule('.cdh-page .cdh-banner__text')).toMatch(/flex: 1 1 auto;/);
    expect(rule('.cdh-page .cdh-banner__text')).toMatch(/min-width: 0;/);
  });

  test('the text scales with the notice, between 12px and 14px, on one line', () => {
    const text = rule('.cdh-page .cdh-notice__text');
    expect(text).toMatch(/white-space: nowrap;/);
    expect(text).toMatch(/font-size: clamp\(12px, calc\(\(100cqi - \d+px\) \/ \d+\), 14px\);/);
    expect(rule('.cdh-page .cdh-notice')).toMatch(/container: cdh-notice \/ inline-size;/);
  });

  test('sizes follow the notice, in three steps: full message, just the question, then two lines', () => {
    expect(css).toMatch(
      /@container cdh-notice \(max-width: 599px\) \{[^@]*\.cdh-notice__more \{\s*display: none;/
    );
    const phone = css.slice(css.indexOf('@container cdh-notice (max-width: 459px)'));
    expect(phone).toMatch(/\.cdh-notice__inner \{\s*flex-direction: column;/);
    expect(phone).toMatch(
      /\.cdh-notice__actions \{\s*display: grid;\s*grid-template-columns: 1fr auto;/
    );
  });

  test('browsers without container queries get the same three steps from the screen width', () => {
    const fallback = css.slice(css.indexOf('@supports not (container-type: inline-size)'));
    expect(fallback).toMatch(
      /@media \(max-width: 760px\) \{\s*\.cdh-page \.cdh-notice__more \{\s*display: none;/
    );
    expect(fallback).toMatch(/@media \(max-width: 540px\) \{[^@]*flex-direction: column;/);
    expect(fallback).toMatch(
      /@media \(max-width: 345px\) \{\s*\.cdh-page \.cdh-notice__cta-more \{\s*display: none;/
    );
  });

  test('both buttons are the same height (the site touch-target size) and the old corner × is gone', () => {
    expect(rule('.cdh-page .cdh-notice__cta,\n.cdh-page .cdh-notice__dismiss')).toMatch(
      /min-height: 44px;/
    );
    expect(css).not.toMatch(/\.cdh-notice__dismiss \{[^}]*position: absolute/);
    expect(css).not.toMatch(/padding-right: 48px/);
  });
});
