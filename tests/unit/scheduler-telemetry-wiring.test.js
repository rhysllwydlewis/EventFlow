/**
 * services/contentReviewScheduler.js and services/notificationCleanupScheduler.js
 * were previously invisible on the /admin-debug Background Jobs dashboard and
 * never reported failures to Sentry — every other cron callback caught its own
 * errors and only logged them. Both now route their cron-triggered runs
 * through services/scheduledJobRunner.js. This verifies the wiring actually
 * reaches backgroundJobTelemetry.recordRun and utils/sentry.captureException.
 */
'use strict';

jest.mock('../../services/backgroundJobTelemetry.service', () => {
  const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
  return {
    ...actual,
    recordRun: jest.fn().mockResolvedValue({}),
  };
});
jest.mock('../../utils/sentry', () => ({ captureException: jest.fn() }));
jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn(() => ({ cancel: jest.fn(), nextInvocation: jest.fn(() => new Date()) })),
}));

const backgroundJobs = require('../../services/backgroundJobTelemetry.service');
const sentry = require('../../utils/sentry');

describe('contentReviewScheduler.runTracked', () => {
  afterEach(() => jest.clearAllMocks());

  test('records a success run under the content-review job key', async () => {
    jest.doMock('../../services/contentReviewTask.service', () => ({
      ensureMonthlyTasks: jest.fn().mockResolvedValue({ created: [{ id: 't1' }], skipped: false }),
    }));
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return { ...actual, recordRun: backgroundJobs.recordRun };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    jest.doMock('../../services/contentReviewTask.service', () => ({
      ensureMonthlyTasks: jest.fn().mockResolvedValue({ created: [{ id: 't1' }], skipped: false }),
    }));
    const scheduler = require('../../services/contentReviewScheduler');

    await scheduler.runTracked('scheduler');

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'content-review', status: 'success' }),
      expect.anything()
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  test('records a skipped run — not success — when content-review automation is disabled', async () => {
    // ensureMonthlyTasks() reports skipped:true when disabled via the
    // database-backed setting; runTracked() must propagate that through to
    // runScheduledJob rather than reporting a false "success", or the
    // dashboard would say automation ran when it didn't.
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return { ...actual, recordRun: backgroundJobs.recordRun };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    jest.doMock('../../services/contentReviewTask.service', () => ({
      ensureMonthlyTasks: jest.fn().mockResolvedValue({ created: [], skipped: true }),
    }));
    const scheduler = require('../../services/contentReviewScheduler');

    await scheduler.runTracked('scheduler');

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'content-review', status: 'skipped' }),
      expect.anything()
    );
  });

  test('reports a failure to Sentry and records status failed', async () => {
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return { ...actual, recordRun: backgroundJobs.recordRun };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    jest.doMock('../../services/contentReviewTask.service', () => ({
      ensureMonthlyTasks: jest.fn().mockRejectedValue(new Error('task store unavailable')),
    }));
    const scheduler = require('../../services/contentReviewScheduler');

    await scheduler.runTracked('scheduler');

    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { scheduledJob: 'content-review' } })
    );
    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'content-review', status: 'failed' }),
      expect.anything()
    );
  });
});

describe('notificationCleanupScheduler.runTracked', () => {
  afterEach(() => jest.clearAllMocks());

  test('records a success run under the notification-cleanup job key', async () => {
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return { ...actual, recordRun: backgroundJobs.recordRun };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    jest.doMock('../../db', () => ({
      getDb: jest.fn().mockResolvedValue({ collection: jest.fn() }),
    }));
    jest.doMock('../../services/notification.service', () =>
      jest.fn().mockImplementation(() => ({
        cleanupExpired: jest.fn().mockResolvedValue(1),
        cleanupStale: jest.fn().mockResolvedValue(2),
      }))
    );
    const scheduler = require('../../services/notificationCleanupScheduler');

    await scheduler.runTracked('scheduler');

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'notification-cleanup', status: 'success' }),
      expect.anything()
    );
  });

  test('reports a failure to Sentry when the DB connection throws', async () => {
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return { ...actual, recordRun: backgroundJobs.recordRun };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    jest.doMock('../../db', () => ({
      getDb: jest.fn().mockRejectedValue(new Error('connection refused')),
    }));
    const scheduler = require('../../services/notificationCleanupScheduler');

    await scheduler.runTracked('scheduler');

    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { scheduledJob: 'notification-cleanup' } })
    );
    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'notification-cleanup', status: 'failed' }),
      expect.anything()
    );
  });
});

describe('notificationCleanupScheduler.runCatchUpIfMissed', () => {
  afterEach(() => jest.clearAllMocks());

  test('runs when there is no recorded run yet, tagged as a missed-run catch-up', async () => {
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return {
        ...actual,
        recordRun: backgroundJobs.recordRun,
        getLatestRun: jest.fn().mockResolvedValue(null),
      };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    jest.doMock('../../db', () => ({
      getDb: jest.fn().mockResolvedValue({ collection: jest.fn() }),
    }));
    jest.doMock('../../services/notification.service', () =>
      jest.fn().mockImplementation(() => ({
        cleanupExpired: jest.fn().mockResolvedValue(0),
        cleanupStale: jest.fn().mockResolvedValue(0),
      }))
    );
    const scheduler = require('../../services/notificationCleanupScheduler');

    await scheduler.runCatchUpIfMissed();

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'notification-cleanup', trigger: 'missed-run-catchup' }),
      expect.anything()
    );
  });

  test('does nothing when a run already happened within the last day', async () => {
    jest.resetModules();
    jest.doMock('../../services/backgroundJobTelemetry.service', () => {
      const actual = jest.requireActual('../../services/backgroundJobTelemetry.service');
      return {
        ...actual,
        recordRun: backgroundJobs.recordRun,
        getLatestRun: jest.fn().mockResolvedValue({ finishedAt: new Date().toISOString() }),
      };
    });
    jest.doMock('../../utils/sentry', () => sentry);
    const scheduler = require('../../services/notificationCleanupScheduler');

    const result = await scheduler.runCatchUpIfMissed();

    expect(result).toBeNull();
    expect(backgroundJobs.recordRun).not.toHaveBeenCalled();
  });
});
