'use strict';

/**
 * PATCH /api/me/plans/:id — the event date lives in `eventDate` and, on every plan made here, also
 * in the older `date`. Readers take `eventDate || date`, so a change that touched only one of them
 * brought the old date back (a cleared date could never be cleared).
 */

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

const plans = [];
const mockUpdateOne = jest.fn(async (_collection, filter, update) => {
  const plan = plans.find(p => p.id === filter.id && p.userId === filter.userId);
  if (!plan) {
    return false;
  }
  Object.assign(plan, update.$set);
  return true;
});
jest.mock('../../db-unified', () => ({
  find: jest.fn(async (_c, query) => plans.filter(p => p.userId === query.userId)),
  findOne: jest.fn(
    async (_c, query) => plans.find(p => p.id === query.id && p.userId === query.userId) || null
  ),
  updateOne: (...args) => mockUpdateOne(...args),
}));
jest.mock('../../store', () => ({ uid: () => 'plan_new' }));

const router = require('../../routes/plans');

describe('PATCH /api/me/plans/:id event date', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', router);
  const patch = body => request(app).patch('/api/me/plans/p1').send(body);

  beforeEach(() => {
    plans.length = 0;
    plans.push({
      id: 'p1',
      userId: 'u1',
      name: 'Our wedding',
      eventDate: '2027-06-19',
      date: '2027-06-19',
    });
    mockUpdateOne.mockClear();
  });

  test('changing the date changes the older `date` with it', async () => {
    const res = await patch({ eventDate: '2027-08-07' });
    expect(res.status).toBe(200);
    expect(plans[0].eventDate).toBe('2027-08-07');
    expect(plans[0].date).toBe('2027-08-07');
    expect(res.body.plan.date).toBe('2027-08-07');
  });

  test('clearing the date clears both, so the old date does not come back', async () => {
    const res = await patch({ eventDate: null });
    expect(res.status).toBe(200);
    expect(plans[0].eventDate).toBeNull();
    expect(plans[0].date).toBeNull();
    expect(plans[0].eventDate || plans[0].date).toBeFalsy();
  });

  test('an empty string clears the date too', async () => {
    await patch({ eventDate: '' });
    expect(plans[0].eventDate).toBeNull();
    expect(plans[0].date).toBeNull();
  });

  test('a date that cannot be read is treated as no date, in both fields', async () => {
    await patch({ eventDate: 'not a date' });
    expect(plans[0].eventDate).toBeNull();
    expect(plans[0].date).toBeNull();
  });

  test('a change that does not mention the date leaves both alone', async () => {
    await patch({ location: 'Bristol' });
    expect(plans[0].eventDate).toBe('2027-06-19');
    expect(plans[0].date).toBe('2027-06-19');
    expect(plans[0].location).toBe('Bristol');
  });

  test('the update is limited to the signed-in owner as well as the plan id', async () => {
    await patch({ location: 'Bristol' });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      'plans',
      { id: 'p1', userId: 'u1' },
      expect.objectContaining({ $set: expect.objectContaining({ location: 'Bristol' }) })
    );
  });

  test("another customer's plan is not found", async () => {
    plans[0].userId = 'someone-else';
    const res = await patch({ eventDate: null });
    expect(res.status).toBe(404);
    expect(plans[0].eventDate).toBe('2027-06-19');
  });
});

describe('GET /api/me/plans', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', router);

  test('reports how many plans a customer may have, so a page can say so before the wizard does', async () => {
    plans.length = 0;
    plans.push({ id: 'p1', userId: 'u1', name: 'Our wedding' });
    const res = await request(app).get('/api/me/plans');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.limit).toBe(3);
  });
});
