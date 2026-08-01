'use strict';

const express = require('express');
const request = require('supertest');

const mockDb = {
  read: jest.fn(async () => ({})),
  findOne: jest.fn(async () => null),
  insertOne: jest.fn(async (_collection, record) => record),
  deleteOne: jest.fn(async () => ({ deleted: 1 })),
};
const mockCreatePartner = jest.fn(async userId => ({ id: 'prt_1', userId, refCode: 'P_TEST' }));
const mockCompleteRegistrationRisk = jest.fn(async () => ({ id: 'event_1' }));
const mockRegistrationRiskGuard = jest.fn(() => (req, _res, next) => {
  req.partnerRegistrationRisk = {
    id: 'risk_1',
    role: 'partner',
    score: 0,
    riskLevel: 'low',
    action: 'allow',
    signalCodes: [],
    signals: [],
    hashes: {},
  };
  next();
});
const mockSendVerificationEmail = jest.fn(async () => ({ MessageID: 'verify_1' }));

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../store', () => ({ uid: jest.fn(() => 'usr_1') }));
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
  metadataFromSendResult: jest.fn(() => ({})),
}));
jest.mock('../../utils/token', () => ({
  generateVerificationToken: jest.fn(() => 'verify-token'),
}));
jest.mock('../../utils/postmark', () => ({
  FROM_HELLO: 'hello@example.com',
  sendVerificationEmail: mockSendVerificationEmail,
  sendMail: jest.fn(async () => ({ ok: true })),
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

function body(captchaToken = 'valid-captcha') {
  return {
    firstName: 'Pat',
    lastName: 'Partner',
    email: 'pat@example.com',
    password: 'Password123',
    location: 'Cardiff',
    captchaToken,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  router.initializeDependencies({});
  mockDb.read.mockResolvedValue({});
  mockDb.findOne.mockResolvedValue(null);
  mockDb.insertOne.mockImplementation(async (_collection, record) => record);
  mockCreatePartner.mockResolvedValue({ id: 'prt_1', refCode: 'P_TEST' });
  mockCompleteRegistrationRisk.mockResolvedValue({ id: 'event_1' });
  mockSendVerificationEmail.mockResolvedValue({ MessageID: 'verify_1' });
});

test('rejects partner registration when ALTCHA verification fails', async () => {
  const verifyAltcha = jest.fn(async () => ({
    success: false,
    error: 'ALTCHA verification failed',
  }));
  router.initializeDependencies({ verifyAltcha });

  const response = await request(app()).post('/api/partner/register').send(body('bad-captcha'));

  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ code: 'CAPTCHA_VERIFICATION_FAILED' });
  expect(verifyAltcha).toHaveBeenCalledWith('bad-captcha');
  expect(mockDb.insertOne).not.toHaveBeenCalled();
  expect(mockCreatePartner).not.toHaveBeenCalled();
});

test('accepts a verified ALTCHA payload and continues secure registration', async () => {
  const verifyAltcha = jest.fn(async () => ({ success: true }));
  router.initializeDependencies({ verifyAltcha });

  const response = await request(app()).post('/api/partner/register').send(body());

  expect(response.status).toBe(201);
  expect(response.body.requiresVerification).toBe(true);
  expect(verifyAltcha).toHaveBeenCalledWith('valid-captcha');
  expect(mockDb.insertOne).toHaveBeenCalledWith(
    'users',
    expect.objectContaining({ verified: false })
  );
});

test('fails closed when the CAPTCHA verifier is unavailable in production', async () => {
  const previousEnv = process.env.NODE_ENV;
  const previousKey = process.env.ALTCHA_HMAC_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.ALTCHA_HMAC_KEY;
  router.initializeDependencies({});
  try {
    const response = await request(app()).post('/api/partner/register').send(body());
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CAPTCHA_VERIFIER_UNAVAILABLE');
    expect(mockDb.insertOne).not.toHaveBeenCalledWith('users', expect.anything());
  } finally {
    process.env.NODE_ENV = previousEnv;
    if (previousKey === undefined) delete process.env.ALTCHA_HMAC_KEY;
    else process.env.ALTCHA_HMAC_KEY = previousKey;
  }
});

test('partner frontend includes self-hosted ALTCHA and sends captchaToken', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(process.cwd(), 'public/partner/index.html'), 'utf8');
  const js = fs.readFileSync(
    path.join(process.cwd(), 'public/assets/js/pages/partner-init.js'),
    'utf8'
  );

  expect(html).toContain('id="partner-reg-altcha-widget"');
  expect(html).toContain('challengeurl="/api/v1/altcha/challenge"');
  expect(html).toContain('/assets/js/vendor/altcha.min.js');
  expect(js).toContain('captchaToken');
  expect(js).toContain('Please complete the verification challenge before creating your account.');
});
