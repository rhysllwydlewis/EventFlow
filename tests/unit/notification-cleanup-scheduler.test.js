'use strict';

jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn(() => ({
    cancel: jest.fn(),
    nextInvocation: jest.fn(() => new Date('2026-01-01T03:20:00.000Z')),
  })),
}));

jest.mock('../../db', () => ({
  getDb: jest.fn(),
}));

const mockCleanupExpired = jest.fn();
const mockCleanupStale = jest.fn();

jest.mock('../../services/notification.service', () =>
  jest.fn().mockImplementation(() => ({
    cleanupExpired: mockCleanupExpired,
    cleanupStale: mockCleanupStale,
  }))
);

jest.mock('../../services/schedulerLock.service', () => ({
  withLock: jest.fn((jobKey, fn) => fn()),
}));

const schedule = require('node-schedule');
const mongoDb = require('../../db');
const schedulerLock = require('../../services/schedulerLock.service');
const scheduler = require('../../services/notificationCleanupScheduler');

describe('services/notificationCleanupScheduler.js', () => {
  afterEach(() => {
    jest.clearAllMocks();
    scheduler.stop();
  });

  describe('run()', () => {
    it('deletes expired and stale notifications when the DB is available', async () => {
      mongoDb.getDb.mockResolvedValue({ collection: jest.fn() });
      mockCleanupExpired.mockResolvedValue(3);
      mockCleanupStale.mockResolvedValue(7);

      const result = await scheduler.run('startup-catch-up');

      expect(result).toEqual({
        deleted: 10,
        expiredDeleted: 3,
        staleDeleted: 7,
        skipped: false,
      });
      expect(mockCleanupExpired).toHaveBeenCalledTimes(1);
      expect(mockCleanupStale).toHaveBeenCalledTimes(1);
    });

    it('skips cleanly when the database is not connected', async () => {
      mongoDb.getDb.mockResolvedValue(null);

      const result = await scheduler.run();

      expect(result).toEqual({
        deleted: 0,
        skipped: true,
        reason: 'Database not connected',
      });
      expect(mockCleanupExpired).not.toHaveBeenCalled();
    });

    it('returns a zeroed result instead of throwing when the DB connection errors', async () => {
      mongoDb.getDb.mockRejectedValue(new Error('connection refused'));

      const result = await scheduler.run();

      expect(result).toEqual({ deleted: 0, error: 'connection refused' });
    });

    it('returns a zeroed result instead of throwing when cleanup itself errors', async () => {
      mongoDb.getDb.mockResolvedValue({ collection: jest.fn() });
      mockCleanupExpired.mockRejectedValue(new Error('mongo write failed'));

      const result = await scheduler.run();

      expect(result).toEqual({ deleted: 0, error: 'mongo write failed' });
    });
  });

  describe('start()/stop()', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnabled = process.env.NOTIFICATION_CLEANUP_ENABLED;
    const originalCron = process.env.NOTIFICATION_CLEANUP_CRON;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalEnabled === undefined) {
        delete process.env.NOTIFICATION_CLEANUP_ENABLED;
      } else {
        process.env.NOTIFICATION_CLEANUP_ENABLED = originalEnabled;
      }
      if (originalCron === undefined) {
        delete process.env.NOTIFICATION_CLEANUP_CRON;
      } else {
        process.env.NOTIFICATION_CLEANUP_CRON = originalCron;
      }
    });

    it('is disabled by default outside production, even with nothing else configured', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.NOTIFICATION_CLEANUP_ENABLED;

      const result = scheduler.start();

      expect(schedule.scheduleJob).not.toHaveBeenCalled();
      expect(result).toEqual({ scheduled: false, nextRun: null });
    });

    it('schedules a daily job and reports the next run time when explicitly enabled', () => {
      process.env.NOTIFICATION_CLEANUP_ENABLED = 'true';

      const result = scheduler.start();

      expect(schedule.scheduleJob).toHaveBeenCalledWith(
        { rule: '20 3 * * *', tz: 'Etc/UTC' },
        expect.any(Function)
      );
      expect(result).toEqual({ scheduled: true, nextRun: new Date('2026-01-01T03:20:00.000Z') });
    });

    it('honors NOTIFICATION_CLEANUP_CRON instead of the hard-coded default', () => {
      // backgroundJobTelemetry.service.js's getDefinitions() advertises
      // NOTIFICATION_CLEANUP_CRON as the active schedule on the dashboard —
      // this scheduler must actually use it, not just the 03:20 default.
      process.env.NOTIFICATION_CLEANUP_ENABLED = 'true';
      process.env.NOTIFICATION_CLEANUP_CRON = '0 5 * * *';

      scheduler.start();

      expect(schedule.scheduleJob).toHaveBeenCalledWith(
        { rule: '0 5 * * *', tz: 'Etc/UTC' },
        expect.any(Function)
      );
    });

    it('acquires the distributed scheduler lock for both the cron tick and the startup catch-up', async () => {
      // On a multi-replica deploy, an unguarded scheduler fires once per
      // replica — this scheduler previously had no lock at all, unlike
      // every other scheduler in the boot sequence.
      mongoDb.getDb.mockResolvedValue({ collection: jest.fn() });
      mockCleanupExpired.mockResolvedValue(0);
      mockCleanupStale.mockResolvedValue(0);
      process.env.NOTIFICATION_CLEANUP_ENABLED = 'true';

      // Drain any startup catch-up still pending from a prior test's setImmediate
      // before this test's own call count assertions.
      await new Promise(resolve => setImmediate(resolve));
      schedulerLock.withLock.mockClear();

      scheduler.start();
      await new Promise(resolve => setImmediate(resolve)); // flush this test's own startup catch-up
      const cronCallback = schedule.scheduleJob.mock.calls.at(-1)[1];
      await cronCallback();

      expect(schedulerLock.withLock).toHaveBeenCalledWith(
        'notification-cleanup',
        expect.any(Function)
      );
      expect(schedulerLock.withLock).toHaveBeenCalledTimes(2); // startup catch-up + cron tick
    });

    it('cancels any previously scheduled job before scheduling a new one', () => {
      process.env.NOTIFICATION_CLEANUP_ENABLED = 'true';
      scheduler.start();
      const firstJob = schedule.scheduleJob.mock.results[0].value;

      scheduler.start();

      expect(firstJob.cancel).toHaveBeenCalledTimes(1);
      expect(schedule.scheduleJob).toHaveBeenCalledTimes(2);
    });

    it('stop() cancels the scheduled job and clears the reference', () => {
      process.env.NOTIFICATION_CLEANUP_ENABLED = 'true';
      scheduler.start();
      const job = schedule.scheduleJob.mock.results[0].value;

      scheduler.stop();

      expect(job.cancel).toHaveBeenCalledTimes(1);

      // Calling stop() again with nothing scheduled is a safe no-op.
      expect(() => scheduler.stop()).not.toThrow();
    });
  });
});
