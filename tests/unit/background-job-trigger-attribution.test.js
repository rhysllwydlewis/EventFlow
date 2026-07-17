'use strict';

const originalAutoinstall = process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL;
const originalNodeEnv = process.env.NODE_ENV;
process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL = 'false';

const fs = require('fs');
const path = require('path');
const {
  buildActionPromptFailureTelemetry,
  buildActionPromptTelemetry,
  buildBadgeTelemetry,
  buildDateManagementTelemetry,
  instrumentActionPromptService,
  instrumentBadgeManagement,
  instrumentDateManagementService,
} = require('../../services/backgroundJobTelemetryBridge');
const {
  COLLECTION,
  JOB_KEYS,
  getDashboardData,
} = require('../../services/backgroundJobTelemetry.service');

describe('background job trigger attribution', () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  afterAll(() => {
    if (originalAutoinstall === undefined) {
      delete process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL;
    } else {
      process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL = originalAutoinstall;
    }
  });

  test('preserves manual triggers in all migrated telemetry payloads', () => {
    expect(buildActionPromptTelemetry({ trigger: 'manual' }).trigger).toBe('manual');
    expect(
      buildActionPromptFailureTelemetry(new Error('failed'), new Date(), new Date(), 'manual')
        .trigger
    ).toBe('manual');
    expect(buildDateManagementTelemetry({}, new Date(), new Date(), 'manual').trigger).toBe(
      'manual'
    );
    expect(
      buildBadgeTelemetry(
        { total: 0, evaluated: 0, awarded: 0, revoked: 0, errors: 0 },
        new Date(),
        new Date(),
        null,
        'manual'
      ).trigger
    ).toBe('manual');
  });

  test('wrappers propagate manual execution context and preserve results', async () => {
    const recordRun = jest.fn().mockResolvedValue({});
    const actionError = new Error('lookup failed');
    const actionService = {
      getSupplierActionItems: jest.fn().mockRejectedValue(actionError),
    };
    instrumentActionPromptService(actionService, { recordRun, log: { warn: jest.fn() } });
    await expect(actionService.getSupplierActionItems({ telemetryTrigger: 'manual' })).rejects.toBe(
      actionError
    );

    class DateService {
      async performMonthlyCheck() {
        return { performed: false, changed: false, reason: 'No changes detected' };
      }
    }
    instrumentDateManagementService(DateService, { recordRun, log: { warn: jest.fn() } });
    await new DateService().performMonthlyCheck({ trigger: 'manual' });

    const badges = {
      evaluateAllSupplierBadges: jest.fn().mockResolvedValue({
        total: 0,
        evaluated: 0,
        awarded: 0,
        revoked: 0,
        errors: 0,
      }),
    };
    instrumentBadgeManagement(badges, { recordRun, log: { warn: jest.fn() } });
    await badges.evaluateAllSupplierBadges({ trigger: 'manual' });

    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.ACTION_PROMPTS, trigger: 'manual' })
    );
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.DATE_MANAGEMENT, trigger: 'manual' })
    );
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: JOB_KEYS.BADGE_EVALUATION, trigger: 'manual' })
    );
  });

  test('manual-only history does not make scheduler health look fresh', async () => {
    process.env.NODE_ENV = 'production';
    const now = new Date('2026-07-17T12:00:00.000Z');
    const db = {
      read: jest.fn().mockResolvedValue({}),
      findWithOptions: jest.fn(async collection => {
        if (collection === COLLECTION) {
          return [
            {
              id: 'manual-date-run',
              jobKey: JOB_KEYS.DATE_MANAGEMENT,
              status: 'success',
              trigger: 'manual',
              startedAt: '2026-07-17T11:59:00.000Z',
              finishedAt: '2026-07-17T11:59:01.000Z',
            },
          ];
        }
        if (collection === 'audit_logs') {
          return [
            {
              action: 'AUTO_DATE_UPDATE',
              timestamp: '2026-07-17T11:59:30.000Z',
            },
          ];
        }
        return [];
      }),
    };

    const data = await getDashboardData({ db, now, log: { warn: jest.fn() } });
    const job = data.jobs.find(item => item.key === JOB_KEYS.DATE_MANAGEMENT);
    expect(job.telemetry).toBe('full');
    expect(job.health).toBe('unknown');
    expect(job.lastAttempt).toBeNull();
    expect(job.history).toEqual(
      expect.arrayContaining([expect.objectContaining({ trigger: 'manual' })])
    );
  });

  test('production and manual call sites preload and propagate trigger context', () => {
    const root = path.resolve(__dirname, '../..');
    const railway = fs.readFileSync(path.join(root, 'railway.json'), 'utf8');
    const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
    const supplierAdmin = fs.readFileSync(path.join(root, 'routes/supplier-admin.js'), 'utf8');
    const scheduler = fs.readFileSync(path.join(root, 'services/actionPromptScheduler.js'), 'utf8');
    const dateService = fs.readFileSync(
      path.join(root, 'services/dateManagementService.js'),
      'utf8'
    );

    expect(railway).toContain('node -r ./services/backgroundJobTelemetryBridge.js server.js');
    expect(admin).toContain("trigger: 'manual'");
    expect(admin).toContain("trigger: 'manual'");
    expect(admin).toContain('userId: req.user.id || req.user.email');
    expect(supplierAdmin).toContain("evaluateAllSupplierBadges({ trigger: 'manual' })");
    expect(scheduler).toContain('getSupplierActionItems({ telemetryTrigger: trigger })');
    expect(dateService).toContain("const manual = trigger === 'manual'");
    expect(dateService).toContain("type: manual ? 'MANUAL_UPDATE' : 'AUTO_UPDATE'");
  });
});
