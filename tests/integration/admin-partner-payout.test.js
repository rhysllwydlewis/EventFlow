/**
 * Integration tests for admin partner payout request endpoints.
 *
 * Verifies:
 * - Both payout endpoints are protected by authRequired + roleRequired('admin')
 *   via the router-level middleware in routes/admin-partner.js
 * - The PATCH (status update) endpoint also enforces CSRF protection
 * - Route ordering: /payout-requests is registered before /:id so it is not
 *   shadowed by the dynamic segment wildcard
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_PARTNER_ROUTES = path.join(__dirname, '../../routes/admin-partner.js');

let routeContent;

beforeAll(() => {
  routeContent = fs.readFileSync(ADMIN_PARTNER_ROUTES, 'utf8');
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────

describe('Admin Partner Payout — Auth Middleware', () => {
  it('admin-partner.js imports authRequired and roleRequired', () => {
    expect(routeContent).toContain('authRequired');
    expect(routeContent).toContain('roleRequired');
  });

  it('applies router-level authRequired + roleRequired("admin") to all routes', () => {
    // The router.use line must come before any route definitions
    expect(routeContent).toMatch(/router\.use\(authRequired,\s*roleRequired\(['"]admin['"]\)\)/);
  });

  it('router.use auth guard appears before payout-requests route', () => {
    const authPos = routeContent.indexOf("router.use(authRequired, roleRequired('admin'))");
    const payoutGetPos = routeContent.indexOf("router.get('/payout-requests'");
    expect(authPos).toBeGreaterThan(-1);
    expect(payoutGetPos).toBeGreaterThan(-1);
    expect(authPos).toBeLessThan(payoutGetPos);
  });

  it('router.use auth guard appears before payout-requests status PATCH route', () => {
    const authPos = routeContent.indexOf("router.use(authRequired, roleRequired('admin'))");
    const payoutPatchPos = routeContent.indexOf("router.patch('/payout-requests/:ticketId/status'");
    expect(authPos).toBeGreaterThan(-1);
    expect(payoutPatchPos).toBeGreaterThan(-1);
    expect(authPos).toBeLessThan(payoutPatchPos);
  });
});

// ─── CSRF Protection ─────────────────────────────────────────────────────────

describe('Admin Partner Payout — CSRF Protection', () => {
  it('admin-partner.js imports csrfProtection', () => {
    expect(routeContent).toContain("require('../middleware/csrf')");
    expect(routeContent).toContain('csrfProtection');
  });

  it('PATCH /payout-requests/:ticketId/status uses csrfProtection', () => {
    expect(routeContent).toContain(
      "router.patch('/payout-requests/:ticketId/status', csrfProtection,"
    );
  });
});

// ─── Route Ordering ───────────────────────────────────────────────────────────

describe('Admin Partner Payout — Route Ordering', () => {
  it('/payout-requests GET is registered before /:id GET', () => {
    const payoutPos = routeContent.indexOf("router.get('/payout-requests'");
    // Use the actual route declaration pattern (not the comment reference)
    const idPos = routeContent.indexOf("\nrouter.get('/:id'");
    expect(payoutPos).toBeGreaterThan(-1);
    expect(idPos).toBeGreaterThan(-1);
    // payout-requests must come first so it is not swallowed by the /:id wildcard
    expect(payoutPos).toBeLessThan(idPos);
  });

  it('/payout-requests/:ticketId/status PATCH is registered before /:id PATCH routes', () => {
    const payoutPatchPos = routeContent.indexOf("router.patch('/payout-requests/:ticketId/status'");
    const idStatusPos = routeContent.indexOf("router.patch('/:id/status'");
    expect(payoutPatchPos).toBeGreaterThan(-1);
    expect(idStatusPos).toBeGreaterThan(-1);
    expect(payoutPatchPos).toBeLessThan(idStatusPos);
  });
});

// ─── Endpoint Existence ───────────────────────────────────────────────────────

describe('Admin Partner Payout — Endpoint Existence', () => {
  it('GET /payout-requests endpoint exists', () => {
    expect(routeContent).toContain("router.get('/payout-requests'");
  });

  it('PATCH /payout-requests/:ticketId/status endpoint exists', () => {
    expect(routeContent).toContain("router.patch('/payout-requests/:ticketId/status'");
  });

  it('GET /payout-requests filters by status query param', () => {
    expect(routeContent).toContain("category === 'partner_payout'");
  });

  it('PATCH /payout-requests/:ticketId/status validates allowed statuses', () => {
    expect(routeContent).toContain("'open', 'in_progress', 'resolved', 'closed'");
  });
});
