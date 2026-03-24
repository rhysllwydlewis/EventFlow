/**
 * Integration tests for admin cashout-request endpoints.
 *
 * Verifies (via static source analysis):
 * - Routes are protected by authRequired + roleRequired('admin')
 * - PATCH endpoint enforces CSRF protection
 * - Route structure: GET /, GET /:id, PATCH /:id
 * - Status transitions validation is present
 * - Ledger side-effects (hold release / final redeem) are present
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, '../../routes/admin-cashout-requests.js');

let routeContent;

beforeAll(() => {
  routeContent = fs.readFileSync(ROUTES_FILE, 'utf8');
});

// ─── Auth Middleware ──────────────────────────────────────────────────────────

describe('Admin Cashout Requests — Auth Middleware', () => {
  it('imports authRequired and roleRequired', () => {
    expect(routeContent).toContain('authRequired');
    expect(routeContent).toContain('roleRequired');
  });

  it('applies router-level authRequired + roleRequired("admin") to all routes', () => {
    expect(routeContent).toMatch(/router\.use\(authRequired,\s*roleRequired\(['"]admin['"]\)\)/);
  });

  it('auth guard appears before GET / route', () => {
    const authPos = routeContent.indexOf("router.use(authRequired, roleRequired('admin'))");
    const listPos = routeContent.indexOf("router.get('/'");
    expect(authPos).toBeGreaterThan(-1);
    expect(listPos).toBeGreaterThan(-1);
    expect(authPos).toBeLessThan(listPos);
  });
});

// ─── CSRF Protection ─────────────────────────────────────────────────────────

describe('Admin Cashout Requests — CSRF Protection', () => {
  it('imports csrfProtection', () => {
    expect(routeContent).toContain('csrfProtection');
  });

  it('PATCH /:id uses csrfProtection', () => {
    expect(routeContent).toContain("router.patch('/:id', csrfProtection,");
  });
});

// ─── Endpoint Existence ───────────────────────────────────────────────────────

describe('Admin Cashout Requests — Endpoint Existence', () => {
  it('GET / endpoint exists', () => {
    expect(routeContent).toContain("router.get('/',");
  });

  it('GET /:id endpoint exists', () => {
    expect(routeContent).toContain("router.get('/:id',");
  });

  it('PATCH /:id endpoint exists', () => {
    expect(routeContent).toContain("router.patch('/:id', csrfProtection,");
  });
});

// ─── Status Transitions ───────────────────────────────────────────────────────

describe('Admin Cashout Requests — Status Workflow', () => {
  it('defines VALID_STATUSES including all required statuses', () => {
    expect(routeContent).toContain("'submitted'");
    expect(routeContent).toContain("'approved'");
    expect(routeContent).toContain("'rejected'");
    expect(routeContent).toContain("'processing'");
    expect(routeContent).toContain("'delivered'");
  });

  it('defines VALID_TRANSITIONS map', () => {
    expect(routeContent).toContain('VALID_TRANSITIONS');
  });

  it('validates that status transitions are allowed', () => {
    expect(routeContent).toContain('Cannot transition from');
  });

  it('releases hold on rejection', () => {
    expect(routeContent).toContain('releaseCashoutHold');
    expect(routeContent).toContain("status === 'rejected'");
  });

  it('creates a final REDEEM transaction on delivery', () => {
    expect(routeContent).toContain("status === 'delivered'");
    expect(routeContent).toContain("CREDIT_TYPES.REDEEM");
  });
});

// ─── Collection Names ─────────────────────────────────────────────────────────

describe('Admin Cashout Requests — Data Model', () => {
  it('reads from partner_cashout_requests collection', () => {
    expect(routeContent).toContain("'partner_cashout_requests'");
  });

  it('enriches responses with partner user info', () => {
    expect(routeContent).toContain('partnerUser');
  });

  it('stores adminUserId on updates', () => {
    expect(routeContent).toContain('adminUserIdApproved');
  });
});
