'use strict';

const express = require('express');
const request = require('supertest');

const mockUsers = [];
const mockDb = {
  read: jest.fn(async () => ({})),
  findOne: jest.fn(async (collection, query) => {
    if (collection !== 'users') return null;
    return (
      mockUsers.find(user => Object.entries(query).every(([key, value]) => user[key] === value)) ||
      null
    );
  }),
  insertOne: jest.fn(async (collection, record) => {
    if (collection === 'users') mockUsers.push(record);
    return record;
  }),
  deleteOne: jest.fn(async (collection, query) => {
    if (collection !== 'users') return null;
    const index = mockUsers.findIndex(user => user.id === query.id);
    if (index < 0) return null;
    return mockUsers.splice(index, 1)[0];
  }),
  updateOne: jest.fn(async () => true),
};
const mockCreatePartner = jest.fn(async userId => ({
  id: 'prt_1',
  userId,
  refCode: 'P_TEST',
  status: 'active',
}));
const mockSendVerificationEmail = jest.fn(async () => ({
  provider: 'postmark',
  MessageID: 'msg_1',
}));
const mockSendMail = jest.fn(async () => ({ ok: true }));
const mockCompleteRegistrationRisk = jest.fn(async () => ({ id: 'event_1' }));
const mockRegistrationRiskGuard = jest.fn(() => (req, _res, next) => {
  req.partnerRegistrationRisk = {
    id: 'risk_1',
    score: 0,
    riskLevel: 'low',
    action: 'allow',
    signalCodes: [],
    signals: [],
    hashes: {},
  };
  next();
});

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: jest.fn(() => 'usr_partner_1') }));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/rateLimits', () => ({
  registrationLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/validation', () => ({ passwordOk: jest.fn(() => true) }));
jest.mock('../../services/partnerService', () => ({ createPartner: mockCreatePartner }));
jest.mock('../../services/partnerRegistrationRiskService', () => ({
  registrationRiskGuard: mockRegistrationRiskGuard,
  completeRegistrationRisk: mockCompleteRegistrationRisk,
}));
jest.mock('../../services/userProvenance.service', () => ({
  emailPasswordPendingProvenance: jest.fn(() => ({ verificationMethod: 'pending' })),
  metadataFromSendResult: jest.fn(() => ({ verificationEmailSentAt: '2026-07-28T10:00:00.000Z' })),
}));
jest.mock('../../utils/token', () => ({
  generateVerificationToken: jest.fn(() => 'verification-token'),
}));
jest.mock('../../utils/postmark', () => ({
  FROM_HELLO: 'hello@example.com',
  sendVerificationEmail: mockSendVerificationEmail,
  sendMail: mockSendMail,
}));
jest.mock('../../services/notifyAdmins.service', () => ({
  notifyAdmins: jest.fn(async () => undefined),
}));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hashed-password') }));

const router = require('../../routes/partner-registration-secure');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/partner', router);
  return instance;
}

function registrationBody() {
  return {
    firstName: 'Pat',
    lastName: 'Partner',
    email: 'pat@example.com',
    password: 'Password123',
    location: 'Cardiff',
    company: 'Partner Co',
  };
}

beforeEach(() => {
  mockUsers.splice(0, mockUsers.length);
  jest.clearAllMocks();
  router.initializeDependencies({});
  mockDb.read.mockResolvedValue({});
  mockDb.insertOne.mockImplementation(async (collection, record) => {
    if (collection === 'users') mockUsers.push(record);
    return record;
  });
  mockDb.updateOne.mockResolvedValue(true);
  mockCompleteRegistrationRisk.mockResolvedValue({ id: 'event_1' });
  mockCreatePartner.mockResolvedValue({ id: 'prt_1', refCode: 'P_TEST', status: 'active' });
  mockSendVerificationEmail.mockResolvedValue({ provider: 'postmark', MessageID: 'msg_1' });
});

test('creates partners unverified and requires email verification before login', async () => {
  const response = await request(app()).post('/api/partner/register').send(registrationBody());

  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ ok: true, requiresVerification: true });
  expect(response.headers['set-cookie']).toBeUndefined();
  expect(mockUsers[0]).toMatchObject({
    email: 'pat@example.com',
    role: 'partner',
    verified: false,
    emailVerified: false,
    verificationToken: 'verification-token',
  });
  expect(mockSendVerificationEmail).toHaveBeenCalled();
  expect(mockCompleteRegistrationRisk).toHaveBeenCalledWith(expect.any(Object), 'usr_partner_1');
  expect(mockCreatePartner).toHaveBeenCalledWith('usr_partner_1');
});

test('does not create an account when the verification email cannot be sent', async () => {
  mockSendVerificationEmail.mockRejectedValueOnce(new Error('mail unavailable'));
  const response = await request(app()).post('/api/partner/register').send(registrationBody());
  expect(response.status).toBe(500);
  expect(mockUsers).toHaveLength(0);
  expect(mockCreatePartner).not.toHaveBeenCalled();
});

test('rolls back the user when risk metadata cannot be persisted', async () => {
  mockCompleteRegistrationRisk.mockRejectedValueOnce(new Error('risk store unavailable'));
  const response = await request(app()).post('/api/partner/register').send(registrationBody());
  expect(response.status).toBe(503);
  expect(mockUsers).toHaveLength(0);
  expect(mockCreatePartner).not.toHaveBeenCalled();
});

test('rolls back user and reconciles the risk event if partner creation fails', async () => {
  mockCreatePartner.mockRejectedValueOnce(new Error('partner insert failed'));
  const response = await request(app()).post('/api/partner/register').send(registrationBody());

  expect(response.status).toBe(500);
  expect(mockUsers).toHaveLength(0);
  expect(mockDb.updateOne).toHaveBeenCalledWith(
    'partner_abuse_events',
    { id: 'event_1' },
    {
      $set: expect.objectContaining({
        outcome: 'rolled_back',
        userId: 'usr_partner_1',
        rollbackReason: 'partner_record_creation_failed',
      }),
    }
  );
});
