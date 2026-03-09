/**
 * Admin Regression Tests
 *
 * Guards against common regressions in admin page behaviour:
 * - Table/list empty-state rendering
 * - Confirmation modal patterns (no native dialogs)
 * - Badge / button render consistency
 * - Route resilience (error paths return useful responses)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
const ADMIN_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-init.js');
const PACKAGES_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-packages-init.js');
const PHOTOS_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-photos-init.js');
const USERS_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-users-init.js');
const SUPPLIERS_INIT = path.join(__dirname, '../../public/assets/js/pages/admin-suppliers-init.js');
const ADMIN_SHARED = path.join(__dirname, '../../public/assets/js/admin-shared.js');

let adminContent;
let packagesInitContent;
let photosInitContent;
let usersInitContent;
let suppliersInitContent;
let adminInitContent;
let adminSharedContent;

beforeAll(() => {
  adminContent = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  packagesInitContent = fs.readFileSync(PACKAGES_INIT, 'utf8');
  photosInitContent = fs.readFileSync(PHOTOS_INIT, 'utf8');
  usersInitContent = fs.readFileSync(USERS_INIT, 'utf8');
  suppliersInitContent = fs.readFileSync(SUPPLIERS_INIT, 'utf8');
  adminInitContent = fs.readFileSync(ADMIN_INIT, 'utf8');
  adminSharedContent = fs.readFileSync(ADMIN_SHARED, 'utf8');
});

// ─── Empty-State Handling ─────────────────────────────────────────────────────

describe('Admin Regression — Empty-State Table Rendering', () => {
  it('admin-packages-init shows empty state when no packages', () => {
    // The JS should guard against undefined/empty data gracefully
    expect(packagesInitContent).toContain('data.items ||');
  });

  it('admin-photos-init shows empty state when no pending photos', () => {
    expect(photosInitContent).toMatch(/data\.photos\s*\|\|/);
  });

  it('admin-users-init accepts empty items list without crash', () => {
    // Should use data.items or similar safe access
    expect(usersInitContent).toMatch(/data\.items|\.items\s*\|\|/);
  });

  it('admin-suppliers-init accepts empty items list without crash', () => {
    expect(suppliersInitContent).toContain('data.items');
  });

  it('admin-messenger-init renders empty-state row instead of crashing', () => {
    const messengerInit = path.join(
      __dirname,
      '../../public/assets/js/pages/admin-messenger-init.js'
    );
    const content = fs.readFileSync(messengerInit, 'utf8');
    expect(content).toContain('No conversations found');
  });

  it('GET /packages route returns an items array (empty-state safe)', () => {
    const idx = adminContent.indexOf("router.get('/packages'");
    const section = adminContent.substring(idx, idx + 600);
    expect(section).toContain('items');
  });

  it('badge-counts error path returns zeroed pending counts', () => {
    // When badge-counts fails it should still return a structured response
    const idx = adminContent.indexOf("router.get('/badge-counts'");
    const section = adminContent.substring(idx, idx + 3000);
    expect(section).toContain('suppliers: 0');
    expect(section).toContain('packages: 0');
    expect(section).toContain('photos: 0');
  });
});

// ─── Confirmation Modal Pattern (no native dialogs) ───────────────────────────

describe('Admin Regression — Confirmation Modal Pattern', () => {
  const NATIVE_DIALOG = /\b(window\.)?(alert|confirm|prompt)\s*\(/;

  const pagesUnderTest = [
    ['admin-init.js', () => adminInitContent],
    ['admin-packages-init.js', () => packagesInitContent],
    ['admin-photos-init.js', () => photosInitContent],
    ['admin-users-init.js', () => usersInitContent],
    ['admin-suppliers-init.js', () => suppliersInitContent],
  ];

  pagesUnderTest.forEach(([name, getContent]) => {
    it(`${name} uses AdminShared modals instead of native dialogs`, () => {
      const content = getContent();
      const lines = content.split('\n');
      const violations = lines.filter(line => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '') {
          return false;
        }
        if (/_adminConfirm|_adminToast|AdminShared\.show|showModal/.test(line)) {
          return false;
        }
        return NATIVE_DIALOG.test(line);
      });
      expect(violations).toEqual([]);
    });
  });
});

// ─── Badge / Button Render Consistency ────────────────────────────────────────

describe('Admin Regression — Badge & Button Render Consistency', () => {
  it('admin-init.js renders badge elements with class "badge"', () => {
    expect(adminInitContent).toContain('class="badge');
  });

  it('admin-init.js uses data-action attributes for action buttons', () => {
    expect(adminInitContent).toContain('data-action=');
  });

  it('AdminShared exposes showToast for consistent toast notifications', () => {
    expect(adminSharedContent).toContain('showToast');
  });

  it('AdminShared exposes escapeHtml for consistent XSS protection', () => {
    expect(adminSharedContent).toContain('escapeHtml');
  });

  it('AdminShared exposes api() wrapper for consistent fetch calls', () => {
    expect(adminSharedContent).toMatch(/function api\b|api\s*[=:]\s*(?:async\s*)?function/);
  });

  it('AdminShared exposes safeAction for button-disable pattern during requests', () => {
    expect(adminSharedContent).toContain('safeAction');
  });

  it('badge-counts response contains both pending and totals sections', () => {
    const idx = adminContent.indexOf("router.get('/badge-counts'");
    const section = adminContent.substring(idx, idx + 2000);
    expect(section).toContain('pending:');
    expect(section).toContain('totals:');
  });
});

// ─── Route Resilience ────────────────────────────────────────────────────────

describe('Admin Regression — Route Error Resilience', () => {
  it('GET /packages has try/catch error handler', () => {
    const idx = adminContent.indexOf("router.get('/packages'");
    const section = adminContent.substring(idx, idx + 800);
    expect(section).toContain('try {');
    expect(section).toContain('catch');
    expect(section).toContain('status(500)');
  });

  it('GET /photos/pending has try/catch error handler', () => {
    const idx = adminContent.indexOf("router.get('/photos/pending'");
    const section = adminContent.substring(idx, idx + 800);
    expect(section).toContain('try {');
    expect(section).toContain('catch');
    expect(section).toContain('status(500)');
  });

  it('GET /settings/site has try/catch error handler', () => {
    const idx = adminContent.indexOf("router.get('/settings/site'");
    const section = adminContent.substring(idx, idx + 600);
    expect(section).toContain('try {');
    expect(section).toContain('catch');
  });

  it('GET /contact-enquiries has try/catch error handler', () => {
    const idx = adminContent.indexOf("router.get('/contact-enquiries'");
    const section = adminContent.substring(idx, idx + 600);
    expect(section).toContain('try {');
    expect(section).toContain('catch');
  });
});

// ─── Route Ordering — Specific Before Wildcard ────────────────────────────────

describe('Admin Regression — Route ordering (specific before wildcard)', () => {
  let userMgmtContent;

  beforeAll(() => {
    userMgmtContent = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-user-management.js'),
      'utf8'
    );
  });

  it('GET /suppliers/pending-verification is defined before GET /suppliers/:id', () => {
    const specificIdx = adminContent.indexOf("'/suppliers/pending-verification'");
    const wildcardIdx = adminContent.indexOf("'/suppliers/:id'");
    expect(specificIdx).toBeGreaterThan(-1);
    expect(wildcardIdx).toBeGreaterThan(-1);
    // The specific route MUST appear before the wildcard to prevent Express wildcard capture
    expect(specificIdx).toBeLessThan(wildcardIdx);
  });

  it('GET /suppliers/pending-verification is a GET route (not POST/PUT/DELETE)', () => {
    const routePath = "'/suppliers/pending-verification'";
    const idx = adminContent.indexOf(routePath);
    // Find the nearest router.<method>( before this path (search backwards from idx)
    const before = adminContent.substring(0, idx);
    const lastRouterCall = before.lastIndexOf('router.');
    expect(lastRouterCall).toBeGreaterThan(-1);
    const methodDecl = adminContent.substring(lastRouterCall, idx);
    expect(methodDecl).toContain('router.get');
  });

  it('GET /suppliers/pending-verification returns suppliers array and count', () => {
    const routePath = "'/suppliers/pending-verification'";
    const routeStart = adminContent.indexOf(routePath);
    // Find the next route definition or end of file
    const nextRoute = adminContent.indexOf('\nrouter.', routeStart + 1);
    const section = adminContent.substring(
      routeStart,
      nextRoute > -1 ? nextRoute : adminContent.length
    );
    expect(section).toContain('suppliers:');
    expect(section).toContain('count:');
  });

  it('GET /users/segments is defined before GET /users/:id (admin-user-management.js)', () => {
    // Only a GET wildcard can shadow a GET specific route — find the GET wildcard specifically
    const specificIdx = userMgmtContent.indexOf("'/users/segments'");
    // Find router.get('/users/:id' (not PUT/POST which have different methods)
    const wildcardIdx = userMgmtContent.indexOf("router.get('/users/:id'");
    expect(specificIdx).toBeGreaterThan(-1);
    expect(wildcardIdx).toBeGreaterThan(-1);
    // The specific route MUST appear before the wildcard to prevent it being swallowed
    expect(specificIdx).toBeLessThan(wildcardIdx);
  });
});
