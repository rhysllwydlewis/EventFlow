'use strict';

/**
 * services/emailSuppression.service.js
 *
 * Includes regression coverage for a CodeQL log-injection finding: `email`
 * (and, in principle, `reason`) come from the Postmark webhook payload and
 * flow directly into a log line. A crafted value containing CR/LF could
 * forge additional log entries if interpolated raw.
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
      expect.stringContaining('user@example.com'),
      expect.anything()
    );
  });

  it('strips newlines from the email before logging, so a crafted value cannot forge log entries', async () => {
    const injected = 'user@example.com\n[fake] Admin login succeeded';

    await suppressEmail(injected, REASON_HARD_BOUNCE);

    const loggedMessage = logger.warn.mock.calls[0][0];
    expect(loggedMessage).not.toContain('\n');
    expect(loggedMessage).not.toContain('\r');
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
