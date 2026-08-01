'use strict';

const express = require('express');
const request = require('supertest');

const mockCreateAppeal = jest.fn(async ({ email, name, message }) => ({
  id: 'appeal_1',
  email,
  name,
  message,
}));
const mockNotifyAdmins = jest.fn(async () => undefined);

jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/rateLimits', () => ({
  registrationLimiter: (_req, _res, next) => next(),
}));
jest.mock('../../services/partnerRegistrationRiskService', () => ({
  createAppeal: mockCreateAppeal,
}));
jest.mock('../../services/notifyAdmins.service', () => ({ notifyAdmins: mockNotifyAdmins }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const router = require('../../routes/partner-abuse-appeals');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/partner', router);
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateAppeal.mockResolvedValue({ id: 'appeal_1' });
  mockNotifyAdmins.mockResolvedValue(undefined);
});

test('validates appeal email and context length', async () => {
  const badEmail = await request(app()).post('/api/partner/abuse-appeals').send({
    email: 'not-an-email',
    message: 'This message is comfortably long enough to validate.',
  });
  expect(badEmail.status).toBe(400);

  const shortMessage = await request(app()).post('/api/partner/abuse-appeals').send({
    email: 'person@example.com',
    message: 'too short',
  });
  expect(shortMessage.status).toBe(400);
  expect(mockCreateAppeal).not.toHaveBeenCalled();
});

test('records a valid appeal and notifies administrators without exposing the email in the alert', async () => {
  const response = await request(app()).post('/api/partner/abuse-appeals').send({
    email: 'person@example.com',
    name: 'Pat Person',
    message: 'I believe the automated registration block was a false positive.',
  });

  expect(response.status).toBe(201);
  expect(response.body).toEqual(expect.objectContaining({ ok: true, appealId: 'appeal_1' }));
  expect(mockCreateAppeal).toHaveBeenCalledWith({
    email: 'person@example.com',
    name: 'Pat Person',
    message: 'I believe the automated registration block was a false positive.',
  });
  expect(mockNotifyAdmins).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Partner anti-abuse appeal received',
      metadata: { appealId: 'appeal_1' },
    })
  );
  expect(JSON.stringify(mockNotifyAdmins.mock.calls[0][0])).not.toContain('person@example.com');
});

test('returns a safe retry response if appeal persistence fails', async () => {
  mockCreateAppeal.mockRejectedValueOnce(new Error('database unavailable'));

  const response = await request(app()).post('/api/partner/abuse-appeals').send({
    email: 'person@example.com',
    name: 'Pat Person',
    message: 'I believe the automated registration block was a false positive.',
  });

  expect(response.status).toBe(500);
  expect(response.body.error).toMatch(/Unable to submit appeal/i);
  expect(mockNotifyAdmins).not.toHaveBeenCalled();
});
