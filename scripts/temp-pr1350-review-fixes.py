from pathlib import Path


def replace(path, old, new, count=1):
    target = Path(path)
    text = target.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(
            f"{path}: expected {count} match(es), found {actual}: {old[:120]!r}"
        )
    target.write_text(text.replace(old, new, count))


replace(
    "railway.json",
    '"startCommand": "node server.js"',
    '"startCommand": "node -r ./services/backgroundJobTelemetryBridge.js server.js"',
)

replace(
    "services/actionPromptScheduler.js",
    " * @param {number}  [opts.limit]        - Override max send cap for this run\n",
    " * @param {number}  [opts.limit]        - Override max send cap for this run\n"
    " * @param {'scheduler'|'manual'} [opts.trigger='scheduler'] - Execution source\n",
)
replace(
    "services/actionPromptScheduler.js",
    "async function runActionPrompts({ dryRun = false, limit } = {}) {",
    "async function runActionPrompts({ dryRun = false, limit, trigger = 'scheduler' } = {}) {",
)
replace(
    "services/actionPromptScheduler.js",
    "    const items = await getSupplierActionItems();",
    "    const items = await getSupplierActionItems({ telemetryTrigger: trigger });",
)
replace(
    "services/actionPromptScheduler.js",
    "    dryRun,\n    scanned,",
    "    dryRun,\n    trigger,\n    scanned,",
)
replace(
    "services/actionPromptScheduler.js",
    "        dryRun: summary.dryRun,\n        scanned: summary.scanned,",
    "        dryRun: summary.dryRun,\n        trigger: summary.trigger,\n        scanned: summary.scanned,",
)

replace(
    "routes/admin.js",
    "      const summary = await runActionPrompts({ dryRun, ...(limit !== undefined ? { limit } : {}) });",
    "      const summary = await runActionPrompts({\n"
    "        dryRun,\n"
    "        trigger: 'manual',\n"
    "        ...(limit !== undefined ? { limit } : {}),\n"
    "      });",
)
replace(
    "routes/admin.js",
    "      const result = await dateService.performMonthlyCheck();",
    "      const result = await dateService.performMonthlyCheck({ trigger: 'manual' });",
)
replace(
    "routes/supplier-admin.js",
    "      const results = await badgeManagement.evaluateAllSupplierBadges();",
    "      const results = await badgeManagement.evaluateAllSupplierBadges({ trigger: 'manual' });",
)

replace(
    "services/backgroundJobTelemetryBridge.js",
    "    trigger: summary && summary.dryRun ? 'dry-run' : 'scheduler',",
    "    trigger: summary && summary.dryRun ? 'dry-run' : summary?.trigger || 'scheduler',",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "function buildActionPromptFailureTelemetry(error, startedAt, finishedAt = new Date()) {",
    "function buildActionPromptFailureTelemetry(\n"
    "  error,\n"
    "  startedAt,\n"
    "  finishedAt = new Date(),\n"
    "  trigger = 'scheduler'\n"
    ") {",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "    trigger: 'scheduler',\n"
    "    startedAt,\n"
    "    finishedAt,\n"
    "    metrics: {\n"
    "      scanned: 0,",
    "    trigger,\n"
    "    startedAt,\n"
    "    finishedAt,\n"
    "    metrics: {\n"
    "      scanned: 0,",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "function buildDateManagementTelemetry(result, startedAt, finishedAt = new Date()) {",
    "function buildDateManagementTelemetry(\n"
    "  result,\n"
    "  startedAt,\n"
    "  finishedAt = new Date(),\n"
    "  trigger = 'scheduler'\n"
    ") {",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "    jobKey: telemetry.JOB_KEYS.DATE_MANAGEMENT,\n"
    "    status: failed ? 'failed' : disabled ? 'skipped' : limited ? 'warning' : 'success',\n"
    "    trigger: 'scheduler',",
    "    jobKey: telemetry.JOB_KEYS.DATE_MANAGEMENT,\n"
    "    status: failed ? 'failed' : disabled ? 'skipped' : limited ? 'warning' : 'success',\n"
    "    trigger,",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "function buildBadgeTelemetry(result, startedAt, finishedAt = new Date(), error = null) {",
    "function buildBadgeTelemetry(\n"
    "  result,\n"
    "  startedAt,\n"
    "  finishedAt = new Date(),\n"
    "  error = null,\n"
    "  trigger = 'scheduler'\n"
    ") {",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "    jobKey: telemetry.JOB_KEYS.BADGE_EVALUATION,\n"
    "    status: failed ? 'failed' : errors > 0 ? 'warning' : 'success',\n"
    "    trigger: 'scheduler',",
    "    jobKey: telemetry.JOB_KEYS.BADGE_EVALUATION,\n"
    "    status: failed ? 'failed' : errors > 0 ? 'warning' : 'success',\n"
    "    trigger,",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "  actionPromptService.getSupplierActionItems = async function instrumentedActionPromptItems(\n"
    "    ...args\n"
    "  ) {\n"
    "    const startedAt = new Date();",
    "  actionPromptService.getSupplierActionItems = async function instrumentedActionPromptItems(\n"
    "    ...args\n"
    "  ) {\n"
    "    const startedAt = new Date();\n"
    "    const trigger = args[0]?.telemetryTrigger || 'scheduler';",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "        buildActionPromptFailureTelemetry(error, startedAt, new Date()),",
    "        buildActionPromptFailureTelemetry(error, startedAt, new Date(), trigger),",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "  prototype.performMonthlyCheck = async function instrumentedMonthlyCheck(...args) {\n"
    "    const startedAt = new Date();",
    "  prototype.performMonthlyCheck = async function instrumentedMonthlyCheck(...args) {\n"
    "    const startedAt = new Date();\n"
    "    const trigger = args[0]?.trigger || 'scheduler';",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "        buildDateManagementTelemetry(result, startedAt, new Date()),",
    "        buildDateManagementTelemetry(result, startedAt, new Date(), trigger),",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "        buildDateManagementTelemetry({ error: error.message }, startedAt, new Date()),",
    "        buildDateManagementTelemetry(\n"
    "          { error: error.message },\n"
    "          startedAt,\n"
    "          new Date(),\n"
    "          trigger\n"
    "        ),",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "  badgeManagement.evaluateAllSupplierBadges = async function instrumentedBadgeEvaluation(...args) {\n"
    "    const startedAt = new Date();",
    "  badgeManagement.evaluateAllSupplierBadges = async function instrumentedBadgeEvaluation(...args) {\n"
    "    const startedAt = new Date();\n"
    "    const trigger = args[0]?.trigger || 'scheduler';",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "      await persistTelemetry(recordRun, buildBadgeTelemetry(result, startedAt, new Date()), log);",
    "      await persistTelemetry(\n"
    "        recordRun,\n"
    "        buildBadgeTelemetry(result, startedAt, new Date(), null, trigger),\n"
    "        log\n"
    "      );",
)
replace(
    "services/backgroundJobTelemetryBridge.js",
    "        buildBadgeTelemetry(null, startedAt, new Date(), error),",
    "        buildBadgeTelemetry(null, startedAt, new Date(), error, trigger),",
)

replace(
    "services/backgroundJobTelemetry.service.js",
    "      trigger: run.dryRun ? 'dry-run' : 'scheduler',",
    "      trigger: run.dryRun ? 'dry-run' : run.trigger || 'scheduler',",
)
replace(
    "services/backgroundJobTelemetry.service.js",
    "  const latest = ordered[0] || null;\n"
    "  const latestSuccess =\n"
    "    ordered.find(run => run.status === 'success' || run.status === 'warning') || null;\n"
    "  const latestFailure = ordered.find(run => run.status === 'failed') || null;\n"
    "  const nextRun =\n"
    "    (runtime && toIso(runtime.nextRun)) || estimateNextRun(definition, latestSuccess, now);",
    "  const schedulerHistory = ordered.filter(\n"
    "    run => run.trigger !== 'manual' && run.trigger !== 'dry-run'\n"
    "  );\n"
    "  const latest = ordered[0] || null;\n"
    "  const latestScheduled = schedulerHistory[0] || null;\n"
    "  const latestSuccess =\n"
    "    schedulerHistory.find(run => run.status === 'success' || run.status === 'warning') || null;\n"
    "  const latestFailure = schedulerHistory.find(run => run.status === 'failed') || null;\n"
    "  const nextRun =\n"
    "    (runtime && toIso(runtime.nextRun)) || estimateNextRun(definition, latestSuccess, now);",
)
replace(
    "services/backgroundJobTelemetry.service.js",
    "      ordered,\n"
    "      now\n"
    "    ),\n"
    "    telemetry: getVisibility(definition, ordered),",
    "      schedulerHistory,\n"
    "      now\n"
    "    ),\n"
    "    telemetry: getVisibility(definition, ordered),",
)
replace(
    "services/backgroundJobTelemetry.service.js",
    "    lastAttempt: latest ? latest.finishedAt || latest.startedAt : null,",
    "    lastAttempt: latestScheduled\n"
    "      ? latestScheduled.finishedAt || latestScheduled.startedAt\n"
    "      : null,",
)

Path("tests/unit/background-job-trigger-attribution.test.js").write_text(
    """'use strict';

const originalAutoinstall = process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL;
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
      buildActionPromptFailureTelemetry(
        new Error('failed'),
        new Date(),
        new Date(),
        'manual'
      ).trigger
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
    await expect(
      actionService.getSupplierActionItems({ telemetryTrigger: 'manual' })
    ).rejects.toBe(actionError);

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
        return [];
      }),
    };

    const data = await getDashboardData({ db, now, log: { warn: jest.fn() } });
    const job = data.jobs.find(item => item.key === JOB_KEYS.DATE_MANAGEMENT);
    expect(job.telemetry).toBe('full');
    expect(job.health).toBe('unknown');
    expect(job.lastAttempt).toBeNull();
    expect(job.history[0].trigger).toBe('manual');
  });

  test('production and manual call sites preload and propagate trigger context', () => {
    const root = path.resolve(__dirname, '../..');
    const railway = fs.readFileSync(path.join(root, 'railway.json'), 'utf8');
    const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
    const supplierAdmin = fs.readFileSync(path.join(root, 'routes/supplier-admin.js'), 'utf8');
    const scheduler = fs.readFileSync(
      path.join(root, 'services/actionPromptScheduler.js'),
      'utf8'
    );

    expect(railway).toContain('node -r ./services/backgroundJobTelemetryBridge.js server.js');
    expect(admin).toContain("trigger: 'manual'");
    expect(admin).toContain("performMonthlyCheck({ trigger: 'manual' })");
    expect(supplierAdmin).toContain("evaluateAllSupplierBadges({ trigger: 'manual' })");
    expect(scheduler).toContain('getSupplierActionItems({ telemetryTrigger: trigger })');
  });
});
"""
)
