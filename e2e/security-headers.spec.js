import { test, expect } from '@playwright/test';

/**
 * Security Headers E2E Tests
 *
 * These tests validate that baseline HTTP security headers are properly configured
 * for defense-in-depth protection against common web vulnerabilities.
 *
 * Tests cover:
 * - X-Content-Type-Options (prevents MIME sniffing)
 * - Referrer-Policy (controls referrer information leakage)
 * - Permissions-Policy (restricts browser features)
 * - Clickjacking protection (CSP frame-ancestors or X-Frame-Options)
 * - X-Powered-By removal (prevents information disclosure)
 * - HSTS (enforces HTTPS in production only)
 *
 * Note: These tests require the full backend server to test security headers.
 * Tag tests as @backend if they fail in static mode.
 */

test.describe('Security Headers @backend', () => {
  test('should set X-Content-Type-Options: nosniff', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('should set Referrer-Policy: strict-origin-when-cross-origin', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('should set Permissions-Policy with restricted permissions', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    const permissionsPolicy = headers['permissions-policy'];
    expect(permissionsPolicy).toBeTruthy();

    // Check that geolocation, camera, and microphone are disabled by default
    // Our custom middleware formats these as: geolocation=(), camera=(), microphone=()
    expect(permissionsPolicy).toContain('geolocation=()');
    expect(permissionsPolicy).toContain('camera=()');
    expect(permissionsPolicy).toContain('microphone=()');
  });

  test('should have clickjacking protection via CSP frame-ancestors or X-Frame-Options', async ({
    request,
  }) => {
    const response = await request.get('/');
    const headers = response.headers();

    // Check for CSP frame-ancestors (preferred)
    const csp = headers['content-security-policy'];
    const hasFrameAncestors = csp && csp.includes("frame-ancestors 'none'");

    // Check for X-Frame-Options (fallback)
    const xFrameOptions = headers['x-frame-options'];
    const hasXFrameOptions = xFrameOptions && xFrameOptions.toUpperCase() === 'DENY';

    // At least one should be present
    expect(hasFrameAncestors || hasXFrameOptions).toBe(true);

    // Document which protection is active
    if (hasFrameAncestors) {
      console.log('✓ Clickjacking protection: CSP frame-ancestors');
    } else if (hasXFrameOptions) {
      console.log('✓ Clickjacking protection: X-Frame-Options');
    }
  });

  test('should not expose X-Powered-By header', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('should set security headers on API responses', async ({ request }) => {
    const response = await request.get('/api/config');
    const headers = response.headers();

    // Verify headers are also applied to API endpoints
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('HSTS configuration based on environment', async ({ request }) => {
    const response = await request.get('/');
    const headers = response.headers();

    const hstsHeader = headers['strict-transport-security'];

    // In CI/test environments, HSTS should NOT be set (NODE_ENV !== 'production')
    // In production, HSTS should be set with max-age and includeSubDomains
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // Production: HSTS should be present
      expect(hstsHeader).toBeTruthy();
      expect(hstsHeader).toContain('max-age=');
      expect(hstsHeader).toContain('includeSubDomains');

      // Should NOT have preload unless explicitly configured
      // (Not in requirements, and preload requires verification)
      console.log('✓ HSTS enabled in production:', hstsHeader);
    } else {
      // Non-production: HSTS should NOT be present
      expect(hstsHeader).toBeUndefined();
      console.log('✓ HSTS correctly disabled in non-production environment');
    }
  });

  test('should set security headers on static assets', async ({ request }) => {
    // Test that security headers are applied to static files too
    const response = await request.get('/favicon.ico');
    const headers = response.headers();

    // Even 404s should have security headers
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('CSP should not break service worker or asset delivery', async ({ page, request }) => {
    const cspViolations = [];
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Content Security Policy') || text.includes('CSP')) {
        cspViolations.push(text);
      }
    });

    const navigation = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(navigation?.ok()).toBe(true);
    await expect(page.locator('body')).toBeVisible();
    await expect.poll(() => page.title()).not.toBe('');

    const stylesheet = await request.get('/assets/css/styles.css');
    expect(stylesheet.ok()).toBe(true);
    expect(stylesheet.headers()['content-type']).toContain('text/css');

    const loadedStylesheets = await page.evaluate(() => document.styleSheets.length);
    expect(loadedStylesheets).toBeGreaterThan(0);

    if (cspViolations.length > 0) {
      console.warn('CSP diagnostics detected without blocking delivery:', cspViolations);
    }
  });
});

test.describe('Security Headers - Edge Cases @backend', () => {
  test('should apply headers to 404 responses', async ({ request }) => {
    const response = await request.get('/nonexistent-page');
    const headers = response.headers();

    // Security headers should be present even on error responses
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('should apply headers to API 404 responses', async ({ request }) => {
    const response = await request.get('/api/nonexistent-endpoint');
    const headers = response.headers();

    // Security headers should be present even on API error responses
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('should apply headers to redirects', async ({ request }) => {
    const response = await request.get('/index.html', {
      maxRedirects: 0, // Don't follow redirects
    });
    const headers = response.headers();

    // Security headers should be present on redirects
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});
