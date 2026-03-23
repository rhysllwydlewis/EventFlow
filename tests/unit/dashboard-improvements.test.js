/**
 * Unit tests for the dashboard improvements PR
 *
 * Covers:
 *  1. /dashboard route now has authRequired
 *  2. POST /api/packages/bulk endpoint structure and validation
 *  3. dashboard-customer-init.js: getCsrfToken checks window.__CSRF_TOKEN__ first
 *  4. dashboard-customer-init.js: budget PATCH checks response.ok
 *  5. dashboard-customer-init.js: populateHeroStats unread listener guard
 *  6. dashboard-customer-module.js: bulk fetch replaces N+1 pattern
 *  7. dashboard-logger.js: console.log is gated behind window.__EF_DEBUG__
 *  8. dashboard-customer.html contains csrf-token meta tag
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------
const dashboardRoutesSrc = fs.readFileSync(
  path.join(__dirname, '../../routes/dashboard.js'),
  'utf8'
);
const suppliersSrc = fs.readFileSync(path.join(__dirname, '../../routes/suppliers.js'), 'utf8');
const customerInitSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/dashboard-customer-init.js'),
  'utf8'
);
const customerModuleSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/dashboard-customer-module.js'),
  'utf8'
);
const dashboardLoggerSrc = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/utils/dashboard-logger.js'),
  'utf8'
);
const dashboardCustomerHtml = fs.readFileSync(
  path.join(__dirname, '../../public/dashboard-customer.html'),
  'utf8'
);

// ---------------------------------------------------------------------------
// 1. /dashboard route — authRequired
// ---------------------------------------------------------------------------
describe('routes/dashboard.js — /dashboard route protection', () => {
  it('GET /dashboard uses authRequired middleware', () => {
    // The route should now include authRequired in the middleware chain
    expect(dashboardRoutesSrc).toMatch(
      /router\.get\(['"]\/dashboard['"],\s*apiLimiter,\s*authRequired/
    );
  });

  it('GET /dashboard performs server-side role redirect for customer', () => {
    expect(dashboardRoutesSrc).toContain("res.redirect('/dashboard/customer')");
  });

  it('GET /dashboard performs server-side role redirect for supplier', () => {
    expect(dashboardRoutesSrc).toContain("res.redirect('/dashboard/supplier')");
  });

  it('GET /dashboard performs server-side role redirect for admin', () => {
    expect(dashboardRoutesSrc).toContain("res.redirect('/admin')");
  });

  it('GET /dashboard is wrapped in try/catch with error logging', () => {
    const block = dashboardRoutesSrc.slice(
      dashboardRoutesSrc.indexOf("router.get('/dashboard'"),
      dashboardRoutesSrc.indexOf("router.get('/dashboard/customer'")
    );
    expect(block).toContain('try {');
    expect(block).toContain('logger.error');
  });
});

// ---------------------------------------------------------------------------
// 2. POST /api/packages/bulk — endpoint structure
// ---------------------------------------------------------------------------
describe('routes/suppliers.js — POST /api/packages/bulk', () => {
  // Extract the bulk route block for targeted assertions
  const bulkStart = suppliersSrc.indexOf("router.post('/packages/bulk'");
  const bulkEnd = suppliersSrc.indexOf('\nrouter.', bulkStart + 10);
  const bulkBlock =
    bulkStart !== -1
      ? suppliersSrc.substring(bulkStart, bulkEnd === -1 ? suppliersSrc.length : bulkEnd)
      : '';

  it('bulk route is defined', () => {
    expect(bulkStart).not.toBe(-1);
  });

  it('bulk route requires authentication (applyAuthRequired middleware)', () => {
    // The JSDoc comment says "Requires authentication so that only logged-in customers
    // can resolve packages linked to their plans" — the implementation must match.
    const routeDeclaration = suppliersSrc.substring(
      bulkStart,
      suppliersSrc.indexOf('async (req, res)', bulkStart)
    );
    expect(routeDeclaration).toMatch(/applyAuthRequired|authRequired/);
  });

  it('bulk route validates that ids is an array', () => {
    expect(bulkBlock).toContain('Array.isArray(ids)');
  });

  it('bulk route enforces a maximum batch size', () => {
    expect(bulkBlock).toMatch(/MAX_BULK_IDS\s*=\s*\d+/);
  });

  it('bulk route deduplicates IDs with Set', () => {
    expect(bulkBlock).toContain('new Set(');
  });

  it('bulk route only returns approved packages', () => {
    expect(bulkBlock).toContain('p.approved');
  });

  it('bulk route is placed before /packages/:slug to avoid routing conflicts', () => {
    const slugPos = suppliersSrc.indexOf("router.get('/packages/:slug'");
    expect(bulkStart).toBeLessThan(slugPos);
  });

  it('bulk route returns a 400 for empty ids array', () => {
    expect(bulkBlock).toContain('status(400)');
  });
});

// ---------------------------------------------------------------------------
// 3. dashboard-customer-init.js — getCsrfToken checks window.__CSRF_TOKEN__
// ---------------------------------------------------------------------------
describe('dashboard-customer-init.js — getCsrfToken reliability', () => {
  it('getCsrfToken checks window.__CSRF_TOKEN__ first', () => {
    // Should check global cache before meta/cookie
    const fnStart = customerInitSrc.indexOf('function getCsrfToken()');
    const fnEnd = customerInitSrc.indexOf('\nfunction ', fnStart + 1);
    const fnBody = customerInitSrc.substring(fnStart, fnEnd === -1 ? fnStart + 500 : fnEnd);
    expect(fnBody).toContain('window.__CSRF_TOKEN__');
  });

  it('ensureCsrfToken function exists to pre-fetch and cache the token', () => {
    expect(customerInitSrc).toContain('async function ensureCsrfToken()');
  });

  it('ensureCsrfToken fetches /api/csrf-token as fallback', () => {
    const fnStart = customerInitSrc.indexOf('async function ensureCsrfToken()');
    const fnEnd = customerInitSrc.indexOf('\nfunction ', fnStart + 1);
    const fnBody = customerInitSrc.substring(fnStart, fnEnd === -1 ? fnStart + 600 : fnEnd);
    expect(fnBody).toContain('/api/csrf-token');
    expect(fnBody).toContain('window.__CSRF_TOKEN__');
  });

  it('initDashboard calls ensureCsrfToken early', () => {
    const initStart = customerInitSrc.indexOf('async function initDashboard()');
    const initEnd = customerInitSrc.indexOf('\nasync function ', initStart + 1);
    const initBody = customerInitSrc.substring(
      initStart,
      initEnd === -1 ? initStart + 1000 : initEnd
    );
    expect(initBody).toContain('await ensureCsrfToken()');
  });
});

// ---------------------------------------------------------------------------
// 4. dashboard-customer-init.js — budget PATCH checks response.ok
// ---------------------------------------------------------------------------
describe('dashboard-customer-init.js — budget PATCH response handling', () => {
  it('checks patchResp.ok after PATCH call', () => {
    expect(customerInitSrc).toContain('patchResp.ok');
  });

  it('sets serverSyncFailed flag when PATCH fails', () => {
    expect(customerInitSrc).toContain('serverSyncFailed = true');
  });

  it('shows a user-visible warning when server sync fails', () => {
    expect(customerInitSrc).toContain('saved locally');
  });

  it('does not show success state when server sync failed', () => {
    // The warning branch must be distinct from the success branch
    expect(customerInitSrc).toContain('serverSyncFailed');
    // Success message only appears in the else branch
    const warnIdx = customerInitSrc.indexOf('serverSyncFailed = true');
    const successIdx = customerInitSrc.indexOf('Budget set to');
    expect(successIdx).toBeGreaterThan(warnIdx);
  });
});

// ---------------------------------------------------------------------------
// 5. dashboard-customer-init.js — unread count listener guard
// ---------------------------------------------------------------------------
describe('dashboard-customer-init.js — unread count listener guard', () => {
  it('uses __heroUnreadListenerAdded guard to prevent duplicate listeners', () => {
    expect(customerInitSrc).toContain('__heroUnreadListenerAdded');
  });

  it('sets guard flag before adding listener', () => {
    const guardIdx = customerInitSrc.indexOf('window.__heroUnreadListenerAdded = true');
    const listenerIdx = customerInitSrc.indexOf(
      "window.addEventListener('unreadCountUpdated'",
      guardIdx
    );
    expect(guardIdx).not.toBe(-1);
    expect(listenerIdx).toBeGreaterThan(guardIdx);
  });
});

// ---------------------------------------------------------------------------
// 6. dashboard-customer-module.js — bulk fetch replaces N+1 pattern
// ---------------------------------------------------------------------------
describe('dashboard-customer-module.js — bulk package fetch', () => {
  it('uses /api/packages/bulk endpoint instead of individual fetches', () => {
    expect(customerModuleSrc).toContain('/api/packages/bulk');
  });

  it('deduplicates package IDs with Set before fetching', () => {
    const calcStart = customerModuleSrc.indexOf('async function calculateRealBudget');
    const calcEnd = customerModuleSrc.indexOf('\nasync function ', calcStart + 1);
    const calcBody = customerModuleSrc.substring(
      calcStart,
      calcEnd === -1 ? calcStart + 3000 : calcEnd
    );
    expect(calcBody).toContain('new Set(');
  });

  it('does not use individual per-package fetch loop', () => {
    // The old N+1 pattern used /api/packages/${pkgId} for each package
    expect(customerModuleSrc).not.toContain('/api/packages/${encodeURIComponent(pkgId)}');
  });

  it('handles bulk fetch errors gracefully by defaulting to empty array', () => {
    expect(customerModuleSrc).toContain('packages: []');
  });
});

// ---------------------------------------------------------------------------
// 7. dashboard-logger.js — console.log gated behind __EF_DEBUG__
// ---------------------------------------------------------------------------
describe('dashboard-logger.js — debug flag gate', () => {
  it('console.log is gated behind window.__EF_DEBUG__', () => {
    expect(dashboardLoggerSrc).toContain('window.__EF_DEBUG__');
    // The console.log must appear inside the if block
    const ifIdx = dashboardLoggerSrc.indexOf('window.__EF_DEBUG__');
    const logIdx = dashboardLoggerSrc.indexOf('console.log', ifIdx);
    expect(logIdx).toBeGreaterThan(ifIdx);
  });

  it('log entries are still stored in window.dashboardLogs regardless of debug flag', () => {
    expect(dashboardLoggerSrc).toContain('window.dashboardLogs.push(logEntry)');
  });
});

// ---------------------------------------------------------------------------
// 8. dashboard-customer.html — CSRF meta tag
// ---------------------------------------------------------------------------
describe('public/dashboard-customer.html — CSRF meta tag', () => {
  it('contains <meta name="csrf-token"> tag', () => {
    expect(dashboardCustomerHtml).toContain('name="csrf-token"');
  });
});
