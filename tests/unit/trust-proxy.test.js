/**
 * req.ip must be the visitor, not a Cloudflare address, when the site is served through
 * Cloudflare and then Railway's edge (utils/trustProxy.js). Anything keyed on the visitor's
 * address (rate limits, the per-address cap on counted profile views, audit logs) depends on it.
 */
'use strict';

const express = require('express');
const request = require('supertest');
const {
  createTrustProxy,
  isCloudflareAddress,
  CLOUDFLARE_IPV4,
  CLOUDFLARE_IPV6,
} = require('../../utils/trustProxy');

function appWith(trust) {
  const app = express();
  app.set('trust proxy', trust);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

const ipFor = async (app, forwardedFor) => {
  const req = request(app).get('/ip');
  if (forwardedFor) {
    req.set('X-Forwarded-For', forwardedFor);
  }
  return (await req).body.ip;
};

describe('isCloudflareAddress', () => {
  test.each([
    '173.245.48.1',
    '103.21.244.0',
    '104.16.0.1',
    '104.23.255.254',
    '172.64.0.1',
    '172.71.255.255',
    '162.158.0.1',
    '162.159.255.255',
    '131.0.72.5',
    '2606:4700::1',
    '2606:4700:4700::1111',
    '2400:cb00:1::1',
    '2a06:98c0::1',
    '2a06:98c7:ffff::1',
    '::ffff:104.16.0.1',
  ])('%s is Cloudflare', address => {
    expect(isCloudflareAddress(address)).toBe(true);
  });

  test.each([
    '8.8.8.8',
    '1.1.1.1',
    '104.15.255.255',
    '104.32.0.1',
    '172.63.255.255',
    '172.72.0.1',
    '162.160.0.1',
    '203.0.113.9',
    '10.0.0.1',
    '2001:db8::1',
    '2606:4701::1',
    '2a06:98c8::1',
    '::1',
    '::ffff:8.8.8.8',
    'not an address',
    '999.1.1.1',
    '1.2.3',
    '',
    undefined,
    null,
  ])('%s is not Cloudflare', address => {
    expect(isCloudflareAddress(address)).toBe(false);
  });

  test('every published range contains its own first and last address', () => {
    for (const cidr of CLOUDFLARE_IPV4) {
      const [base, length] = cidr.split('/');
      const octets = base.split('.').map(Number);
      const hostBits = 32 - Number(length);
      expect(isCloudflareAddress(base)).toBe(true);
      const last = octets.reduce((n, o) => n * 256 + o, 0) + 2 ** hostBits - 1;
      const text = [24, 16, 8, 0].map(shift => Math.floor(last / 2 ** shift) % 256).join('.');
      expect(isCloudflareAddress(text)).toBe(true);
    }
    for (const cidr of CLOUDFLARE_IPV6) {
      expect(isCloudflareAddress(cidr.split('/')[0])).toBe(true);
    }
  });
});

describe('req.ip behind Cloudflare and Railway', () => {
  const app = appWith(createTrustProxy());

  test('through Cloudflare: the visitor, not the Cloudflare address Railway saw', async () => {
    expect(await ipFor(app, '198.51.100.7, 104.16.0.9')).toBe('198.51.100.7');
  });

  test('through Cloudflare with an IPv6 visitor', async () => {
    expect(await ipFor(app, '2001:db8::5, 172.64.1.1')).toBe('2001:db8::5');
  });

  test('without Cloudflare (a direct Railway address): the visitor Railway saw', async () => {
    expect(await ipFor(app, '198.51.100.7')).toBe('198.51.100.7');
  });

  test('a forged value placed by the visitor is never reached', async () => {
    // The visitor sent "9.9.9.9"; Cloudflare appended the real address, Railway appended Cloudflare's.
    expect(await ipFor(app, '9.9.9.9, 198.51.100.7, 104.16.0.9')).toBe('198.51.100.7');
    // Direct to Railway, the visitor's forged value sits left of the address Railway appended.
    expect(await ipFor(app, '9.9.9.9, 198.51.100.7')).toBe('198.51.100.7');
  });

  test('a visitor cannot pose as Cloudflare to skip their own address', async () => {
    // "104.16.0.1" is forged by the visitor, but the visitor's own address is what Railway appended
    // right of it, and that address is not Cloudflare, so the walk stops there.
    expect(await ipFor(app, '104.16.0.1, 198.51.100.7')).toBe('198.51.100.7');
  });

  test('no forwarded-for header: the connection itself', async () => {
    expect(await ipFor(app, null)).toMatch(/127\.0\.0\.1|::1/);
  });

  test('the old one-hop setting shows why: it reports the Cloudflare address', async () => {
    expect(await ipFor(appWith(1), '198.51.100.7, 104.16.0.9')).toBe('104.16.0.9');
  });
});

describe('server wiring', () => {
  test('server.js uses it in place of a bare hop count', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    expect(source).toContain("require('./utils/trustProxy')");
    expect(source).toContain("app.set('trust proxy', createTrustProxy())");
    expect(source).not.toMatch(/app\.set\('trust proxy', 1\)/);
  });
});
