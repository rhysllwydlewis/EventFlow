'use strict';

jest.mock('node-schedule', () => ({
  scheduleJob: jest.fn(() => ({
    cancel: jest.fn(),
    nextInvocation: jest.fn(() => new Date('2026-01-01T08:17:00.000Z')),
  })),
}));

jest.mock('../../services/contentReviewTask.service', () => ({
  ensureMonthlyTasks: jest.fn().mockResolvedValue({ created: [], skipped: false }),
}));

jest.mock('../../services/schedulerLock.service', () => ({
  withLock: jest.fn((jobKey, fn) => fn()),
}));

const schedule = require('node-schedule');
const schedulerLock = require('../../services/schedulerLock.service');
const scheduler = require('../../services/contentReviewScheduler');

describe('services/contentReviewScheduler.js — start()/stop()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.CONTENT_REVIEW_ENABLED;

  afterEach(() => {
    jest.clearAllMocks();
    scheduler.stop();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnabled === undefined) {
      delete process.env.CONTENT_REVIEW_ENABLED;
    } else {
      process.env.CONTENT_REVIEW_ENABLED = originalEnabled;
    }
  });

  it('is disabled by default outside production', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.CONTENT_REVIEW_ENABLED;

    const result = scheduler.start();

    expect(schedule.scheduleJob).not.toHaveBeenCalled();
    expect(result).toEqual({ scheduled: false, nextRun: null });
  });

  it('schedules a daily job and runs a startup catch-up when explicitly enabled', () => {
    process.env.CONTENT_REVIEW_ENABLED = 'true';

    const result = scheduler.start();

    expect(schedule.scheduleJob).toHaveBeenCalledWith(
      { rule: '17 8 * * *', tz: 'Etc/UTC' },
      expect.any(Function)
    );
    expect(result).toEqual({ scheduled: true, nextRun: new Date('2026-01-01T08:17:00.000Z') });
  });

  it('acquires the distributed scheduler lock for both the cron tick and the startup catch-up', async () => {
    // On a multi-replica deploy, an unguarded scheduler fires once per
    // replica — this scheduler previously had no lock at all, unlike every
    // other scheduler in the boot sequence.
    process.env.CONTENT_REVIEW_ENABLED = 'true';

    // Drain any startup catch-up still pending from a prior test's setImmediate
    // before this test's own call count assertions.
    await new Promise(resolve => setImmediate(resolve));
    schedulerLock.withLock.mockClear();

    scheduler.start();
    await new Promise(resolve => setImmediate(resolve)); // flush this test's own startup catch-up
    const cronCallback = schedule.scheduleJob.mock.calls.at(-1)[1];
    await cronCallback();

    expect(schedulerLock.withLock).toHaveBeenCalledWith('content-review', expect.any(Function));
    expect(schedulerLock.withLock).toHaveBeenCalledTimes(2); // startup catch-up + cron tick
  });

  it('cancels any previously scheduled job before scheduling a new one', () => {
    process.env.CONTENT_REVIEW_ENABLED = 'true';
    scheduler.start();
    const firstJob = schedule.scheduleJob.mock.results[0].value;

    scheduler.start();

    expect(firstJob.cancel).toHaveBeenCalledTimes(1);
    expect(schedule.scheduleJob).toHaveBeenCalledTimes(2);
  });

  it('stop() cancels the scheduled job and clears the reference', () => {
    process.env.CONTENT_REVIEW_ENABLED = 'true';
    scheduler.start();
    const job = schedule.scheduleJob.mock.results[0].value;

    scheduler.stop();

    expect(job.cancel).toHaveBeenCalledTimes(1);
    expect(() => scheduler.stop()).not.toThrow();
  });
});
