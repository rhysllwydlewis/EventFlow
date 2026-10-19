'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'u1' };
    next();
  },
  requireVerifiedUser: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/rateLimits', () => ({ writeLimiter: (_req, _res, next) => next() }));

const plans = [{ id: 'p1', userId: 'u1', budgetItems: [] }];
jest.mock('../../db-unified', () => ({
  findOne: jest.fn(
    async (_c, q) => plans.find(p => p.id === q.id && p.userId === q.userId) || null
  ),
  updateOne: jest.fn(async (_c, q, u) => {
    Object.assign(
      plans.find(p => p.id === q.id),
      u.$set
    );
    return true;
  }),
}));
jest.mock('../../store', () => ({ uid: () => 'budget_new' }));

const router = require('../../routes/plans');

describe('POST /api/me/plans/:id/budget', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', router);
  const plan = plans[0];
  const save = body => request(app).post('/api/me/plans/p1/budget').send(body);

  beforeEach(() => {
    plan.budgetItems = [];
    delete plan.budgetUpdatedAt;
  });

  test('amounts are clamped to sensible pounds and pence', async () => {
    const res = await save({
      budgetItems: [
        { item: 'Venue', estimated: '5000000000', actual: -5, paid: '12.345' },
        { item: 'Cake', estimated: 'abc', actual: '1e999' },
      ],
    });
    expect(res.status).toBe(200);
    const [venue, cake] = res.body.budgetItems;
    expect(venue.estimated).toBe(1000000000);
    expect(venue.actual).toBe(0);
    expect(venue.paid).toBe(12.35);
    expect(cake.estimated).toBe(0);
    expect(cake.actual).toBe(0);
  });

  test('refuses more items than a budget can hold', async () => {
    const budgetItems = Array.from({ length: 501 }, (_, i) => ({ item: `Item ${i}` }));
    const res = await save({ budgetItems });
    expect(res.status).toBe(400);
  });

  test('a save made from the current version succeeds and moves the version on', async () => {
    const first = await save({
      budgetItems: [{ item: 'Venue', estimated: 1000 }],
      baseVersion: '',
    });
    expect(first.status).toBe(200);
    expect(first.body.budgetUpdatedAt).toBeTruthy();
    const second = await save({
      budgetItems: [{ item: 'Venue', estimated: 2000 }],
      baseVersion: first.body.budgetUpdatedAt,
    });
    expect(second.status).toBe(200);
    expect(plan.budgetItems[0].estimated).toBe(2000);
  });

  test('a save made from an old version is refused and nothing is overwritten', async () => {
    const first = await save({
      budgetItems: [{ item: 'Venue', estimated: 1000 }],
      baseVersion: '',
    });
    const stale = await save({ budgetItems: [{ item: 'Other', estimated: 5 }], baseVersion: '' });
    expect(stale.status).toBe(409);
    expect(stale.body.budgetItems[0].item).toBe('Venue');
    expect(stale.body.budgetUpdatedAt).toBe(first.body.budgetUpdatedAt);
    expect(plan.budgetItems[0].item).toBe('Venue');
  });

  test('clients that send no version still save', async () => {
    await save({ budgetItems: [{ item: 'Venue' }] });
    const res = await save({ budgetItems: [{ item: 'Venue' }, { item: 'Cake' }] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });
});
