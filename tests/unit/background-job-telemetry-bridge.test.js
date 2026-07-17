'use strict';

process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL = 'false';

const fs = require('fs');
const path = require('path');
const {
  buildActionPromptTelemetry,
  buildBadgeTelemetry,
  buildDateManagementTelemetry,
  buildSystemCheckTelemetry,
  installDatabaseHooks,
  instrumentBadgeManagement,
  instrumentDateManagementService,
  resetSeenRunsForTests,
} = require('../../services/backgroundJobTelemetryBridge');
const {
  COLLECTION,
  JOB_KEYS,
  getDashboardData,
} = require('../../services/backgroundJobTelemetry.service');

describe('background job telemetry bridge', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    resetSeenRunsForTests();
    jest.clearAllMocks();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test('normalises system-check and action-prompt runs for shared telemetry', () => {
    expect(
      buildSystemCheckTelemetry({
        status: 'pass',
        startedAt: '2026-07-17T03:00:00.000Z',
        finishedAt: '2026-07-17T03:00:02.000Z',
        checks: [{ ok: true }, { ok: true, warning: 'Auth redirect' }],
      })
    ).toEqual(
      expect.objectContaining({
        jobKey: JOB_KEYS.SYSTEM_CHECKS,
        status: 'success',
        metrics: { total: 2, passed: 2, failed: 0, warnings: 1 },
      })
    );

    expect(
      buildActionPromptTelemetry({
        startedAt: '2026-07-17T09:00:00.000Z',
        finishedAt: '2026-07-17T09:00:04.000Z',
        scanned: 15,
        sent: 4,
        skippedCadence: 10,
        cappedByLimit: true,
        errors: 1,
      })
    ).toEqual(
      expect.objectContaining({
        jobKey: JOB_KEYS.ACTION_PROMPTS,
        status: 'warning',
        metrics: {
          scanned: 15,
          sent: 4,
          skippedCadence: 10,
          errors: 1,
          cappedByLimit: true,
        },
      })
    );
  });

  test('classifies no-change date checks as successful trustworthy runs', () => {
    expect(
      buildDateManagementTelemetry(
        { performed: false, changed: false, reason: 'No changes detected' },
        new Date('2026-07-17T02:00:00.000Z'),
        new Date('2026-07-17T02:00:01.000Z')
      )
    ).toEqual(
      expect.objectContaining({
        jobKey: JOB_KEYS.DATE_MANAGEMENT,
        status: 'success',
        metrics: expect.objectContaining({ performed: false, changed: false }),
      })
    );

    expect(
      buildDateManagementTelemetry(
        { performed: false, reason: 'Auto-update disabled' },
        new Date('2026-07-17T02:00:00.000Z'),
        new Date('2026-07-17T02:00:01.000Z')
      ).status
    ).toBe('skipped');
  });

  test('records badge warnings without exposing supplier-level data', () => {
    const payload = buildBadgeTelemetry(
      { total: 12, evaluated: 11, awarded: 2, revoked: 1, errors: 1 },
      new Date('2026-07-17T08:00:00.000Z'),
      new Date('2026-07-17T08:00:03.000Z')
    );

    expect(payload).toEqual(
      expect.objectContaining({
        jobKey: JOB_KEYS.BADGE_EVALUATION,
        status: 'warning',
        metrics: { total: 12, evaluated: 11, awarded: 2, revoked: 1, errors: 1 },
      })
    );
    expect(JSON.stringify(payload)).not.toContain('supplierId');
  });

  test('bridges system-check inserts and action-prompt settings writes once per run', async () => {
    const recordRun = jest.fn().mockResolvedValue({});
    const db = {
      insertOne: jest.fn().mockResolvedValue(true),
      writeAndVerify: jest.fn().mockResolvedValue(true),
    };
    installDatabaseHooks({ db, recordRun, log: { warn: jest.fn() } });

    const systemRun = {
      status: 'pass',
      startedAt: '2026-07-17T03:00:00.000Z',
      finishedAt: '2026-07-17T03:00:02.000Z',
      checks: [{ ok: true }],
    };
    await db.insertOne('system_checks', systemRun);
    await db.insertOne('system_checks', systemRun);

    const settings = {
      emailAutomation: {
        actionPrompts: {
          lastRun: {
            startedAt: '2026-07-17T09:00:00.000Z',
            finishedAt: '2026-07-17T09:00:03.000Z',
            scanned: 5,
            sent: 1,
            errors: 0,
          },
        },
      },
    };
    await db.writeAndVerify('settings', settings);
    await db.writeAndVerify('settings', settings);

    expect(recordRun).toHaveBeenCalledTimes(2);
    expect(recordRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ jobKey: JOB_KEYS.SYSTEM_CHECKS })
    );
    expect(recordRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ jobKey: JOB_KEYS.ACTION_PROMPTS })
    );
  });

  test('shared runs move every migrated job to full telemetry', async () => {
    process.env.NODE_ENV = 'production';
    const now = new Date('2026-07-17T12:00:00.000Z');
    const migratedKeys = [
      JOB_KEYS.SYSTEM_CHECKS,
      JOB_KEYS.ACTION_PROMPTS,
      JOB_KEYS.DATE_MANAGEMENT,
      JOB_KEYS.BADGE_EVALUATION,
    ];
    const db = {
      read: jest.fn().mockResolvedValue({}),
      findWithOptions: jest.fn(async collection => {
        if (collection === COLLECTION) {
          return migratedKeys.map((jobKey, index) => ({
            id: `jobrun_${index}`,
            jobKey,
            status: 'success',
            startedAt: `2026-07-17T0${index + 3}:00:00.000Z`,
            finishedAt: `2026-07-17T0${index + 3}:00:01.000Z`,
            metrics: { completed: true },
          }));
        }
        return [];
      }),
    };

    const data = await getDashboardData({ db, now, log: { warn: jest.fn() } });
    for (const jobKey of migratedKeys) {
      expect(data.jobs.find(job => job.key === jobKey)).toEqual(
        expect.objectContaining({ telemetry: 'full', health: 'healthy' })
      );
    }
  });

  test('loads the telemetry bridge in local and production startup commands', () => {
    const repositoryRoot = path.resolve(__dirname, '../..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');

    expect(packageJson.scripts.dev).toContain('-r ./services/backgroundJobTelemetryBridge.js');
    expect(packageJson.scripts.start).toContain('-r ./services/backgroundJobTelemetryBridge.js');
    expect(dockerfile).toContain('-r');
    expect(dockerfile).toContain('./services/backgroundJobTelemetryBridge.js');
  });

  test('wraps date and badge execution while preserving return values and failures', async () => {
    const recordRun = jest.fn().mockResolvedValue({});

    class DateService {
      async performMonthlyCheck() {
        return { performed: false, changed: false, reason: 'No changes detected' };
      }
    }
    instrumentDateManagementService(DateService, { recordRun, log: { warn: jest.fn() } });
    await expect(new DateService().performMonthlyCheck()).resolves.toEqual(
      expect.objectContaining({ reason: 'No changes detected' })
    );

    const badgeError = new Error('badge database unavailable');
    const badges = {
      evaluateAllSupplierBadges: jest.fn().mockRejectedValue(badgeError),
    };
    instrumentBadgeManagement(badges, { recordRun, log: { warn: jest.fn() } });
    await expect(badges.evaluateAllSupplierBadges()).rejects.toThrow('badge database unavailable');

    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.DATE_MANAGEMENT, status: 'success' })
    );
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.BADGE_EVALUATION, status: 'failed' })
    );
  });
});
