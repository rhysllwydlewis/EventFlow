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
  {
    id: 'p3',
    userId: 'u1',
    guestList: [],
    tables: [],
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

  describe('seating stays consistent with the guest list', () => {
    const seatedPlan = () => plans.find(p => p.id === 'p3');
    beforeEach(() => {
      const plan = seatedPlan();
      plan.guestList = [
        { id: 'a', name: 'Ann', rsvpStatus: 'attending', tableId: 't1', tableName: 'Top' },
        { id: 'b', name: 'Bob', rsvpStatus: 'attending', tableId: 't1', tableName: 'Top' },
        { id: 'c', name: 'Cy', rsvpStatus: 'attending', tableId: 't2', tableName: 'Two' },
      ];
      plan.tables = [
        { id: 't1', name: 'Top', capacity: 8, guestIds: ['a', 'b'] },
        { id: 't2', name: 'Two', capacity: 8, guestIds: ['c'] },
      ];
    });

    test('deleting a seated guest frees their seat', async () => {
      const res = await request(app).delete('/api/me/plans/p3/guests/a');
      expect(res.status).toBe(200);
      expect(seatedPlan().guestList.map(g => g.id)).toEqual(['b', 'c']);
      expect(seatedPlan().tables[0].guestIds).toEqual(['b']);
      expect(seatedPlan().tables[1].guestIds).toEqual(['c']);
    });

    test('a guest who declines is unseated', async () => {
      const res = await request(app)
        .patch('/api/me/plans/p3/guests/b')
        .send({ rsvpStatus: 'declined' });
      expect(res.status).toBe(200);
      const guest = seatedPlan().guestList.find(g => g.id === 'b');
      expect(guest.rsvpStatus).toBe('declined');
      expect(guest.tableId).toBeNull();
      expect(guest.tableName).toBeNull();
      expect(seatedPlan().tables[0].guestIds).toEqual(['a']);
    });

    test('editing an attending guest keeps their seat', async () => {
      const res = await request(app)
        .patch('/api/me/plans/p3/guests/a')
        .send({ name: 'Ann Smith', rsvpStatus: 'attending' });
      expect(res.status).toBe(200);
      const guest = seatedPlan().guestList.find(g => g.id === 'a');
      expect(guest.tableId).toBe('t1');
      expect(seatedPlan().tables[0].guestIds).toEqual(['a', 'b']);
    });
  });

  describe('guest notes', () => {
    test('saving a guest keeps notes up to the length allowed on create', async () => {
      const plan = plans.find(p => p.id === 'p3');
      plan.guestList = [{ id: 'n1', name: 'Nia', rsvpStatus: 'pending', notes: '' }];
      const long = 'x'.repeat(900);
      const res = await request(app).patch('/api/me/plans/p3/guests/n1').send({ notes: long });
      expect(res.status).toBe(200);
      expect(plan.guestList[0].notes).toHaveLength(900);
      const over = await request(app)
        .patch('/api/me/plans/p3/guests/n1')
        .send({ notes: 'y'.repeat(1500) });
      expect(over.status).toBe(200);
      expect(plan.guestList[0].notes).toHaveLength(1000);
    });
  });
});
