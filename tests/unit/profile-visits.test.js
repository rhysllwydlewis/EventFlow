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
  return `a:${crypto.createHash('sha256').update(`${ip}|${family}`).digest('hex').slice(0, 32)}`;
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
      expect(event.ipKey).toMatch(/^ip:[0-9a-f]{32}$/);
      expect(JSON.stringify(event)).not.toContain(ip);
    });
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
