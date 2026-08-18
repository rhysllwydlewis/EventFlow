'use strict';

/**
 * routes/admin-campaigns.js — GET/PUT /api/admin/campaigns/automation
 *
 * Regression coverage for the recurring-newsletter automation config
 * consumed by services/newsletterCadenceScheduler.js.
 */

const express = require('express');
const request = require('supertest');

function buildApp(settingsSeed = {}) {
  jest.resetModules();

  const settings = { ...settingsSeed };

  jest.doMock('../../middleware/auth', () => ({
    authRequired: (req, _res, next) => {
      req.user = { id: 'admin_1', role: 'admin' };
      next();
    },
    roleRequired: () => (_req, _res, next) => next(),
  }));
  jest.doMock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
  jest.doMock('../../middleware/rateLimits', () => ({
    writeLimiter: (_req, _res, next) => next(),
  }));
  jest.doMock('../../config/email', () => ({ EMAIL_ENABLED: true }));
  jest.doMock('../../db-unified', () => ({
    read: jest.fn(async collection => (collection === 'settings' ? settings : [])),
    writeAndVerify: jest.fn(async (_collection, doc) => {
      Object.assign(settings, doc);
      return true;
    }),
  }));

  const campaignsRoutes = require('../../routes/admin-campaigns');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/campaigns', campaignsRoutes);
  return { app, settings };
}

describe('GET /api/admin/campaigns/automation', () => {
  it('returns null when nothing has been configured yet', async () => {
    const { app } = buildApp({});
    const res = await request(app).get('/api/admin/campaigns/automation').expect(200);
    expect(res.body).toEqual({ ok: true, automation: null });
  });

  it('returns the stored config', async () => {
    const { app } = buildApp({
      newsletterAutomation: { enabled: true, cadence: 'weekly', dayOfWeek: 1, subject: 'Hi' },
    });
    const res = await request(app).get('/api/admin/campaigns/automation').expect(200);
    expect(res.body.automation).toMatchObject({ enabled: true, cadence: 'weekly' });
  });
});

describe('PUT /api/admin/campaigns/automation', () => {
  it('rejects enabling without a cadence', async () => {
    const { app } = buildApp({});
    const res = await request(app)
      .put('/api/admin/campaigns/automation')
      .send({ enabled: true, subject: 'Hi', bodyHtml: '<p>hi</p>' })
      .expect(400);
    expect(res.body.error).toMatch(/cadence/);
  });

  it('rejects an out-of-range dayOfWeek for weekly cadence', async () => {
    const { app } = buildApp({});
    await request(app)
      .put('/api/admin/campaigns/automation')
      .send({
        enabled: true,
        cadence: 'weekly',
        dayOfWeek: 9,
        subject: 'Hi',
        bodyHtml: '<p>hi</p>',
      })
      .expect(400);
  });

  it('rejects enabling without subject/bodyHtml', async () => {
    const { app } = buildApp({});
    const res = await request(app)
      .put('/api/admin/campaigns/automation')
      .send({ enabled: true, cadence: 'weekly', dayOfWeek: 1 })
      .expect(400);
    expect(res.body.error).toMatch(/subject/);
  });

  it('rejects a CTA text/URL supplied without its pair', async () => {
    const { app } = buildApp({});
    await request(app)
      .put('/api/admin/campaigns/automation')
      .send({
        enabled: true,
        cadence: 'weekly',
        dayOfWeek: 1,
        subject: 'Hi',
        bodyHtml: '<p>hi</p>',
        ctaText: 'Click me',
      })
      .expect(400);
  });

  it('saves a valid weekly config', async () => {
    const { app, settings } = buildApp({});
    const res = await request(app)
      .put('/api/admin/campaigns/automation')
      .send({
        enabled: true,
        cadence: 'weekly',
        dayOfWeek: 1,
        audience: 'both',
        subject: 'This week at EventFlow',
        bodyHtml: '<p>hello</p>',
      })
      .expect(200);

    expect(res.body.automation).toMatchObject({
      enabled: true,
      cadence: 'weekly',
      dayOfWeek: 1,
      subject: 'This week at EventFlow',
    });
    expect(settings.newsletterAutomation).toMatchObject({ enabled: true, cadence: 'weekly' });
  });

  it('allows disabling without content validation', async () => {
    const { app } = buildApp({
      newsletterAutomation: { enabled: true, cadence: 'weekly', dayOfWeek: 1 },
    });
    const res = await request(app)
      .put('/api/admin/campaigns/automation')
      .send({ enabled: false })
      .expect(200);
    expect(res.body.automation.enabled).toBe(false);
  });
});
