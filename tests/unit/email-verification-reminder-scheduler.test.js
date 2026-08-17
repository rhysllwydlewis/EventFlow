'use strict';

/**
 * services/emailVerificationReminderScheduler.js
 *
 * Regression coverage for: unverified accounts that never come back to
 * click "resend verification" were never nudged at all. This tests the
 * eligibility logic (day-3/day-7 cadence, opt-outs, suppression, OAuth
 * exclusion) and the run loop against a mocked db-unified/postmark.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../../utils/postmark', () => ({
  sendVerificationEmail: jest.fn(),
}));
jest.mock('../../utils/token', () => ({
  generateVerificationToken: jest.fn(() => 'fake-jwt-token'),
}));
jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn(() => ({
    cancel: jest.fn(),
    nextInvocation: jest.fn(() => new Date('2026-01-01T09:40:00.000Z')),
  })),
}));

const schedule = require('node-schedule');
const dbUnified = require('../../db-unified');
const postmark = require('../../utils/postmark');
const scheduler = require('../../services/emailVerificationReminderScheduler');
const { isEligibleForReminder, runVerificationReminders } = scheduler;

function buildUser(overrides = {}) {
  return {
    id: 'user_1',
    email: 'user@example.com',
    role: 'customer',
    signupMethod: 'email_password',
    verificationMethod: 'pending',
    createdAt: new Date(Date.now() - 4 * ONE_DAY_MS).toISOString(),
    ...overrides,
  };
}

describe('isEligibleForReminder', () => {
  const now = Date.now();

  it('is eligible 3+ days after signup with no reminders sent yet', () => {
    expect(isEligibleForReminder(buildUser(), now)).toBe(true);
  });

  it('is not eligible before 3 days have passed', () => {
    const user = buildUser({ createdAt: new Date(now - 1 * ONE_DAY_MS).toISOString() });
    expect(isEligibleForReminder(user, now)).toBe(false);
  });

  it('is not eligible once verified', () => {
    expect(isEligibleForReminder(buildUser({ verified: true }), now)).toBe(false);
    expect(isEligibleForReminder(buildUser({ emailVerified: true }), now)).toBe(false);
  });

  it('is not eligible for a globally-suppressed address', () => {
    expect(isEligibleForReminder(buildUser({ emailUnsubscribed: true }), now)).toBe(false);
  });

  it('is not eligible when the user opted out of verification reminders specifically', () => {
    expect(isEligibleForReminder(buildUser({ verificationReminderOptOut: true }), now)).toBe(false);
  });

  it('excludes OAuth-provisioned accounts — their email is already provider-verified', () => {
    const user = buildUser({ signupMethod: 'google', verificationMethod: 'google_verified_email' });
    expect(isEligibleForReminder(user, now)).toBe(false);
  });

  it('is not eligible again until 7 days have passed after one reminder was sent', () => {
    const user = buildUser({
      createdAt: new Date(now - 5 * ONE_DAY_MS).toISOString(),
      verificationReminderState: { remindersSent: [new Date(now - 2 * ONE_DAY_MS).toISOString()] },
    });
    expect(isEligibleForReminder(user, now)).toBe(false);
  });

  it('is eligible for the second reminder once 7 days have passed', () => {
    const user = buildUser({
      createdAt: new Date(now - 8 * ONE_DAY_MS).toISOString(),
      verificationReminderState: { remindersSent: [new Date(now - 5 * ONE_DAY_MS).toISOString()] },
    });
    expect(isEligibleForReminder(user, now)).toBe(true);
  });

  it('is not eligible after the two-reminder cap is reached', () => {
    const user = buildUser({
      createdAt: new Date(now - 20 * ONE_DAY_MS).toISOString(),
      verificationReminderState: {
        remindersSent: [
          new Date(now - 15 * ONE_DAY_MS).toISOString(),
          new Date(now - 8 * ONE_DAY_MS).toISOString(),
        ],
      },
    });
    expect(isEligibleForReminder(user, now)).toBe(false);
  });
});

describe('runVerificationReminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postmark.sendVerificationEmail.mockResolvedValue({ sentAt: '2026-01-01T00:00:00.000Z' });
    dbUnified.updateOne.mockResolvedValue(true);
  });

  it('sends to eligible users and records reminder state', async () => {
    dbUnified.read.mockResolvedValue([buildUser()]);

    const result = await runVerificationReminders();

    expect(result).toEqual({ scanned: 1, eligible: 1, sent: 1, errors: 0 });
    expect(postmark.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user_1' }),
      'fake-jwt-token'
    );
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'users',
      { id: 'user_1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          verificationToken: 'fake-jwt-token',
          verificationReminderState: expect.objectContaining({
            remindersSent: expect.arrayContaining([expect.any(String)]),
          }),
        }),
      })
    );
  });

  it('skips ineligible users without sending', async () => {
    dbUnified.read.mockResolvedValue([buildUser({ verified: true })]);

    const result = await runVerificationReminders();

    expect(result).toEqual({ scanned: 1, eligible: 0, sent: 0, errors: 0 });
    expect(postmark.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('counts a send failure as an error without stopping the run', async () => {
    dbUnified.read.mockResolvedValue([
      buildUser(),
      buildUser({ id: 'user_2', email: 'u2@example.com' }),
    ]);
    postmark.sendVerificationEmail
      .mockRejectedValueOnce(new Error('postmark down'))
      .mockResolvedValueOnce({ sentAt: '2026-01-01T00:00:00.000Z' });

    const result = await runVerificationReminders();

    expect(result).toEqual({ scanned: 2, eligible: 2, sent: 1, errors: 1 });
  });
});

describe('start()/stop()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.EMAIL_VERIFICATION_REMINDER_ENABLED;

  afterEach(() => {
    jest.clearAllMocks();
    scheduler.stop();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnabled === undefined) {
      delete process.env.EMAIL_VERIFICATION_REMINDER_ENABLED;
    } else {
      process.env.EMAIL_VERIFICATION_REMINDER_ENABLED = originalEnabled;
    }
  });

  it('is disabled by default outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.EMAIL_VERIFICATION_REMINDER_ENABLED;

    const result = scheduler.start();

    expect(schedule.scheduleJob).not.toHaveBeenCalled();
    expect(result).toEqual({ scheduled: false, nextRun: null });
  });

  it('schedules a daily job when explicitly enabled', () => {
    process.env.EMAIL_VERIFICATION_REMINDER_ENABLED = 'true';

    const result = scheduler.start();

    expect(schedule.scheduleJob).toHaveBeenCalledWith(
      { rule: '40 9 * * *', tz: 'Etc/UTC' },
      expect.any(Function)
    );
    expect(result).toEqual({ scheduled: true, nextRun: new Date('2026-01-01T09:40:00.000Z') });
  });

  it('stop() cancels the scheduled job', () => {
    process.env.EMAIL_VERIFICATION_REMINDER_ENABLED = 'true';
    scheduler.start();
    const job = schedule.scheduleJob.mock.results[0].value;

    scheduler.stop();

    expect(job.cancel).toHaveBeenCalledTimes(1);
    expect(() => scheduler.stop()).not.toThrow();
  });
});
