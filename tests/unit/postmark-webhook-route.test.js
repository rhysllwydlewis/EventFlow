'use strict';

jest.mock('../../services/emailLog.service', () => ({
  appendWebhookEvent: jest.fn(),
  getLog: jest.fn(),
}));

jest.mock('../../db-unified', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

function loadApp(env = {}, options = {}) {
  jest.resetModules();
  process.env.NODE_ENV = env.NODE_ENV || 'test';
  process.env.POSTMARK_WEBHOOK_USER = env.POSTMARK_WEBHOOK_USER || '';
  process.env.POSTMARK_WEBHOOK_PASS = env.POSTMARK_WEBHOOK_PASS || '';
  process.env.POSTMARK_WEBHOOK_ENABLED = env.POSTMARK_WEBHOOK_ENABLED || '';

  const emailLogService = require('../../services/emailLog.service');
  const dbUnified = require('../../db-unified');

  emailLogService.appendWebhookEvent.mockImplementation(async payload => ({
    matched: payload.MessageID === 'known-message',
    id: payload.MessageID === 'known-message' ? 'email-log-1' : undefined,
    reason: payload.MessageID === 'known-message' ? undefined : 'unknown_message_id',
  }));
  emailLogService.getLog.mockResolvedValue(
    options.emailLog || {
      id: 'email-log-1',
      template: 'review-request',
      status: 'delivered',
      postmarkMessageId: 'known-message',
      lastEventAt: '2026-07-16T09:30:00.000Z',
    }
  );
  dbUnified.findOne.mockResolvedValue(
    options.reviewRequest === undefined
      ? { id: 'request-1', status: 'sent' }
      : options.reviewRequest
  );
  dbUnified.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

  const route = require('../../routes/postmark-webhook');
  const app = express();
  app.use('/api/webhooks', route);
  return { app, dbUnified, emailLogService, route };
}

function auth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('postmark webhook route', () => {
  afterEach(() => {
    delete process.env.POSTMARK_WEBHOOK_USER;
    delete process.env.POSTMARK_WEBHOOK_PASS;
    delete process.env.POSTMARK_WEBHOOK_ENABLED;
    process.env.NODE_ENV = 'test';
    jest.clearAllMocks();
  });

  test('normalizes Postmark provider RecordType values to EventFlow statuses', () => {
    const { route } = loadApp();

    expect(route.normalizePostmarkPayload({ RecordType: 'Delivery' }).RecordType).toBe('Delivered');
    expect(route.normalizePostmarkPayload({ RecordType: 'Bounce' }).RecordType).toBe('Bounced');
    expect(route.normalizePostmarkPayload({ RecordType: 'Open' }).RecordType).toBe('Opened');
    expect(route.normalizePostmarkPayload({ RecordType: 'Click' }).RecordType).toBe('LinkClicked');
    expect(route.normalizePostmarkPayload({ RecordType: 'SubscriptionChange' }).RecordType).toBe(
      'SubscriptionChanged'
    );
    expect(route.normalizePostmarkPayload({ RecordType: 'SpamComplaint' }).RecordType).toBe(
      'SpamComplaint'
    );
  });

  test('rejects invalid auth when credentials are configured', async () => {
    const { app } = loadApp({
      POSTMARK_WEBHOOK_USER: 'postmark',
      POSTMARK_WEBHOOK_PASS: 'secret',
    });

    await request(app)
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'wrong'))
      .send({ RecordType: 'Delivery', MessageID: 'known-message' })
      .expect(401);
  });

  test('accepts Delivery events and updates the matching review request', async () => {
    const { app, dbUnified, emailLogService } = loadApp({
      POSTMARK_WEBHOOK_USER: 'postmark',
      POSTMARK_WEBHOOK_PASS: 'secret',
    });

    await request(app)
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({ RecordType: 'Delivery', MessageID: 'known-message' })
      .expect(200)
      .expect(res => {
        expect(res.body.ok).toBe(true);
        expect(res.body.matched).toBe(true);
        expect(res.body.reviewRequestUpdated).toBe(true);
      });

    expect(emailLogService.appendWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ RecordType: 'Delivered', MessageID: 'known-message' })
    );
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'reviewRequests',
      { id: 'request-1' },
      {
        $set: expect.objectContaining({
          deliveryStatus: 'delivered',
          deliveredAt: '2026-07-16T09:30:00.000Z',
          retryable: false,
        }),
      }
    );
  });

  test('marks a bounced request failed and retryable when Postmark has not deactivated it', async () => {
    const { app, dbUnified, emailLogService } = loadApp(
      {
        POSTMARK_WEBHOOK_USER: 'postmark',
        POSTMARK_WEBHOOK_PASS: 'secret',
      },
      {
        emailLog: {
          id: 'email-log-1',
          template: 'review-request',
          status: 'bounced',
          postmarkMessageId: 'known-message',
          lastEventAt: '2026-07-16T09:35:00.000Z',
        },
      }
    );

    await request(app)
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({
        RecordType: 'Bounce',
        MessageID: 'known-message',
        Inactive: false,
      })
      .expect(200);

    expect(emailLogService.appendWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ RecordType: 'Bounced', Inactive: false })
    );
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'reviewRequests',
      { id: 'request-1' },
      {
        $set: expect.objectContaining({
          status: 'failed',
          deliveryStatus: 'bounced',
          retryable: true,
          deliveryFailedAt: '2026-07-16T09:35:00.000Z',
        }),
      }
    );
  });

  test('does not overwrite a completed request when a late bounce arrives', async () => {
    const { app, dbUnified } = loadApp(
      {
        POSTMARK_WEBHOOK_USER: 'postmark',
        POSTMARK_WEBHOOK_PASS: 'secret',
      },
      {
        emailLog: {
          id: 'email-log-1',
          template: 'review-request',
          status: 'bounced',
          postmarkMessageId: 'known-message',
          lastEventAt: '2026-07-16T09:40:00.000Z',
        },
        reviewRequest: { id: 'request-1', status: 'completed' },
      }
    );

    await request(app)
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({ RecordType: 'Bounce', MessageID: 'known-message', Inactive: true })
      .expect(200);

    const update = dbUnified.updateOne.mock.calls[0][2].$set;
    expect(update.status).toBeUndefined();
    expect(update.deliveryStatus).toBe('bounced');
    expect(update.retryable).toBe(false);
  });

  test('unknown MessageID returns 200 without attempting review-request sync', async () => {
    const { app, dbUnified, emailLogService } = loadApp({
      POSTMARK_WEBHOOK_USER: 'postmark',
      POSTMARK_WEBHOOK_PASS: 'secret',
    });

    await request(app)
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({ RecordType: 'Open', MessageID: 'missing' })
      .expect(200)
      .expect(res => {
        expect(res.body.ok).toBe(true);
        expect(res.body.matched).toBe(false);
        expect(res.body.reviewRequestUpdated).toBe(false);
      });

    expect(emailLogService.appendWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ RecordType: 'Opened', MessageID: 'missing' })
    );
    expect(emailLogService.getLog).not.toHaveBeenCalled();
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('does not update review requests for unrelated email templates', async () => {
    const { app, dbUnified } = loadApp(
      {
        POSTMARK_WEBHOOK_USER: 'postmark',
        POSTMARK_WEBHOOK_PASS: 'secret',
      },
      {
        emailLog: {
          id: 'email-log-1',
          template: 'verification',
          status: 'delivered',
          postmarkMessageId: 'known-message',
          lastEventAt: '2026-07-16T09:45:00.000Z',
        },
      }
    );

    await request(app)
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({ RecordType: 'Delivery', MessageID: 'known-message' })
      .expect(200)
      .expect(res => {
        expect(res.body.reviewRequestUpdated).toBe(false);
      });

    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  test('missing production credentials are rejected safely', async () => {
    const { app } = loadApp({ NODE_ENV: 'production' });

    await request(app)
      .post('/api/webhooks/postmark')
      .send({ RecordType: 'Delivery', MessageID: 'known-message' })
      .expect(503);
  });
});
