'use strict';

jest.mock('../../services/emailLog.service', () => ({
  appendWebhookEvent: jest.fn(async payload => ({
    matched: payload.MessageID === 'known-message',
    reason: payload.MessageID === 'known-message' ? undefined : 'unknown_message_id',
  })),
}));

const express = require('express');
const request = require('supertest');

function loadApp(env = {}) {
  jest.resetModules();
  process.env.NODE_ENV = env.NODE_ENV || 'test';
  process.env.POSTMARK_WEBHOOK_USER = env.POSTMARK_WEBHOOK_USER || '';
  process.env.POSTMARK_WEBHOOK_PASS = env.POSTMARK_WEBHOOK_PASS || '';
  process.env.POSTMARK_WEBHOOK_ENABLED = env.POSTMARK_WEBHOOK_ENABLED || '';
  const route = require('../../routes/postmark-webhook');
  const app = express();
  app.use('/api/webhooks', route);
  return app;
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

  test('rejects invalid auth when credentials are configured', async () => {
    await request(loadApp({ POSTMARK_WEBHOOK_USER: 'postmark', POSTMARK_WEBHOOK_PASS: 'secret' }))
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'wrong'))
      .send({ RecordType: 'Delivered', MessageID: 'known-message' })
      .expect(401);
  });

  test('accepts valid Delivered events and forwards payload', async () => {
    await request(loadApp({ POSTMARK_WEBHOOK_USER: 'postmark', POSTMARK_WEBHOOK_PASS: 'secret' }))
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({ RecordType: 'Delivered', MessageID: 'known-message' })
      .expect(200)
      .expect(res => {
        expect(res.body.ok).toBe(true);
        expect(res.body.matched).toBe(true);
      });
  });

  test('unknown MessageID returns 200 without crashing', async () => {
    await request(loadApp({ POSTMARK_WEBHOOK_USER: 'postmark', POSTMARK_WEBHOOK_PASS: 'secret' }))
      .post('/api/webhooks/postmark')
      .set('Authorization', auth('postmark', 'secret'))
      .send({ RecordType: 'Opened', MessageID: 'missing' })
      .expect(200)
      .expect(res => {
        expect(res.body.ok).toBe(true);
        expect(res.body.matched).toBe(false);
      });
  });

  test('missing production credentials are rejected safely', async () => {
    await request(loadApp({ NODE_ENV: 'production' }))
      .post('/api/webhooks/postmark')
      .send({ RecordType: 'Delivered', MessageID: 'known-message' })
      .expect(503);
  });
});
