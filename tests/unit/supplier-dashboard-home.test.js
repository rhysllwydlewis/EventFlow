'use strict';

/**
 * Supplier dashboard home (public/dashboard-supplier.html) structural invariants.
 *
 * The page used to be 32 stylesheets, 59 scripts, five overlapping "how complete is my profile"
 * surfaces and metrics the server could not honestly supply. These tests keep it consolidated:
 *   - one page stylesheet, scoped so it cannot leak
 *   - every element id the scripts read still exists, and each id exists once
 *   - no repeated section headings, accordions, inline styles, inline handlers or emoji
 *   - the removed layers stay removed, and nothing still links to a deleted file
 *   - the pure logic (next-step order, metric formatting, honest nulls) and the rendered page
 *     behave as documented in docs/SUPPLIER_DASHBOARD_HOME.md
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = rel => fs.existsSync(path.join(ROOT, rel));

const html = read('public/dashboard-supplier.html');
const css = read('public/assets/css/supplier-dashboard-home.css');
const homeJs = read('public/assets/js/pages/supplier-dashboard-home.js');
const appJs = read('public/assets/js/app.js');
const verificationJs = read('public/assets/js/pages/dashboard-supplier-verification.js');

/** The <main> element, where the page's own content lives. */
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

/** The markup with every HTML comment removed, so ids inside comments are not counted. */
const withoutComments = markup => markup.replace(/<!--[\s\S]*?-->/g, '');

/** Every element id in a piece of markup, ignoring commented-out markup. */
const idsIn = markup => [...withoutComments(markup).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

/** Every public HTML page, as { rel, text }. */
const publicPages = (() => {
  const pages = [];
  const walk = dir => {
    fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(entry => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'vendor') {
          walk(rel);
        }
      } else if (entry.name.endsWith('.html')) {
        pages.push({ rel, text: read(rel) });
      }
    });
  };
  walk('public');
  return pages;
})();

describe('supplier dashboard home: stylesheets', () => {
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m => m[1]);

  test('exactly one supplier-dashboard stylesheet is linked, and it is versioned', () => {
    const dashboardSheets = links.filter(href => /supplier-dashboard-/.test(href));
    expect(dashboardSheets).toHaveLength(1);
    expect(dashboardSheets[0]).toMatch(/supplier-dashboard-home\.css\?v=\d+\.\d+\.\d+$/);
  });

  test('the layered patch sheets are not linked from this page', () => {
    [
      'supplier-dashboard-improvements',
      'supplier-dashboard-liquid-glass',
      'supplier-dashboard-v3-polish',
      'supplier-dashboard-visual-refresh',
      'supplier-dashboard-aesthetic-refresh',
      'dashboard-hero',
      'dashboard-overhaul',
      'dashboard-mobile',
      'dashboard-animations',
      'card-collapse',
      'supplier-utils',
      'profile-health',
      'liquid-glass',
      'messaging-glass',
      'p3-features',
      'design-tokens',
    ].forEach(name => {
      expect(links.filter(href => href.includes(name))).toEqual([]);
    });
  });

  test('stylesheets and scripts that only this page used are gone', () => {
    [
      'public/assets/css/supplier-dashboard-liquid-glass.css',
      'public/assets/css/supplier-dashboard-v3-polish.css',
      'public/assets/css/supplier-dashboard-visual-refresh.css',
      'public/assets/css/supplier-dashboard-aesthetic-refresh.css',
      'public/assets/css/supplier-utils.css',
      'public/assets/css/profile-health.css',
      'public/assets/css/dashboard-overhaul.css',
      'public/assets/css/dashboard-animations.css',
      'public/assets/css/card-collapse.css',
      'public/assets/css/liquid-glass-mobile.css',
      'public/assets/css/messaging-glass-enhancements.css',
      'public/assets/js/pages/dashboard-supplier-module.js',
      'public/assets/js/pages/dashboard-supplier-auth.js',
      'public/assets/js/pages/dashboard-supplier-threads.js',
      'public/assets/js/pages/dashboard-supplier-actions.js',
      'public/assets/js/pages/dashboard-supplier-breadcrumb.js',
      'public/assets/js/pages/dashboard-supplier-inline.js',
      'public/assets/js/dashboard-supplier-overhaul.js',
      'public/assets/js/dashboard-supplier-websocket.js',
      'public/assets/js/supplier-dashboard-enhancements.js',
      'public/assets/js/supplier-analytics-chart.js',
      'public/assets/js/liquid-glass-engine.js',
      'public/assets/js/card-collapse.js',
      'public/supplier/js/feature-access.js',
    ].forEach(file => expect(exists(file)).toBe(false));
  });

  test('no page still links a deleted file', () => {
    const deleted = [
      'supplier-dashboard-liquid-glass.css',
      'supplier-dashboard-v3-polish.css',
      'supplier-dashboard-visual-refresh.css',
      'supplier-dashboard-aesthetic-refresh.css',
      'supplier-utils.css',
      'profile-health.css',
      'dashboard-overhaul.css',
      'dashboard-animations.css',
      'card-collapse.css',
      'liquid-glass-mobile.css',
      'messaging-glass-enhancements.css',
      'dashboard-supplier-module.js',
      'dashboard-supplier-auth.js',
      'dashboard-supplier-threads.js',
      'dashboard-supplier-actions.js',
      'dashboard-supplier-breadcrumb.js',
      'dashboard-supplier-inline.js',
      'dashboard-supplier-overhaul.js',
      'dashboard-supplier-websocket.js',
      'supplier-dashboard-enhancements.js',
      'supplier-analytics-chart.js',
      'liquid-glass-engine.js',
      'card-collapse.js',
      'feature-access.js',
    ];
    const linked = [];
    publicPages.forEach(({ rel, text }) => {
      deleted.forEach(name => {
        if (text.includes(`/${name}`)) {
          linked.push(`${rel} -> ${name}`);
        }
      });
    });
    expect(linked).toEqual([]);
  });

  test('files other pages still use were not deleted', () => {
    // supplier-dashboard-improvements.css is still linked by the public supplier pages.
    expect(exists('public/assets/css/supplier-dashboard-improvements.css')).toBe(true);
    const users = publicPages.filter(page =>
      page.text.includes('supplier-dashboard-improvements.css')
    );
    expect(users.length).toBeGreaterThanOrEqual(3);
    expect(users.map(page => page.rel)).not.toContain('public/dashboard-supplier.html');
    // Linked by mobile-preview.html.
    ['dashboard-hero.css', 'dashboard-mobile.css'].forEach(file =>
      expect(exists(`public/assets/css/${file}`)).toBe(true)
    );
    // Shared with the admin supplier page and the public pages.
    expect(exists('public/assets/js/components/profile-health-widget.js')).toBe(true);
    expect(exists('public/assets/js/utils/lead-quality-helper.js')).toBe(true);
    expect(exists('public/assets/js/utils/tier-icon.js')).toBe(true);
    expect(exists('public/assets/js/vendor/confetti-safe.js')).toBe(true);
  });

  test('the old layers are not loaded as scripts either', () => {
    [
      'dashboard-supplier-module',
      'liquid-glass',
      'card-collapse',
      'p3-features',
      'tier-icon',
      'confetti',
      'MessengerTrigger',
      'components.js',
      'toast-notifications',
      'notification-system',
      'notification-dispatcher',
      'profile-health-widget',
    ].forEach(name => expect(html).not.toContain(name));
  });
});

describe('supplier dashboard home: stylesheet scoping', () => {
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

  test('every selector is scoped under .sdh-page', () => {
    const unscoped = selectors(css).filter(sel => !sel.startsWith('.sdh-page'));
    expect(unscoped).toEqual([]);
  });

  test('the page body carries the scope class', () => {
    expect(html).toMatch(/<body class="[^"]*\bsdh-page\b/);
  });

  test('stays on the site type scale', () => {
    const scale = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32];
    const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map(m => parseFloat(m[1]));
    expect(sizes.length).toBeGreaterThan(40);
    sizes.forEach(px => expect(scale).toContain(px));
    expect(css).not.toMatch(/font-size:\s*[0-9.]+(rem|em)/);
  });

  test('no pill radii, no backdrop blur, and no gradients except the loading shimmer', () => {
    expect(css).not.toMatch(/border-radius:\s*(999|9999)/);
    expect(css).not.toContain('backdrop-filter: blur');
    const gradients = css.match(/(?:linear|radial)-gradient\([^)]*\)/g) || [];
    gradients.forEach(g => expect(g).toMatch(/#efede8|#f7f6f3/));
  });

  test('enforces [hidden], calms motion and keeps keyboard focus visible', () => {
    expect(css).toMatch(/\.sdh-page \[hidden\] \{\s*display: none !important;/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('):focus-visible {');
  });

  test('icon-only .ef-cta buttons keep their padding reset (CLAUDE.md)', () => {
    expect(css).toMatch(/#ef-bottom-menu \{\s*padding: 0 !important;/);
  });

  test('touch targets are 44px on the controls the page draws', () => {
    expect(css).toMatch(/\.sdh-page \.sdh-btn \{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.sdh-page \.sdh-input \{[^}]*min-height: 44px;/);
  });
});

describe('supplier dashboard home: structure', () => {
  test('exactly one h1, and no repeated section headings', () => {
    expect(main.match(/<h1\b/g)).toHaveLength(1);
    const headings = [...main.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map(m =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    );
    expect(headings.length).toBeGreaterThanOrEqual(10);
    expect(new Set(headings).size).toBe(headings.length);
  });

  test('the cards appear once each, in the planned set', () => {
    const titles = [...main.matchAll(/class="sdh-card__title"[^>]*>([\s\S]*?)<\/h2>/g)].map(m =>
      m[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    expect(titles).toEqual([
      'Next steps',
      'Your profile',
      'Your packages',
      'Reviews',
      'Calendar',
      'Messages',
      'Availability',
      'Profile visits',
      'Tips',
      'Plan',
      'Support',
    ]);
  });

  test('completeness is shown once: no second ring, health card, hero tip or onboarding card', () => {
    [
      'profile-completeness-widget',
      'welcome-pro-tip',
      'next-steps-card',
      'next-steps-list',
      'onboarding',
      'supplier-pro-ribbon',
      'earnings-overview',
      'lead-quality',
      'supplier-conversion-funnel',
      'supplier-response-time',
      'quick-stat-',
    ].forEach(text => expect(html).not.toContain(text));
  });

  test('no duplicate ids anywhere in the page', () => {
    const ids = idsIn(html);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  test('every id the page scripts read from the static page exists', () => {
    const required = [
      // home script
      'welcome-heading',
      'sdh-lede',
      'sdh-next-action',
      'sdh-secondary-action',
      'sdh-banners',
      'verification-status-banner',
      'sdh-summary-grid',
      'sdh-summary-extra',
      'sdh-steps-body',
      'sdh-steps-sub',
      'sdh-view-public',
      'supplier-performance-chart',
      'sdh-performance-sub',
      'supplier-perf-tips',
      'sdh-tips',
      'supplier-availability-widget',
      'supplier-subscription-card',
      'supplier-reviews-section',
      'supplier-review-request-widget',
      'sdh-review-dialog',
      'supplier-review-request-form',
      'rreq-email',
      'rreq-name',
      'rreq-status',
      'rreq-send-btn',
      'sdh-confirm-dialog',
      'sdh-confirm-title',
      'sdh-confirm-text',
      'sdh-confirm-ok',
      'sdh-confirm-cancel',
      'sdh-request-review-btn',
      'sr-announcer',
      // app.js profile and package forms
      'my-suppliers',
      'toggle-profile-form',
      'profile-form-section',
      'supplier-form',
      'sup-id',
      'sup-name',
      'sup-category',
      'sup-location',
      'sup-base-postcode',
      'sup-travel-radius',
      'sup-service-area-search',
      'sup-service-area-results',
      'sup-service-area-tags',
      'sup-service-area-add-nationwide',
      'sup-service-area-max',
      'sup-short',
      'sup-long',
      'sup-website',
      'sup-license',
      'sup-amenities',
      'sup-max',
      'venue-postcode-row',
      'sup-venue-postcode',
      'sup-photos',
      'sup-photo-drop',
      'sup-photo-preview',
      'sup-gallery-reorder-bar',
      'sup-gallery-save-order',
      'sup-gallery-order-status',
      'sup-manage-gallery-link',
      'sup-create',
      'sup-preview',
      'cancel-profile-form',
      'sup-status',
      'sup-name-error',
      'sup-category-error',
      'sup-website-error',
      'my-packages',
      'toggle-package-form',
      'package-form-section',
      'package-form',
      'pkg-supplier',
      'pkg-title',
      'pkg-price',
      'pkg-category',
      'pkg-event-wedding',
      'pkg-desc',
      'pkg-image',
      'pkg-photo-drop',
      'pkg-photo-preview',
      'pkg-use-profile-photo-btn',
      'pkg-reuse-photo-panel',
      'pkg-manage-gallery-link',
      'pkg-gallery-row',
      'pkg-gallery-existing',
      'pkg-gallery-reorder-bar',
      'pkg-gallery-save-order',
      'pkg-gallery-order-status',
      'cancel-package-form',
      'pkg-status',
      'pkg-supplier-id-hidden',
      'pkg-id-hidden',
      'pkg-limit-note',
      // calendar, tickets, messenger, export
      'availability-calendar',
      'supplier-events-calendar',
      'sup-cal-add-entry-btn',
      'sup-cal-add-event-btn',
      'sup-cal-permission-notice',
      'sup-my-public-events',
      'sup-cal-legend',
      'supplier-cal-cta',
      'supplier-cal-subtitle',
      'tickets-sup',
      'createSupplierTicketBtn',
      'messenger-dashboard-widget-supplier',
      'unreadMessageBadge',
      'export-enquiries-btn',
      // verification dialog
      'sv-verification-modal',
      'sv-verification-form',
      'sv-modal-title',
      'sv-modal-subtitle',
      'sv-modal-error',
      'sv-modal-success',
      'sv-modal-close',
      'sv-fields',
      'sv-name',
      'sv-category',
      'sv-phone',
      'sv-location',
      'sv-email',
      'sv-supplier-note-block',
      'sv-supplier-note',
      'sv-rejection-notes-block',
      'sv-rejection-notes-text',
      'sv-submit-btn',
      'sv-cancel-btn',
    ];
    const present = new Set(idsIn(html));
    expect(required.filter(id => !present.has(id))).toEqual([]);
  });

  test('every id in the home script resolves to the page or is built by a script', () => {
    const created = new Set([
      'email-verify-banner',
      'sdh-availability-note',
      'sdh-availability-status',
    ]);
    const present = new Set(idsIn(html));
    const idBlock = homeJs.slice(
      homeJs.indexOf('const ids = {'),
      homeJs.indexOf('};', homeJs.indexOf('const ids = {'))
    );
    const homeIds = [...idBlock.matchAll(/^\s{4}\w+: '([\w-]+)',?$/gm)].map(m => m[1]);
    const direct = [...homeJs.matchAll(/byId\('([\w-]+)'\)/g)].map(m => m[1]);
    const missing = [...homeIds, ...direct].filter(id => !present.has(id) && !created.has(id));
    expect(missing).toEqual([]);
  });

  test('no inline styles or inline handlers in the page markup', () => {
    // The shared site header, bottom nav and footer carry a few of their own; this page's content does not.
    expect(main).not.toMatch(/\sstyle=/);
    expect(main).not.toMatch(/\son[a-z]+=/);
    expect(homeJs).not.toMatch(/\sstyle="/);
    expect(homeJs).not.toMatch(/\son[a-z]+="/);
  });

  test('no emoji used as decoration in the page markup or the page scripts', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(main)).toBe(false);
    expect(emoji.test(homeJs)).toBe(false);
    expect(emoji.test(verificationJs)).toBe(false);
  });

  test('no accordion hides primary content: details only wraps completed steps', () => {
    expect(main).not.toMatch(/<details/);
    expect(homeJs.match(/<details/g)).toHaveLength(1);
    expect(homeJs).toMatch(/completed<\/summary>/);
    expect(html).not.toContain('card-collapse');
    expect(html).not.toContain('Expand all');
  });

  test('mobile has only the site header and the existing bottom nav: no pill nav or hero chips', () => {
    expect(html).not.toContain('dashboard-mobile-nav');
    expect(html).not.toContain('mobile-nav-pill');
    expect(html).not.toContain('dashboard-action-chip');
    expect(html).toContain('class="ef-bottom-nav"');
  });

  test('the primary action starts hidden so it never flashes the wrong label while the summary loads', () => {
    expect(html).toMatch(/id="sdh-next-action"[^>]*\bhidden\b/);
  });

  test('the verification strip is hidden with the hidden attribute, which the page sheet enforces', () => {
    expect(html).toMatch(/id="verification-status-banner"[^>]*\bhidden\b/);
    expect(html).not.toMatch(/id="verification-status-banner"[^>]*style=/);
  });

  test('scripts load in an order that lets app.js find the home script, all versioned', () => {
    const home = html.indexOf('supplier-dashboard-home.js');
    const app = html.indexOf('/assets/js/app.js');
    expect(home).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(home);
    expect(html).toMatch(/supplier-dashboard-home\.js\?v=\d/);
    expect(html).toMatch(/dashboard-supplier-verification\.js\?v=\d/);
    expect(html).toMatch(/dashboard-supplier-calendar\.js\?v=\d/);
    expect(html).toMatch(/supplier-reviews-init\.js\?v=\d/);
    expect(html).toMatch(/dashboard-supplier-export\.js\?v=\d/);
  });

  test('every page that loads app.js is on the new version', () => {
    const stale = publicPages.filter(page => /assets\/js\/app\.js\?v=18\.5\.6/.test(page.text));
    expect(stale.map(page => page.rel)).toEqual([]);
    const withApp = publicPages.filter(page => /assets\/js\/app\.js/.test(page.text));
    withApp.forEach(page => expect(page.text).toMatch(/assets\/js\/app\.js\?v=18\.5\.7/));
  });

  test('the dashboard guard is on the same version as the customer dashboard', () => {
    expect(html).toMatch(/dashboard-guard\.js\?v=17\.1\.0/);
  });
});

describe('supplier dashboard home: honest metrics', () => {
  test('no invented numbers or claims in the page or its scripts', () => {
    const copy = `${main}\n${homeJs}\n${verificationJs}`;
    [
      /\b3x\b/i,
      /3×/,
      /more enquiries/i,
      /more bookings/i,
      /increase booking/i,
      /up to 40%/i,
      /triples/i,
      /Math\.random/,
    ].forEach(pattern => expect(copy).not.toMatch(pattern));
  });

  test('metrics with no data source are not on the page', () => {
    [
      'Earnings',
      'Coming soon',
      'Coming Soon',
      'Lead Quality',
      'Enquiry Rate',
      'Conversion',
    ].forEach(text => {
      expect(main).not.toContain(text);
      expect(homeJs).not.toContain(text);
    });
    expect(main).not.toMatch(/\bbookings?\b/i);
  });

  test('a missing value is never shown as 0 or 100', () => {
    expect(homeJs).not.toMatch(/\|\|\s*100\b/);
    expect(homeJs).toContain('Not available');
  });

  test('profile visits say they count page loads, and name the window the server served', () => {
    expect(homeJs).toContain('Counts page loads, not people.');
    expect(homeJs).toContain('Profile visits, last ${views.days} days');
  });

  test('the home script has JSDoc on every function', () => {
    const lines = homeJs.split('\n');
    const missing = [];
    lines.forEach((line, index) => {
      if (
        /^\s*(async\s+)?function\s+\w+\(/.test(line) ||
        /^\s*const\s+\w+\s*=\s*(async\s*)?\(?\w*\)?\s*=>/.test(line)
      ) {
        let above = index - 1;
        while (above >= 0 && lines[above].trim() === '') {
          above -= 1;
        }
        if (!/\*\/\s*$/.test(lines[above] || '')) {
          missing.push(line.trim());
        }
      }
    });
    expect(missing).toEqual([]);
  });
});

describe('supplier dashboard home: pure logic', () => {
  const home = (() => {
    const classList = { toggle() {} };
    const node = () => ({
      classList,
      dataset: {},
      style: {},
      setAttribute() {},
      removeAttribute() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    });
    const window = {
      addEventListener() {},
      setTimeout: () => 0,
      clearTimeout() {},
      matchMedia: () => ({ matches: false }),
      location: { hash: '', href: '' },
    };
    const document = {
      getElementById: () => null,
      createElement: node,
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      body: node(),
      readyState: 'loading',
    };
    vm.runInNewContext(homeJs, {
      window,
      document,
      console,
      fetch: () => Promise.reject(new Error('offline')),
      setTimeout,
      clearTimeout,
    });
    return window.SupplierDashboardHome;
  })();

  const example = JSON.parse(
    JSON.stringify({
      window: { days: 30, maxDays: 90, requestedDays: 30 },
      verification: {
        emailVerified: true,
        approved: true,
        state: 'approved',
        status: 'approved',
        notes: null,
        rejectionCount: 0,
      },
      profile: {
        name: 'Moor Audio',
        publicProfilePath: '/supplier/moor-audio--3fc5ec9ce919df35',
        completeness: {
          score: 85,
          checks: [
            { id: 'coverImage', label: 'Banner image', done: false },
            { id: 'logo', label: 'Profile photo', done: true },
          ],
        },
      },
      packages: {
        total: 3,
        active: 1,
        paused: 1,
        awaitingApproval: 1,
        limit: 50,
        countedTowardsLimit: 2,
      },
      messages: { unreadMessages: 4, conversationsWithUnread: 3 },
      responses: { sampleSize: 5, repliedPct: 75, medianMinutes: 30 },
      views: { total: 5, days: 30, basis: 'page_loads' },
      reviews: { approvedCount: 3, averageRating: 4.5, pendingCount: 1 },
      subscription: {
        plan: 'pro',
        status: 'active',
        limits: { maxPackages: 50, maxPhotos: 500, analyticsWindowDays: 90 },
      },
      analytics: {
        dailyData: [
          { date: '2026-07-01', views: 2 },
          { date: '2026-07-02', views: 3 },
        ],
      },
      nextSteps: {
        steps: [
          { id: 'verify-email', label: 'Verify your email address', done: true },
          {
            id: 'banner',
            label: 'Add a banner image',
            done: false,
            href: '/supplier/profile-customization#sup-banner-drop',
          },
          {
            id: 'first-package',
            label: 'Create your first package',
            done: false,
            locked: true,
            lockedReason: 'Your profile must be approved first',
          },
        ],
        primaryStepId: 'banner',
      },
    })
  );

  describe('normaliseSummary', () => {
    test('reads the real contract', () => {
      const model = home.normaliseSummary(example);
      expect(model.verification).toMatchObject({
        approved: true,
        state: 'approved',
        emailVerified: true,
      });
      expect(model.profile).toMatchObject({ name: 'Moor Audio', score: 85 });
      expect(model.messages).toMatchObject({ unread: 4, conversations: 3 });
      expect(model.reviews).toMatchObject({ count: 3, average: 4.5, pending: 1 });
      expect(model.views).toMatchObject({ total: 5, days: 30 });
      expect(model.views.daily).toHaveLength(2);
      expect(model.packages).toMatchObject({ active: 1, counted: 2, limit: 50 });
    });

    test('a block that is missing or null stays null: nothing is defaulted to 0 or 100', () => {
      const model = home.normaliseSummary({
        messages: { unreadMessages: null },
        responses: null,
        reviews: {},
      });
      expect(model.messages.unread).toBeNull();
      expect(model.responses).toBeNull();
      expect(model.reviews.count).toBeNull();
      expect(model.reviews.average).toBeNull();
      expect(model.views).toBeNull();
      expect(model.subscription).toBeNull();
      expect(model.verification).toBeNull();
    });

    test('survives garbage', () => {
      [null, undefined, 5, 'x', [], { profile: 'no', packages: [] }].forEach(value => {
        expect(() => home.normaliseSummary(value)).not.toThrow();
      });
      expect(home.normaliseSummary({ views: { total: '12' } }).views.total).toBeNull();
    });

    test('prefers the detailed verification status and treats limit -1 as no limit', () => {
      const model = home.normaliseSummary({
        verification: {
          approved: false,
          state: 'rejected',
          status: 'needs_changes',
          notes: 'Add a phone number',
        },
        packages: { total: 1, active: 1, limit: -1 },
      });
      expect(model.verification.state).toBe('needs_changes');
      expect(model.verification.notes).toBe('Add a phone number');
      expect(model.packages.limit).toBeNull();
    });
  });

  describe('next steps', () => {
    test('the server list is used, the first open step is the primary action, and locked steps are skipped', () => {
      const model = home.normaliseSummary(example);
      expect(model.nextSteps.steps).toHaveLength(3);
      // The banner is a polish step (an Edit profile field), never the headline action, and the
      // package step is locked: nothing is left to headline.
      expect(home.pickPrimaryStep(model.nextSteps)).toBeNull();
      const withSetup = {
        ...model.nextSteps,
        steps: [
          ...model.nextSteps.steps,
          { key: 'description', label: 'Add a description', done: false, locked: false },
        ],
      };
      expect(home.pickPrimaryStep(withSetup).key).toBe('description');
      const noPrimary = { ...withSetup, primaryKey: '' };
      expect(home.pickPrimaryStep(noPrimary).key).toBe('description');
      // Even when the server names the banner as primary, it is not the headline action.
      expect(home.pickPrimaryStep({ ...withSetup, primaryKey: 'banner' }).key).toBe('description');
      const allLocked = { steps: [{ key: 'a', done: false, locked: true }], primaryKey: '' };
      expect(home.pickPrimaryStep(allLocked)).toBeNull();
    });

    test('a step in review waits instead of being the next action', () => {
      const steps = home.normaliseSummary({
        nextSteps: {
          steps: [
            { id: 'get-verified', label: 'Get your profile verified', done: false },
            { id: 'description', label: 'Add a description', done: false },
          ],
        },
      }).nextSteps;
      const waiting = home.applyVerificationState(steps, {
        approved: false,
        state: 'pending_review',
      });
      expect(waiting.steps[0]).toMatchObject({ waiting: true, label: 'Verification is in review' });
      expect(home.pickPrimaryStep(waiting).key).toBe('description');
      // Not in review: the step stays an action.
      expect(
        home.pickPrimaryStep(
          home.applyVerificationState(steps, { approved: false, state: 'unverified' })
        ).key
      ).toBe('get-verified');
    });

    test('derived steps put email first, then profile checks, then approval, then the first package', () => {
      const model = home.normaliseSummary({
        verification: { approved: false, state: 'unverified' },
        profile: {
          completeness: {
            score: 40,
            checks: [
              { id: 'logo', label: 'Profile photo', done: false },
              { id: 'website', label: 'Website', done: true },
            ],
          },
        },
        packages: { total: 0 },
        reviews: { approvedCount: 0 },
      });
      const steps = home.deriveSteps(model, { emailVerified: false });
      expect(steps.steps.map(step => step.key)).toEqual([
        'verify-email',
        'profile-logo',
        'get-approved',
        'first-package',
        'profile-website',
      ]);
      expect(steps.steps.find(step => step.key === 'first-package').locked).toBe(true);
      expect(steps.steps.find(step => step.key === 'profile-website').done).toBe(true);
      expect(steps.completed).toBe(1);
      expect(home.pickPrimaryStep(steps).key).toBe('verify-email');
    });

    test('derives nothing when it knows nothing', () => {
      expect(home.deriveSteps(home.normaliseSummary({}), {})).toBeNull();
    });

    test('each step maps to an action the page owns, or to its own link', () => {
      expect(home.stepAction({ key: 'verify-email' })).toEqual({ action: 'resend-email' });
      expect(home.stepAction({ key: 'get-verified' })).toEqual({ action: 'verify' });
      expect(home.stepAction({ key: 'first-package' })).toEqual({ action: 'new-package' });
      expect(home.stepAction({ key: 'package-photos' })).toMatchObject({
        action: 'scroll',
        target: 'my-packages',
      });
      expect(home.stepAction({ key: 'request-review' })).toEqual({ action: 'request-review' });
      expect(home.stepAction({ key: 'profile-photo' })).toEqual({ action: 'upload-avatar' });
      expect(home.stepAction({ key: 'description' })).toMatchObject({
        action: 'edit-profile',
        focus: 'sup-long',
      });
      expect(home.stepAction({ key: 'website' })).toMatchObject({ focus: 'sup-website' });
      // The banner is a field in the profile editor; tagline and social links are on their own page.
      expect(
        home.stepAction({ key: 'banner', href: '/supplier/profile-customization#sup-banner-drop' })
      ).toEqual({ action: 'edit-profile', focus: 'sdh-banner-upload' });
      expect(home.stepAction({ key: 'profile-coverImage' })).toMatchObject({
        action: 'edit-profile',
        focus: 'sdh-banner-upload',
      });
      expect(home.stepAction({ key: 'social-links' })).toEqual({
        href: '/supplier/profile-customization',
      });
      expect(home.stepAction({ key: 'calendar' })).toMatchObject({
        target: 'availability-calendar',
      });
    });
  });

  describe('formatting', () => {
    test('typical reply time is never rounded down to "0 h"', () => {
      expect(home.formatMinutes(0.4)).toBe('Under a minute');
      expect(home.formatMinutes(20)).toBe('20 min');
      expect(home.formatMinutes(108)).toBe('1 h 48 min');
      expect(home.formatMinutes(120)).toBe('2 h');
      expect(home.formatMinutes(60 * 24 * 3)).toBe('3 days');
      expect(home.formatMinutes(null)).toBe('');
      expect(home.formatMinutes(-5)).toBe('');
    });

    test('rating is one decimal, and nothing when there is none', () => {
      expect(home.formatRating(4.83)).toBe('4.8');
      expect(home.formatRating(5)).toBe('5.0');
      expect(home.formatRating(0)).toBe('');
      expect(home.formatRating(null)).toBe('');
    });

    test('plan usage counts what the server counts, and says "no limit" honestly', () => {
      expect(home.packageUsage(home.normaliseSummary(example))).toBe('2 of 50 active packages');
      expect(
        home.packageUsage(home.normaliseSummary({ packages: { total: 2, active: 2, limit: -1 } }))
      ).toBe('2 active packages');
      expect(
        home.packageUsage(home.normaliseSummary({ packages: { total: 0, active: 0, limit: -1 } }))
      ).toBe('No active packages yet');
      expect(home.packageUsage(home.normaliseSummary({}))).toBe('');
      const free = home.normaliseSummary({
        packages: { active: 1 },
        subscription: { plan: 'free', limits: { maxPackages: 3 } },
      });
      expect(home.packageUsage(free)).toBe('1 of 3 active packages');
    });

    test('plan names are the ones on the pricing page', () => {
      expect(home.planLabel('free')).toBe('Starter');
      expect(home.planLabel('pro')).toBe('Pro');
      expect(home.planLabel('pro_plus')).toBe('Pro Plus');
    });
  });

  describe('reply figures', () => {
    test('shown only with at least 3 conversations behind them and a real value', () => {
      expect(home.replyMetric({ sampleSize: 2, repliedPct: 100, medianMinutes: 5 })).toBeNull();
      expect(home.replyMetric({ sampleSize: 5, repliedPct: null, medianMinutes: null })).toBeNull();
      expect(home.replyMetric({ sampleSize: 3, repliedPct: 0, medianMinutes: null })).toMatchObject(
        { repliedPct: 0 }
      );
      expect(home.replyMetric(null)).toBeNull();
    });
  });

  describe('verification strip', () => {
    test('says nothing for approved or unknown suppliers', () => {
      expect(home.stripFor(null)).toBeNull();
      expect(home.stripFor({ approved: true, state: 'approved' })).toBeNull();
      expect(home.stripFor({ approved: null })).toBeNull();
    });

    test('offers Get verified, then waits in review, then Resubmit with notes, then support', () => {
      expect(
        home.stripFor({ approved: false, state: 'unverified', rejectionCount: 0 })
      ).toMatchObject({ action: 'verify', tone: 'warn' });
      expect(home.stripFor({ approved: false, state: 'pending_review' })).toMatchObject({
        action: '',
        tone: 'info',
      });
      expect(home.stripFor({ approved: false, state: 'pending' })).toMatchObject({ action: '' });
      expect(
        home.stripFor({ approved: false, state: 'needs_changes', rejectionCount: 1 })
      ).toMatchObject({ action: 'resubmit', tone: 'danger' });
      expect(
        home.stripFor({ approved: false, state: 'rejected', rejectionCount: 2 })
      ).toMatchObject({ action: 'resubmit' });
      expect(
        home.stripFor({ approved: false, state: 'rejected', rejectionCount: 5 })
      ).toMatchObject({ action: 'support' });
      expect(home.stripFor({ approved: false, state: 'suspended' })).toMatchObject({
        action: 'support',
      });
    });
  });

  describe('greeting', () => {
    test('follows the time of day', () => {
      expect(home.greetingFor(new Date(2026, 0, 1, 9))).toBe('Good morning');
      expect(home.greetingFor(new Date(2026, 0, 1, 14))).toBe('Good afternoon');
      expect(home.greetingFor(new Date(2026, 0, 1, 20))).toBe('Good evening');
    });

    test('the lede is an error sentence, the no-profile prompt, or a fact from the summary', () => {
      expect(home.ledeFor(null, { error: true })).toMatch(/could not load/);
      expect(home.ledeFor(null, { noProfile: true })).toMatch(/Create your business profile/);
      expect(home.ledeFor(home.normaliseSummary(example), {})).toBe('You have 4 unread messages.');
      const quiet = home.normaliseSummary({ ...example, messages: { unreadMessages: 0 } });
      // Only the banner is left, and that is polish, not something to headline.
      expect(home.ledeFor(quiet, {})).toBe('Your profile, packages and messages in one place.');
    });
  });
});

describe('supplier dashboard home: rendered page', () => {
  const runner = path.join(__dirname, '../helpers/supplier-dashboard-home-scenario.js');
  const run = scenario =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [runner, Buffer.from(JSON.stringify(scenario), 'utf8').toString('base64')],
        {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        }
      )
    );
  const clone = value => JSON.parse(JSON.stringify(value));

  const populated = {
    window: { days: 30, maxDays: 90, requestedDays: 30 },
    verification: {
      emailVerified: true,
      approved: true,
      state: 'approved',
      status: 'approved',
      notes: null,
      rejectionCount: 0,
    },
    profile: {
      name: 'Hawthorn Barn',
      publicProfilePath: '/supplier/hawthorn-barn--0123456789abcdef',
      completeness: {
        score: 85,
        checks: [{ id: 'coverImage', label: 'Banner image', done: false }],
      },
    },
    packages: {
      total: 3,
      active: 1,
      paused: 1,
      awaitingApproval: 1,
      limit: 50,
      countedTowardsLimit: 2,
    },
    messages: { unreadMessages: 4, conversationsWithUnread: 3 },
    responses: { sampleSize: 5, repliedPct: 75, medianMinutes: 30 },
    views: { total: 5, days: 30, basis: 'page_loads' },
    reviews: { approvedCount: 3, averageRating: 4.5, pendingCount: 1 },
    subscription: {
      plan: 'pro',
      status: 'active',
      activeUntil: '2027-08-10T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      limits: { maxPackages: 50, maxPhotos: 500, analyticsWindowDays: 90 },
    },
    analytics: {
      dailyData: [
        { date: '2026-07-01', views: 2 },
        { date: '2026-07-02', views: 3 },
        { date: '2026-07-03', views: 0 },
      ],
    },
    nextSteps: {
      steps: [
        { id: 'verify-email', label: 'Verify your email address', done: true },
        { id: 'get-verified', label: 'Get your profile verified', done: true },
        {
          id: 'banner',
          label: 'Add a banner image',
          done: false,
          href: '/supplier/profile-customization#sup-banner-drop',
        },
        { id: 'package-photos', label: 'Add a photo to every package', done: false },
      ],
      completed: 2,
      total: 4,
      primaryStepId: 'banner',
    },
  };

  test('an approved supplier: one h1, real tiles, the first open step as the action, finished steps folded', () => {
    const page = run({ summary: populated, suppliers: [{ id: 's1' }] });
    expect(page.h1Count).toBe(1);
    expect(page.heading).toBe(
      `${/^Good (morning|afternoon|evening), Hannah$/.test(page.heading) ? page.heading : 'x'}`
    );
    expect(page.tiles.map(tile => tile.label)).toEqual([
      'Unread messages',
      'Profile complete',
      'Rating',
      'Plan',
    ]);
    expect(page.tiles[0].value).toBe('4');
    expect(page.tiles[1].value).toBe('85%');
    expect(page.tiles[2].value).toBe('4.5 out of 5');
    expect(page.tiles[3].body).toContain('2 of 50 active packages');
    // The headline action is the first setup step; the banner (an Edit profile field) is listed
    // as "Add banner" but never headlines the page.
    expect(page.primary).toMatchObject({ hidden: false, label: 'Add a photo to every package' });
    expect(page.steps.todo).toEqual(['Add banner', 'Add a photo to every package']);
    expect(page.steps.next).toBe('Add a photo to every package');
    expect(page.steps.summary).toBe('2 completed');
    expect(page.steps.detailsOpen).toBe(false);
    expect(page.strip.hidden).toBe(true);
    expect(page.emailBanner).toBeNull();
  });

  test('visits and reply figures appear only because the server sent them, with the page-loads footnote', () => {
    const page = run({ summary: populated, suppliers: [{ id: 's1' }] });
    expect(page.extra.hidden).toBe(false);
    expect(page.extra.text).toContain('Profile visits, last 30 days');
    expect(page.extra.text).toContain('Counts page loads, not people.');
    expect(page.extra.text).toContain('Reply rate75%');
    expect(page.extra.text).toContain('Typical reply time30 min');
    expect(page.chartBars).toBe(3);
  });

  test('fewer than 3 conversations: no reply rate or reply time, never a made-up number', () => {
    const sparse = clone(populated);
    sparse.responses = { sampleSize: 2, repliedPct: null, medianMinutes: null };
    const page = run({ summary: sparse, suppliers: [{ id: 's1' }] });
    expect(page.extra.text).not.toContain('Reply rate');
    expect(page.extra.text).not.toContain('Typical reply time');
    expect(page.extra.text).toContain('Profile visits');
  });

  test('reply rate needs 3 old-enough conversations and reply time needs 3 replies, each hidden on its own', () => {
    const noRate = clone(populated);
    noRate.responses = { sampleSize: 5, matureSampleSize: 2, repliedPct: null, medianMinutes: 30 };
    const noRatePage = run({ summary: noRate, suppliers: [{ id: 's1' }] });
    expect(noRatePage.extra.text).not.toContain('Reply rate');
    expect(noRatePage.extra.text).toContain('Typical reply time30 min');
    const noTime = clone(populated);
    noTime.responses = { sampleSize: 5, matureSampleSize: 4, repliedPct: 50, medianMinutes: null };
    const noTimePage = run({ summary: noTime, suppliers: [{ id: 's1' }] });
    expect(noTimePage.extra.text).toContain('Reply rate50%');
    expect(noTimePage.extra.text).not.toContain('Typical reply time');
  });

  test('an unknown email state (null) locks nothing and shows no verify-your-email prompt', () => {
    const unknown = clone(populated);
    unknown.verification.emailVerified = null;
    const page = run({
      summary: unknown,
      suppliers: [{ id: 's1' }],
      user: { firstName: 'Sam' },
    });
    expect(page.emailBanner).toBeNull();
    expect(page.primary.action).not.toBe('resend-email');
    expect(page.steps.todo.join(' ')).not.toMatch(/verify your email/i);
    expect(page.lede).not.toMatch(/verify your email/i);
  });

  test('a summary with almost nothing in it renders dashes and hides tiles instead of guessing', () => {
    const page = run({
      summary: { messages: { unreadMessages: null }, reviews: { approvedCount: null } },
      suppliers: [{ id: 's1' }],
    });
    expect(page.tiles[0].value).toBe('Not available');
    expect(page.tiles[1].value).toBe('Not available');
    expect(page.tiles[2].value).toBe('Not available');
    expect(page.extra.hidden).toBe(true);
    expect(page.chartBars).toBe(0);
  });

  test('no reviews yet reads "No reviews yet", not 0.0', () => {
    const none = clone(populated);
    none.reviews = { approvedCount: 0, averageRating: null, pendingCount: 0 };
    const page = run({ summary: none, suppliers: [{ id: 's1' }] });
    expect(page.tiles[2].value).toBe('No reviews yet');
    expect(page.tiles[2].body).not.toContain('0.0');
  });

  test('a supplier whose profile is in review sees the strip, a waiting step, and no Get verified button', () => {
    const pending = clone(populated);
    pending.verification = {
      emailVerified: true,
      approved: false,
      state: 'pending',
      status: 'pending_review',
      notes: null,
      rejectionCount: 0,
    };
    pending.nextSteps.steps[1] = {
      id: 'get-verified',
      label: 'Get your profile verified',
      done: false,
    };
    const page = run({ summary: pending, suppliers: [{ id: 's1' }] });
    expect(page.strip).toMatchObject({ hidden: false, tone: 'info' });
    expect(page.strip.text).toContain('Verification is in review');
    expect(page.strip.text).not.toContain('Get verified');
    expect(page.steps.todo[0]).toContain('Verification is in review');
    expect(page.lede).toMatch(/in review/);
  });

  test('a supplier who has not been verified sees Get verified and can open the dialog (the strip is no longer stuck hidden)', () => {
    const fresh = clone(populated);
    fresh.verification = {
      emailVerified: true,
      approved: false,
      state: 'unverified',
      status: 'unverified',
      notes: null,
      rejectionCount: 0,
    };
    const page = run({ summary: fresh, suppliers: [{ id: 's1' }], clickStripAction: true });
    expect(page.strip.hidden).toBe(false);
    expect(page.strip.text).toContain('Get verified to go live');
    expect(page.actions.verificationDialog).toMatchObject({
      open: true,
      title: 'Submit for verification',
      notesShown: false,
    });
  });

  test('a rejected supplier sees the reviewer notes and Resubmit, and the dialog opens as a resubmission', () => {
    const rejected = clone(populated);
    rejected.verification = {
      emailVerified: true,
      approved: false,
      state: 'rejected',
      status: 'needs_changes',
      notes: 'Please add a phone number',
      rejectionCount: 1,
    };
    const page = run({ summary: rejected, suppliers: [{ id: 's1' }], clickStripAction: true });
    expect(page.strip.tone).toBe('danger');
    expect(page.strip.text).toContain('Changes are needed');
    expect(page.strip.text).toContain('Please add a phone number');
    expect(page.strip.text).toContain('Resubmit');
    expect(page.actions.verificationDialog).toMatchObject({
      open: true,
      title: 'Resubmit for verification',
      notesShown: true,
      notes: 'Please add a phone number',
      submit: 'Resubmit for verification',
    });
  });

  test('an unverified email gets one banner and the email step as the action, not a second banner', () => {
    const fresh = clone(populated);
    fresh.verification = {
      emailVerified: false,
      approved: false,
      state: 'unverified',
      status: 'unverified',
      notes: null,
      rejectionCount: 0,
    };
    fresh.nextSteps.steps[0] = {
      id: 'verify-email',
      label: 'Verify your email address',
      done: false,
    };
    fresh.nextSteps.primaryStepId = 'verify-email';
    const page = run({
      summary: fresh,
      suppliers: [{ id: 's1' }],
      user: { firstName: 'Sam', verified: false },
    });
    expect(page.emailBanner).toContain('Please verify your email address');
    expect(page.primary).toMatchObject({
      label: 'Verify your email address',
      action: 'resend-email',
    });
    expect(page.strip.hidden).toBe(true);
  });

  test('a supplier with no profile gets one short empty state: the no-profile layout and one action', () => {
    const page = run({
      summaryStatus: 404,
      summary: { error: 'Supplier profile not found' },
      suppliers: [],
    });
    expect(page.noProfile).toBe(true);
    expect(page.primary).toMatchObject({
      hidden: false,
      label: 'Create your profile',
      action: 'edit-profile',
    });
    expect(page.summaryEmpty).toContain('Once you have a profile');
    expect(page.tiles).toEqual([]);
    expect(page.lede).toMatch(/Create your business profile/);
    expect(page.plan).toContain('Starter');
  });

  test('a supplier with no profile never triggers the summary 404 (the fetch wrapper would toast it)', () => {
    const page = run({ summaryStatus: 404, suppliers: [] });
    expect(page.requested.join(' ')).not.toContain('dashboard-summary');
    expect(page.requested.join(' ')).toContain('/api/v2/subscriptions/me');
    const withProfile = run({ summary: populated, suppliers: [{ id: 's1' }] });
    expect(withProfile.requested.join(' ')).toContain('dashboard-summary');
  });

  test('if the summary request fails the page says so and offers a retry, not an empty dashboard', () => {
    const page = run({ summaryStatus: 500, suppliers: [{ id: 's1' }] });
    expect(page.summaryEmpty).toContain('Your summary could not be loaded');
    expect(page.summaryEmpty).toContain('Try again');
    expect(page.steps.body).toContain('Something went wrong while loading your next steps.');
    expect(page.lede).toBe('We could not load your summary just now.');
    expect(page.primary.hidden).toBe(true);
    expect(page.tiles).toEqual([]);
  });

  test('the plan card names the plan, its renewal and what it includes, with no upsell claims', () => {
    const page = run({ summary: populated, suppliers: [{ id: 's1' }] });
    expect(page.plan).toContain('Pro');
    expect(page.plan).toContain('Renews on 10 August 2027');
    expect(page.plan).toContain('Up to 50 active packages');
    expect(page.plan).toContain('90 days of visit history');
    expect(page.plan).not.toMatch(/more enquiries|3x/i);
    const past = clone(populated);
    past.subscription.status = 'past_due';
    const pastPage = run({ summary: past, suppliers: [{ id: 's1' }] });
    expect(pastPage.plan).toContain('Payment failed');
    expect(pastPage.plan).toContain('Update payment method');
  });

  test('a short plan window is labelled with what was served and says so', () => {
    const starter = clone(populated);
    starter.window = { days: 7, maxDays: 7, requestedDays: 30 };
    starter.views = { total: 9, days: 7, basis: 'page_loads' };
    const page = run({ summary: starter, suppliers: [{ id: 's1' }] });
    expect(page.extra.text).toContain('Profile visits, last 7 days');
    expect(page.visits).toContain('Your plan shows the last 7 days.');
  });

  test('availability that cannot load shows an error with a retry, not a skeleton forever', () => {
    const page = run({ summary: populated, suppliers: [{ id: 's1' }], availabilityFails: true });
    expect(page.availability).toContain('We could not load your availability.');
    expect(page.availability).toContain('Try again');
  });

  test('tips the server did not send are not made up: the card hides when there are none', () => {
    const none = run({ summary: populated, suppliers: [{ id: 's1' }] });
    expect(none.tipsHidden).toBe(true);
    const some = run({
      summary: populated,
      suppliers: [{ id: 's1' }],
      tips: [
        {
          title: 'Add 2 more photos',
          body: 'A fuller gallery shows what you offer.',
          action: { label: 'Add photos', href: '/dashboard/supplier#photos' },
        },
      ],
    });
    expect(some.tipsHidden).toBe(false);
    expect(some.tips).toContain('Add 2 more photos');
  });

  test('the Request a review button opens the dialog', () => {
    const page = run({ summary: populated, suppliers: [{ id: 's1' }], clickRequestReview: true });
    expect(page.actions.reviewDialogOpen).toBe(true);
  });

  test('the page asks the server once for the summary and once for the user, not once per widget', () => {
    const page = run({ summary: populated, suppliers: [{ id: 's1' }] });
    const count = text => page.requested.filter(url => url.includes(text)).length;
    expect(count('/api/supplier/dashboard-summary')).toBe(1);
    expect(count('/api/v1/auth/me')).toBe(1);
    expect(count('/api/v2/subscriptions/me')).toBe(0);
    expect(count('/api/me/suppliers')).toBe(0);
    expect(count('/api/me/packages')).toBe(0);
    expect(count('/api/supplier/analytics')).toBe(0);
    expect(count('/api/me/action-prompt-checklist')).toBe(0);
  });
});

describe('supplier dashboard home: app.js profile and package behaviour', () => {
  test('the old health ring, setup checklist and injected Onboarding card are gone', () => {
    [
      'spc-ring',
      'spc-checklist',
      'renderSupplierChecklist',
      'ef-onboarding-box',
      'supplier-pro-ribbon',
      'quick-stat-profiles',
    ].forEach(text => expect(appJs).not.toContain(text));
  });

  test('the empty profile card has a working button, not a link to a missing target', () => {
    expect(appJs).not.toContain('href="#profile-form"');
    expect(appJs).not.toContain('data-action="open-profile-form"');
    expect(appJs).toContain('data-sdh-action="edit-profile"');
    expect(appJs).toContain('Create profile');
  });

  test('re-opening the profile form after Cancel fills it from the saved profile (it used to be blank and save as new)', () => {
    const toggle = appJs.slice(
      appJs.indexOf('function toggleProfileForm('),
      appJs.indexOf('async function editProfile(')
    );
    expect(toggle).toContain('window._efCachedSuppliers');
    expect(toggle).toContain('window._efPopulateSupplierForm(savedProfile)');
  });

  test('the package allowance line is shown from real counts and the plan limit, never hidden', () => {
    expect(appJs).toContain('function packageNoteText(');
    expect(appJs).toContain('getPackageAllowance');
    expect(appJs).not.toContain("classList.add('sd-hidden')");
    expect(appJs).not.toContain('const freeLimit = 3');
    expect(appJs).not.toContain('unlimited packages');
  });

  test('delete and remove ask in the page dialog, and results go through the one toast', () => {
    const deletePackage = appJs.slice(
      appJs.indexOf('async function deletePackage('),
      appJs.indexOf('async function togglePackagePause(')
    );
    expect(deletePackage).toContain('efConfirm(');
    expect(deletePackage).not.toContain("confirm('");
    expect(deletePackage).not.toContain('location.reload');
    expect(deletePackage).not.toContain('alert(');
    expect(appJs).toContain("efConfirm({\n    title: 'Remove this photo?'");
  });

  test('package rows have one button and text links, and escape what the supplier typed', () => {
    const row = appJs.slice(
      appJs.indexOf('function packageCardHtml('),
      appJs.indexOf('function packageMessageHtml(')
    );
    expect(row.match(/<button type="button" class="sdh-btn/g)).toHaveLength(1);
    expect(row).toContain('escapeHtml(String(p.title');
    expect(row).toContain('escapeHtml(String(p.description');
    expect(row).not.toContain('class="ef-cta');
  });

  test('showing and hiding uses the hidden attribute rather than inline display', () => {
    const dashboard = appJs.slice(
      appJs.indexOf('async function initDashSupplier('),
      appJs.indexOf('function efDetectPage(')
    );
    expect(dashboard).not.toMatch(
      /(galleryRow|galleryExisting|pkgManageGalleryLink|reusePanel|cancelBtn|upgradeCta)\.style\.display/
    );
  });

  test('profile and package changes tell the home script to refresh its numbers', () => {
    expect(appJs).toContain("new CustomEvent('sdh:changed')");
    expect(appJs).toContain("new CustomEvent('sdh:suppliers'");
    expect(homeJs).toContain("document.addEventListener('sdh:changed'");
  });

  test('the plan limits come from the dashboard summary, not three separate subscription requests', () => {
    expect(appJs).toContain('getPlanLimits');
    expect(read('public/assets/js/supplier-gallery.js')).toContain('getPlanLimits');
  });
});

describe('supplier dashboard home: messenger widget', () => {
  test('the widget no longer broadcasts an under-count of unread messages, and the page hides its heading', () => {
    expect(homeJs).toContain('broadcastUnread: false');
    expect(read('public/messenger/js/MessengerWidgetV4.js')).toContain(
      'this.options.broadcastUnread !== false'
    );
    expect(css).toMatch(/\.sdh-messenger-widget \.mwv4__header \{\s*display: none;/);
  });

  test('conversation search, filter and sort boxes (which only saw 5 conversations) are not on the page', () => {
    [
      'widget-search-input-supplier',
      'widget-filter-select-supplier',
      'widget-sort-select-supplier',
    ].forEach(id => expect(html).not.toContain(id));
  });

  test('export says how many conversations it exports and asks for the most the server allows', () => {
    const exportJs = read('public/assets/js/dashboard-supplier-export.js');
    expect(exportJs).toContain('const EXPORT_LIMIT = 100');
    expect(exportJs).toContain('messenger/conversations?limit=');
    expect(html).toContain('Export latest 100 conversations (CSV)');
  });
});
