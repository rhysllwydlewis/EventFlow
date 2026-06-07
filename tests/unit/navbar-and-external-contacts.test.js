/**
 * Tests for:
 * 1. Admin navbar regression (TDZ fix, icon visibility, button behaviour)
 * 2. External contacts ingestion route
 * 3. Admin external contacts CRUD
 */
'use strict';

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const path = require('path');
const fs = require('fs');

const navbarSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/admin-navbar.js'),
  'utf8'
);
const navbarCss = fs.readFileSync(
  path.join(__dirname, '../../public/assets/css/admin-navbar.css'),
  'utf8'
);

// ─── Part 1: Admin navbar regression ─────────────────────────────────────────
describe('Admin navbar — TDZ regression fix', () => {
  test('notifPanelOpen is declared before the DOMContentLoaded / init call', () => {
    const panelIdx = navbarSrc.indexOf('let notifPanelOpen = false');
    const initIdx = navbarSrc.indexOf('if (document.readyState');
    expect(panelIdx).toBeGreaterThan(-1);
    expect(initIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeLessThan(initIdx);
  });

  test('notifPollInterval is declared before the DOMContentLoaded / init call', () => {
    const pollIdx = navbarSrc.indexOf('let notifPollInterval = null');
    const initIdx = navbarSrc.indexOf('if (document.readyState');
    expect(pollIdx).toBeGreaterThan(-1);
    expect(pollIdx).toBeLessThan(initIdx);
  });

  test('initNotifBell is wrapped in try/catch inside init()', () => {
    const initFn = navbarSrc.slice(
      navbarSrc.indexOf('function init()'),
      navbarSrc.indexOf('function init()') + 600
    );
    expect(initFn).toContain('try {');
    expect(initFn).toContain('initNotifBell()');
    expect(initFn).toContain('catch');
  });

  test('initRefreshButton is called AFTER initNotifBell in init()', () => {
    const fn = navbarSrc.slice(
      navbarSrc.indexOf('function init()'),
      navbarSrc.indexOf('function init()') + 800
    );
    const bellIdx = fn.indexOf('initNotifBell()');
    const refreshIdx = fn.indexOf('initRefreshButton()');
    expect(bellIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(bellIdx);
  });

  test('initQuickNav is called AFTER initNotifBell in init()', () => {
    const fn = navbarSrc.slice(
      navbarSrc.indexOf('function init()'),
      navbarSrc.indexOf('function init()') + 800
    );
    const bellIdx = fn.indexOf('initNotifBell()');
    const navIdx = fn.indexOf('initQuickNav()');
    expect(navIdx).toBeGreaterThan(bellIdx);
  });
});

describe('Admin navbar — button HTML', () => {
  test('notification bell button has type="button"', () => {
    expect(navbarSrc).toContain('type="button" class="ef-cta navbar-icon-btn admin-notif-bell"');
  });

  test('refresh button has type="button"', () => {
    expect(navbarSrc).toContain('type="button" class="ef-cta navbar-icon-btn" id="navRefreshBtn"');
  });

  test('notification bell button has aria-label', () => {
    expect(navbarSrc).toContain('aria-label="Notifications"');
  });

  test('notification bell button has aria-haspopup', () => {
    expect(navbarSrc).toContain('aria-haspopup="true"');
  });
});

describe('Admin navbar — icon visibility CSS', () => {
  test('CSS resets ef-cta padding for icon buttons', () => {
    expect(navbarCss).toContain('.navbar-icon-btn.ef-cta');
    expect(navbarCss).toContain('padding: 0 !important');
  });

  test('CSS sets explicit visible colour on icon buttons', () => {
    expect(navbarCss).toMatch(/\.navbar-icon-btn[^{]*{[^}]*color:\s*#1e293b/);
  });

  test('CSS forces SVG display:block and correct dimensions', () => {
    expect(navbarCss).toContain('.navbar-icon-btn > svg');
    expect(navbarCss).toContain('display: block');
    expect(navbarCss).toContain('opacity: 1');
    expect(navbarCss).toContain('visibility: visible');
  });

  test('CSS provides hover colour for icon buttons', () => {
    expect(navbarCss).toContain('.navbar-icon-btn:hover');
    expect(navbarCss).toContain('color: #0B8073');
  });

  test('CSS provides focus-visible outline for keyboard users', () => {
    expect(navbarCss).toContain('.navbar-icon-btn:focus-visible');
    expect(navbarCss).toContain('outline: 2px solid #0B8073');
  });
});

describe('Admin navbar — notification bell functionality', () => {
  test('getNotifIcon accepts metadata as second argument', () => {
    expect(navbarSrc).toMatch(/function getNotifIcon\(type,\s*metadata\)/);
  });

  test('getNotifIcon handles external_contact category', () => {
    expect(navbarSrc).toContain("metadata.category === 'external_contact'");
  });

  test('getNotifIcon call site passes metadata', () => {
    expect(navbarSrc).toContain('getNotifIcon(n.type, n.metadata)');
  });
});

// ─── Part 2: External contacts ingestion ──────────────────────────────────────
describe('External contacts ingestion route', () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, '../../routes/integrations-external-contacts.js'),
    'utf8'
  );

  test('route file exists', () => {
    expect(
      fs.existsSync(path.join(__dirname, '../../routes/integrations-external-contacts.js'))
    ).toBe(true);
  });

  test('validates X-EventFlow-Integration-Secret header', () => {
    expect(routeSrc).toContain('x-eventflow-integration-secret');
    expect(routeSrc).toContain('status(401)');
  });

  test('validates X-EventFlow-Source header', () => {
    expect(routeSrc).toContain('x-eventflow-source');
    expect(routeSrc).toContain('status(403)');
  });

  test('validates required fields (name, email, message)', () => {
    expect(routeSrc).toContain("'name is required'");
    expect(routeSrc).toContain("'email is required'");
    expect(routeSrc).toContain("'message is required'");
    expect(routeSrc).toContain('status(400)');
  });

  test('validates email format', () => {
    expect(routeSrc).toContain('EMAIL_RE.test(email)');
  });

  test('implements duplicate detection with a time window', () => {
    expect(routeSrc).toContain('DEDUP_WINDOW_MS');
    expect(routeSrc).toContain('duplicate: true');
  });

  test('stores IP only as a hash (never raw)', () => {
    expect(routeSrc).toContain('hashIp(ip)');
    expect(routeSrc).toContain('ipHash');
    expect(routeSrc).not.toContain('rawIp:');
  });

  test('notifies admins on new contact', () => {
    expect(routeSrc).toContain('notifyAdmins');
    expect(routeSrc).toContain("category: 'external_contact'");
  });

  test('uses writeLimiter rate limiting', () => {
    expect(routeSrc).toContain('writeLimiter');
  });

  test('never logs personal data', () => {
    // The logger.info call must not include name, email or message fields
    const logInfoIdx = routeSrc.indexOf('logger.info');
    const logInfoBlock = routeSrc.slice(logInfoIdx, logInfoIdx + 200);
    expect(logInfoBlock).not.toContain('name');
    expect(logInfoBlock).not.toContain('email');
    expect(logInfoBlock).not.toContain('message');
  });

  test('uses type system with metadata.category for external_contact', () => {
    // Should NOT use a non-existent 'external_contact' type directly
    expect(routeSrc).not.toContain("type: 'external_contact'");
    // Should use 'system' with metadata
    expect(routeSrc).toContain("type: 'system'");
    expect(routeSrc).toContain("category: 'external_contact'");
  });

  test('mounted in server.js', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    expect(server).toContain('integrations-external-contacts');
  });
});

// ─── Part 3: Admin external contacts CRUD ─────────────────────────────────────
describe('Admin external contacts CRUD route', () => {
  const routeSrc = fs.readFileSync(
    path.join(__dirname, '../../routes/admin-external-contacts.js'),
    'utf8'
  );

  test('route file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../routes/admin-external-contacts.js'))).toBe(
      true
    );
  });

  test('GET / requires auth and admin role', () => {
    const block = routeSrc.slice(
      routeSrc.indexOf("router.get('/'"),
      routeSrc.indexOf("router.get('/'") + 200
    );
    expect(block).toContain('authRequired');
    expect(block).toContain("roleRequired('admin')");
  });

  test('PATCH requires CSRF protection', () => {
    const idx = routeSrc.indexOf("router.patch('/:id'");
    const block = routeSrc.slice(idx, idx + 200);
    expect(block).toContain('csrfProtection');
  });

  test('POST /notes requires CSRF protection', () => {
    const idx = routeSrc.indexOf("router.post('/:id/notes'");
    const block = routeSrc.slice(idx, idx + 200);
    expect(block).toContain('csrfProtection');
  });

  test('returns summary counts (new, vexi, chlo, archived)', () => {
    // Summary object has shorthand properties { new:, vexi:, chlo:, archived: }
    expect(routeSrc).toContain('new:');
    expect(routeSrc).toContain('vexi:');
    expect(routeSrc).toContain('chlo:');
    expect(routeSrc).toContain('archived:');
  });

  test('validates status values against allowlist', () => {
    expect(routeSrc).toContain('VALID_STATUSES');
    expect(routeSrc).toContain("'new'");
    expect(routeSrc).toContain("'in_review'");
    expect(routeSrc).toContain("'replied'");
    expect(routeSrc).toContain("'archived'");
  });

  test('mounted in server.js', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    expect(server).toContain('admin-external-contacts');
  });
});

// ─── Part 4+5: Admin registry + HTML page ────────────────────────────────────
describe('Admin registry — External Contacts', () => {
  const registry = fs.readFileSync(path.join(__dirname, '../../config/adminRegistry.js'), 'utf8');

  test('External Contacts is in the registry', () => {
    expect(registry).toContain('/admin-external-contacts');
    expect(registry).toContain("label: 'External Contacts'");
  });

  test('admin-external-contacts.html exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../public/admin-external-contacts.html'))).toBe(
      true
    );
  });

  test('admin-external-contacts-init.js exists', () => {
    expect(
      fs.existsSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-external-contacts-init.js')
      )
    ).toBe(true);
  });

  test('page uses sourceBadge with distinct VEXI and Chlo labels', () => {
    const initSrc = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/admin-external-contacts-init.js'),
      'utf8'
    );
    expect(initSrc).toContain("'VEXI'");
    expect(initSrc).toContain("'Chlo'");
    expect(initSrc).toContain('From ${c.label}');
  });
});
