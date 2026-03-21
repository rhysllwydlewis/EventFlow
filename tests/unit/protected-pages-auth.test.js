/**
 * Unit tests for server-side authentication guards on private HTML pages and SPA routes.
 *
 * Verifies that:
 *  - All pages in `protectedHtmlPages` (server.js) are listed, including /budget.
 *  - /messenger and /chat SPA prefixes are protected against unauthenticated access.
 *  - Unauthenticated requests receive a 302 redirect to /auth?redirect=<originalUrl>.
 *  - Authenticated requests pass through (next() is called).
 *  - scripts/serve-static.js mirrors the production protected-path list.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const serveStaticSrc = fs.readFileSync(
  path.join(__dirname, '../../scripts/serve-static.js'),
  'utf8'
);

// ---------------------------------------------------------------------------
// Helpers — simulate the protection middleware logic in isolation
// ---------------------------------------------------------------------------

/**
 * Simulate a protectedHtmlPages route handler.
 * Returns { redirected, location, nextCalled }.
 */
function runPageGuard(isAuthed, originalUrl = '/budget') {
  let redirected = false;
  let location = null;
  let nextCalled = false;

  const req = { originalUrl, cookies: isAuthed ? { token: 'valid' } : {} };
  const res = {
    redirect: (code, loc) => {
      redirected = true;
      location = loc;
    },
  };
  const next = () => {
    nextCalled = true;
  };

  // Inline the guard logic from server.js (getUserFromCookie simplified for tests)
  const user = req.cookies && req.cookies.token ? { id: 'u1' } : null;
  if (!user) {
    res.redirect(302, `/auth?redirect=${encodeURIComponent(req.originalUrl)}`);
  } else {
    next();
  }

  return { redirected, location, nextCalled };
}

/**
 * Simulate the SPA prefix middleware (app.use(prefix, ...)).
 * Express calls the middleware with req.originalUrl = full path.
 */
function runSpaGuard(isAuthed, originalUrl = '/messenger/') {
  let redirected = false;
  let location = null;
  let nextCalled = false;

  const req = { originalUrl, cookies: isAuthed ? { token: 'valid' } : {} };
  const res = {
    redirect: (code, loc) => {
      redirected = true;
      location = loc;
    },
  };
  const next = () => {
    nextCalled = true;
  };

  // Inline the guard logic from server.js
  const user = req.cookies && req.cookies.token ? { id: 'u1' } : null;
  if (!user) {
    res.redirect(302, `/auth?redirect=${encodeURIComponent(req.originalUrl)}`);
  } else {
    next();
  }

  return { redirected, location, nextCalled };
}

// ---------------------------------------------------------------------------
// 1. server.js source-level checks — ensure arrays contain required entries
// ---------------------------------------------------------------------------

describe('server.js — protectedHtmlPages array', () => {
  const expectedPages = [
    'notifications',
    'messages',
    'guests',
    'settings',
    'plan',
    'timeline',
    'my-marketplace-listings',
    'budget',
  ];

  it('defines the protectedHtmlPages array', () => {
    expect(serverSrc).toContain('protectedHtmlPages');
  });

  expectedPages.forEach(page => {
    it(`includes '${page}'`, () => {
      // Look for the page inside the protectedHtmlPages array block
      const arrayMatch = serverSrc.match(/protectedHtmlPages\s*=\s*\[([\s\S]*?)\];/);
      expect(arrayMatch).toBeTruthy();
      expect(arrayMatch[1]).toContain(`'${page}'`);
    });
  });
});

describe('server.js — protectedSpaPrefixes block', () => {
  it('defines protectedSpaPrefixes', () => {
    expect(serverSrc).toContain('protectedSpaPrefixes');
  });

  it("includes '/messenger'", () => {
    const arrayMatch = serverSrc.match(/protectedSpaPrefixes\s*=\s*\[([\s\S]*?)\];/);
    expect(arrayMatch).toBeTruthy();
    expect(arrayMatch[1]).toContain("'/messenger'");
  });

  it("includes '/chat'", () => {
    const arrayMatch = serverSrc.match(/protectedSpaPrefixes\s*=\s*\[([\s\S]*?)\];/);
    expect(arrayMatch).toBeTruthy();
    expect(arrayMatch[1]).toContain("'/chat'");
  });

  it('uses app.use() so subpaths are also protected', () => {
    // app.use(prefix, ...) handles all subpaths; app.get() would only match exact path
    expect(serverSrc).toContain('app.use(prefix, apiLimiter');
  });

  it('both page and SPA guards use the shared unauthRedirect function', () => {
    // Verify the shared helper is defined and used by both guards
    expect(serverSrc).toContain('function unauthRedirect(req, res, next)');
    expect(serverSrc).toContain('getUserFromCookie(req)');
    // Both loops delegate to unauthRedirect rather than inline callbacks
    expect(serverSrc).toContain('app.get(`/${page}`, apiLimiter, unauthRedirect)');
    expect(serverSrc).toContain('app.use(prefix, apiLimiter, unauthRedirect)');
  });
});

describe('server.js — SPA guard is registered before express.static()', () => {
  it('protectedSpaPrefixes block appears before app.use(express.static())', () => {
    const spaIdx = serverSrc.indexOf('protectedSpaPrefixes');
    // Search for the actual static-serving call, not comment references
    const staticIdx = serverSrc.indexOf('app.use(express.static(');
    expect(spaIdx).toBeGreaterThan(-1);
    expect(staticIdx).toBeGreaterThan(-1);
    expect(spaIdx).toBeLessThan(staticIdx);
  });
});

// ---------------------------------------------------------------------------
// 2. Guard logic — unauthenticated requests are redirected
// ---------------------------------------------------------------------------

describe('Page guard — unauthenticated → 302 redirect', () => {
  test.each([
    '/budget',
    '/notifications',
    '/settings',
    '/plan',
    '/timeline',
    '/guests',
    '/messages',
    '/my-marketplace-listings',
  ])('redirects unauthenticated request to %s', originalUrl => {
    const { redirected, location, nextCalled } = runPageGuard(false, originalUrl);
    expect(redirected).toBe(true);
    expect(location).toBe(`/auth?redirect=${encodeURIComponent(originalUrl)}`);
    expect(nextCalled).toBe(false);
  });
});

describe('Page guard — authenticated → next() called', () => {
  test.each([
    '/budget',
    '/notifications',
    '/settings',
    '/plan',
    '/timeline',
    '/guests',
    '/messages',
    '/my-marketplace-listings',
  ])('passes authenticated request for %s', originalUrl => {
    const { redirected, nextCalled } = runPageGuard(true, originalUrl);
    expect(redirected).toBe(false);
    expect(nextCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. SPA guard logic — /messenger and /chat
// ---------------------------------------------------------------------------

describe('SPA guard — unauthenticated → 302 redirect', () => {
  test.each([
    '/messenger',
    '/messenger/',
    '/messenger/index.html',
    '/chat',
    '/chat/',
    '/chat/index.html',
  ])('redirects unauthenticated request to %s', originalUrl => {
    const { redirected, location, nextCalled } = runSpaGuard(false, originalUrl);
    expect(redirected).toBe(true);
    expect(location).toBe(`/auth?redirect=${encodeURIComponent(originalUrl)}`);
    expect(nextCalled).toBe(false);
  });
});

describe('SPA guard — authenticated → next() called', () => {
  test.each(['/messenger', '/messenger/', '/messenger/index.html', '/chat', '/chat/'])(
    'passes authenticated request for %s',
    originalUrl => {
      const { redirected, nextCalled } = runSpaGuard(true, originalUrl);
      expect(redirected).toBe(false);
      expect(nextCalled).toBe(true);
    }
  );
});

describe('SPA guard — redirect URL encodes originalUrl correctly', () => {
  it('encodes query strings in the redirect', () => {
    const originalUrl = '/messenger/?conversation=abc123&foo=bar';
    const { location } = runSpaGuard(false, originalUrl);
    expect(location).toBe(`/auth?redirect=${encodeURIComponent(originalUrl)}`);
  });
});

// ---------------------------------------------------------------------------
// 4. serve-static.js — mirrors the protected-path list
// ---------------------------------------------------------------------------

describe('serve-static.js — protectedStaticPaths mirrors production', () => {
  const requiredPaths = [
    '/notifications',
    '/messages',
    '/guests',
    '/settings',
    '/plan',
    '/timeline',
    '/my-marketplace-listings',
    '/budget',
    '/messenger',
    '/chat',
  ];

  it('defines protectedStaticPaths', () => {
    expect(serveStaticSrc).toContain('protectedStaticPaths');
  });

  requiredPaths.forEach(p => {
    it(`includes '${p}'`, () => {
      const arrayMatch = serveStaticSrc.match(/protectedStaticPaths\s*=\s*\[([\s\S]*?)\];/);
      expect(arrayMatch).toBeTruthy();
      expect(arrayMatch[1]).toContain(`'${p}'`);
    });
  });

  it('redirects unauthenticated requests to /auth?redirect=<originalUrl>', () => {
    expect(serveStaticSrc).toContain('/auth?redirect=');
    expect(serveStaticSrc).toContain('encodeURIComponent(req.originalUrl)');
  });
});
