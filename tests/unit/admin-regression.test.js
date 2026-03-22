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

// ─── Navigation URL Consistency ──────────────────────────────────────────────

describe('Admin Regression — Navigation Button URLs (clean, no .html)', () => {
  // All quick-action and moderation-queue buttons must use canonical clean URLs
  // (no .html extension). The server redirects .html→clean, but:
  //  a) hash fragments (#...) are lost in server-side redirects
  //  b) canonical URLs are the correct production behaviour
  const expectedMappings = [
    ['userManagementBtn', '/admin-users'],
    ['packageManagementBtn', '/admin-packages'],
    ['homepageChangesBtn', '/admin-homepage'],
    ['supportTicketsBtn', '/admin-tickets'],
    ['paymentsAnalyticsBtn', '/admin-payments'],
    ['reportsQueueBtn', '/admin-reports'],
    ['auditLogBtn', '/admin-audit'],
    ['adminSettingsBtn', '/admin-settings'],
    ['reviewPhotosBtn', '/admin-photos'],
    ['reviewReportsBtn', '/admin-reports'],
    // verifySuppliersBtn previously pointed to /admin-users.html#suppliers which
    // (a) used the wrong page and (b) lost the hash in the server-side redirect
    ['verifySuppliersBtn', '/admin-suppliers'],
  ];

  expectedMappings.forEach(([btnId, expectedHref]) => {
    it(`setupNavButton('${btnId}', ...) targets '${expectedHref}' (no .html)`, () => {
      // Match the exact setupNavButton call in admin-init.js
      const pattern = new RegExp(
        `setupNavButton\\(['"]${btnId}['"],\\s*['"]${expectedHref}['"]\\)`
      );
      expect(adminInitContent).toMatch(pattern);
    });

    it(`setupNavButton('${btnId}', ...) does NOT use .html extension`, () => {
      const htmlPattern = new RegExp(
        `setupNavButton\\(['"]${btnId}['"],\\s*['"][^'"]*\\.html[^'"]*['"]\\)`
      );
      expect(adminInitContent).not.toMatch(htmlPattern);
    });
  });
});

// ─── Subscription Endpoint Regression ────────────────────────────────────────

describe('Admin Regression — Subscription endpoint alignment (admin-suppliers-init.js)', () => {
  it('grantSubscription uses /subscription POST endpoint (supports pro_plus tiers)', () => {
    // Must use the full-featured subscription endpoint (admin-user-management.js) that supports pro_plus
    // Find the function definition (not the inline onclick reference)
    const grantIdx = suppliersInitContent.indexOf('window.grantSubscription = async');
    expect(grantIdx).toBeGreaterThan(-1);
    const section = suppliersInitContent.substring(grantIdx, grantIdx + 900);
    expect(section).toContain('/subscription');
    expect(section).toContain("'POST'");
    // Should NOT fall through to simple /pro endpoint (which doesn't support pro_plus)
    expect(section).not.toMatch(/\/suppliers.*\/pro.*POST/);
  });

  it('removeSubscription uses DELETE /subscription endpoint', () => {
    // Find the function definition (not the inline onclick reference)
    const removeIdx = suppliersInitContent.indexOf('window.removeSubscription = async');
    expect(removeIdx).toBeGreaterThan(-1);
    const section = suppliersInitContent.substring(removeIdx, removeIdx + 700);
    expect(section).toContain('/subscription');
    expect(section).toContain("'DELETE'");
  });

  it('getEffectiveSubscriptionTier helper defined and used for badge, stats, filter, CSV', () => {
    expect(suppliersInitContent).toContain('getEffectiveSubscriptionTier');
    expect(suppliersInitContent).toContain('getSubscriptionBadge(getEffectiveSubscriptionTier(');
  });

  it('subscription filter does not use supplier.subscription?.tier directly', () => {
    // The old broken pattern checked a field that was always undefined on supplier records
    expect(suppliersInitContent).not.toContain('supplier.subscription?.tier === subscription');
  });

  it('getSubscriptionBadge renders PRO+ badge with correct class', () => {
    expect(suppliersInitContent).toContain('badge-pro-plus');
    expect(suppliersInitContent).toContain('PRO+');
  });
});

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

// ─── Subscription Management Button – Admin User Fix ─────────────────────────

describe('Admin Regression — Subscription management button works for admin-role users', () => {
  let userMgmtContent;

  beforeAll(() => {
    userMgmtContent = fs.readFileSync(
      path.join(__dirname, '../../routes/admin-user-management.js'),
      'utf8'
    );
  });

  it('admin-users-init click handler uses btn (closure) not e.target to read data attribute', () => {
    // Using e.target instead of the closure variable `btn` is a common source of silent
    // failures: if e.target happens to be a child element it lacks the data attribute and
    // getAttribute() returns null, making the modal never open ("button does nothing").
    // Verify the fix: btn.getAttribute should appear in the subscription button handler and
    // e.target.getAttribute should NOT appear in that same handler.

    // Find the event listener setup section (not the template string where the attribute is set)
    const listenerSetupIdx = usersInitContent.indexOf(
      "querySelectorAll('[data-manage-subscription]')"
    );
    expect(listenerSetupIdx).toBeGreaterThan(-1);

    // Check the block of code around and after the listener setup
    const listenerSection = usersInitContent.substring(listenerSetupIdx, listenerSetupIdx + 600);
    // The click handler must read from btn (the closure variable), not e.target
    expect(listenerSection).toContain('btn.getAttribute(');
    expect(listenerSection).not.toContain('e.target.getAttribute(');
  });

  it('GET /users endpoint returns _id as fallback id for users without explicit id field', () => {
    // Admin accounts created before the `id` field was standardised may only have _id.
    // Without this fallback the button renders with an empty data attribute and clicking
    // it silently does nothing (if (userId) check is falsy).
    const getUsersSection = userMgmtContent.match(
      /router\.get\('\/users',[\s\S]*?res\.json\(\s*\{[\s\S]*?\}\s*\);/
    )?.[0];
    expect(getUsersSection).toBeTruthy();
    expect(getUsersSection).toContain('u._id');
    expect(getUsersSection).toContain('u.id ||');
  });

  it('POST /users/:id/subscription uses findUserByIdOrObjectId (handles admin users without id)', () => {
    // Admin users without an explicit id field must still be found by the subscription
    // endpoint, otherwise the grant silently succeeds on the wire but the update is never
    // applied (updateOne with a wrong filter matches nothing).
    expect(userMgmtContent).toContain('findUserByIdOrObjectId');
    const helperIdx = userMgmtContent.indexOf('async function findUserByIdOrObjectId');
    expect(helperIdx).toBeGreaterThan(-1);
    // Helper must fall back to _id comparison
    const helperSection = userMgmtContent.substring(helperIdx, helperIdx + 600);
    expect(helperSection).toContain('_id.toString()');
  });

  it('subscription POST updateOne uses a resolved filter not the raw URL param id', () => {
    // When a user only has _id (no explicit id field), filtering by { id: rawUrlParam } would
    // match nothing and the change would be silently dropped. The code must resolve a correct
    // DB filter (either { id: user.id } or { _id: user._id }) so the right document is updated
    // regardless of how the user was originally created.
    const postSubscriptionIdx = userMgmtContent.indexOf("'/users/:id/subscription',");
    expect(postSubscriptionIdx).toBeGreaterThan(-1);
    // Find the matching router.delete for subscription (comes after the POST)
    const deleteSubscriptionIdx = userMgmtContent.indexOf(
      "'/users/:id/subscription',",
      postSubscriptionIdx + 1
    );
    const postSection = userMgmtContent.substring(
      postSubscriptionIdx,
      deleteSubscriptionIdx > -1 ? deleteSubscriptionIdx : postSubscriptionIdx + 3000
    );
    // Must resolve a DB-safe filter — either named updateFilter or effectiveId approach
    const hasUpdateFilter =
      postSection.includes('updateFilter') || postSection.includes('effectiveId');
    expect(hasUpdateFilter).toBe(true);
    // Must NOT use the raw URL param directly as the filter (would silently miss _id-only users)
    expect(postSection).not.toMatch(/updateOne\(\s*'users',\s*\{\s*id\s*\}\s*,/);
  });

  // ── Modal visibility: .active class ──────────────────────────────────────────

  it('openSubscriptionModal adds the .active class so components.css opacity/visibility are applied', () => {
    // components.css defines .modal-overlay with opacity:0;visibility:hidden and only
    // .modal-overlay.active makes the overlay visible. Without classList.add('active') the
    // modal is technically display:flex but still invisible — the core bug that caused
    // "Manage Subscription does nothing".
    const openIdx = usersInitContent.indexOf('function openSubscriptionModal(');
    expect(openIdx).toBeGreaterThan(-1);
    // Grab the function body (up to the next top-level function)
    const openSection = usersInitContent.substring(openIdx, openIdx + 600);
    expect(openSection).toContain("classList.add('active')");
  });

  it('closeSubscriptionModal removes the .active class to properly hide the modal', () => {
    const closeIdx = usersInitContent.indexOf('function closeSubscriptionModal(');
    expect(closeIdx).toBeGreaterThan(-1);
    const closeSection = usersInitContent.substring(closeIdx, closeIdx + 400);
    expect(closeSection).toContain("classList.remove('active')");
  });

  it('openSubscriptionModal logs a console.error when #subscriptionModal is absent', () => {
    // Silent early-return on missing DOM makes debugging impossible; a clear error message
    // is required so developers can trace the issue in production DevTools.
    const openIdx = usersInitContent.indexOf('function openSubscriptionModal(');
    const openSection = usersInitContent.substring(openIdx, openIdx + 600);
    expect(openSection).toContain('console.error');
    expect(openSection).toContain('subscriptionModal');
  });

  it('loadSubscriptionData logs a console.error when status/history DOM nodes are absent', () => {
    // Without this, the function silently returns and developers see no indication of why
    // subscription status is never rendered (missing DOM = silent no-op).
    const loadIdx = usersInitContent.indexOf('async function loadSubscriptionData(');
    expect(loadIdx).toBeGreaterThan(-1);
    const loadSection = usersInitContent.substring(loadIdx, loadIdx + 600);
    expect(loadSection).toContain('console.error');
    expect(loadSection).toContain('currentSubscriptionStatus');
  });

  it('loadSubscriptionData shows a visible error in historyDiv when API call fails', () => {
    // On API failure the modal must remain open and display a human-readable error — not
    // silently stay in "Loading..." state which is indistinguishable from a slow response.
    const loadIdx = usersInitContent.indexOf('async function loadSubscriptionData(');
    const closeIdx = usersInitContent.indexOf('function setupSubscriptionModal(');
    const loadSection = usersInitContent.substring(loadIdx, closeIdx);
    // catch block must write visible error text into historyDiv
    expect(loadSection).toContain('text-error');
    expect(loadSection).toContain('catch');
  });
});

// ─── Subscription Modal DOM – admin-users.html ────────────────────────────────

describe('Admin Regression — Subscription modal DOM present in admin-users.html', () => {
  let adminUsersHtml;

  beforeAll(() => {
    adminUsersHtml = fs.readFileSync(path.join(__dirname, '../../public/admin-users.html'), 'utf8');
  });

  it('admin-users.html contains #subscriptionModal element', () => {
    expect(adminUsersHtml).toContain('id="subscriptionModal"');
  });

  it('admin-users.html contains #currentSubscriptionStatus element', () => {
    expect(adminUsersHtml).toContain('id="currentSubscriptionStatus"');
  });

  it('admin-users.html contains #subscriptionHistory element', () => {
    expect(adminUsersHtml).toContain('id="subscriptionHistory"');
  });

  it('admin-users.html contains #subscriptionUserId hidden input', () => {
    expect(adminUsersHtml).toContain('id="subscriptionUserId"');
  });

  it('admin-users.html loads admin-users-init.js', () => {
    expect(adminUsersHtml).toContain('admin-users-init.js');
  });
});
