'use strict';

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    const role = req.get('x-test-role');
    if (!role) {
      return res.status(401).json({ error: 'auth required' });
    }
    req.user = { id: 'test-user', role };
    return next();
  },
  roleRequired: role => (req, res, next) =>
    req.user && req.user.role === role ? next() : res.status(403).json({ error: 'forbidden' }),
}));

jest.mock('../../middleware/rateLimits', () => ({
  apiLimiter: (_req, _res, next) => next(),
}));

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
}));

jest.mock('../../services/emailLog.service', () => ({
  getSummary: jest.fn(async () => ({ summary: {}, lastWebhookAt: null })),
}));

jest.mock('../../services/verificationProvenance.service', () => ({
  getVerificationIntegrity: jest.fn(async () => ({ summary: {} })),
  readVerificationLogs: jest.fn(async () => []),
  summariseUser: jest.fn(() => ({})),
}));

jest.mock('../../utils/postmark', () => ({
  getPostmarkStatus: jest.fn(() => ({ enabled: true, apiKeyConfigured: true })),
}));

jest.mock('../../config/email', () => ({ EMAIL_ENABLED: true }));

const express = require('express');
const request = require('supertest');
const db = require('../../db-unified');
const router = require('../../routes/admin-email-centre');

function app() {
  const instance = express();
  instance.use('/api/admin/email-centre', router);
  return instance;
}

describe('admin review request operations route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.read.mockResolvedValue([
      {
        id: 'request-1',
        supplierId: 'supplier-1',
        supplierName: 'Moor Audio',
        customerEmail: 'customer@example.com',
        status: 'failed',
        tokenHash: 'never-return-this',
        providerMessageId: 'provider-message',
        emailLogId: 'email-log-1',
        lastError: 'Bounce received',
        createdAt: '2026-07-16T10:00:00.000Z',
      },
    ]);
  });

  test('requires admin access', async () => {
    await request(app()).get('/api/admin/email-centre/review-requests').expect(401);
    await request(app())
      .get('/api/admin/email-centre/review-requests')
      .set('x-test-role', 'supplier')
      .expect(403);
  });

  test('returns filterable operations data without invitation tokens', async () => {
    const response = await request(app())
      .get('/api/admin/email-centre/review-requests?supplier=moor&status=failed')
      .set('x-test-role', 'admin')
      .expect(200);

    expect(response.body.summary).toEqual(
      expect.objectContaining({ total: 1, failed: 1, deliveryIssues: 1 })
    );
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        supplierName: 'Moor Audio',
        providerMessageId: 'provider-message',
        emailLogId: 'email-log-1',
        retryable: true,
      })
    );
    expect(JSON.stringify(response.body)).not.toContain('never-return-this');
  });
});
