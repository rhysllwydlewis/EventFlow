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
 * The visitor key the route derives for an anonymous visitor.
 *
 * @param {string} ip - Address
 * @param {string} agent - User agent
 * @returns {string} Key
 */
function anonymousKey(ip, agent = BROWSER) {
  return `a:${crypto.createHash('sha256').update(`${ip}|${agent}`).digest('hex').slice(0, 32)}`;
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
    await beacon({ ip, agent: `${BROWSER} Other` });

    expect(events()).toHaveLength(3);
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
