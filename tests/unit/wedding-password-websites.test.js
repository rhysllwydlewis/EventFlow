'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
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
    id: 'plain-plan',
    userId: 'u1',
    name: 'Plain Wedding',
    guestList: [],
    weddingWebsite: {
      slug: 'plain-wedding',
      status: 'published',
      visibility: 'private_link',
      coupleNames: 'Plain Couple',
      rsvpEnabled: true,
    },
  },
  {
    id: 'password-plan',
    userId: 'u1',
    name: 'Protected Wedding',
    guestList: [],
    weddingWebsite: {
      slug: 'protected-wedding',
      status: 'published',
      visibility: 'private_link',
      coupleNames: 'Protected Couple',
      eventDate: '2027-06-01',
      ceremonyVenueName: 'Castle Venue',
      rsvpEnabled: true,
    },
  },
  {
    id: 'draft-plan',
    userId: 'u1',
    name: 'Draft Wedding',
    guestList: [],
    weddingWebsite: {
      slug: 'draft-password-wedding',
      status: 'draft',
      visibility: 'password',
      coupleNames: 'Draft Couple',
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
jest.mock('../../store', () => ({ uid: p => `${p}_testid` }));

const router = require('../../routes/wedding-websites');

describe('password protected wedding websites', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/me/plans', router);
    app.use('/api', router);
  });

  test('customer can enable password visibility and stores only a hash', async () => {
    const res = await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password', password: 'guest-secret' });

    expect(res.status).toBe(200);
    expect(res.body.website.visibility).toBe('password');
    expect(res.body.website.passwordHash).toBeUndefined();
    expect(res.body.website.passwordSet).toBe(true);
    expect(plans[1].weddingWebsite.passwordHash).toMatch(/^pbkdf2:/);
    expect(plans[1].weddingWebsite.passwordHash).not.toContain('guest-secret');
    expect(plans[1].weddingWebsite.passwordUpdatedAt).toBeTruthy();
  });

  test('rejects password visibility without a password when no password is stored', async () => {
    delete plans[1].weddingWebsite.passwordHash;
    delete plans[1].weddingWebsite.passwordUpdatedAt;
    plans[1].weddingWebsite.visibility = 'private_link';

    const res = await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });

  test('customer response does not expose passwordHash', async () => {
    await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password', password: 'guest-secret' });

    const res = await request(app).get('/api/me/plans/password-plan/wedding-website');

    expect(res.status).toBe(200);
    expect(res.body.website.passwordHash).toBeUndefined();
    expect(res.body.website.passwordSet).toBe(true);
  });

  test('public GET for password protected site requires password access', async () => {
    await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password', password: 'guest-secret' });

    const res = await request(app).get('/api/public/wedding-websites/protected-wedding');

    expect(res.status).toBe(401);
    expect(res.body.passwordRequired).toBe(true);
    expect(res.body.website).toBeUndefined();
  });

  test('incorrect password is rejected and correct password grants access', async () => {
    await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password', password: 'guest-secret' });

    let res = await request(app)
      .post('/api/public/wedding-websites/protected-wedding/access')
      .send({ password: 'wrong-secret' });
    expect(res.status).toBe(403);

    const agent = request.agent(app);
    res = await agent
      .post('/api/public/wedding-websites/protected-wedding/access')
      .send({ password: 'guest-secret' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeTruthy();

    res = await agent.get('/api/public/wedding-websites/protected-wedding');
    expect(res.status).toBe(200);
    expect(res.body.website.coupleNames).toBe('Protected Couple');
    expect(res.body.website.passwordHash).toBeUndefined();
  });

  test('public RSVP is blocked without password access and works after access', async () => {
    plans[1].guestList = [];
    await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password', password: 'guest-secret' });

    let res = await request(app)
      .post('/api/public/wedding-websites/protected-wedding/rsvp')
      .send({ guestName: 'Jane Guest', attending: true });
    expect(res.status).toBe(403);
    expect(res.body.passwordRequired).toBe(true);

    const agent = request.agent(app);
    await agent
      .post('/api/public/wedding-websites/protected-wedding/access')
      .send({ password: 'guest-secret' });
    res = await agent
      .post('/api/public/wedding-websites/protected-wedding/rsvp')
      .send({ guestName: 'Jane Guest', attending: true, email: 'jane@example.com' });

    expect(res.status).toBe(200);
    expect(plans[1].guestList).toHaveLength(1);
    expect(plans[1].guestList[0].rsvpStatus).toBe('attending');
  });

  test('private link behaviour still works and draft sites remain blocked', async () => {
    let res = await request(app).get('/api/public/wedding-websites/plain-wedding');
    expect(res.status).toBe(200);

    res = await request(app)
      .post('/api/public/wedding-websites/plain-wedding/rsvp')
      .send({ guestName: 'Public Guest', attending: true });
    expect(res.status).toBe(200);

    res = await request(app).get('/api/public/wedding-websites/draft-password-wedding');
    expect(res.status).toBe(404);
  });
});
