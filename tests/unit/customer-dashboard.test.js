/**
 * Unit tests for the customer dashboard API (routes/customer-dashboard.js)
 *
 * The summary and countdown endpoints that used to sit beside the milestones were never called by
 * the page (it works from /api/me/plans), so they were removed; only the checklist is left.
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockDb = {
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({ modified: 1 }),
  read: jest.fn().mockResolvedValue([]),
};
jest.mock('../../db-unified', () => mockDb);

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    if (req.headers['x-test-user-role'] === 'none') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    const role = req.headers['x-test-user-role'] || 'customer';
    req.user = { id: 'user-cust-1', role, email: 'customer@test.com' };
    next();
  },
}));

jest.mock('../../middleware/csrf', () => ({
  csrfProtection: (req, res, next) => next(),
}));

jest.mock('../../middleware/rateLimits', () => ({
  writeLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

jest.mock('../../utils/sanitise', () => ({
  sanitiseText: t => String(t || '').slice(0, 500),
}));

const request = require('supertest');
const express = require('express');
const router = require('../../routes/customer-dashboard');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/customer', router);
  return app;
}

describe('GET /api/v1/customer/milestones', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.find.mockResolvedValue([]);
    mockDb.findOne.mockResolvedValue(null);
  });

  it('returns 403 for non-customers', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/milestones')
      .set('x-test-user-role', 'admin');
    expect(res.status).toBe(403);
  });

  it('returns milestone list with completion state', async () => {
    mockDb.find.mockResolvedValue([]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/milestones')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.milestones)).toBe(true);
    expect(res.body.milestones.length).toBeGreaterThan(0);
    expect(typeof res.body.percent).toBe('number');
    expect(res.body.percent).toBeGreaterThanOrEqual(0);
    expect(res.body.percent).toBeLessThanOrEqual(100);
  });

  it('marks create-plan milestone done when plans exist', async () => {
    mockDb.find.mockImplementation(async col => {
      if (col === 'plans') {
        return [{ id: 'plan-1', userId: 'user-cust-1', budget: 3000 }];
      }
      return [];
    });
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/milestones')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    const createPlan = res.body.milestones.find(m => m.id === 'create-plan');
    expect(createPlan.done).toBe(true);
    const setBudget = res.body.milestones.find(m => m.id === 'set-budget');
    expect(setBudget.done).toBe(true);
  });

  it.each([
    ['an empty guest list kept in `guests`', { guests: [] }, false],
    ['an empty `guestList`', { guestList: [] }, false],
    ['a head count of zero', { guests: 0, guestCount: 0 }, false],
    ['a head count', { guests: '80' }, true],
    ['an old-style guest list', { guests: [{ id: 'g1' }] }, true],
    ['a guest list kept in `guestList`', { guestList: [{ id: 'g1' }] }, true],
  ])('set-guests milestone with %s is done: %s', async (_label, fields, done) => {
    mockDb.find.mockImplementation(async col =>
      col === 'plans' ? [{ id: 'plan-1', userId: 'user-cust-1', ...fields }] : []
    );
    const res = await request(buildApp())
      .get('/api/v1/customer/milestones')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    expect(res.body.milestones.find(m => m.id === 'set-guests').done).toBe(done);
  });

  /** Answers each collection the route reads from a small fixture. */
  function useData({ plans = [], shortlist = null, quoteRequests = [] }) {
    mockDb.find.mockImplementation(async col => {
      if (col === 'plans') {
        return plans;
      }
      return col === 'quoteRequests' ? quoteRequests : [];
    });
    mockDb.findOne.mockImplementation(async col => (col === 'shortlists' ? shortlist : null));
  }

  async function milestonesFor(data) {
    useData(data);
    const res = await request(buildApp())
      .get('/api/v1/customer/milestones')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.milestones.map(m => [m.id, m.done]));
  }

  it('counts a supplier saved from the dashboard (the shortlist) as a saved supplier', async () => {
    const done = await milestonesFor({
      shortlist: { items: [{ type: 'supplier', id: 's1', name: 'Tom', category: 'Photography' }] },
    });
    expect(done['save-supplier']).toBe(true);
    expect(done['book-venue']).toBe(false);
  });

  it('does not count a saved listing (not a supplier) as a saved supplier', async () => {
    const done = await milestonesFor({
      shortlist: { items: [{ type: 'listing', id: 'l1', name: 'Table', category: 'Venues' }] },
    });
    expect(done['save-supplier']).toBe(false);
  });

  it('counts a shortlisted venue, or a quote request to one, for the venue step', async () => {
    expect(
      (
        await milestonesFor({
          shortlist: { items: [{ type: 'supplier', id: 's2', name: 'Barn', category: 'Venues' }] },
        })
      )['book-venue']
    ).toBe(true);
    expect(
      (
        await milestonesFor({
          quoteRequests: [
            { id: 'qr1', suppliers: [{ supplierId: 's3', category: 'Wedding venue' }] },
          ],
        })
      )['book-venue']
    ).toBe(true);
    expect(
      (
        await milestonesFor({
          quoteRequests: [{ id: 'qr2', suppliers: [{ supplierId: 's4', category: 'Catering' }] }],
        })
      )['book-venue']
    ).toBe(false);
  });

  it.each([
    ['a figure saved by the budget form', 7500, true],
    ['a figure saved as text', '7500', true],
    ['a range from the plan wizard', '£5,000–£10,000', false],
    ['"Up to" from the plan wizard', 'Up to £1,000', false],
    ['nothing', null, false],
    ['zero', 0, false],
  ])('the budget step with %s is done: %s', async (_label, budget, done) => {
    const result = await milestonesFor({
      plans: [{ id: 'plan-1', userId: 'user-cust-1', budget }],
    });
    expect(result['set-budget']).toBe(done);
  });

  it('no longer serves the unused summary and countdown endpoints', async () => {
    for (const path of ['dashboard-summary', 'event-countdown']) {
      const res = await request(buildApp()).get(`/api/v1/customer/${path}`);
      expect(res.status).toBe(404);
    }
  });
});
