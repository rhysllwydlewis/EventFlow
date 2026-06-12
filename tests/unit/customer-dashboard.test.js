/**
 * Unit tests for the customer dashboard API (routes/customer-dashboard.js)
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

describe('GET /api/v1/customer/dashboard-summary', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.find.mockResolvedValue([]);
    mockDb.findOne.mockResolvedValue(null);
  });

  it('returns 403 for non-customer roles', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/dashboard-summary')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty state for new customer', async () => {
    mockDb.find.mockResolvedValue([]);
    mockDb.findOne.mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/dashboard-summary')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('plans');
    expect(res.body).toHaveProperty('budget');
    expect(res.body).toHaveProperty('savedSuppliers');
    expect(res.body).toHaveProperty('upcomingEvents');
    expect(res.body).toHaveProperty('tickets');
    expect(res.body.plans.total).toBe(0);
    expect(res.body.budget.spent).toBe(0);
    expect(Array.isArray(res.body.upcomingEvents)).toBe(true);
  });

  it('calculates budget by resolving package IDs from plans', async () => {
    const plan = {
      id: 'plan-1',
      userId: 'user-cust-1',
      budget: 5000,
      updatedAt: new Date().toISOString(),
      packages: ['pkg-1', 'pkg-2'], // plan.packages stores IDs, not objects
    };
    mockDb.find.mockImplementation(async col => {
      if (col === 'plans') {
        return [plan];
      }
      return [];
    });
    mockDb.findOne.mockImplementation(async (col, filter) => {
      if (col === 'packages' && filter.id === 'pkg-1') {
        return { id: 'pkg-1', price: '£1000', primaryCategoryKey: 'Photography' };
      }
      if (col === 'packages' && filter.id === 'pkg-2') {
        return { id: 'pkg-2', price: '£500', primaryCategoryKey: 'Catering' };
      }
      return null;
    });
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/dashboard-summary')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    expect(res.body.budget.total).toBe(5000);
    expect(res.body.budget.spent).toBe(1500);
    expect(res.body.budget.remaining).toBe(3500);
    expect(res.body.budget.percentUsed).toBe(30);
  });
});

describe('GET /api/v1/customer/event-countdown', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockDb.find.mockResolvedValue([]);
    mockDb.findOne.mockResolvedValue(null);
  });

  it('returns 403 for supplier', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/event-countdown')
      .set('x-test-user-role', 'supplier');
    expect(res.status).toBe(403);
  });

  it('returns null nearest when no plans have dates', async () => {
    mockDb.find.mockResolvedValue([{ id: 'plan-1', userId: 'user-cust-1' }]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/event-countdown')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    expect(res.body.nearest).toBeNull();
  });

  it('returns nearest upcoming event when plan has a future date', async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockDb.find.mockResolvedValue([
      {
        id: 'plan-1',
        userId: 'user-cust-1',
        name: 'My Wedding',
        eventDate: futureDate,
      },
    ]);
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/customer/event-countdown')
      .set('x-test-user-role', 'customer');
    expect(res.status).toBe(200);
    expect(res.body.nearest).not.toBeNull();
    expect(res.body.nearest.name).toBe('My Wedding');
    expect(res.body.nearest.daysUntil).toBeGreaterThan(0);
  });
});

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
});
