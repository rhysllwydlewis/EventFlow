'use strict';

/**
 * The guest routes read the whole list, edit it and write it back. These tests make two requests
 * start from the same copy of the plan (as two tabs would) and check that neither one's change
 * is lost, using a database stand-in that honours the filter an update names.
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

let plans;
let barrier;
let ids = 0;
const clone = value => JSON.parse(JSON.stringify(value));

const matches = (item, filter) =>
  Object.entries(filter).every(([key, wanted]) => {
    if (wanted && typeof wanted === 'object' && Array.isArray(wanted.$in)) {
      return wanted.$in.includes(item[key]);
    }
    return item[key] === wanted;
  });

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../store', () => ({ uid: prefix => `${prefix}_${(ids += 1)}` }));

const dbUnified = require('../../db-unified');
const router = require('../../routes/guests');

const app = express();
app.use(express.json());
app.use('/api/me/plans', router);

const guest = (id, name) => ({ id, name, rsvpStatus: 'pending', notes: '' });
const names = () => plans[0].guestList.map(g => g.name);

/** Holds every read until `count` of them have been asked for, so they all see the same plan. */
const startTogether = count => {
  const waiting = [];
  barrier = () =>
    new Promise(resolve => {
      waiting.push(resolve);
      if (waiting.length === count) {
        barrier = null;
        waiting.forEach(release => release());
      }
    });
};

beforeEach(() => {
  barrier = null;
  ids = 0;
  plans = [
    {
      id: 'p1',
      userId: 'u1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      guestList: [guest('g1', 'Ann'), guest('g2', 'Bob')],
      tables: [],
    },
  ];
  jest.resetAllMocks();
  // Every caller gets its own copy, like a real database read.
  dbUnified.read.mockImplementation(async () => {
    const snapshot = clone(plans);
    if (barrier) {
      await barrier();
    }
    return snapshot;
  });
  dbUnified.findOne.mockImplementation(async (_c, filter) => {
    const found = plans.find(p => matches(p, filter));
    return found ? clone(found) : null;
  });
  dbUnified.updateOne.mockImplementation(async (_c, filter, update) => {
    const found = plans.find(p => matches(p, filter));
    if (!found) {
      return false;
    }
    Object.assign(found, clone(update.$set));
    return true;
  });
});

describe('guest changes made at the same time', () => {
  test('two adds from the same copy both end up on the list', async () => {
    startTogether(2);
    const [a, b] = await Promise.all([
      request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' }),
      request(app).post('/api/me/plans/p1/guests').send({ name: 'Di' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(names().sort()).toEqual(['Ann', 'Bob', 'Cy', 'Di']);
    // The guest each response names is the one that was kept.
    const stored = plans[0].guestList.map(g => g.id);
    expect(stored).toContain(a.body.guest.id);
    expect(stored).toContain(b.body.guest.id);
    expect(new Set(stored).size).toBe(stored.length);
  });

  test('an import and an edit from the same copy both stick', async () => {
    startTogether(2);
    const [imported, edited] = await Promise.all([
      request(app)
        .post('/api/me/plans/p1/guests/bulk')
        .send({ guests: [{ name: 'Cy' }, { name: 'Di' }] }),
      request(app).patch('/api/me/plans/p1/guests/g1').send({ notes: 'Vegetarian' }),
    ]);
    expect([imported.status, edited.status]).toEqual([201, 200]);
    expect(names().sort()).toEqual(['Ann', 'Bob', 'Cy', 'Di']);
    expect(plans[0].guestList.find(g => g.id === 'g1').notes).toBe('Vegetarian');
  });

  test('edits to two different guests do not undo each other', async () => {
    startTogether(2);
    const [a, b] = await Promise.all([
      request(app).patch('/api/me/plans/p1/guests/g1').send({ rsvpStatus: 'attending' }),
      request(app).patch('/api/me/plans/p1/guests/g2').send({ rsvpStatus: 'declined' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(plans[0].guestList.map(g => g.rsvpStatus)).toEqual(['attending', 'declined']);
  });

  test('a delete does not bring back a guest another request just removed', async () => {
    startTogether(2);
    const [a, b] = await Promise.all([
      request(app).delete('/api/me/plans/p1/guests/g1'),
      request(app).delete('/api/me/plans/p1/guests/g2'),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(names()).toEqual([]);
  });

  test('an edit to a guest who was just deleted is a 404, not a resurrection', async () => {
    startTogether(2);
    const [removed, edited] = await Promise.all([
      request(app).delete('/api/me/plans/p1/guests/g1'),
      request(app).patch('/api/me/plans/p1/guests/g1').send({ notes: 'late' }),
    ]);
    expect(removed.status).toBe(200);
    expect([200, 404]).toContain(edited.status);
    expect(names()).toEqual(['Bob']);
  });

  test('a guest added by another part of the app between the read and the write is kept', async () => {
    const normalUpdate = dbUnified.updateOne.getMockImplementation();
    dbUnified.updateOne.mockImplementationOnce(async (...args) => {
      // Something else (the seating or RSVP code) saves its own guest, moving updatedAt on.
      plans[0].guestList.push(guest('g9', 'Zed'));
      plans[0].updatedAt = '2026-02-02T00:00:00.000Z';
      return normalUpdate(...args);
    });
    const res = await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    expect(res.status).toBe(201);
    expect(names().sort()).toEqual(['Ann', 'Bob', 'Cy', 'Zed']);
  });
});

describe('what a write names', () => {
  test('it carries the plan owner and the updatedAt the edit started from', async () => {
    await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    const [, filter, update] = dbUnified.updateOne.mock.calls[0];
    expect(filter).toEqual({
      id: 'p1',
      userId: 'u1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(update.$set.updatedAt > '2026-01-01T00:00:00.000Z').toBe(true);
  });

  test('a plan that never had updatedAt can still be changed', async () => {
    delete plans[0].updatedAt;
    const res = await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    expect(res.status).toBe(201);
    expect(names()).toContain('Cy');
    expect(plans[0].updatedAt).toBeTruthy();
  });

  test('the new updatedAt always moves forward, even inside the same millisecond', async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    plans[0].updatedAt = future;
    await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    expect(plans[0].updatedAt > future).toBe(true);
  });
});

describe('when the write cannot be made', () => {
  test('a database that refuses the write is a 500 for add, edit and delete', async () => {
    const calls = [
      () => request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' }),
      () => request(app).patch('/api/me/plans/p1/guests/g1').send({ notes: 'x' }),
      () => request(app).delete('/api/me/plans/p1/guests/g1'),
    ];
    for (const call of calls) {
      dbUnified.updateOne.mockResolvedValueOnce(false);
      const res = await call();
      expect(res.status).toBe(500);
    }
    expect(names()).toEqual(['Ann', 'Bob']);
  });

  test('a database error while re-reading the plan is a 500, not a hung request', async () => {
    dbUnified.updateOne.mockResolvedValueOnce(false);
    dbUnified.findOne.mockRejectedValueOnce(new Error('connection lost'));
    const res = await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    expect(res.status).toBe(500);
  });

  test('a plan that disappears mid-write is a 404', async () => {
    dbUnified.updateOne.mockResolvedValueOnce(false);
    dbUnified.findOne.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    expect(res.status).toBe(404);
  });

  test('a list that keeps changing gives up with a 409 after a few tries', async () => {
    let tick = 0;
    dbUnified.updateOne.mockImplementation(async () => false);
    dbUnified.findOne.mockImplementation(async () => ({
      ...clone(plans[0]),
      updatedAt: `2026-03-0${(tick += 1)}T00:00:00.000Z`,
    }));
    const res = await request(app).post('/api/me/plans/p1/guests').send({ name: 'Cy' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed somewhere else/);
    expect(dbUnified.updateOne).toHaveBeenCalledTimes(5);
    expect(names()).toEqual(['Ann', 'Bob']);
  });
});
