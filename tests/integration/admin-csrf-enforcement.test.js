/**
 * Integration tests for CSRF enforcement on admin state-changing routes
 *
 * Every POST / PUT / DELETE admin route that modifies data MUST include
 * csrfProtection middleware. This test file verifies the critical admin
 * routes that should be guarded.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_ROUTES = path.join(__dirname, '../../routes/admin.js');
const DEBUG_ROUTES = path.join(__dirname, '../../routes/admin-debug.js');
const CSRF_MIDDLEWARE = path.join(__dirname, '../../middleware/csrf.js');

let adminContent;
let debugContent;
let csrfContent;

beforeAll(() => {
  adminContent = fs.readFileSync(ADMIN_ROUTES, 'utf8');
  debugContent = fs.readFileSync(DEBUG_ROUTES, 'utf8');
  csrfContent = fs.readFileSync(CSRF_MIDDLEWARE, 'utf8');
});

// ─── CSRF Middleware Verification ────────────────────────────────────────────

describe('CSRF Middleware', () => {
  it('csrf.js exports csrfProtection function', () => {
    expect(csrfContent).toMatch(
      /(?:module\.exports|exports)\s*[=.]\s*(?:\{[^}]*csrfProtection|csrfProtection)/
    );
  });

  it('csrf.js validates X-CSRF-Token or csrf-token header', () => {
    expect(csrfContent).toMatch(/x-csrf-token|csrf-token/i);
  });

  it('admin.js imports csrfProtection from csrf middleware', () => {
    expect(adminContent).toContain("require('../middleware/csrf')");
    expect(adminContent).toContain('csrfProtection');
  });

  it('admin-debug.js imports csrfProtection from csrf middleware', () => {
    expect(debugContent).toContain("require('../middleware/csrf')");
    expect(debugContent).toContain('csrfProtection');
  });
});

// ─── Supplier State-Changing Routes ─────────────────────────────────────────

describe('CSRF Enforcement — Supplier Routes', () => {
  it('DELETE /suppliers/:id has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.delete('/suppliers/:id', authRequired, roleRequired('admin'), csrfProtection"
    );
  });

  it('POST /suppliers/:id/approve has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.post('/suppliers/:id/approve', authRequired, roleRequired('admin'), csrfProtection"
    );
  });

  it('POST /suppliers/:id/reject has csrfProtection', () => {
    expect(adminContent).toContain("'/suppliers/:id/reject'");
    const idx = adminContent.indexOf("'/suppliers/:id/reject'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });

  it('POST /suppliers/bulk-approve has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.post('/suppliers/bulk-approve', authRequired, roleRequired('admin'), csrfProtection"
    );
  });

  it('POST /suppliers/bulk-reject has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.post('/suppliers/bulk-reject', authRequired, roleRequired('admin'), csrfProtection"
    );
  });

  it('POST /suppliers/bulk-delete has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.post('/suppliers/bulk-delete', authRequired, roleRequired('admin'), csrfProtection"
    );
  });
});

// ─── Package State-Changing Routes ──────────────────────────────────────────

describe('CSRF Enforcement — Packages Routes', () => {
  it('POST /packages has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.post('/packages', authRequired, roleRequired('admin'), csrfProtection"
    );
  });

  it('POST /packages/:id/approve has csrfProtection', () => {
    expect(adminContent).toContain("'/packages/:id/approve'");
    const idx = adminContent.indexOf("'/packages/:id/approve'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });

  it('POST /packages/:id/feature has csrfProtection', () => {
    expect(adminContent).toContain("'/packages/:id/feature'");
    const idx = adminContent.indexOf("'/packages/:id/feature'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });

  it('POST /packages/bulk-approve has csrfProtection', () => {
    expect(adminContent).toContain("'/packages/bulk-approve'");
    const idx = adminContent.indexOf("'/packages/bulk-approve'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });
});

// ─── Photos State-Changing Routes ────────────────────────────────────────────

describe('CSRF Enforcement — Photos Routes', () => {
  it('POST /photos/:id/approve has csrfProtection', () => {
    expect(adminContent).toContain("'/photos/:id/approve'");
    const idx = adminContent.indexOf("'/photos/:id/approve'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });

  it('POST /photos/:id/reject has csrfProtection', () => {
    expect(adminContent).toContain("'/photos/:id/reject'");
    const idx = adminContent.indexOf("'/photos/:id/reject'");
    const block = adminContent.substring(idx - 30, idx + 300);
    expect(block).toContain('csrfProtection');
  });
});

// ─── Settings State-Changing Routes ─────────────────────────────────────────

describe('CSRF Enforcement — Settings Routes', () => {
  it('PUT /settings/site has csrfProtection', () => {
    // Verify csrfProtection appears in the settings/site block
    const getIdx = adminContent.indexOf("router.get('/settings/site'");
    const putBlock = adminContent.substring(getIdx + 100, getIdx + 800);
    expect(putBlock).toContain('csrfProtection');
  });

  it('PUT /settings/features has csrfProtection', () => {
    // Locate the PUT handler itself (not the GET handler above it) so this
    // assertion doesn't depend on the byte distance between the two, which
    // drifts whenever unrelated code is added/removed between them.
    const putIdx = adminContent.indexOf("router.put(\n  '/settings/features'");
    expect(putIdx).toBeGreaterThan(-1);
    const block = adminContent.substring(putIdx, putIdx + 300);
    expect(block).toContain('csrfProtection');
  });

  it('PUT /settings/maintenance has csrfProtection', () => {
    expect(adminContent).toContain(
      "router.put('/settings/maintenance', authRequired, roleRequired('admin'), csrfProtection"
    );
  });
});

// ─── Contact Enquiries State-Changing Routes ─────────────────────────────────

describe('CSRF Enforcement — Contact Enquiries Routes', () => {
  it('PUT /contact-enquiries/:id has csrfProtection', () => {
    expect(adminContent).toContain("'/contact-enquiries/:id'");
    const idx = adminContent.indexOf("'/contact-enquiries/:id'");
    const block = adminContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });

  it('POST /contact-enquiries/:id/reply has csrfProtection', () => {
    expect(adminContent).toContain("'/contact-enquiries/:id/reply'");
    const idx = adminContent.indexOf("'/contact-enquiries/:id/reply'");
    const block = adminContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });
});

// ─── Debug State-Changing Routes ─────────────────────────────────────────────

describe('CSRF Enforcement — Admin Debug Routes', () => {
  it('POST /fix-password has csrfProtection', () => {
    const idx = debugContent.indexOf("'/fix-password'");
    const block = debugContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });

  it('POST /verify-user has csrfProtection', () => {
    const idx = debugContent.indexOf("'/verify-user'");
    const block = debugContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });

  it('POST /test-email has csrfProtection', () => {
    const idx = debugContent.indexOf("'/test-email'");
    const block = debugContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });

  it('POST /login-test has csrfProtection', () => {
    const idx = debugContent.indexOf("'/login-test'");
    const block = debugContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });

  it('POST /audit-users has csrfProtection', () => {
    const idx = debugContent.indexOf("'/audit-users'");
    const block = debugContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });
});

// ─── Ticket Routes ────────────────────────────────────────────────────────────

describe('CSRF Enforcement — Tickets Routes', () => {
  it('PUT /tickets/:id has csrfProtection', () => {
    // There are GET and PUT routes for /tickets/:id.
    // Find the second occurrence of '/tickets/:id' which is the PUT route
    const firstIdx = adminContent.indexOf("'/tickets/:id'");
    const putIdx = adminContent.indexOf("'/tickets/:id'", firstIdx + 1);
    expect(putIdx).toBeGreaterThan(-1);
    const block = adminContent.substring(putIdx - 200, putIdx + 400);
    expect(block).toContain('csrfProtection');
  });

  it('POST /tickets/:id/reply has csrfProtection', () => {
    expect(adminContent).toContain("'/tickets/:id/reply'");
    const idx = adminContent.indexOf("'/tickets/:id/reply'");
    const block = adminContent.substring(idx - 30, idx + 400);
    expect(block).toContain('csrfProtection');
  });
});
