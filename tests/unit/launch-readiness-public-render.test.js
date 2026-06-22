'use strict';

/**
 * Launch readiness tests:
 *  Scope A — Public anonymous render cleanup
 *  Scope B — Public calendar role-gating
 *  Scope C — Footer/version/loading-state cleanup
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.resolve(__dirname, '../../public');
const JS_DIR = path.resolve(__dirname, '../../public/assets/js');

const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const readJs = f => fs.readFileSync(path.join(JS_DIR, f), 'utf8');

const KEY_PUBLIC_PAGES = [
  'index.html',
  'start.html',
  'suppliers.html',
  'marketplace.html',
  'public-calendar.html',
  'guides.html',
  'pricing.html',
  'faq.html',
  'for-suppliers.html',
  'legal.html',
  'terms.html',
];

// ─── Scope A: Public anonymous render ──────────────────────────────────────

describe('Scope A — Public anonymous render', () => {
  describe('Notification dropdown', () => {
    KEY_PUBLIC_PAGES.forEach(page => {
      if (!fs.existsSync(path.join(PUBLIC, page))) return;
      const html = read(page);
      if (!html.includes('notification-dropdown')) return;

      test(`${page}: notification dropdown has hidden attribute`, () => {
        // The dropdown must be hidden from crawlers and screen readers by default
        expect(html).toMatch(/id="notification-dropdown"[^>]*hidden/);
      });

      test(`${page}: notification dropdown has aria-hidden="true"`, () => {
        expect(html).toMatch(/id="notification-dropdown"[^>]*aria-hidden="true"/);
      });
    });
  });

  describe('Auth-only nav elements use display:none by default', () => {
    ['index.html', 'start.html', 'suppliers.html'].forEach(page => {
      test(`${page}: Dashboard link hidden by default`, () => {
        const html = read(page);
        if (html.includes('ef-dashboard-link')) {
          expect(html).toMatch(
            /id="ef-dashboard-link"[^>]*style="display: none;"|id="ef-dashboard-link"[^>]*hidden/
          );
        }
      });

      test(`${page}: Logout link hidden by default`, () => {
        const html = read(page);
        if (html.includes('ef-mobile-logout')) {
          expect(html).toMatch(
            /id="ef-mobile-logout"[^>]*style="display: none;"|id="ef-mobile-logout"[^>]*hidden/
          );
        }
      });
    });
  });

  describe('notifications.js toggles hidden attribute with dropdown', () => {
    test('notifications.js removes hidden attribute when opening dropdown', () => {
      const js = readJs('notifications.js');
      expect(js).toContain('dropdown.hidden = false');
    });

    test('notifications.js sets hidden attribute when closing dropdown', () => {
      const js = readJs('notifications.js');
      expect(js).toContain('dropdown.hidden = true');
    });
  });
});

// ─── Scope B: Public calendar role-gating ─────────────────────────────────

describe('Scope B — Public calendar role-gating', () => {
  const calendarHtml = read('public-calendar.html');
  const calendarJs = readJs('pages/public-calendar-init.js');

  describe('Static HTML: no internal taxonomy in status filter', () => {
    test('draft option NOT in static HTML', () => {
      // draft option should only be injected by JS for admin users
      const staticOptions =
        calendarHtml.match(/<select id="pc-filter-status">([\s\S]*?)<\/select>/)?.[1] || '';
      expect(staticOptions).not.toContain('draft');
    });

    test('pending_review option NOT in static HTML', () => {
      const staticOptions =
        calendarHtml.match(/<select id="pc-filter-status">([\s\S]*?)<\/select>/)?.[1] || '';
      expect(staticOptions).not.toContain('pending_review');
    });

    test('rejected option NOT in static HTML', () => {
      const staticOptions =
        calendarHtml.match(/<select id="pc-filter-status">([\s\S]*?)<\/select>/)?.[1] || '';
      expect(staticOptions).not.toContain('rejected');
    });

    test('status filter wrapper is hidden by default', () => {
      expect(calendarHtml).toMatch(/id="pc-filter-status-wrap"[^>]*hidden/);
    });
  });

  describe('Static HTML: admin/publisher controls hidden by default', () => {
    test('publisher banner has hidden attribute', () => {
      expect(calendarHtml).toMatch(/id="pc-publisher-banner"[^>]*hidden/);
    });

    test('permission notice has hidden attribute', () => {
      expect(calendarHtml).toMatch(/id="pc-permission-notice"[^>]*hidden/);
    });

    test('admin requests panel has hidden attribute', () => {
      expect(calendarHtml).toMatch(/id="pc-admin-requests-panel"[^>]*hidden/);
    });
  });

  describe('JS: admin status options injected by JS only', () => {
    test('calendar JS injects draft option for admins', () => {
      expect(calendarJs).toContain('draft');
    });

    test('calendar JS injects pending_review option for admins', () => {
      expect(calendarJs).toContain('pending_review');
    });

    test('calendar JS injects rejected option for admins', () => {
      expect(calendarJs).toContain('rejected');
    });
  });

  describe('JS: role checks for publisher/admin controls', () => {
    test('calendar JS checks isAdmin before showing admin panel', () => {
      expect(calendarJs).toContain('isAdmin');
      expect(calendarJs).toContain('showAdminRequestsPanel');
    });

    test('calendar JS checks isPublisher before showing publisher banner', () => {
      expect(calendarJs).toContain('isPublisher');
    });

    test('calendar JS uses element.hidden = false to reveal elements', () => {
      // Ensures elements with HTML hidden attribute are properly revealed
      expect(calendarJs).toContain('hidden = false');
    });

    test('calendar JS fetches auth before revealing any controls', () => {
      expect(calendarJs).toContain('/api/v1/auth/me');
    });
  });
});

// ─── Scope C: Footer/version/loading states ────────────────────────────────

describe('Scope C — Footer/version/loading states', () => {
  describe('Version "loading..." NOT visible in public pages', () => {
    KEY_PUBLIC_PAGES.forEach(page => {
      if (!fs.existsSync(path.join(PUBLIC, page))) return;
      test(`${page}: no "Version: loading" text visible in static HTML`, () => {
        const html = read(page);
        // Should not have visible "loading..." next to "Version:" text
        expect(html).not.toMatch(/Version:\s*<span[^>]*>loading/i);
      });
    });
  });

  describe('Version container is hidden by default', () => {
    KEY_PUBLIC_PAGES.forEach(page => {
      if (!fs.existsSync(path.join(PUBLIC, page))) return;
      test(`${page}: version wrapper has hidden attribute`, () => {
        const html = read(page);
        if (!html.includes('ef-version-label')) return; // skip pages without version
        // The version wrapper should be hidden by default
        expect(html).toMatch(/id="ef-version-wrap"[^>]*hidden|class="version"[^>]*hidden/);
      });
    });
  });

  describe('version reveal: admin-shared.js is the sole handler', () => {
    test('app.js does NOT make an extra auth/me fetch for version display', () => {
      const js = readJs('app.js');
      // Version display was moved out of app.js to avoid a per-page auth fetch.
      // The comment marks where it was; there should be no auth/me call there.
      const versionBlock = js.slice(
        js.indexOf('// Version display is handled by admin-shared.js'),
        js.indexOf('// Per-page setup')
      );
      expect(versionBlock).not.toContain('/auth/me');
    });

    test('admin-shared.js removes hidden attribute when revealing version', () => {
      const js = readJs('admin-shared.js');
      const fnStart = js.indexOf('async function populateVersionLabel');
      const fnEnd = js.indexOf('\n  }', fnStart) + 4;
      const fn = js.slice(fnStart, fnEnd);
      expect(fn).toContain("removeAttribute('hidden')");
    });

    test('admin-shared.js removes aria-hidden when revealing version', () => {
      const js = readJs('admin-shared.js');
      const fnStart = js.indexOf('async function populateVersionLabel');
      const fnEnd = js.indexOf('\n  }', fnStart) + 4;
      const fn = js.slice(fnStart, fnEnd);
      expect(fn).toContain("removeAttribute('aria-hidden')");
    });
  });

  describe('Admin pages: version still shows for admins', () => {
    test('admin-shared.js still has version population logic', () => {
      const js = readJs('admin-shared.js');
      expect(js).toContain('ef-version-label');
    });
  });

  describe('Loading states: no unresolved stub text', () => {
    test('guides.html: no plain "Loading guides…" paragraph text', () => {
      const html = read('guides.html');
      // Should have skeleton cards, not a bare "Loading guides…" text
      expect(html).not.toContain('>Loading guides…<');
    });

    test('guides.html: has skeleton loading UI', () => {
      const html = read('guides.html');
      expect(html).toContain('skeleton');
    });

    test('guides.html: loading-skeleton.css is loaded', () => {
      const html = read('guides.html');
      expect(html).toContain('loading-skeleton.css');
    });
  });

  describe('Version consistency', () => {
    test('package.json version matches app.js debug version reference', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
      );
      const homeInit = readJs('pages/home-init.js');
      // home-init should reference a reasonable version string
      expect(homeInit).toContain(pkg.version);
    });
  });
});
