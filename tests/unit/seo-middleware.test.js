/**
 * Unit tests for SEO noindex middleware (middleware/seo.js)
 *
 * Verifies that authenticated/private pages receive X-Robots-Tag: noindex, nofollow
 * and that public pages remain indexable.
 */

'use strict';

const { noindexMiddleware } = require('../../middleware/seo');

// Suppress logger noise in test output
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

function runMiddleware(path) {
  const middleware = noindexMiddleware();
  const headers = {};
  const req = { path };
  const res = {
    setHeader: (k, v) => {
      headers[k] = v;
    },
  };
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { headers, nextCalled };
}

function isNoindex(path) {
  const { headers } = runMiddleware(path);
  return headers['X-Robots-Tag'] === 'noindex, nofollow';
}

describe('SEO noindex middleware — authenticated pages', () => {
  test.each([
    // Legacy .html paths
    '/auth.html',
    '/reset-password.html',
    '/dashboard.html',
    '/dashboard-customer.html',
    '/dashboard-supplier.html',
    '/messages.html',
    '/guests.html',
    '/checkout.html',
    '/my-marketplace-listings.html',
    '/budget.html',
    // Canonical messenger SPA
    '/messenger',
    '/messenger/',
    '/messenger/index.html',
    // Canonical chat SPA
    '/chat',
    '/chat/',
    '/chat/index.html',
    // Admin pages
    '/admin/users.html',
    '/admin-tickets.html',
  ])('noindex applied to %s', path => {
    expect(isNoindex(path)).toBe(true);
  });
});

describe('SEO noindex middleware — public pages remain indexable', () => {
  test.each([
    '/',
    '/suppliers',
    '/marketplace',
    '/pricing',
    '/start',
    '/guides',
    '/faq',
    '/for-suppliers',
    '/contact',
    '/legal',
    '/privacy',
    '/terms',
  ])('no noindex on %s', path => {
    expect(isNoindex(path)).toBe(false);
  });
});

describe('SEO noindex middleware — next() is always called', () => {
  it('calls next() for noindex paths', () => {
    const { nextCalled } = runMiddleware('/messenger/');
    expect(nextCalled).toBe(true);
  });

  it('calls next() for public paths', () => {
    const { nextCalled } = runMiddleware('/suppliers');
    expect(nextCalled).toBe(true);
  });
});
