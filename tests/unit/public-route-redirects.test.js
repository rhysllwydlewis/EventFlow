/**
 * Unit tests for dead-end route redirects and protected-page server-side gating.
 *
 * Tests the routing logic introduced to:
 *   - Redirect /supplier → /suppliers (301)
 *   - Redirect /category → /suppliers (301)
 *   - Redirect bare /package → /suppliers (301)
 *   - Serve /package when meaningful context (id, packageId, slug) is present
 */

'use strict';

/**
 * Simulate the redirect logic for dead-end singular routes.
 * Mirrors the route handlers in scripts/serve-static.js and server.js.
 */
function resolveDeadEndRoute(path, query = {}) {
  // /supplier → /suppliers
  if (path === '/supplier' || path === '/supplier.html') {
    return { redirect: 301, location: '/suppliers' };
  }

  // /category → /suppliers
  if (path === '/category' || path === '/category.html') {
    return { redirect: 301, location: '/suppliers' };
  }

  // /package — serve detail page when a meaningful identifier is present
  if (path === '/package' || path === '/package.html') {
    const { id, packageId, slug } = query;
    if (id || packageId || slug) {
      return { serve: 'package.html' };
    }
    return { redirect: 301, location: '/suppliers' };
  }

  return { serve: 'other' };
}

describe('Dead-end route redirects', () => {
  describe('/supplier', () => {
    it('redirects /supplier to /suppliers with 301', () => {
      const result = resolveDeadEndRoute('/supplier');
      expect(result.redirect).toBe(301);
      expect(result.location).toBe('/suppliers');
    });

    it('redirects /supplier.html to /suppliers with 301', () => {
      const result = resolveDeadEndRoute('/supplier.html');
      expect(result.redirect).toBe(301);
      expect(result.location).toBe('/suppliers');
    });
  });

  describe('/category', () => {
    it('redirects /category to /suppliers with 301', () => {
      const result = resolveDeadEndRoute('/category');
      expect(result.redirect).toBe(301);
      expect(result.location).toBe('/suppliers');
    });

    it('redirects /category.html to /suppliers with 301', () => {
      const result = resolveDeadEndRoute('/category.html');
      expect(result.redirect).toBe(301);
      expect(result.location).toBe('/suppliers');
    });
  });

  describe('/package', () => {
    it('redirects bare /package (no query params) to /suppliers with 301', () => {
      const result = resolveDeadEndRoute('/package', {});
      expect(result.redirect).toBe(301);
      expect(result.location).toBe('/suppliers');
    });

    it('serves package.html when id query param is present', () => {
      const result = resolveDeadEndRoute('/package', { id: 'mock-pkg-1' });
      expect(result.serve).toBe('package.html');
      expect(result.redirect).toBeUndefined();
    });

    it('serves package.html when packageId query param is present', () => {
      const result = resolveDeadEndRoute('/package', { packageId: 'mock-pkg-1' });
      expect(result.serve).toBe('package.html');
      expect(result.redirect).toBeUndefined();
    });

    it('serves package.html when slug query param is present', () => {
      const result = resolveDeadEndRoute('/package', { slug: 'garden-party-package' });
      expect(result.serve).toBe('package.html');
      expect(result.redirect).toBeUndefined();
    });

    it('redirects /package.html (no query params) to /suppliers with 301', () => {
      const result = resolveDeadEndRoute('/package.html', {});
      expect(result.redirect).toBe(301);
      expect(result.location).toBe('/suppliers');
    });
  });
});

/**
 * Simulate the server-side protection guard for authenticated pages.
 * Mirrors the middleware added in server.js and scripts/serve-static.js
 * that blocks unauthenticated requests to protected pages.
 */
function applyProtectedPageGuard(path, isAuthenticated) {
  const protectedPaths = [
    '/notifications',
    '/messages',
    '/guests',
    '/settings',
    '/plan',
    '/timeline',
    '/my-marketplace-listings',
    '/dashboard',
    '/dashboard/customer',
    '/dashboard/supplier',
    '/messenger',
    '/chat',
  ];

  const normalised = path.replace(/\.html$/, '');
  const isProtected = protectedPaths.some(
    p => normalised === p || normalised.startsWith(`${p}/`)
  );

  if (!isProtected) {
    return { action: 'pass' }; // public page, no guard
  }

  if (!isAuthenticated) {
    return { action: 'redirect', location: `/auth?redirect=${encodeURIComponent(path)}` };
  }

  return { action: 'pass' }; // authenticated, allow through
}

describe('Server-side protected page guard', () => {
  const protectedPages = [
    '/notifications',
    '/messages',
    '/guests',
    '/settings',
    '/plan',
    '/timeline',
    '/my-marketplace-listings',
    '/dashboard',
    '/dashboard/customer',
    '/dashboard/supplier',
    '/messenger',
    '/chat',
  ];

  describe('unauthenticated requests', () => {
    protectedPages.forEach(page => {
      it(`redirects unauthenticated request to ${page} to /auth`, () => {
        const result = applyProtectedPageGuard(page, false);
        expect(result.action).toBe('redirect');
        expect(result.location).toContain('/auth');
        expect(result.location).toContain(encodeURIComponent(page));
      });
    });
  });

  describe('authenticated requests', () => {
    protectedPages.forEach(page => {
      it(`allows authenticated request to ${page}`, () => {
        const result = applyProtectedPageGuard(page, true);
        expect(result.action).toBe('pass');
      });
    });
  });

  describe('public pages are not blocked', () => {
    const trulyPublicPages = ['/', '/auth', '/legal', '/privacy', '/suppliers', '/marketplace', '/budget'];

    trulyPublicPages.forEach(page => {
      it(`allows unauthenticated request to public page ${page}`, () => {
        const result = applyProtectedPageGuard(page, false);
        expect(result.action).toBe('pass');
      });
    });
  });

  describe('sub-paths of protected routes', () => {
    it('blocks /dashboard/customer sub-paths for unauthenticated users', () => {
      const result = applyProtectedPageGuard('/dashboard/customer', false);
      expect(result.action).toBe('redirect');
    });

    it('blocks /messenger/ for unauthenticated users', () => {
      const result = applyProtectedPageGuard('/messenger/', false);
      expect(result.action).toBe('redirect');
    });
  });
});
