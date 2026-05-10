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
    name: 'A wedding plan',
    eventType: 'wedding',
    guestList: [],
    weddingWebsite: null,
  },
];

jest.mock('../../db-unified', () => ({
  read: jest.fn(async c => (c === 'plans' ? plans : [])),
  updateOne: jest.fn(async (_c, q, u) => {
    const p = plans.find(x => x.id === q.id);
    if (p && u.$set) {
      Object.assign(p, u.$set);
    }
    return true;
  }),
}));

jest.mock('../../store', () => ({ uid: p => `${p}_${Math.random().toString(36).slice(2, 8)}` }));

const ww = require('../../routes/wedding-websites');
const guests = require('../../routes/guests');

describe('integration: dashboard + public RSVP flow', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', ww);
  app.use('/api/me/plans', guests);
  app.use('/api', ww);

  test('create, publish, rsvp, and summary', async () => {
    let res = await request(app)
      .post('/api/me/plans/p1/wedding-website')
      .send({ coupleNames: 'Amy & Ben' });
    expect(res.status).toBe(201);
    res = await request(app).post('/api/me/plans/p1/wedding-website/publish').send({});
    expect(res.status).toBe(200);
    const slug = plans[0].weddingWebsite.slug;
    res = await request(app).get(`/api/public/wedding-websites/${slug}`);
    expect(res.status).toBe(200);
    res = await request(app)
      .post(`/api/public/wedding-websites/${slug}/rsvp`)
      .send({ guestName: 'Guest One', attending: 'true', partySize: 2 });
    expect(res.status).toBe(200);
    res = await request(app).get('/api/me/plans/p1/rsvp-summary');
    expect(res.status).toBe(200);
    expect(res.body.summary.attending).toBe(1);
    expect(res.body.summary.partySizeTotal).toBe(2);
  });

  test('unpublish hides public site and blocks RSVP', async () => {
    const slug = plans[0].weddingWebsite.slug;
    let res = await request(app).post('/api/me/plans/p1/wedding-website/unpublish').send({});
    expect(res.status).toBe(200);
    res = await request(app).get(`/api/public/wedding-websites/${slug}`);
    expect(res.status).toBe(404);
    res = await request(app)
      .post(`/api/public/wedding-websites/${slug}/rsvp`)
      .send({ guestName: 'After close', attending: 'true' });
    expect(res.status).toBe(404);
  });

  test('public endpoint excludes private guest records', async () => {
    plans[0].weddingWebsite.status = 'published';
    plans[0].guestList = [
      {
        id: 'g_priv',
        name: 'Private',
        email: 'p@example.com',
        phone: '123',
        dietaryRequirements: 'x',
      },
    ];
    const slug = plans[0].weddingWebsite.slug;
    const res = await request(app).get(`/api/public/wedding-websites/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.website.guestList).toBeUndefined();
    expect(JSON.stringify(res.body.website)).not.toContain('p@example.com');
  });

  test('password visibility rejected in patch', async () => {
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ visibility: 'password' });
    expect(res.status).toBe(400);
  });
});
