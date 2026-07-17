'use strict';

const {
  COLLECTION,
  JOB_KEYS,
  classifyHealth,
  getDashboardData,
  recordRun,
  sanitizeError,
} = require('../../services/backgroundJobTelemetry.service');

describe('background job telemetry', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('persists sanitised run telemetry without throwing when storage succeeds', async () => {
    const db = { insertOne: jest.fn().mockResolvedValue(true) };
    const startedAt = new Date('2026-07-17T09:00:00.000Z');
    const finishedAt = new Date('2026-07-17T09:00:02.500Z');

    const run = await recordRun(
      {
        jobKey: JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
        status: 'success',
        startedAt,
        finishedAt,
        metrics: {
          checked: 3,
          expired: 2,
          apiKey: 'secret-metric-value',
          nested: { hidden: true },
        },
        error: 'token=secret-value https://example.com/private',
      },
      { db, log: { warn: jest.fn() } }
    );

    expect(run).toEqual(
      expect.objectContaining({
        jobKey: JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
        durationMs: 2500,
        metrics: { checked: 3, expired: 2, apiKey: '[redacted]' },
      })
    );
    expect(run.error).toContain('[redacted]');
    expect(run.error).toContain('[url removed]');
    expect(run.error).not.toContain('secret-value');
    expect(JSON.stringify(run.metrics)).not.toContain('secret-metric-value');
    expect(db.insertOne).toHaveBeenCalledWith(COLLECTION, run);
  });

  test('treats telemetry persistence failures as non-fatal', async () => {
    const log = { warn: jest.fn() };
    await expect(
      recordRun(
        {
          jobKey: JOB_KEYS.SYSTEM_CHECKS,
          status: 'failed',
          error: 'database unavailable',
        },
        {
          db: { insertOne: jest.fn().mockRejectedValue(new Error('offline')) },
          log,
        }
      )
    ).resolves.toEqual(expect.objectContaining({ jobKey: JOB_KEYS.SYSTEM_CHECKS }));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not persist run'),
      'offline'
    );
  });

  test('aggregates shared telemetry with existing scheduler histories', async () => {
    process.env.NODE_ENV = 'production';
    const now = new Date('2026-07-17T10:00:00.000Z');
    const db = {
      insertOne: jest.fn(),
      read: jest.fn().mockResolvedValue({
        emailAutomation: {
          actionPrompts: {
            cron: '30 8 * * *',
            runHistory: [
              {
                startedAt: '2026-07-17T09:00:00.000Z',
                finishedAt: '2026-07-17T09:00:05.000Z',
                durationMs: 5000,
                scanned: 20,
                sent: 4,
                errors: 0,
              },
            ],
          },
        },
      }),
      findWithOptions: jest.fn(async collection => {
        if (collection === COLLECTION) {
          return [
            {
              id: 'jobrun_review',
              jobKey: JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
              status: 'success',
              startedAt: '2026-07-17T09:15:00.000Z',
              finishedAt: '2026-07-17T09:15:01.000Z',
              durationMs: 1000,
              metrics: { checked: 2, expired: 1 },
            },
          ];
        }
        if (collection === 'system_checks') {
          return [
            {
              status: 'pass',
              startedAt: '2026-07-17T03:00:00.000Z',
              finishedAt: '2026-07-17T03:00:02.000Z',
              durationMs: 2000,
              checks: [{ ok: true }, { ok: true, warning: 'auth redirect' }],
            },
          ];
        }
        return [];
      }),
    };

    const data = await getDashboardData({
      db,
      now,
      historyLimit: 5,
      dateService: {
        getStatus: () => ({
          scheduled: true,
          nextRun: new Date('2026-08-01T02:00:00.000Z'),
        }),
      },
      log: { warn: jest.fn() },
    });

    expect(data.jobs).toHaveLength(5);
    expect(data.jobs.find(job => job.key === JOB_KEYS.REVIEW_REQUEST_MAINTENANCE)).toEqual(
      expect.objectContaining({ health: 'healthy', telemetry: 'full' })
    );
    expect(data.jobs.find(job => job.key === JOB_KEYS.SYSTEM_CHECKS)).toEqual(
      expect.objectContaining({ health: 'healthy', telemetry: 'partial' })
    );
    expect(data.jobs.find(job => job.key === JOB_KEYS.ACTION_PROMPTS)).toEqual(
      expect.objectContaining({
        schedule: '30 8 * * *',
        scheduleSource: 'settings',
        latestMetrics: expect.objectContaining({ scanned: 20, sent: 4 }),
      })
    );
    expect(data.jobs.find(job => job.key === JOB_KEYS.DATE_MANAGEMENT).nextRun).toBe(
      '2026-08-01T02:00:00.000Z'
    );
    expect(data.summary).toEqual(expect.objectContaining({ total: 5, attention: 0, unknown: 2 }));
  });

  test('does not mark update-only legacy evidence overdue', () => {
    const definition = {
      enabled: true,
      staleAfterMs: 60 * 60 * 1000,
      legacyFreshnessReliable: false,
    };
    const history = [
      {
        status: 'success',
        source: 'audit_logs',
        finishedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    expect(classifyHealth(definition, history, new Date('2026-07-17T10:00:00.000Z'))).toBe(
      'unknown'
    );
  });

  test('marks successful jobs overdue after their stale threshold', () => {
    const definition = {
      enabled: true,
      staleAfterMs: 60 * 60 * 1000,
      legacyFreshnessReliable: true,
    };
    const history = [
      {
        status: 'success',
        finishedAt: '2026-07-17T07:00:00.000Z',
      },
    ];
    expect(classifyHealth(definition, history, new Date('2026-07-17T10:00:00.000Z'))).toBe(
      'overdue'
    );
  });

  test('sanitises URLs and credential-style query values', () => {
    expect(sanitizeError('Failed https://host/path?token=abc token=xyz')).toBe(
      'Failed [url removed] token=[redacted]'
    );
  });
});
