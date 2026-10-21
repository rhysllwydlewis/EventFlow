'use strict';

/**
 * Where a signed-in person can be sent by a `redirect` parameter. These run the real code from
 * public/assets/js/app.js (see tests/helpers/load-app-redirect.js).
 */

const { loadAppRedirect, appJs } = require('../helpers/load-app-redirect');

const ORIGIN = 'https://event-flow.co.uk';
const { safeRedirectTarget, allowedPaths } = loadAppRedirect(ORIGIN);

describe('safeRedirectTarget', () => {
  test('sends each role to the pages it is allowed, and keeps the query and fragment', () => {
    expect(safeRedirectTarget('/dashboard/supplier', 'supplier')).toBe('/dashboard/supplier');
    expect(safeRedirectTarget('/pricing?plan=pro#compare', 'customer')).toBe(
      '/pricing?plan=pro#compare'
    );
    expect(safeRedirectTarget('/admin-users?tab=staff', 'admin')).toBe('/admin-users?tab=staff');
    expect(safeRedirectTarget('/messenger/', 'customer')).toBe('/messenger/');
  });

  test('every allowlisted page of every role is reachable and comes back unchanged', () => {
    Object.entries(allowedPaths).forEach(([role, pages]) => {
      pages.forEach(page => {
        expect(safeRedirectTarget(page, role)).toBe(page);
      });
    });
  });

  test('a page that belongs to another role, or to nobody, is refused', () => {
    expect(safeRedirectTarget('/admin', 'supplier')).toBeNull();
    expect(safeRedirectTarget('/admin', 'customer')).toBeNull();
    expect(safeRedirectTarget('/dashboard/supplier', 'customer')).toBeNull();
    expect(safeRedirectTarget('/not-a-page', 'admin')).toBeNull();
    expect(safeRedirectTarget('/dashboard/customer', undefined)).toBeNull();
    expect(safeRedirectTarget('/dashboard/customer', 'unknown-role')).toBeNull();
  });

  test.each([
    ['another site', 'https://evil.example/dashboard/customer'],
    ['a protocol-relative address', '//evil.example/dashboard/customer'],
    ['a backslash that browsers read as a slash', '/\\evil.example'],
    ['a backslash after a path', '/dashboard/customer\\..\\..\\evil'],
    ['a tab that browsers drop', '/\t/evil.example'],
    ['a newline that browsers drop', '/\n/evil.example'],
    ['a carriage return', '/dashboard/customer\r\nSet-Cookie: x=1'],
    ['a null byte', '/dashboard/customer\u0000.evil'],
    ['a javascript: address', 'javascript:alert(1)'],
    ['a data: address', 'data:text/html,<script>alert(1)</script>'],
    ['no leading slash', 'dashboard/customer'],
    ['an empty value', ''],
    ['only spaces', '   '],
  ])('refuses %s', (_label, value) => {
    expect(safeRedirectTarget(value, 'customer')).toBeNull();
    expect(safeRedirectTarget(value, 'admin')).toBeNull();
  });

  test('refuses values that are not text', () => {
    [undefined, null, 5, {}, ['/dashboard/customer'], true].forEach(value => {
      expect(safeRedirectTarget(value, 'customer')).toBeNull();
    });
  });

  test('a path that only resolves into another page is judged on where it really lands', () => {
    // "..": the real destination is /admin, which a supplier may not have.
    expect(safeRedirectTarget('/dashboard/supplier/../../admin', 'supplier')).toBeNull();
    // For an admin it is allowed, and what comes back is the clean address, not the raw text.
    expect(safeRedirectTarget('/dashboard/supplier/../../admin', 'admin')).toBe('/admin');
    // Encoded slashes are part of the file name, not separators, so this is not an allowed page.
    expect(safeRedirectTarget('/%2F%2Fevil.example', 'customer')).toBeNull();
  });

  test('carries a plan along, once', () => {
    expect(safeRedirectTarget('/checkout', 'supplier', 'pro')).toBe('/checkout?plan=pro');
    expect(safeRedirectTarget('/checkout?plan=pro_plus', 'supplier', 'pro')).toBe(
      '/checkout?plan=pro_plus'
    );
    expect(safeRedirectTarget('/checkout?x=1#top', 'supplier', 'pro')).toBe(
      '/checkout?x=1&plan=pro#top'
    );
    expect(safeRedirectTarget('/pricing', 'supplier', 'a b&c=d')).toBe('/pricing?plan=a+b%26c%3Dd');
  });

  test('whatever it is given, a result is always a path on this site', () => {
    const hostile = [
      '/dashboard/customer',
      '/dashboard/customer?next=https://evil.example',
      '/pricing#//evil.example',
      '/pricing?x=\\\\evil.example',
      '/budget/../guests',
      '/%5Cevil.example',
      '/%09/evil.example',
      '/.%2e/admin',
    ];
    hostile.forEach(value => {
      ['customer', 'supplier', 'admin'].forEach(role => {
        const target = safeRedirectTarget(value, role);
        if (target !== null) {
          expect(target.startsWith('/')).toBe(true);
          expect(target.startsWith('//')).toBe(false);
          expect(new URL(target, ORIGIN).origin).toBe(ORIGIN);
        }
      });
    });
  });
});

describe('the sign-in and registration pages', () => {
  test('never send the visitor to a redirect parameter as it stands', () => {
    expect(appJs).not.toMatch(/destination\s*=\s*redirect(Param)?\s*;/);
    expect(appJs).not.toMatch(/redirectUrl\s*=\s*redirect\s*;/);
    expect(appJs).not.toMatch(/redirectUrl\s*=\s*`\$\{redirect\}/);
    // Each of the three places that read the parameter goes through the helper.
    expect(appJs.match(/safeRedirectTarget\(/g).length).toBeGreaterThanOrEqual(4);
  });

  test('the old validator that fell back to trusting unparsed text is gone', () => {
    expect(appJs).not.toContain('validateRedirectForRole');
    expect(appJs).not.toContain('treat it as a pathname directly');
  });
});

describe('the venue map', () => {
  test('does not keep a visitor location in the browser, and erases what older versions kept', () => {
    expect(appJs).not.toMatch(/localStorage\.setItem\(\s*LAST_QUERY/);
    expect(appJs).not.toContain('LAST_QUERY_KEY');
    expect(appJs).toContain("localStorage.removeItem('ef:lastMapQuery')");
    expect(appJs).toContain("localStorage.removeItem('ef:lastMapLabel')");
  });

  test("says plainly when location sharing is off, not in the browser's technical words", () => {
    expect(appJs).toContain('Location sharing is switched off. Type a postcode instead.');
    expect(appJs).not.toContain('Could not access your location (${err.message})');
  });
});
