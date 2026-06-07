'use strict';

jest.mock('../../config/email', () => ({
  sendMail: jest.fn().mockResolvedValue({ status: 'sent' }),
}));

jest.mock('../../utils/postmark', () => ({
  FROM_NOREPLY: 'noreply@example.com',
  FROM_HELLO: 'hello@example.com',
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

const emailConfig = require('../../config/email');
const emailService = require('../../services/email.service');

describe('email.service critical auth email options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks verification emails as critical transactional delivery attempts', async () => {
    await emailService.sendVerificationEmail(
      'user@example.com',
      'User',
      'https://example.com/verify?token=secret'
    );

    expect(emailConfig.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        template: 'verification',
        messageStream: 'outbound',
        criticalDelivery: true,
        tags: ['verification', 'transactional'],
      })
    );
  });

  it('marks password reset emails as critical transactional delivery attempts', async () => {
    await emailService.sendPasswordResetEmail(
      'user@example.com',
      'User',
      'https://example.com/reset-password?token=secret'
    );

    expect(emailConfig.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        template: 'password-reset',
        messageStream: 'password-reset',
        criticalDelivery: true,
        tags: ['password-reset', 'transactional'],
      })
    );
  });
});
