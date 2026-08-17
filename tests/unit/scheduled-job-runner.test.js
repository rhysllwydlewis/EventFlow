'use strict';

jest.mock('../../services/backgroundJobTelemetry.service', () => ({
  recordRun: jest.fn().mockResolvedValue({}),
  getLatestRun: jest.fn().mockResolvedValue(null),
  JOB_KEYS: { CONTENT_REVIEW: 'content-review' },
}));
jest.mock('../../utils/sentry', () => ({
  captureException: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const backgroundJobs = require('../../services/backgroundJobTelemetry.service');
const sentry = require('../../utils/sentry');
const logger = require('../../utils/logger');
const { runScheduledJob, runIfMissed } = require('../../services/scheduledJobRunner');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('runScheduledJob', () => {
  afterEach(() => jest.clearAllMocks());

  it('records a success run and returns the work function result', async () => {
    const result = await runScheduledJob('content-review', async () => ({ created: 2 }));

    expect(result).toEqual({ created: 2 });
    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        jobKey: 'content-review',
        status: 'success',
        trigger: 'scheduler',
        metrics: { created: 2 },
      }),
      expect.objectContaining({ log: logger })
    );
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('records a skipped run when the work function reports skipped:true', async () => {
    await runScheduledJob('content-review', async () => ({ skipped: true, reason: 'disabled' }));

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped' }),
      expect.anything()
    );
  });

  it('reports failures to Sentry, records a failed run, and returns null', async () => {
    const boom = new Error('db unavailable');
    const result = await runScheduledJob('content-review', async () => {
      throw boom;
    });

    expect(result).toBeNull();
    expect(sentry.captureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ tags: { scheduledJob: 'content-review' } })
    );
    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        jobKey: 'content-review',
        status: 'failed',
        error: 'db unavailable',
      }),
      expect.anything()
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it('defaults to an empty metrics object when the work function resolves undefined', async () => {
    await runScheduledJob('content-review', async () => undefined);

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', metrics: {} }),
      expect.anything()
    );
  });

  it('forwards a custom trigger through to recordRun', async () => {
    await runScheduledJob('content-review', async () => ({}), { trigger: 'startup-catch-up' });

    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'startup-catch-up' }),
      expect.anything()
    );
  });
});

describe('runIfMissed', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs the catch-up when there is no recorded run at all', async () => {
    backgroundJobs.getLatestRun.mockResolvedValue(null);
    const fn = jest.fn().mockResolvedValue({ ok: true });

    const result = await runIfMissed('content-review', fn, { expectedIntervalMs: ONE_DAY_MS });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
    expect(backgroundJobs.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: 'content-review', trigger: 'missed-run-catchup' }),
      expect.anything()
    );
  });

  it('runs the catch-up when the last run is older than the expected interval', async () => {
    backgroundJobs.getLatestRun.mockResolvedValue({
      finishedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
    });
    const fn = jest.fn().mockResolvedValue({ ok: true });

    const result = await runIfMissed('content-review', fn, { expectedIntervalMs: ONE_DAY_MS });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('does nothing when a recent run already exists', async () => {
    backgroundJobs.getLatestRun.mockResolvedValue({
      finishedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    const fn = jest.fn();

    const result = await runIfMissed('content-review', fn, { expectedIntervalMs: ONE_DAY_MS });

    expect(fn).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(backgroundJobs.recordRun).not.toHaveBeenCalled();
  });

  it('treats an unparsable last-run timestamp as missing (runs the catch-up)', async () => {
    backgroundJobs.getLatestRun.mockResolvedValue({ finishedAt: 'not-a-date' });
    const fn = jest.fn().mockResolvedValue({ ok: true });

    await runIfMissed('content-review', fn, { expectedIntervalMs: ONE_DAY_MS });

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
