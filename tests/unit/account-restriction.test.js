'use strict';

const fs = require('fs');
const path = require('path');
const {
  getAccountRestriction,
  releaseExpiredSuspension,
  restrictionBody,
  restrictionRedirect,
  suspensionHasExpired,
} = require('../../utils/accountRestriction');

const ROOT = path.join(__dirname, '../..');
const source = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const NOW = Date.parse('2026-10-28T12:00:00Z');
const iso = offsetMs => new Date(NOW + offsetMs).toISOString();

describe('getAccountRestriction', () => {
  it('is null for an ordinary, missing or unrestricted account', () => {
    expect(getAccountRestriction(null, NOW)).toBeNull();
    expect(getAccountRestriction({ id: 'u', email: 'a@example.test' }, NOW)).toBeNull();
    expect(getAccountRestriction({ suspended: false, banned: false }, NOW)).toBeNull();
  });

  it('reports a suspension with no expiry, or an expiry still ahead', () => {
    expect(getAccountRestriction({ suspended: true }, NOW)).toEqual({
      type: 'suspended',
      reason: null,
    });
    expect(
      getAccountRestriction(
        { suspended: true, suspensionReason: 'spam', suspensionExpiresAt: iso(1000) },
        NOW
      )
    ).toEqual({ type: 'suspended', reason: 'spam' });
  });

  it('ignores a suspension whose expiry has passed or is exactly now', () => {
    expect(
      getAccountRestriction({ suspended: true, suspensionExpiresAt: iso(-1) }, NOW)
    ).toBeNull();
    expect(getAccountRestriction({ suspended: true, suspensionExpiresAt: iso(0) }, NOW)).toBeNull();
  });

  it('treats an unreadable expiry as no expiry, so the suspension stands', () => {
    expect(
      getAccountRestriction({ suspended: true, suspensionExpiresAt: 'nonsense' }, NOW)
    ).toEqual({ type: 'suspended', reason: null });
  });

  it('reports a ban, and a ban wins over a suspension', () => {
    expect(getAccountRestriction({ banned: true, banReason: 'abuse' }, NOW)).toEqual({
      type: 'banned',
      reason: 'abuse',
    });
    expect(getAccountRestriction({ banned: true, suspended: true }, NOW).type).toBe('banned');
  });

  it('never restricts the owner account', () => {
    expect(getAccountRestriction({ isOwner: true, banned: true, suspended: true }, NOW)).toBeNull();
  });

  it('only a literal true counts (a stray string or number does not lock anyone out)', () => {
    expect(getAccountRestriction({ suspended: 'false' }, NOW)).toBeNull();
    expect(getAccountRestriction({ banned: 1 }, NOW)).toBeNull();
  });
});

describe('response helpers', () => {
  it('never include the admin-typed reason', () => {
    const body = restrictionBody({ type: 'suspended', reason: 'secret note' });
    expect(JSON.stringify(body)).not.toMatch(/secret note/);
    expect(body.code).toBe('ACCOUNT_SUSPENDED');
    expect(restrictionBody({ type: 'banned' }).code).toBe('ACCOUNT_BANNED');
  });

  it('sends browsers to the sign-in page with the type as the reason', () => {
    expect(restrictionRedirect({ type: 'banned' })).toBe('/auth?reason=banned');
  });
});

describe('releaseExpiredSuspension', () => {
  const db = () => ({ updateOne: jest.fn().mockResolvedValue(true) });

  it('clears every suspension field once the suspension has run out', async () => {
    const fake = db();
    const released = await releaseExpiredSuspension(
      fake,
      { id: 'u1', suspended: true, suspensionExpiresAt: iso(-1000) },
      NOW
    );
    expect(released).toBe(true);
    expect(fake.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'u1' },
      {
        $set: expect.objectContaining({
          suspended: false,
          suspensionReason: null,
          suspensionDuration: null,
          suspensionExpiresAt: null,
        }),
      }
    );
  });

  it('does nothing for a running, open-ended or absent suspension', async () => {
    const fake = db();
    expect(await releaseExpiredSuspension(fake, { id: 'a', suspended: true }, NOW)).toBe(false);
    expect(
      await releaseExpiredSuspension(
        fake,
        { id: 'b', suspended: true, suspensionExpiresAt: iso(1000) },
        NOW
      )
    ).toBe(false);
    expect(await releaseExpiredSuspension(fake, { id: 'c' }, NOW)).toBe(false);
    expect(await releaseExpiredSuspension(fake, null, NOW)).toBe(false);
    expect(fake.updateOne).not.toHaveBeenCalled();
  });

  it('suspensionHasExpired needs an expiry', () => {
    expect(suspensionHasExpired({ suspended: true }, NOW)).toBe(false);
  });
});

describe('every way of signing in checks the restriction', () => {
  it('password login, Google token login and the 2FA step refuse a restricted account', () => {
    const auth = source('routes/auth.js');
    expect(auth).toMatch(/const restriction = getAccountRestriction\(user\);/);
    expect(auth).toMatch(/const googleRestriction = getAccountRestriction\(user\);/);
    expect(auth).toMatch(/const twoFaRestriction = getAccountRestriction\(user\);/);
    expect(auth).toMatch(/const meRestriction = getAccountRestriction\(u\);/);
  });

  it.each(['google', 'facebook', 'apple'])(
    'the %s redirect sign-in sends a restricted account back to /auth',
    name => {
      const route = source(`routes/${name}-redirect-auth.js`);
      expect(route).toMatch(/getAccountRestriction\(user\)/);
      expect(route).toMatch(/res\.redirect\(303, restrictionRedirect\(restriction\)\)/);
      // checked before the cookie is issued
      expect(route.indexOf('getAccountRestriction(user)')).toBeLessThan(
        route.indexOf('setAuthCookie(res')
      );
    }
  );

  it('the canonical GET /api/auth/me in server.js signs a restricted account out', () => {
    const server = source('server.js');
    expect(server).toMatch(/const restriction = getAccountRestriction\(u\);/);
    expect(server).toMatch(/json\(\{ user: null, restricted: restriction\.type \}\)/);
  });

  it('the logged-in middleware checks it on every request', () => {
    expect(source('middleware/auth.js')).toMatch(
      /const restriction = getAccountRestriction\(dbUser\);/
    );
  });

  it('the sign-in page explains a suspended or banned account, with a fresh cache version', () => {
    const intent = source('public/assets/js/pages/auth-intent.js');
    expect(intent).toMatch(/suspended: \{\s*title: 'Account suspended'/);
    expect(intent).toMatch(/banned: \{\s*title: 'Account banned'/);
    expect(source('public/auth.html')).toContain('auth-intent.js?v=18.5.11');
  });
});
