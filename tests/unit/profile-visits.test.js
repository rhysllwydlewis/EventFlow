'use strict';

/**
 * Profile visits: one event per visit, the supplier's own visits, admins and
 * automated clients excluded, and the same visitor counted once per hour (rule
 * enforced in the database so it holds across instances and restarts).
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Pin the per-address cap low so the tests can reach it with a handful of browsers.
process.env.PROFILE_VIEW_IP_CAP = '5';

jest.mock('../../db-unified', () => require('../helpers/fake-db-unified'));

jest.mock('../../middleware/auth', () => ({
  getUserFromCookie: async req => {
    const header = req.headers['x-test-user'];
    return header ? JSON.parse(header) : null;
  },
  authRequired: (req, res, next) => next(),
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const fakeDb = require('../helpers/fake-db-unified');

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0';

const crypto = require('crypto');
const profileViewKeys = require('../../utils/profileViewKeys');
const { PROFILE_VIEW_RETENTION_DAYS } = require('../../utils/profileViewRetention');

const app = (() => {
  const instance = express();
  instance.set('trust proxy', true);
  instance.use(express.json());
  instance.use('/api/analytics', require('../../routes/analytics'));
  return instance;
})();

let nextAddress = 10;

/**
 * A fresh IP address, so the per-process flood guard never hides what the database rule does.
 *
 * @returns {string} IPv4 address
 */
function freshIp() {
  nextAddress += 1;
  return `10.1.${Math.floor(nextAddress / 250)}.${nextAddress % 250}`;
}

/**
 * The visitor key the route derives for an anonymous visitor on the test browser (Chrome on Windows:
 * the key uses the browser family, not the full user-agent string).
 *
 * @param {string} ip - Address
 * @param {string} family - Browser family the route derives from the user agent
 * @returns {string} Key
 */
function anonymousKey(ip, family = 'chrome/windows') {
  return profileViewKeys.anonymousVisitorKey(ip, family);
}

/**
 * Send a tracking beacon.
 *
 * @param {Object} options - { type, supplierId, ip, agent, user }
 * @returns {Promise<Object>} supertest response
 */
function beacon({
  type = 'profile_view',
  supplierId = 'sup-1',
  ip = freshIp(),
  agent = BROWSER,
  user,
} = {}) {
  const req = request(app)
    .post('/api/analytics/track')
    .set('X-Forwarded-For', ip)
    .set('User-Agent', agent);
  if (user) {
    req.set('x-test-user', JSON.stringify(user));
  }
  return req.send({ type, supplierId });
}

/**
 * Stored events of one type.
 *
 * @param {string} type - Event type
 * @returns {Object[]} Events
 */
function events(type = 'profile_view') {
  return (fakeDb.__store().events || []).filter(event => event.type === type);
}

beforeEach(() => {
  fakeDb.__reset({
    suppliers: [
      { id: 'sup-1', ownerUserId: 'owner-1', name: 'Moor Audio', approved: true },
      { id: 'sup-draft', ownerUserId: 'owner-2', name: 'Draft', approved: false },
    ],
    events: [],
  });
});

describe('POST /api/analytics/track profile_view', () => {
  it('records one event for a visit and stores a hashed visitor key, never the raw IP', async () => {
    const res = await beacon({ ip: '203.0.113.9' });

    expect(res.body.message).toBe('Event tracked');
    expect(events()).toHaveLength(1);
    expect(events()[0].visitorKey).toMatch(/^a:[0-9a-f]{32}$/);
    expect(JSON.stringify(events())).not.toContain('203.0.113.9');
  });

  it('keys the visitor with a server secret: a plain SHA-256 of the address cannot be matched to it', async () => {
    const ip = '203.0.113.9';
    await beacon({ ip });

    const plain = crypto.createHash('sha256').update(`${ip}|chrome/windows`).digest('hex');
    expect(events()[0].visitorKey).not.toBe(`a:${plain.slice(0, 32)}`);
    // The key depends on the secret: the same visit under another secret is another key.
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'a-different-secret-for-this-assertion-only-0123456789';
    try {
      expect(anonymousKey(ip)).not.toBe(events()[0].visitorKey);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  it('stores nothing derived from the address on the event, for anonymous or signed-in visitors', async () => {
    await beacon({ ip: '203.0.113.9' });
    await beacon({ ip: '203.0.113.9', user: { id: 'cust-9', role: 'customer' } });

    expect(events()).toHaveLength(2);
    events().forEach(event => {
      expect(event).not.toHaveProperty('ipKey');
      expect(Object.keys(event).sort()).toEqual(
        [
          'date',
          'dedupeKey',
          'expiresAt',
          'id',
          'metadata',
          'sessionId',
          'supplierId',
          'timestamp',
          'type',
          'userId',
          'visitorKey',
        ].sort()
      );
    });
    // The signed-in visitor is keyed by account, with no address-derived value at all.
    expect(events()[1].visitorKey).toBe('u:cust-9');
    expect(events()[1].dedupeKey).toMatch(/^sup-1:u:cust-9:\d+$/);
  });

  it('counts nothing for anonymous visitors when there is no secret to key them with', async () => {
    const jwt = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const anonymous = await beacon();
      const signedIn = await beacon({ user: { id: 'cust-2', role: 'customer' } });

      expect(anonymous.body.message).toBe('Not counted');
      expect(signedIn.body.message).toBe('Event tracked');
      expect(events()).toHaveLength(1);
      expect(events()[0].visitorKey).toBe('u:cust-2');
    } finally {
      process.env.JWT_SECRET = jwt;
    }
  });

  it('treats an IPv6 address as its /64: the same prefix is one visitor, another prefix is another', async () => {
    await beacon({ ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' });
    await beacon({ ip: '2001:db8:1:2:1111:2222:3333:4444' });
    expect(events()).toHaveLength(1);

    await beacon({ ip: '2001:db8:1:3:aaaa:bbbb:cccc:dddd' });
    expect(events()).toHaveLength(2);
  });

  it('counts the same visitor once per hour (database rule, not just the in-memory guard)', async () => {
    const ip = freshIp();
    // Simulates an earlier visit recorded by another instance, before a restart.
    fakeDb.__store().events.push({
      id: 'earlier',
      type: 'profile_view',
      supplierId: 'sup-1',
      visitorKey: anonymousKey(ip),
      timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    });

    const res = await beacon({ ip });

    expect(res.body.message).toBe('Already tracked');
    expect(events()).toHaveLength(1);
  });

  it('counts the same visitor again after an hour', async () => {
    const ip = freshIp();
    fakeDb.__store().events.push({
      id: 'earlier',
      type: 'profile_view',
      supplierId: 'sup-1',
      visitorKey: anonymousKey(ip),
      timestamp: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
    });

    await beacon({ ip });

    expect(events()).toHaveLength(2);
  });

  it('counts different visitors separately (different browser or address)', async () => {
    const ip = freshIp();
    await beacon({ ip });
    await beacon({ ip: freshIp() });
    await beacon({ ip, agent: FIREFOX });

    expect(events()).toHaveLength(3);
  });

  it('does not count one visitor twice when two beacons arrive at the same moment', async () => {
    const ip = freshIp();
    const results = await Promise.all(Array.from({ length: 8 }, () => beacon({ ip })));

    // The read-then-insert check alone lets all of these through; the unique dedupeKey does not.
    expect(events()).toHaveLength(1);
    expect(events()[0].dedupeKey).toMatch(/^sup-1:a:[0-9a-f]{32}:\d+$/);
    expect(results.filter(res => res.body.message === 'Event tracked')).toHaveLength(1);
    expect(results.filter(res => res.body.message === 'Already tracked')).toHaveLength(7);
  });

  it('treats a second insert with the same dedupeKey as already tracked, not an error', async () => {
    const ip = freshIp();
    // Simulates the race: the earlier request wrote its event after this one's read.
    fakeDb.count.mockImplementationOnce(async () => 0);
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    fakeDb.__store().events.push({
      id: 'winner',
      type: 'profile_view',
      supplierId: 'sup-1',
      visitorKey: anonymousKey(ip),
      dedupeKey: `sup-1:${anonymousKey(ip)}:${bucket}`,
      timestamp: new Date().toISOString(),
    });

    const res = await beacon({ ip });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Already tracked');
    expect(events()).toHaveLength(1);
  });

  it('changing the user-agent version or text does not make a new visitor', async () => {
    const ip = freshIp();
    for (let version = 100; version < 130; version += 1) {
      await beacon({
        ip,
        agent: `Mozilla/5.0 (Windows NT 10.0) Chrome/${version} Safari/537.36 x${version}`,
      });
    }

    expect(events()).toHaveLength(1);
  });

  it('rotating user-agents from one address adds a bounded number of views', async () => {
    const ip = freshIp();
    const agents = [
      BROWSER,
      FIREFOX,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17 Mobile Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];
    for (let round = 0; round < 40; round += 1) {
      await beacon({ ip, agent: `${agents[round % agents.length]} ${round}` });
    }

    expect(events().length).toBeLessThanOrEqual(5);
    expect(events().length).toBeGreaterThan(0);
    events().forEach(event => {
      expect(event).not.toHaveProperty('ipKey');
      expect(JSON.stringify(event)).not.toContain(ip);
    });
  });

  it('the cap holds when the requests arrive at the same moment (atomic counter, not count-then-insert)', async () => {
    const ip = freshIp();
    const agents = [
      BROWSER,
      FIREFOX,
      'Safari/605 (Macintosh; Mac OS X)',
      'Mozilla/5.0 (iPhone) Safari/604',
      'Mozilla/5.0 (Android 14) Chrome/120',
      'Mozilla/5.0 (X11; Linux) Chrome/120',
      'Mozilla/5.0 (Windows) Edg/120',
      'Mozilla/5.0 (Macintosh) Firefox/121',
      'Mozilla/5.0 (X11; Linux) Firefox/121',
      'Mozilla/5.0 (Android 14) Firefox/121',
    ];
    await Promise.all(agents.map(agent => beacon({ ip, agent })));

    expect(events()).toHaveLength(5);
  });

  it('keeps the cap counters in their own collection: no address in them, and they expire within two hours', async () => {
    const ip = '198.51.100.77';
    await beacon({ ip });

    const rows = fakeDb.__store().profile_view_caps;
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toMatch(/^sup-1:[0-9a-f]{32}:\d+$/);
    expect(rows[0].count).toBe(1);
    expect(JSON.stringify(rows)).not.toContain(ip);
    // A BSON date (the TTL monitor ignores strings), between one and two hours ahead.
    expect(rows[0].expiresAt).toBeInstanceOf(Date);
    const ahead = rows[0].expiresAt.getTime() - Date.now();
    expect(ahead).toBeGreaterThan(60 * 60 * 1000);
    expect(ahead).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  });

  it('stamps every new profile view with an expiry date (a BSON date, retention days after the view)', async () => {
    await beacon({ ip: '198.51.100.78' });
    await beacon({ ip: '198.51.100.79', user: { id: 'usr_expiry', role: 'customer' } });

    expect(events()).toHaveLength(2);
    for (const event of events()) {
      // A Date, not a string: the TTL monitor ignores anything else.
      expect(event.expiresAt).toBeInstanceOf(Date);
      const keptMs = event.expiresAt.getTime() - Date.parse(event.timestamp);
      expect(keptMs).toBe(PROFILE_VIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    }
  });

  it('a repeat of the same visitor does not use up another slot of the address cap', async () => {
    const ip = freshIp();
    await Promise.all(Array.from({ length: 8 }, () => beacon({ ip })));
    await beacon({ ip });

    expect(events()).toHaveLength(1);
    expect(fakeDb.__store().profile_view_caps[0].count).toBe(1);
  });

  it('requests refused by the cap give their slot back, so a burst cannot push the counter past the cap', async () => {
    const ip = freshIp();
    const families = [
      BROWSER,
      FIREFOX,
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17 Safari/605.1.15',
      'Mozilla/5.0 (iPhone) Safari/604',
      'Mozilla/5.0 (Android 14) Chrome/120',
      'Mozilla/5.0 (X11; Linux) Chrome/120',
      'Mozilla/5.0 (Windows) Edg/120',
      'Mozilla/5.0 (Macintosh) Firefox/121',
    ];
    await Promise.all(families.map(agent => beacon({ ip, agent })));

    expect(events()).toHaveLength(5);
    expect(fakeDb.__store().profile_view_caps[0].count).toBe(5);
  });

  it('defaults the cap to 20 views per address per supplier per hour', async () => {
    const key = `sup-1:${profileViewKeys.addressKey('198.51.100.1')}:${Math.floor(Date.now() / 3600000)}`;
    const envCap = process.env.PROFILE_VIEW_IP_CAP;
    delete process.env.PROFILE_VIEW_IP_CAP;
    jest.isolateModules(() => {
      jest.doMock('../../db-unified', () => require('../helpers/fake-db-unified'));
      const isolated = express();
      isolated.set('trust proxy', true);
      isolated.use(express.json());
      isolated.use('/api/analytics', require('../../routes/analytics'));
      global.__isolatedApp = isolated;
    });
    process.env.PROFILE_VIEW_IP_CAP = envCap;
    const send = () =>
      request(global.__isolatedApp)
        .post('/api/analytics/track')
        .set('X-Forwarded-For', '198.51.100.1')
        .set('User-Agent', BROWSER)
        .send({ type: 'profile_view', supplierId: 'sup-1' });

    // 19 slots used: this visitor takes the 20th. 20 used: the next one is over the cap.
    fakeDb.__store().profile_view_caps = [{ key, count: 19 }];
    await send();
    expect(events()).toHaveLength(1);

    fakeDb.__store().events.length = 0;
    fakeDb.__store().profile_view_caps = [{ key, count: 20 }];
    await send();
    expect(events()).toHaveLength(0);
    delete global.__isolatedApp;
  });

  it('the cap is per address and supplier: other addresses and other suppliers still count', async () => {
    fakeDb.__store().suppliers.push({ id: 'sup-2', ownerUserId: 'owner-3', approved: true });
    const ip = freshIp();
    const agents = [
      BROWSER,
      FIREFOX,
      'Safari/605 (Macintosh; Mac OS X)',
      'Mozilla/5.0 (iPhone) Safari/604',
      'Mozilla/5.0 (Android 14) Chrome/120',
      'Mozilla/5.0 (X11; Linux) Chrome/120',
    ];
    for (const agent of agents) {
      await beacon({ ip, agent });
    }
    expect(events()).toHaveLength(5);

    await beacon({ ip, agent: 'Mozilla/5.0 (Windows) Edg/120', supplierId: 'sup-2' });
    await beacon({ ip: freshIp() });

    expect(events()).toHaveLength(7);
  });

  it('the address cap does not apply to signed-in visitors, and no counter row is made for them', async () => {
    const ip = freshIp();
    for (let i = 0; i < 8; i += 1) {
      await beacon({ ip, user: { id: `cust-${i}`, role: 'customer' } });
    }

    expect(events()).toHaveLength(8);
    expect(fakeDb.__store().profile_view_caps || []).toHaveLength(0);
  });

  it('counts a signed-in visitor once per hour whatever device they use', async () => {
    const user = { id: 'cust-1', role: 'customer' };
    await beacon({ user });
    await beacon({ user });

    expect(events()).toHaveLength(1);
    expect(events()[0].visitorKey).toBe('u:cust-1');
  });

  it('does not count the supplier looking at their own profile', async () => {
    const res = await beacon({ user: { id: 'owner-1', role: 'supplier' } });

    expect(res.body.message).toBe('Not counted');
    expect(events()).toHaveLength(0);
  });

  it('does not count admins', async () => {
    await beacon({ user: { id: 'admin-1', role: 'admin' } });

    expect(events()).toHaveLength(0);
  });

  it('counts another supplier looking at the page (they are an ordinary visitor)', async () => {
    await beacon({ user: { id: 'owner-2', role: 'supplier' } });

    expect(events()).toHaveLength(1);
  });

  it.each([
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'bingbot',
    'HeadlessChrome/120',
    'Pingdom.com_bot',
    'facebookexternalhit/1.1',
    'Lighthouse',
  ])('does not count the automated client %s', async agent => {
    await beacon({ agent });

    expect(events()).toHaveLength(0);
  });

  it('ignores suppliers that do not exist or are not public, so ids cannot be made up', async () => {
    const ghost = await beacon({ supplierId: 'sup-ghost' });
    const draft = await beacon({ supplierId: 'sup-draft' });

    expect(ghost.body.message).toBe('Not tracked');
    expect(draft.body.message).toBe('Not tracked');
    expect(events()).toHaveLength(0);
  });

  it('a view no longer silently drops the same visitor enquiry event', async () => {
    const ip = freshIp();
    await beacon({ type: 'profile_view', ip });
    await beacon({ type: 'enquiry', ip });

    expect(events('profile_view')).toHaveLength(1);
    expect(events('enquiry_sent')).toHaveLength(1);
  });

  it('rejects malformed input', async () => {
    expect((await beacon({ type: 'nope' })).status).toBe(400);
    expect((await beacon({ supplierId: 'a b' })).status).toBe(400);
  });
});

describe('one event per page load', () => {
  it('the profile endpoint no longer records a second view', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../routes/suppliers.js'), 'utf8');

    expect(source).not.toMatch(/trackProfileView/);
  });

  it('the beacon route is the only caller that records a profile view', () => {
    const callers = ['routes', 'services', 'utils']
      .flatMap(dir =>
        fs
          .readdirSync(path.join(__dirname, '../..', dir))
          .filter(file => file.endsWith('.js'))
          .map(file => path.join(dir, file))
      )
      .filter(file =>
        /\.trackProfileView\(/.test(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'))
      );

    expect(callers).toEqual([path.join('routes', 'analytics.js')]);
  });
});
