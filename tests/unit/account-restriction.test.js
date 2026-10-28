'use strict';

const fs = require('fs');
const path = require('path');
const {
  dropLiveSessions,
  getAccountRestriction,
  releaseExpiredSuspension,
  suspensionExpiry,
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
      { id: 'u1', suspended: true, suspensionExpiresAt: iso(-1000) },
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

  it('only clears the suspension it saw expire, so a renewal made in the meantime survives', async () => {
    const fake = db();
    await releaseExpiredSuspension(
      fake,
      { id: 'u1', suspended: true, suspendedUntil: iso(-1000) },
      NOW
    );
    // the filter carries the observed expiry: a renewed suspension has a different one, or none
    expect(fake.updateOne.mock.calls[0][1]).toEqual({
      id: 'u1',
      suspended: true,
      suspendedUntil: iso(-1000),
    });
    expect(fake.updateOne.mock.calls[0][2].$set).toMatchObject({
      suspendedUntil: null,
      suspensionExpiresAt: null,
    });
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

describe('the bulk-suspend expiry field', () => {
  it('suspensionExpiry reads suspensionExpiresAt first, then suspendedUntil', () => {
    expect(suspensionExpiry({ suspensionExpiresAt: 'a', suspendedUntil: 'b' })).toBe('a');
    expect(suspensionExpiry({ suspendedUntil: 'b' })).toBe('b');
    expect(suspensionExpiry({})).toBeNull();
  });

  it('a timed suspension written as suspendedUntil ends when it runs out', () => {
    expect(
      getAccountRestriction({ suspended: true, suspendedUntil: iso(1000) }, NOW)
    ).toMatchObject({ type: 'suspended' });
    expect(getAccountRestriction({ suspended: true, suspendedUntil: iso(-1000) }, NOW)).toBeNull();
    expect(suspensionHasExpired({ suspended: true, suspendedUntil: iso(-1000) }, NOW)).toBe(true);
  });

  it('the old bulk-suspend route also writes the field the admin screens use', () => {
    expect(source('routes/admin.js')).toMatch(
      /suspendedUntil: suspendUntil \? suspendUntil\.toISOString\(\) : null,\s*suspensionExpiresAt: suspendUntil/
    );
  });
});

describe('dropLiveSessions', () => {
  afterEach(() => {
    delete global.wsServerV2;
  });

  it('asks the realtime server to disconnect the user', () => {
    global.wsServerV2 = { disconnectUser: jest.fn() };
    expect(dropLiveSessions('u1')).toBe(true);
    expect(global.wsServerV2.disconnectUser).toHaveBeenCalledWith('u1');
  });

  it('does nothing when realtime is not running or there is no user', () => {
    expect(dropLiveSessions('u1')).toBe(false);
    global.wsServerV2 = { disconnectUser: jest.fn() };
    expect(dropLiveSessions('')).toBe(false);
    expect(global.wsServerV2.disconnectUser).not.toHaveBeenCalled();
  });

  it('is called when an admin suspends, disables, bans or bulk-suspends accounts', () => {
    const management = source('routes/admin-user-management.js');
    expect(management.match(/dropLiveSessions\(user\.id\)/g)).toHaveLength(2);
    expect(management).toContain('dropLiveSessions(req.params.id)');
    // bulk: only after the suspensions are saved
    expect(management).toMatch(
      /await Promise\.all\(suspendPromises\);[\s\S]*?suspendedIds\.forEach\(dropLiveSessions\)/
    );
    expect(source('routes/admin.js')).toContain('dropLiveSessions(userId)');
  });
});

describe('the realtime server', () => {
  const WebSocketServerV2 = require('../../websocket-server-v2');
  const prototype = WebSocketServerV2.prototype;

  it('treats a suspended or banned account as restricted, and anyone else as fine', async () => {
    const findOne = jest.fn();
    const fake = { db: { collection: () => ({ findOne }) } };
    findOne.mockResolvedValue({ id: 'u1', suspended: true });
    expect(await prototype.isUserRestricted.call(fake, 'u1')).toBe(true);
    findOne.mockResolvedValue({ id: 'u1', banned: true });
    expect(await prototype.isUserRestricted.call(fake, 'u1')).toBe(true);
    findOne.mockResolvedValue({ id: 'u1' });
    expect(await prototype.isUserRestricted.call(fake, 'u1')).toBe(false);
  });

  it('does not block anyone when there is no database or the lookup fails', async () => {
    expect(await prototype.isUserRestricted.call({ db: null }, 'u1')).toBe(false);
    const failing = {
      db: { collection: () => ({ findOne: jest.fn().mockRejectedValue(new Error('x')) }) },
    };
    expect(await prototype.isUserRestricted.call(failing, 'u1')).toBe(false);
    expect(await prototype.isUserRestricted.call({ db: {} }, '')).toBe(false);
  });

  it('disconnectUser closes every socket that user has open', () => {
    const open = { disconnect: jest.fn() };
    const fake = {
      userSockets: new Map([['u1', new Set(['s1', 's2', 'gone'])]]),
      io: {
        sockets: {
          sockets: new Map([
            ['s1', open],
            ['s2', open],
          ]),
        },
      },
    };
    expect(prototype.disconnectUser.call(fake, 'u1')).toBe(3);
    expect(open.disconnect).toHaveBeenCalledTimes(2);
    expect(open.disconnect).toHaveBeenCalledWith(true);
    expect(prototype.disconnectUser.call(fake, 'nobody')).toBe(0);
  });

  it('the handshake and the auth event both check the restriction', () => {
    const server = source('websocket-server-v2.js');
    expect(server).toMatch(/userId && !\(await this\.isUserRestricted\(userId\)\)/);
    expect(server).toMatch(
      /if \(await this\.isUserRestricted\(userId\)\) \{\s*socket\.userId = null;/
    );
  });
});
