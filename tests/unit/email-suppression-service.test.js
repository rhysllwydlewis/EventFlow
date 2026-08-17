'use strict';

/**
 * services/emailSuppression.service.js
 *
 * Includes regression coverage for a CodeQL log-injection finding: `email`
 * (and, in principle, `reason`) come from the Postmark webhook payload.
 * They're logged as structured metadata rather than interpolated into the
 * log message string, so a crafted value can't forge additional log
 * entries by embedding CR/LF into the message itself.
 */

jest.mock('../../db-unified', () => ({
  updateOne: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
}));

const dbUnified = require('../../db-unified');
const logger = require('../../utils/logger');
const {
  suppressEmail,
  applyWebhookSuppression,
  REASON_HARD_BOUNCE,
} = require('../../services/emailSuppression.service');

describe('emailSuppression.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.updateOne.mockResolvedValue(true);
  });

  it('suppresses a normal email and logs it', async () => {
    await suppressEmail('user@example.com', REASON_HARD_BOUNCE);

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { email: 'user@example.com' },
      expect.objectContaining({ $set: expect.objectContaining({ emailUnsubscribed: true }) })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ email: 'user@example.com' })
    );
  });

  it('logs a crafted email as structured metadata, not interpolated into the message, so it cannot forge log entries', async () => {
    const injected = 'user@example.com\n[fake] Admin login succeeded';

    await suppressEmail(injected, REASON_HARD_BOUNCE);

    const [loggedMessage, loggedMeta] = logger.warn.mock.calls[0];
    expect(loggedMessage).not.toContain('\n');
    expect(loggedMessage).not.toContain('\r');
    expect(loggedMeta.email).toBe(injected.toLowerCase());
  });

  it('does not throw and returns false/false for an empty email', async () => {
    const result = await suppressEmail('', REASON_HARD_BOUNCE);

    expect(result).toEqual({ usersUpdated: false, newsletterUpdated: false });
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  it('applyWebhookSuppression passes the raw payload email through to suppression', async () => {
    await applyWebhookSuppression({
      RecordType: 'Bounced',
      Type: 'HardBounce',
      Email: 'bounced@example.com',
    });

    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { email: 'bounced@example.com' },
      expect.anything()
    );
  });
});
