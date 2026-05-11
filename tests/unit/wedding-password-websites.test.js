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
  {
    id: 'placeholder-plan',
    userId: 'u1',
    name: 'Wedding Website',
    guestList: [],
    weddingWebsite: {
      slug: 'wedding-website',
      status: 'draft',
      visibility: 'private_link',
      coupleNames: 'Rhys & Jade',
      eventDate: '2027-07-01',
      ceremonyVenueName: 'The Venue',
      rsvpEnabled: true,
    },
  },
  {
    id: 'publish-plan',
    userId: 'u1',
    name: 'Publish Wedding',
    eventDate: '2028-05-20',
    guestList: [],
    weddingWebsite: {
      slug: 'publish-wedding',
      status: 'draft',
      visibility: 'private_link',
      coupleNames: 'Publish Couple',
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

  test('reserved placeholder slug is rejected on manual save', async () => {
    const res = await request(app)
      .patch('/api/me/plans/plain-plan/wedding-website')
      .send({ slug: 'wedding-website' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/personal website link/i);
  });

  test('reserved placeholder slug is never publicly available', async () => {
    const res = await request(app).get('/api/public/wedding-websites/wedding-website');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not available/i);
  });

  test('publish repairs legacy placeholder slug before going live', async () => {
    const res = await request(app).post('/api/me/plans/placeholder-plan/wedding-website/publish');

    expect(res.status).toBe(200);
    expect(res.body.website.slug).not.toBe('wedding-website');
    expect(res.body.website.slug).toBe('rhys-jade');
    expect(res.body.website.shareable).toBe(true);
  });

  test('switching away from password clears stored hash', async () => {
    await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'password', password: 'guest-secret' });

    const res = await request(app)
      .patch('/api/me/plans/password-plan/wedding-website')
      .send({ visibility: 'public' });

    expect(res.status).toBe(200);
    expect(res.body.website.passwordHash).toBeUndefined();
    expect(res.body.website.passwordSet).toBe(false);
    expect(plans[1].weddingWebsite.passwordHash).toBeUndefined();
  });

  test('eventDate is persisted and satisfies publish readiness with venue details', async () => {
    let res = await request(app).post('/api/me/plans/publish-plan/wedding-website/publish');
    expect(res.status).toBe(400);
    expect(res.body.checklist.missing).toEqual(expect.arrayContaining(['eventDate', 'venue']));

    res = await request(app)
      .patch('/api/me/plans/publish-plan/wedding-website')
      .send({ eventDate: '2028-05-20', ceremonyVenueName: 'Cardiff Castle' });

    expect(res.status).toBe(200);
    expect(res.body.website.eventDate).toBe('2028-05-20');
    expect(res.body.website.ceremonyVenueName).toBe('Cardiff Castle');

    res = await request(app).post('/api/me/plans/publish-plan/wedding-website/publish');
    expect(res.status).toBe(200);
    expect(res.body.website.shareable).toBe(true);
  });

  test('new wedding website drafts inherit plan event date where available', async () => {
    const plan = {
      id: 'new-date-plan',
      userId: 'u1',
      name: 'New Date Wedding',
      eventType: 'wedding',
      eventDate: '2029-08-12',
      guestList: [],
    };
    plans.push(plan);

    const res = await request(app).post('/api/me/plans/new-date-plan/wedding-website').send({});

    expect(res.status).toBe(201);
    expect(res.body.website.eventDate).toBe('2029-08-12');
  });
});
