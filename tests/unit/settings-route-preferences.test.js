'use strict';

/**
 * routes/settings.js — GET/POST /api/me/settings preference fields added
 * for the unified preferences page: newsletterStatus (read-only),
 * communityDigestCadence, browseNudgeOptOut, verificationReminderOptOut.
 */

const express = require('express');
const request = require('supertest');

function matches(row, filter) {
  return Object.keys(filter).every(key => row[key] === filter[key]);
}

function buildDb(seed = {}) {
  const data = { users: [], newsletterSubscribers: [], ...seed };
  return {
    data,
    read: jest.fn(async collection => data[collection] || []),
    findOne: jest.fn(
      async (collection, filter) =>
        (data[collection] || []).find(row => matches(row, filter)) || null
    ),
    updateOne: jest.fn(async () => true),
  };
}

function buildApp(db) {
  jest.resetModules();
  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
      req.user = { id: 'user_1' };
      next();
    },
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  jest.doMock('../../middleware/rateLimits', () => ({
    writeLimiter: (_req, _res, next) => next(),
  }));
  jest.doMock('../../db-unified', () => db);

  const settingsRoutes = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use('/api/me/settings', settingsRoutes);
  return app;
}

describe('GET /api/me/settings — preference fields', () => {
  it('reports not-subscribed when no newsletter row exists', async () => {
    const db = buildDb({ users: [{ id: 'user_1', email: 'u@example.com' }] });
    const app = buildApp(db);

    const res = await request(app).get('/api/me/settings').expect(200);

    expect(res.body.newsletterStatus).toBe('not-subscribed');
    expect(res.body.communityDigestCadence).toBe('weekly');
    expect(res.body.browseNudgeOptOut).toBe(false);
    expect(res.body.verificationReminderOptOut).toBe(false);
    expect(res.body.verified).toBe(false);
  });

  it('reports the matching newsletter subscriber status and stored preferences', async () => {
    const db = buildDb({
      users: [
        {
          id: 'user_1',
          email: 'u@example.com',
          verified: true,
          communityNotificationPreferences: { email: 'daily' },
          browseNudgeOptOut: true,
        },
      ],
      newsletterSubscribers: [{ email: 'u@example.com', status: 'active' }],
    });
    const app = buildApp(db);

    const res = await request(app).get('/api/me/settings').expect(200);

    expect(res.body.newsletterStatus).toBe('active');
    expect(res.body.communityDigestCadence).toBe('daily');
    expect(res.body.browseNudgeOptOut).toBe(true);
    expect(res.body.verified).toBe(true);
  });
});

describe('POST /api/me/settings — preference fields', () => {
  it('rejects an invalid communityDigestCadence value', async () => {
    const db = buildDb({ users: [{ id: 'user_1', email: 'u@example.com' }] });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/me/settings')
      .send({ notify: true, communityDigestCadence: 'hourly' })
      .expect(400);

    expect(res.body.error).toMatch(/communityDigestCadence/);
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean browseNudgeOptOut', async () => {
    const db = buildDb({ users: [{ id: 'user_1', email: 'u@example.com' }] });
    const app = buildApp(db);

    await request(app)
      .post('/api/me/settings')
      .send({ notify: true, browseNudgeOptOut: 'yes' })
      .expect(400);
  });

  it('writes notify_account (the field real sends gate on), not just the deprecated notify field', async () => {
    // utils/postmark.js's sendNotificationEmail and
    // services/queue/workers/email.worker.js both check notify_account, not
    // the legacy `notify` field — a user unchecking this toggle here must
    // actually stop those sends, not just flip a field nothing reads.
    const db = buildDb({ users: [{ id: 'user_1', email: 'u@example.com' }] });
    const app = buildApp(db);

    await request(app).post('/api/me/settings').send({ notify: false }).expect(200);

    expect(db.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'user_1' },
      { $set: expect.objectContaining({ notify: false, notify_account: false }) }
    );
  });

  it('does not touch notify/notify_account when the request omits notify entirely', async () => {
    // Every other field on this endpoint (communityDigestCadence,
    // browseNudgeOptOut, verificationReminderOptOut) is gated on
    // `!== undefined` — notify must be too, or a client posting a partial
    // payload silently disables the user's account notifications as a side
    // effect of a request that never mentioned them.
    const db = buildDb({ users: [{ id: 'user_1', email: 'u@example.com' }] });
    const app = buildApp(db);

    await request(app).post('/api/me/settings').send({ browseNudgeOptOut: true }).expect(200);

    expect(db.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'user_1' },
      { $set: expect.not.objectContaining({ notify: expect.anything() }) }
    );
    const [, , setArg] = db.updateOne.mock.calls[0];
    expect(setArg.$set).not.toHaveProperty('notify_account');
  });

  it('reads notify from notify_account, matching what PUT /api/auth/preferences writes', async () => {
    const db = buildDb({
      users: [{ id: 'user_1', email: 'u@example.com', notify: true, notify_account: false }],
    });
    const app = buildApp(db);

    const res = await request(app).get('/api/me/settings').expect(200);

    expect(res.body.notify).toBe(false);
  });

  it('falls back to the legacy notify field when notify_account was never explicitly set', async () => {
    // A user who unchecked this toggle before notify_account existed
    // already expressed their real preference via `notify: false` — without
    // this fallback, switching the read to notify_account (undefined here)
    // would silently show the toggle as back on.
    const db = buildDb({
      users: [{ id: 'user_1', email: 'u@example.com', notify: false }],
    });
    const app = buildApp(db);

    const res = await request(app).get('/api/me/settings').expect(200);

    expect(res.body.notify).toBe(false);
  });

  it('writes communityDigestCadence as a dot-path key and the opt-outs as flat keys', async () => {
    const db = buildDb({ users: [{ id: 'user_1', email: 'u@example.com' }] });
    const app = buildApp(db);

    await request(app)
      .post('/api/me/settings')
      .send({
        notify: true,
        communityDigestCadence: 'none',
        browseNudgeOptOut: true,
        verificationReminderOptOut: true,
      })
      .expect(200);

    expect(db.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'user_1' },
      {
        $set: expect.objectContaining({
          'communityNotificationPreferences.email': 'none',
          browseNudgeOptOut: true,
          verificationReminderOptOut: true,
        }),
      }
    );
  });
});
