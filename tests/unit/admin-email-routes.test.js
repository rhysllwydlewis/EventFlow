'use strict';

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) {
      return res.status(401).json({ ok: false, error: 'auth required' });
    }
    req.user = { id: 'test-user', role };
    return next();
  },
  roleRequired: role => (req, res, next) => {
    if (req.user && req.user.role === role) {
      return next();
    }
    return res.status(403).json({ ok: false, error: 'forbidden' });
  },
}));

jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../services/emailLog.service', () => ({
  listLogs: jest.fn(async query => ({
    items: [{ id: 'email-log-1', to: query.recipient || 'person@example.com', status: 'sent' }],
    pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
  })),
  getLog: jest.fn(async id => ({ id, to: 'person@example.com', events: [] })),
  getSummary: jest.fn(async () => ({
    summary: {
      sent: 1,
      failed: 0,
      delivered: 0,
      bounced: 0,
      opened: 0,
      clicked: 0,
      last24h: 1,
      last7d: 1,
    },
    lastWebhookAt: null,
  })),
}));

const express = require('express');
const request = require('supertest');
const emailLogs = require('../../routes/admin-email-logs');
const emailCentre = require('../../routes/admin-email-centre');

function app() {
  const instance = express();
  instance.use('/api/admin/email-logs', emailLogs);
  instance.use('/api/admin/email-centre', emailCentre);
  return instance;
}

describe('admin email routes', () => {
  test('unauthenticated users cannot access email logs', async () => {
    await request(app()).get('/api/admin/email-logs').expect(401);
  });

  test('non-admin users cannot access email logs', async () => {
    await request(app()).get('/api/admin/email-logs').set('x-test-role', 'customer').expect(403);
  });

  test('admin users can access email log list, detail and summary', async () => {
    await request(app())
      .get('/api/admin/email-logs?recipient=person@example.com')
      .set('x-test-role', 'admin')
      .expect(200);
    await request(app())
      .get('/api/admin/email-logs/email-log-1')
      .set('x-test-role', 'admin')
      .expect(200);
    await request(app())
      .get('/api/admin/email-centre/summary')
      .set('x-test-role', 'admin')
      .expect(200);
  });
});
