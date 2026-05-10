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
    name: 'Wedding Plan',
    weddingWebsite: { slug: 'amy-ben-2026', status: 'draft', rsvpEnabled: true },
  },
  {
    id: 'p2',
    userId: 'u1',
    name: 'Other',
    tables: [{ id: 't1', name: 'Table 1', capacity: 10, guestIds: [] }],
    guestList: [{ id: 'g1', name: 'Jane', rsvpStatus: 'attending' }],
    weddingWebsite: {
      slug: 'published-site',
      status: 'published',
      coupleNames: 'A&B',
      rsvpEnabled: true,
    },
  },
];

jest.mock('../../db-unified', () => ({
  read: jest.fn(async col => (col === 'plans' ? plans : [])),
  insertOne: jest.fn(async (_c, doc) => {
    plans.push(doc);
    return doc;
  }),
  updateOne: jest.fn(async (_c, q, u) => {
    const p = plans.find(x => x.id === q.id);
    if (p && u.$set) {
      Object.assign(p, u.$set);
    }
    return true;
  }),
}));
jest.mock('../../store', () => ({ uid: p => `${p}_${Math.random().toString(36).slice(2, 8)}` }));

const router = require('../../routes/wedding-websites');

describe('wedding websites routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', router);
  app.use('/api', router);

  test('blocks draft public access', async () => {
    const res = await request(app).get('/api/public/wedding-websites/amy-ben-2026');
    expect(res.status).toBe(404);
  });

  test('returns published public website safe shape', async () => {
    const res = await request(app).get('/api/public/wedding-websites/published-site');
    expect(res.status).toBe(200);
    expect(res.body.website.userId).toBeUndefined();
  });

  test('rejects RSVP honeypot and disabled/deadline', async () => {
    let res = await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: true, website: 'spam' });
    expect(res.status).toBe(400);
    plans[1].weddingWebsite.rsvpEnabled = false;
    res = await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: true });
    expect(res.status).toBe(400);
    plans[1].weddingWebsite.rsvpEnabled = true;
    plans[1].weddingWebsite.rsvpDeadline = '2000-01-01';
    res = await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: true });
    expect(res.status).toBe(400);
    plans[1].weddingWebsite.rsvpDeadline = null;
  });

  test('updates duplicate RSVP by name/email', async () => {
    const before = plans[1].guestList.length;
    await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: false, email: 'jane@example.com' });
    expect(plans[1].guestList.length).toBe(before);
    expect(plans[1].guestList[0].rsvpStatus).toBe('declined');
  });

  test('rejects reserved slug on patch', async () => {
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ slug: 'admin' });
    expect(res.status).toBe(400);
  });

  test('rejects non-unique slug on patch', async () => {
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ slug: 'published-site' });
    expect(res.status).toBe(409);
  });

  test('blocks publish when readiness checks are incomplete', async () => {
    const res = await request(app).post('/api/me/plans/p1/wedding-website/publish').send({});
    expect(res.status).toBe(400);
    expect(res.body.checklist.ready).toBe(false);
    expect(res.body.checklist.missing).toEqual(
      expect.arrayContaining(['coupleNames', 'eventDate', 'venue'])
    );
  });

  test('assign and unassign guest', async () => {
    plans[1].guestList[0].rsvpStatus = 'attending';
    let res = await request(app)
      .post('/api/me/plans/p2/tables/t1/assign-guest')
      .send({ guestId: 'g1' });
    expect(res.status).toBe(200);
    expect(plans[1].tables[0].guestIds).toContain('g1');
    res = await request(app).post('/api/me/plans/p2/tables/unassign-guest').send({ guestId: 'g1' });
    expect(res.status).toBe(200);
    expect(plans[1].tables[0].guestIds).not.toContain('g1');
  });

  test('creates standalone wedding workspace when user has no wedding plan', async () => {
    const res = await request(app).post('/api/me/plans/wedding-workspace').send({});
    expect([200, 201]).toContain(res.status);
    expect(res.body.plan).toBeTruthy();
    expect(res.body.plan.isWebsiteWorkspace).toBe(true);
    expect(res.body.plan.source).toBe('wedding_website_quick_start');
  });
});
