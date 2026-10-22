'use strict';

/**
 * Header rules found while auditing the supplier dashboard:
 * - "Use my location" needs geolocation on the pages that have the button, and nowhere else.
 * - Socket.IO is served by this site, so the content-security policy no longer lists its CDN.
 */

const fs = require('fs');
const { configurePermissionsPolicy } = require('../../middleware/security');

function policyFor(path) {
  const headers = {};
  const res = { setHeader: (name, value) => (headers[name] = value) };
  const next = jest.fn();
  configurePermissionsPolicy()({ path }, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  return headers['Permissions-Policy'];
}

describe('Permissions-Policy geolocation', () => {
  it.each(['/marketplace', '/marketplace.html', '/suppliers', '/suppliers.html', '/suppliers/'])(
    'is allowed for this site on %s',
    path => {
      expect(policyFor(path)).toBe('geolocation=(self), camera=(), microphone=()');
    }
  );

  it.each([
    '/',
    '/dashboard/supplier',
    '/supplier/some-slug',
    '/suppliers/extra',
    '/auth',
    '/admin',
  ])('stays off on %s', path => {
    expect(policyFor(path)).toBe('geolocation=(), camera=(), microphone=()');
  });

  it('never allows the camera or microphone', () => {
    expect(policyFor('/suppliers')).toContain('camera=()');
    expect(policyFor('/suppliers')).toContain('microphone=()');
  });
});

describe('content-security policy', () => {
  it('no longer lists the Socket.IO CDN', () => {
    const source = fs.readFileSync(require.resolve('../../middleware/security.js'), 'utf8');
    expect(source).not.toContain('cdn.socket.io');
  });
});
