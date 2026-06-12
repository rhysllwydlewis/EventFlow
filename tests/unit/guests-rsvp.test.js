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

const plans = [
  {
    id: 'p1',
    userId: 'u1',
    guests: 2,
    guestList: [
      {
        id: 'g1',
        name: 'Jane',
        rsvpStatus: 'attending',
        dietaryRequirements: 'Nut allergy',
        partySize: 2,
      },
    ],
  },
];
jest.mock('../../db-unified', () => ({
  read: jest.fn(async c => (c === 'plans' ? plans : [])),
  updateOne: jest.fn(async (_c, q, u) => {
    Object.assign(
      plans.find(p => p.id === q.id),
      u.$set
    );
    return true;
  }),
}));
jest.mock('../../store', () => ({ uid: () => 'guest_new' }));

const router = require('../../routes/guests');

describe('guests routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', router);
  test('csv export contains expected columns', async () => {
    const res = await request(app).get('/api/me/plans/p1/guests/export.csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain('RSVP Status');
    expect(res.text).toContain('Jane');
  });
  test('rsvp summary uses guestList not numeric guests field', async () => {
    const res = await request(app).get('/api/me/plans/p1/rsvp-summary');
    expect(res.body.summary.totalGuests).toBe(1);
    expect(res.body.summary.attending).toBe(1);
  });
});
