/**
 * Unit tests for verify-init.js
 *
 * Validates that the email verification page JS:
 *   - Calls the correct backend API endpoint (/api/v1/auth/verify)
 *   - Calls /api/v1/auth/me for user data post-verification
 *   - Calls /api/v1/auth/resend-verification for the resend form
 *   - Redirects to the correct dashboard URLs after verification
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VERIFY_INIT = path.join(__dirname, '../../public/assets/js/pages/verify-init.js');

let content;

beforeAll(() => {
  content = fs.readFileSync(VERIFY_INIT, 'utf8');
});

describe('verify-init.js — API endpoints', () => {
  it('calls /api/v1/auth/verify for token verification', () => {
    expect(content).toContain('/api/v1/auth/verify');
  });

  it('calls /api/v1/auth/me to retrieve current user', () => {
    expect(content).toContain('/api/v1/auth/me');
  });

  it('calls /api/v1/auth/resend-verification for the resend form', () => {
    expect(content).toContain('/api/v1/auth/resend-verification');
  });

  it('does NOT call a /api/v2 verification endpoint', () => {
    expect(content).not.toMatch(/\/api\/v2\/auth\/verify/);
  });
});

describe('verify-init.js — redirect URLs after verification', () => {
  it('redirects admin users to /admin.html', () => {
    expect(content).toContain('/admin.html');
  });

  it('redirects supplier users to /dashboard/supplier', () => {
    expect(content).toContain('/dashboard/supplier');
  });

  it('redirects customer users to /dashboard/customer', () => {
    expect(content).toContain('/dashboard/customer');
  });

  it('does NOT redirect to /dashboard-supplier.html (use canonical clean route instead)', () => {
    expect(content).not.toContain("redirectUrl = '/dashboard-supplier.html'");
  });

  it('does NOT redirect to /dashboard-customer.html (use canonical clean route instead)', () => {
    expect(content).not.toContain("redirectUrl = '/dashboard-customer.html'");
  });

  it('does NOT redirect to /admin without .html extension (wrong path)', () => {
    expect(content).not.toContain("redirectUrl = '/admin'");
  });
});
