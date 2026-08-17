'use strict';

/**
 * services/newsletterCadenceScheduler.js
 *
 * Regression coverage for: routes/admin-campaigns.js was 100% admin-
 * triggered, with no recurring cadence — this adds a settings-driven
 * automated send and tests the "is today the day" gating logic plus the
 * run path that calls the shared sendCampaign().
 */

jest.mock('../../db-unified', () => ({
  read: jest.fn(),
  writeAndVerify: jest.fn(),
}));
jest.mock('../../config/email', () => ({ EMAIL_ENABLED: true }));

const mockSendCampaign = jest.fn();
jest.mock('../../routes/admin-campaigns', () => ({
  sendCampaign: (...args) => mockSendCampaign(...args),
}));
jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn(() => ({
    cancel: jest.fn(),
    nextInvocation: jest.fn(() => new Date('2026-01-01T08:30:00.000Z')),
  })),
}));

const schedule = require('node-schedule');
const dbUnified = require('../../db-unified');
const scheduler = require('../../services/newsletterCadenceScheduler');
const { isDueToday, runNewsletterCadence } = scheduler;

describe('isDueToday', () => {
  it('is false when automation is not enabled', () => {
    const now = new Date('2026-03-02T09:00:00.000Z'); // a Monday
    expect(
      isDueToday(
        { enabled: false, cadence: 'weekly', dayOfWeek: 1, subject: 'x', bodyHtml: 'x' },
        now
      )
    ).toBe(false);
  });

  it('is false when subject or bodyHtml is missing', () => {
    const now = new Date('2026-03-02T09:00:00.000Z');
    expect(isDueToday({ enabled: true, cadence: 'weekly', dayOfWeek: 1 }, now)).toBe(false);
  });

  it('is true for a weekly cadence on the matching day of week', () => {
    const now = new Date('2026-03-02T09:00:00.000Z'); // Monday
    expect(
      isDueToday(
        { enabled: true, cadence: 'weekly', dayOfWeek: 1, subject: 'x', bodyHtml: 'x' },
        now
      )
    ).toBe(true);
  });

  it('is false for a weekly cadence on a non-matching day', () => {
    const now = new Date('2026-03-03T09:00:00.000Z'); // Tuesday
    expect(
      isDueToday(
        { enabled: true, cadence: 'weekly', dayOfWeek: 1, subject: 'x', bodyHtml: 'x' },
        now
      )
    ).toBe(false);
  });

  it('is true for a monthly cadence on the matching day of month', () => {
    const now = new Date('2026-03-15T09:00:00.000Z');
    expect(
      isDueToday(
        { enabled: true, cadence: 'monthly', dayOfMonth: 15, subject: 'x', bodyHtml: 'x' },
        now
      )
    ).toBe(true);
  });

  it('clamps a monthly day-of-month beyond the current month length to the last real day', () => {
    const now = new Date('2026-04-30T09:00:00.000Z'); // April has 30 days
    expect(
      isDueToday(
        { enabled: true, cadence: 'monthly', dayOfMonth: 31, subject: 'x', bodyHtml: 'x' },
        now
      )
    ).toBe(true);
  });

  it('is false when already sent today', () => {
    const now = new Date('2026-03-02T09:00:00.000Z');
    expect(
      isDueToday(
        {
          enabled: true,
          cadence: 'weekly',
          dayOfWeek: 1,
          subject: 'x',
          bodyHtml: 'x',
          lastSentDateKey: '2026-03-02',
        },
        now
      )
    ).toBe(false);
  });
});

describe('runNewsletterCadence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbUnified.writeAndVerify.mockResolvedValue(true);
  });

  it('skips when not due today', async () => {
    dbUnified.read.mockResolvedValue({ newsletterAutomation: { enabled: false } });

    const result = await runNewsletterCadence();

    expect(result).toEqual({ skipped: true, reason: 'not-due' });
    expect(mockSendCampaign).not.toHaveBeenCalled();
  });

  it('sends via the shared sendCampaign() and persists lastSentAt when due', async () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    dbUnified.read.mockResolvedValue({
      newsletterAutomation: {
        enabled: true,
        cadence: 'weekly',
        dayOfWeek,
        subject: 'Weekly update',
        bodyHtml: '<p>hi</p>',
        audience: 'both',
      },
    });
    mockSendCampaign.mockResolvedValue({ sent: 10, failed: 1, total: 11 });

    const result = await runNewsletterCadence();

    expect(result).toEqual({ skipped: false, sent: 10, failed: 1, total: 11 });
    expect(mockSendCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'both', subject: 'Weekly update' })
    );
    expect(dbUnified.writeAndVerify).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({
        newsletterAutomation: expect.objectContaining({
          lastRunStats: { sent: 10, failed: 1, total: 11, trigger: 'scheduler' },
        }),
      })
    );
  });

  it('skips without sending when EMAIL_ENABLED is false, even if due today', async () => {
    // sendCampaign() itself doesn't check EMAIL_ENABLED — only the manual
    // /send route did, as a route-level guard this scheduler bypasses by
    // calling sendCampaign() directly. Regression coverage for that gap.
    jest.resetModules();
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../config/email', () => ({ EMAIL_ENABLED: false }));
    jest.doMock('../../routes/admin-campaigns', () => ({
      sendCampaign: (...args) => mockSendCampaign(...args),
    }));
    const isolatedScheduler = require('../../services/newsletterCadenceScheduler');

    const now = new Date();
    dbUnified.read.mockResolvedValue({
      newsletterAutomation: {
        enabled: true,
        cadence: 'weekly',
        dayOfWeek: now.getUTCDay(),
        subject: 'Weekly update',
        bodyHtml: '<p>hi</p>',
      },
    });

    const result = await isolatedScheduler.runNewsletterCadence();

    expect(result).toEqual({ skipped: true, reason: 'email-disabled' });
    expect(mockSendCampaign).not.toHaveBeenCalled();
    expect(dbUnified.writeAndVerify).not.toHaveBeenCalled();
  });
});

describe('start()/stop()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.NEWSLETTER_CADENCE_ENABLED;

  afterEach(() => {
    jest.clearAllMocks();
    scheduler.stop();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnabled === undefined) {
      delete process.env.NEWSLETTER_CADENCE_ENABLED;
    } else {
      process.env.NEWSLETTER_CADENCE_ENABLED = originalEnabled;
    }
  });

  it('is disabled by default outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.NEWSLETTER_CADENCE_ENABLED;

    const result = scheduler.start();

    expect(schedule.scheduleJob).not.toHaveBeenCalled();
    expect(result).toEqual({ scheduled: false, nextRun: null });
  });

  it('schedules a daily job when explicitly enabled', () => {
    process.env.NEWSLETTER_CADENCE_ENABLED = 'true';

    const result = scheduler.start();

    expect(schedule.scheduleJob).toHaveBeenCalledWith(
      { rule: '30 8 * * *', tz: 'Etc/UTC' },
      expect.any(Function)
    );
    expect(result).toEqual({ scheduled: true, nextRun: new Date('2026-01-01T08:30:00.000Z') });
  });

  it('stop() cancels the scheduled job', () => {
    process.env.NEWSLETTER_CADENCE_ENABLED = 'true';
    scheduler.start();
    const job = schedule.scheduleJob.mock.results[0].value;

    scheduler.stop();

    expect(job.cancel).toHaveBeenCalledTimes(1);
    expect(() => scheduler.stop()).not.toThrow();
  });
});
