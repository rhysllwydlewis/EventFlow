'use strict';

const express = require('express');
const request = require('supertest');

const collections = {
  partner_abuse_events: [],
  partner_abuse_appeals: [],
  partner_abuse_overrides: [],
};

function matches(item, query) {
  return Object.entries(query).every(([key, value]) => item[key] === value);
}

const mockDb = {
  read: jest.fn(async collection => collections[collection] || []),
  updateOne: jest.fn(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return false;
    Object.assign(item, update.$set || update);
    return true;
  }),
};
const mockCreateOverride = jest.fn(async ({ reason, adminUserId }) => ({
  id: 'override_1',
  reason,
  adminUserId,
  subjectHash: 'subject-hash',
  expiresAt: '2026-08-01T00:00:00.000Z',
}));
const mockGetConfig = jest.fn(() => ({
  mode: 'enforce',
  retentionDays: 90,
  appealRetentionDays: 180,
  reviewScore: 35,
  blockScore: 70,
  ipWindowHours: 24,
  ipRegistrationMax: 8,
  subnetRegistrationMax: 20,
  browserRegistrationMax: 4,
  deviceNetworkRegistrationMax: 4,
  referralRegistrationMax: 12,
  domainRegistrationMax: 20,
}));

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../middleware/auth', () => ({
  authRequired(req, _res, next) {
    req.user = { id: 'admin_1', role: 'admin' };
    next();
  },
  roleRequired: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../services/partnerRegistrationRiskService', () => ({
  createRegistrationOverride: mockCreateOverride,
  getConfig: mockGetConfig,
}));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const router = require('../../routes/admin-partner-abuse');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/partner-abuse', router);
  return instance;
}

beforeEach(() => {
  Object.values(collections).forEach(items => items.splice(0, items.length));
  jest.clearAllMocks();
  mockDb.read.mockImplementation(async collection => collections[collection] || []);
  mockDb.updateOne.mockImplementation(async (collection, query, update) => {
    const item = (collections[collection] || []).find(candidate => matches(candidate, query));
    if (!item) return false;
    Object.assign(item, update.$set || update);
    return true;
  });
  mockCreateOverride.mockResolvedValue({
    id: 'override_1',
    subjectHash: 'subject-hash',
    reason: 'Reviewed manually with independent evidence.',
    adminUserId: 'admin_1',
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
  delete process.env.PARTNER_ABUSE_IP_REPUTATION_URL;
});

test('lists and filters recent registration risk events', async () => {
  collections.partner_abuse_events.push(
    { id: 'old', outcome: 'created', riskLevel: 'low', createdAt: '2026-07-01T00:00:00.000Z' },
    { id: 'new', outcome: 'blocked', riskLevel: 'high', createdAt: '2026-07-28T00:00:00.000Z' }
  );

  const response = await request(app()).get(
    '/api/admin/partner-abuse/events?outcome=blocked&riskLevel=high&limit=10'
  );

  expect(response.status).toBe(200);
  expect(response.body.total).toBe(1);
  expect(response.body.items).toEqual([expect.objectContaining({ id: 'new' })]);
});

test('lists appeals and updates a reviewed appeal with attributed evidence', async () => {
  collections.partner_abuse_appeals.push({
    id: 'appeal_1',
    status: 'open',
    createdAt: '2026-07-28T00:00:00.000Z',
  });

  const list = await request(app()).get('/api/admin/partner-abuse/appeals?status=open&limit=5');
  expect(list.status).toBe(200);
  expect(list.body.total).toBe(1);

  const update = await request(app()).patch('/api/admin/partner-abuse/appeals/appeal_1').send({
    status: 'accepted',
    internalNote: 'Verified independently and approved after manual review.',
  });
  expect(update.status).toBe(200);
  expect(collections.partner_abuse_appeals[0]).toEqual(
    expect.objectContaining({ status: 'accepted', reviewedBy: 'admin_1' })
  );
});

test('requires a meaningful note when closing an appeal', async () => {
  const response = await request(app())
    .patch('/api/admin/partner-abuse/appeals/missing')
    .send({ status: 'rejected', internalNote: 'too short' });
  expect(response.status).toBe(400);
});

test('creates, lists and revokes temporary registration overrides', async () => {
  const created = await request(app()).post('/api/admin/partner-abuse/overrides').send({
    email: 'reviewed@example.com',
    reason: 'Reviewed manually with sufficient independent identity evidence.',
    expiresInDays: 4,
  });
  expect(created.status).toBe(201);
  expect(mockCreateOverride).toHaveBeenCalledWith(
    expect.objectContaining({
      email: 'reviewed@example.com',
      adminUserId: 'admin_1',
      expiresInDays: 4,
    })
  );

  collections.partner_abuse_overrides.push({
    id: 'override_1',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  const listed = await request(app()).get('/api/admin/partner-abuse/overrides');
  expect(listed.status).toBe(200);
  expect(listed.body.total).toBe(1);

  const revoked = await request(app())
    .patch('/api/admin/partner-abuse/overrides/override_1/revoke')
    .send({ reason: 'New evidence shows the temporary exception should be withdrawn.' });
  expect(revoked.status).toBe(200);
  expect(collections.partner_abuse_overrides[0]).toEqual(
    expect.objectContaining({ revokedBy: 'admin_1', revokeReason: expect.any(String) })
  );
});

test('validates override input and returns non-secret active configuration', async () => {
  const invalid = await request(app()).post('/api/admin/partner-abuse/overrides').send({
    email: 'not-an-email',
    reason: 'Long enough reason but invalid email identity.',
  });
  expect(invalid.status).toBe(400);

  process.env.PARTNER_ABUSE_IP_REPUTATION_URL = 'https://reputation.example/{ip}';
  const config = await request(app()).get('/api/admin/partner-abuse/config');
  expect(config.status).toBe(200);
  expect(config.body).toEqual(
    expect.objectContaining({
      mode: 'enforce',
      blockScore: 70,
      reputationProviderConfigured: true,
    })
  );
  expect(config.body).not.toHaveProperty('hashSecret');
});

test('returns not found for missing appeal and override updates', async () => {
  const appeal = await request(app()).patch('/api/admin/partner-abuse/appeals/missing').send({
    status: 'resolved',
    internalNote: 'Checked all evidence and no matching record was found.',
  });
  expect(appeal.status).toBe(404);

  const override = await request(app())
    .patch('/api/admin/partner-abuse/overrides/missing/revoke')
    .send({ reason: 'Checked the record and confirmed this override no longer exists.' });
  expect(override.status).toBe(404);
});
