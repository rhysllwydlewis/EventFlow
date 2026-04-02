/**
 * Integration tests for admin/debug endpoint hardening
 *
 * Verifies that all admin debug endpoints:
 * 1. Require authentication (authRequired middleware)
 * 2. Require admin role (roleRequired('admin') middleware)
 * 3. Protect state-changing operations with CSRF (csrfProtection)
 * 4. Produce audit logs for sensitive actions
 * 5. Do not expose sensitive tokens in API responses
 * 6. Enforce safe input validation
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEBUG_ROUTES = path.join(__dirname, '../../routes/admin-debug.js');
const WEBHOOKS_TEST_ROUTES = path.join(__dirname, '../../routes/admin-webhooks-test.js');
const INDEX_ROUTES = path.join(__dirname, '../../routes/index.js');
const FRONTEND_DEBUG = path.join(__dirname, '../../public/assets/js/pages/admin-debug.js');

let debugContent;
let webhooksTestContent;
let indexContent;
let frontendDebugContent;

beforeAll(() => {
  debugContent = fs.readFileSync(DEBUG_ROUTES, 'utf8');
  webhooksTestContent = fs.readFileSync(WEBHOOKS_TEST_ROUTES, 'utf8');
  indexContent = fs.readFileSync(INDEX_ROUTES, 'utf8');
  frontendDebugContent = fs.readFileSync(FRONTEND_DEBUG, 'utf8');
});

// ─── File Existence ───────────────────────────────────────────────────────────

describe('Admin Debug Hardening — File Structure', () => {
  it('routes/admin-debug.js exists', () => {
    expect(fs.existsSync(DEBUG_ROUTES)).toBe(true);
  });

  it('admin-debug.js imports authRequired and roleRequired', () => {
    expect(debugContent).toContain('authRequired');
    expect(debugContent).toContain('roleRequired');
  });

  it('admin-debug.js imports csrfProtection', () => {
    expect(debugContent).toContain('csrfProtection');
  });

  it('admin-debug.js imports auditLog for change tracking', () => {
    expect(debugContent).toContain('auditLog');
  });
});

// ─── Authentication Gate ──────────────────────────────────────────────────────

describe('Admin Debug Hardening — Authentication Requirements', () => {
  const endpoints = [
    { name: 'GET /user', pattern: "router.get('/user'" },
    { name: 'POST /fix-password', pattern: "'/fix-password'" },
    { name: 'POST /verify-user', pattern: "'/verify-user'" },
    { name: 'POST /test-email', pattern: "'/test-email'" },
    { name: 'POST /login-test', pattern: "'/login-test'" },
    { name: 'POST /audit-users', pattern: "'/audit-users'" },
  ];

  endpoints.forEach(({ name, pattern }) => {
    it(`${name} requires authRequired middleware`, () => {
      const idx = debugContent.indexOf(pattern);
      expect(idx).toBeGreaterThan(-1);
      const block = debugContent.substring(idx - 20, idx + 300);
      expect(block).toContain('authRequired');
    });

    it(`${name} requires roleRequired('admin') middleware`, () => {
      const idx = debugContent.indexOf(pattern);
      expect(idx).toBeGreaterThan(-1);
      const block = debugContent.substring(idx - 20, idx + 300);
      expect(block).toContain("roleRequired('admin')");
    });
  });
});

// ─── CSRF Enforcement on State-Changing Endpoints ─────────────────────────────

describe('Admin Debug Hardening — CSRF Protection', () => {
  const stateChangingEndpoints = [
    { name: 'POST /fix-password', pattern: "'/fix-password'" },
    { name: 'POST /verify-user', pattern: "'/verify-user'" },
    { name: 'POST /test-email', pattern: "'/test-email'" },
    { name: 'POST /login-test', pattern: "'/login-test'" },
    { name: 'POST /audit-users', pattern: "'/audit-users'" },
  ];

  stateChangingEndpoints.forEach(({ name, pattern }) => {
    it(`${name} has csrfProtection middleware`, () => {
      const idx = debugContent.indexOf(pattern);
      expect(idx).toBeGreaterThan(-1);
      const block = debugContent.substring(idx - 20, idx + 400);
      expect(block).toContain('csrfProtection');
    });
  });
});

// ─── Audit Logging ────────────────────────────────────────────────────────────

describe('Admin Debug Hardening — Audit Logging', () => {
  it('POST /fix-password records audit log entry', () => {
    const idx = debugContent.indexOf("'/fix-password'");
    const block = debugContent.substring(idx, idx + 1200);
    expect(block).toContain('auditLog');
    expect(block).toContain("action: 'fix_password'");
  });

  it('POST /verify-user records audit log entry', () => {
    const idx = debugContent.indexOf("'/verify-user'");
    const block = debugContent.substring(idx, idx + 1200);
    expect(block).toContain('auditLog');
    expect(block).toContain("action: 'verify_user'");
  });

  it('POST /test-email records audit log entry', () => {
    const idx = debugContent.indexOf("'/test-email'");
    const block = debugContent.substring(idx, idx + 1200);
    expect(block).toContain('auditLog');
    expect(block).toContain("action: 'test_email'");
  });

  it('POST /audit-users records audit log entry', () => {
    const idx = debugContent.indexOf("'/audit-users'");
    const block = debugContent.substring(idx, idx + 2000);
    expect(block).toContain('auditLog');
    expect(block).toContain("action: 'audit_users'");
  });
});

// ─── Response Safety (no sensitive data leakage) ──────────────────────────────

describe('Admin Debug Hardening — Response Safety', () => {
  it('GET /user never returns passwordHash in response', () => {
    const userIdx = debugContent.indexOf("router.get('/user'");
    const userBlock = debugContent.substring(userIdx, userIdx + 2000);
    // debug_info section must NOT include the raw passwordHash value
    // It should only include hasPasswordHash (boolean) and passwordHashLength
    expect(userBlock).toContain('hasPasswordHash');
    expect(userBlock).not.toMatch(/debug_info[\s\S]*?passwordHash\s*:/);
  });

  it('POST /test-email does not return a raw token in the response body', () => {
    const testEmailIdx = debugContent.indexOf("'/test-email'");
    const block = debugContent.substring(testEmailIdx, testEmailIdx + 1500);
    // testToken should NOT be returned - it leaks sensitive email verification tokens
    expect(block).not.toMatch(/testToken\s*:/);
  });

  it('POST /fix-password enforces minimum password length of 8 characters', () => {
    const fixIdx = debugContent.indexOf("'/fix-password'");
    const block = debugContent.substring(fixIdx, fixIdx + 1000);
    expect(block).toContain('8');
    expect(block).toMatch(/newPassword\.length\s*<\s*8/);
  });

  it('POST /fix-password does not return the new password in the response', () => {
    const fixIdx = debugContent.indexOf("'/fix-password'");
    const block = debugContent.substring(fixIdx, fixIdx + 1500);
    // Response should include user info but not the password
    expect(block).not.toMatch(/res\.json[\s\S]{0,100}newPassword/);
  });

  it('POST /audit-users returns summary statistics without exposing all user data', () => {
    const auditIdx = debugContent.indexOf("'/audit-users'");
    const block = debugContent.substring(auditIdx, auditIdx + 2000);
    // Should return summary counts, not full user objects
    expect(block).toContain('summary');
    expect(block).toContain('totalUsers');
  });
});

// ─── Input Validation ─────────────────────────────────────────────────────────

describe('Admin Debug Hardening — Input Validation', () => {
  it('GET /user validates email query parameter is provided', () => {
    const userIdx = debugContent.indexOf("router.get('/user'");
    const block = debugContent.substring(userIdx, userIdx + 600);
    expect(block).toContain('email');
    expect(block).toContain('status(400)');
  });

  it('POST /fix-password validates both email and newPassword are provided', () => {
    const fixIdx = debugContent.indexOf("'/fix-password'");
    const block = debugContent.substring(fixIdx, fixIdx + 800);
    expect(block).toContain('email');
    expect(block).toContain('newPassword');
    expect(block).toContain('status(400)');
  });

  it('POST /verify-user validates email is provided', () => {
    const verifyIdx = debugContent.indexOf("'/verify-user'");
    const block = debugContent.substring(verifyIdx, verifyIdx + 600);
    expect(block).toContain('email');
    expect(block).toContain('status(400)');
  });

  it('POST /login-test validates both email and password are provided', () => {
    const loginIdx = debugContent.indexOf("'/login-test'");
    const block = debugContent.substring(loginIdx, loginIdx + 600);
    expect(block).toContain('email');
    expect(block).toContain('password');
    expect(block).toContain('status(400)');
  });
});

// ─── Logging ─────────────────────────────────────────────────────────────────

describe('Admin Debug Hardening — Operational Logging', () => {
  it('admin-debug.js uses logger for info/error messages', () => {
    expect(debugContent).toContain('logger.info');
    expect(debugContent).toContain('logger.error');
  });

  it('fix-password logs admin email for traceability', () => {
    const fixIdx = debugContent.indexOf("'/fix-password'");
    const block = debugContent.substring(fixIdx, fixIdx + 1500);
    expect(block).toContain('req.user.email');
    expect(block).toMatch(/logger\.info/);
  });

  it('verify-user logs admin email for traceability', () => {
    const verifyIdx = debugContent.indexOf("'/verify-user'");
    const block = debugContent.substring(verifyIdx, verifyIdx + 1000);
    expect(block).toContain('req.user.email');
    expect(block).toMatch(/logger\.info/);
  });
});

// ─── Webhooks Test Route — Route Separation Regression ───────────────────────
//
// Ensures that POST /test-webhooks lives in admin-webhooks-test.js (always
// mounted, including production) and is NOT duplicated in admin-debug.js
// (which is gated to non-production only).  This is the regression that caused
// the 404 in production described in the bug report.

describe('Admin Webhooks Test — File Structure', () => {
  it('routes/admin-webhooks-test.js exists', () => {
    expect(fs.existsSync(WEBHOOKS_TEST_ROUTES)).toBe(true);
  });

  it('admin-webhooks-test.js defines POST /test-webhooks handler', () => {
    expect(webhooksTestContent).toContain("'/test-webhooks'");
    expect(webhooksTestContent).toContain('router.post');
  });

  it('admin-webhooks-test.js requires authRequired and roleRequired', () => {
    expect(webhooksTestContent).toContain('authRequired');
    expect(webhooksTestContent).toContain("roleRequired('admin')");
  });

  it('admin-webhooks-test.js requires csrfProtection (no CSRF regression)', () => {
    expect(webhooksTestContent).toContain('csrfProtection');
  });

  it('admin-webhooks-test.js records an audit log entry', () => {
    expect(webhooksTestContent).toContain('auditLog');
    expect(webhooksTestContent).toContain("action: 'test_webhooks'");
  });

  it('admin-debug.js does NOT contain a duplicate /test-webhooks handler', () => {
    // The comment referencing test-webhooks is acceptable; the actual router.post handler must not be there.
    const idx = debugContent.indexOf("router.post(\n  '/test-webhooks'");
    expect(idx).toBe(-1);
  });
});

describe('Admin Webhooks Test — Route Mounting (no production gate)', () => {
  it('routes/index.js mounts admin-webhooks-test unconditionally (outside the isProduction gate)', () => {
    // The require for admin-webhooks-test must appear BEFORE the if (!isProduction...) block.
    const webhooksIdx = indexContent.indexOf("require('./admin-webhooks-test')");
    const productionGateIdx = indexContent.indexOf('if (!isProduction && debugRoutesEnabled)');
    expect(webhooksIdx).toBeGreaterThan(-1);
    expect(productionGateIdx).toBeGreaterThan(-1);
    expect(webhooksIdx).toBeLessThan(productionGateIdx);
  });

  it('routes/index.js mounts admin-webhooks-test at the canonical versioned path', () => {
    expect(indexContent).toMatch(/app\.use\(['"]\/api\/v1\/admin\/debug['"],\s*adminWebhooksTestRoutes\)/);
  });

  it('routes/index.js mounts admin-webhooks-test at the backward-compat unversioned path', () => {
    expect(indexContent).toMatch(/app\.use\(['"]\/api\/admin\/debug['"],\s*adminWebhooksTestRoutes\)/);
  });
});

describe('Admin Webhooks Test — Frontend URL', () => {
  it('frontend admin-debug.js uses the canonical versioned DEBUG_BASE_URL', () => {
    expect(frontendDebugContent).toContain("const DEBUG_BASE_URL = '/api/v1/admin/debug'");
  });

  it('frontend admin-debug.js does NOT use the bare unversioned debug base URL', () => {
    // Must not hardcode the old unversioned path as the constant value
    expect(frontendDebugContent).not.toContain("const DEBUG_BASE_URL = '/api/admin/debug'");
  });
});
