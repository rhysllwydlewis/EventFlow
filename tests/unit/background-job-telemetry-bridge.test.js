'use strict';

const originalBridgeAutoinstall = process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL;
process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL = 'false';

const fs = require('fs');
const path = require('path');
const {
  buildActionPromptFailureTelemetry,
  buildActionPromptTelemetry,
  buildBadgeTelemetry,
  buildDateManagementTelemetry,
  buildRunIdentity,
  buildSystemCheckTelemetry,
  installDatabaseHooks,
  instrumentActionPromptService,
  instrumentBadgeManagement,
  instrumentDateManagementService,
  isRecentRun,
  resetSeenRunsForTests,
  wasInsertSuccessful,
  wasWriteVerified,
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

  afterAll(() => {
    if (originalBridgeAutoinstall === undefined) {
      delete process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL;
    } else {
      process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL = originalBridgeAutoinstall;
    }
  });

  test('normalises successful and failed system-check runs', () => {
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
      buildSystemCheckTelemetry({
        status: 'pass',
        startedAt: '2026-07-17T03:00:00.000Z',
        finishedAt: '2026-07-17T03:00:02.000Z',
        checks: [],
      })
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'System check run produced no check results',
      })
    );
  });

  test('normalises action-prompt success, warning and fatal failure telemetry', () => {
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

    expect(
      buildActionPromptFailureTelemetry(
        new Error('supplier lookup failed'),
        new Date('2026-07-17T09:00:00.000Z'),
        new Date('2026-07-17T09:00:01.000Z')
      )
    ).toEqual(
      expect.objectContaining({
        jobKey: JOB_KEYS.ACTION_PROMPTS,
        status: 'failed',
        error: 'supplier lookup failed',
      })
    );
  });

  test('classifies date-management outcomes without turning missing evidence into success', () => {
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

    expect(
      buildDateManagementTelemetry(
        { performed: false, changed: false, reason: 'No git history available' },
        new Date('2026-07-17T02:00:00.000Z'),
        new Date('2026-07-17T02:00:01.000Z')
      )
    ).toEqual(expect.objectContaining({ status: 'warning', error: 'No git history available' }));

    expect(
      buildDateManagementTelemetry(
        null,
        new Date('2026-07-17T02:00:00.000Z'),
        new Date('2026-07-17T02:00:01.000Z')
      ).status
    ).toBe('failed');
  });

  test('records badge warnings and invalid results without exposing supplier-level data', () => {
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

    expect(
      buildBadgeTelemetry(
        null,
        new Date('2026-07-17T08:00:00.000Z'),
        new Date('2026-07-17T08:00:03.000Z')
      ).status
    ).toBe('failed');
  });

  test('uses the real database success contracts before recording shared telemetry', async () => {
    expect(wasInsertSuccessful({ id: 'stored' })).toBe(true);
    expect(wasInsertSuccessful(null)).toBe(false);
    expect(wasWriteVerified({ success: true, verified: true })).toBe(true);
    expect(wasWriteVerified({ success: false, verified: false })).toBe(false);

    const recordRun = jest.fn().mockResolvedValue({});
    const db = {
      read: jest.fn().mockResolvedValue({}),
      insertOne: jest.fn().mockResolvedValue(null),
      writeAndVerify: jest
        .fn()
        .mockResolvedValue({ success: false, verified: false, error: 'not stored' }),
    };
    installDatabaseHooks({ db, recordRun, log: { warn: jest.fn() } });

    const finishedAt = new Date(Date.now() - 1000).toISOString();
    await db.insertOne('system_checks', {
      status: 'pass',
      startedAt: new Date(Date.now() - 2000).toISOString(),
      finishedAt,
      checks: [{ ok: true }],
    });
    await db.writeAndVerify('settings', {
      emailAutomation: {
        actionPrompts: {
          lastRun: {
            startedAt: new Date(Date.now() - 2000).toISOString(),
            finishedAt,
            scanned: 5,
            sent: 1,
            errors: 0,
          },
        },
      },
    });

    expect(recordRun).not.toHaveBeenCalled();
  });

  test('bridges verified system-check and changed action-prompt writes once per run', async () => {
    const recordRun = jest.fn().mockResolvedValue({});
    const db = {
      read: jest.fn().mockResolvedValue({}),
      insertOne: jest.fn(async (_collection, document) => document),
      writeAndVerify: jest.fn().mockResolvedValue({
        success: true,
        verified: true,
        data: {},
      }),
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

    const actionFinishedAt = new Date(Date.now() - 1000).toISOString();
    const settings = {
      emailAutomation: {
        actionPrompts: {
          lastRun: {
            startedAt: new Date(Date.now() - 4000).toISOString(),
            finishedAt: actionFinishedAt,
            scanned: 5,
            sent: 1,
            errors: 0,
          },
        },
      },
    };
    await db.writeAndVerify('settings', settings);
    await db.writeAndVerify('settings', settings);
    await db.writeAndVerify('settings', {
      emailAutomation: {
        actionPrompts: {
          lastRun: {
            finishedAt: '2026-01-01T00:00:00.000Z',
            scanned: 999,
          },
        },
      },
    });
    await db.writeAndVerify('settings', {
      emailAutomation: {
        actionPrompts: {
          lastRun: {
            scanned: 999,
          },
        },
      },
    });

    expect(isRecentRun({ finishedAt: actionFinishedAt })).toBe(true);
    expect(isRecentRun({ finishedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(isRecentRun({ scanned: 999 })).toBe(false);
    expect(buildRunIdentity(JOB_KEYS.ACTION_PROMPTS, { scanned: 999 })).toBeNull();
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

  test('does not replay an unchanged recent action-prompt run after process dedupe resets', async () => {
    const finishedAt = new Date(Date.now() - 1000).toISOString();
    const previousSettings = {
      emailAutomation: {
        actionPrompts: {
          lastRun: {
            startedAt: new Date(Date.now() - 3000).toISOString(),
            finishedAt,
            scanned: 5,
            sent: 1,
            errors: 0,
          },
        },
      },
    };
    const recordRun = jest.fn().mockResolvedValue({});
    const db = {
      read: jest.fn().mockResolvedValue(previousSettings),
      insertOne: jest.fn(),
      writeAndVerify: jest.fn().mockResolvedValue({
        success: true,
        verified: true,
        data: previousSettings,
      }),
    };
    installDatabaseHooks({ db, recordRun, log: { warn: jest.fn() } });

    resetSeenRunsForTests();
    await db.writeAndVerify('settings', previousSettings);

    expect(recordRun).not.toHaveBeenCalled();
  });

  test('records fatal action-prompt discovery failures and preserves the original error', async () => {
    const originalError = new Error('supplier lookup failed');
    const recordRun = jest.fn().mockResolvedValue({});
    const actionPromptService = {
      getSupplierActionItems: jest.fn().mockRejectedValue(originalError),
    };
    instrumentActionPromptService(actionPromptService, {
      recordRun,
      log: { warn: jest.fn() },
    });

    await expect(actionPromptService.getSupplierActionItems()).rejects.toBe(originalError);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        jobKey: JOB_KEYS.ACTION_PROMPTS,
        status: 'failed',
        error: 'supplier lookup failed',
      })
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

  test('loads the bridge in every server startup path without changing unrelated scripts', () => {
    const repositoryRoot = path.resolve(__dirname, '../..');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
    );
    const dockerfile = fs.readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
    const productionSupervisor = fs.readFileSync(
      path.join(repositoryRoot, 'scripts/start-production.js'),
      'utf8'
    );
    const deploymentPreload = fs.readFileSync(
      path.join(repositoryRoot, 'services/deploymentMetadataPreload.js'),
      'utf8'
    );
    const storeSource = fs.readFileSync(path.join(repositoryRoot, 'store.js'), 'utf8');

    expect(packageJson.scripts.dev).toContain('-r ./services/backgroundJobTelemetryBridge.js');
    expect(packageJson.scripts.start).toContain('-r ./services/backgroundJobTelemetryBridge.js');
    expect(packageJson.scripts['audit:orphan-supplier-data']).toBe(
      'node scripts/audit-orphaned-supplier-data.js'
    );
    expect(dockerfile).toContain('scripts/start-production.js');
    expect(productionSupervisor).toContain('./services/deploymentMetadataPreload.js');
    expect(deploymentPreload).toContain("require('./backgroundJobTelemetryBridge')");
    expect(storeSource).toContain("system_checks: path.join(DATA_DIR, 'system_checks.json')");
    expect(storeSource).toContain(
      "background_job_runs: path.join(DATA_DIR, 'background_job_runs.json')"
    );
  });

  test('wraps date and badge execution while preserving results and failures', async () => {
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
    await expect(badges.evaluateAllSupplierBadges()).rejects.toBe(badgeError);

    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.DATE_MANAGEMENT, status: 'success' })
    );
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.BADGE_EVALUATION, status: 'failed' })
    );
  });
});
