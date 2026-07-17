'use strict';

const crypto = require('crypto');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const COLLECTION = 'background_job_runs';
const DEFAULT_HISTORY_LIMIT = 6;
const MAX_HISTORY_LIMIT = 20;
const MAX_ERROR_LENGTH = 500;

const JOB_KEYS = Object.freeze({
  SYSTEM_CHECKS: 'system-checks',
  ACTION_PROMPTS: 'action-prompts',
  DATE_MANAGEMENT: 'date-management',
  BADGE_EVALUATION: 'badge-evaluation',
  REVIEW_REQUEST_MAINTENANCE: 'review-request-maintenance',
});

function envEnabled(name, defaultValue) {
  const configured = process.env[name];
  if (configured === undefined) {
    return defaultValue;
  }
  return configured !== 'false' && configured !== '0';
}

function safeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value) {
  const date = safeDate(value);
  return date ? date.toISOString() : null;
}

function sanitizeError(value) {
  if (!value) {
    return null;
  }
  return String(value)
    .replace(/https?:\/\/[^\s]+/gi, '[url removed]')
    .replace(/((?:token|secret|password|key))=([^\s&]+)/gi, '$1=[redacted]')
    .trim()
    .slice(0, MAX_ERROR_LENGTH);
}

function sanitizeMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metrics)
      .filter(
        ([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null
      )
      .slice(0, 30)
      .map(([key, value]) => [
        String(key).slice(0, 80),
        typeof value === 'string' ? value.slice(0, 200) : value,
      ])
  );
}

function normaliseStatus(status) {
  return ['success', 'warning', 'failed', 'skipped'].includes(status) ? status : 'failed';
}

async function recordRun(
  {
    jobKey,
    status,
    trigger = 'scheduler',
    startedAt = new Date(),
    finishedAt = new Date(),
    metrics = {},
    error = null,
    metadata = {},
  },
  { db = dbUnified, log = logger } = {}
) {
  if (!jobKey || typeof jobKey !== 'string') {
    throw new TypeError('background job telemetry requires a jobKey');
  }

  const start = safeDate(startedAt) || new Date();
  const finish = safeDate(finishedAt) || new Date();
  const document = {
    id: `jobrun_${crypto.randomUUID()}`,
    jobKey: jobKey.slice(0, 120),
    status: normaliseStatus(status),
    trigger: String(trigger || 'scheduler').slice(0, 80),
    startedAt: start.toISOString(),
    finishedAt: finish.toISOString(),
    durationMs: Math.max(0, finish.getTime() - start.getTime()),
    metrics: sanitizeMetrics(metrics),
    error: sanitizeError(error),
    metadata: sanitizeMetrics(metadata),
    environment: process.env.NODE_ENV || 'development',
    createdAt: finish.toISOString(),
  };

  try {
    const inserted = await db.insertOne(COLLECTION, document);
    if (!inserted) {
      log.warn(`[background-jobs] Run was not persisted for ${jobKey}`);
    }
  } catch (persistError) {
    log.warn(`[background-jobs] Could not persist run for ${jobKey}:`, persistError.message);
  }

  return document;
}

function getDefinitions(now = new Date()) {
  const production = process.env.NODE_ENV === 'production';
  const badgeHours = Math.max(1, Number.parseInt(process.env.BADGE_EVAL_INTERVAL_HOURS, 10) || 24);

  return [
    {
      key: JOB_KEYS.SYSTEM_CHECKS,
      name: 'System checks',
      description: 'Checks public, protected and admin routes plus core APIs.',
      source: 'services/systemCheckService.js',
      schedule: process.env.SYSTEM_CHECKS_CRON || '0 3 * * *',
      scheduleSource: process.env.SYSTEM_CHECKS_CRON ? 'environment' : 'default',
      enabled: envEnabled('SYSTEM_CHECKS_ENABLED', production),
      expectedIntervalMs: 24 * 60 * 60 * 1000,
      staleAfterMs: 36 * 60 * 60 * 1000,
      legacyTelemetry: 'system_checks',
    },
    {
      key: JOB_KEYS.ACTION_PROMPTS,
      name: 'Supplier action prompts',
      description:
        'Evaluates supplier action items and sends reminder emails within the configured cap.',
      source: 'services/actionPromptScheduler.js',
      schedule: process.env.ACTION_PROMPTS_CRON || '0 9 * * *',
      scheduleSource: process.env.ACTION_PROMPTS_CRON ? 'environment' : 'settings/default',
      enabled: envEnabled('ACTION_PROMPTS_ENABLED', production),
      expectedIntervalMs: 24 * 60 * 60 * 1000,
      staleAfterMs: 36 * 60 * 60 * 1000,
      legacyTelemetry: 'settings.emailAutomation.actionPrompts.runHistory',
    },
    {
      key: JOB_KEYS.DATE_MANAGEMENT,
      name: 'Legal date management',
      description:
        'Checks legal-document git history and updates published dates when content changes.',
      source: 'services/dateManagementService.js',
      schedule: '0 2 1 * *',
      scheduleSource: 'default',
      enabled: true,
      expectedIntervalMs: 31 * 24 * 60 * 60 * 1000,
      staleAfterMs: 40 * 24 * 60 * 60 * 1000,
      legacyTelemetry: 'audit_logs (updates only)',
    },
    {
      key: JOB_KEYS.BADGE_EVALUATION,
      name: 'Supplier badge evaluation',
      description: 'Re-evaluates supplier badges against the current badge definitions.',
      source: 'server.js / utils/badgeManagement.js',
      schedule: `every ${badgeHours} hour${badgeHours === 1 ? '' : 's'}`,
      scheduleSource: process.env.BADGE_EVAL_INTERVAL_HOURS ? 'environment' : 'default',
      enabled: true,
      expectedIntervalMs: badgeHours * 60 * 60 * 1000,
      staleAfterMs: Math.max(2, Math.ceil(badgeHours * 1.5)) * 60 * 60 * 1000,
      legacyTelemetry: null,
    },
    {
      key: JOB_KEYS.REVIEW_REQUEST_MAINTENANCE,
      name: 'Review-request expiry',
      description: 'Expires stale review invitations and releases their active reservation IDs.',
      source: 'services/reviewRequestMaintenance.service.js',
      schedule: process.env.REVIEW_REQUEST_MAINTENANCE_CRON || '15 * * * *',
      scheduleSource: process.env.REVIEW_REQUEST_MAINTENANCE_CRON ? 'environment' : 'default',
      enabled: envEnabled('REVIEW_REQUEST_MAINTENANCE_ENABLED', production),
      expectedIntervalMs: 60 * 60 * 1000,
      staleAfterMs: 3 * 60 * 60 * 1000,
      legacyTelemetry: 'reviewRequests.expiredAt (activity only)',
    },
  ].map(definition => ({ ...definition, registeredAt: toIso(now) }));
}

function estimateNextRun(definition, latestSuccess, now = new Date()) {
  const current = safeDate(now) || new Date();
  const latest = safeDate(latestSuccess && latestSuccess.finishedAt);

  if (definition.key === JOB_KEYS.BADGE_EVALUATION && latest) {
    return new Date(latest.getTime() + definition.expectedIntervalMs).toISOString();
  }

  const [minuteRaw, hourRaw, dayRaw, monthRaw, weekdayRaw] = String(definition.schedule).split(
    /\s+/
  );
  const simple = [minuteRaw, hourRaw, dayRaw, monthRaw, weekdayRaw].every(
    part => part === '*' || /^\d+$/.test(part)
  );
  if (!simple) {
    return null;
  }

  const candidate = new Date(current.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  const maxMinutes = 45 * 24 * 60;

  for (let i = 0; i < maxMinutes; i += 1) {
    const matches =
      (minuteRaw === '*' || candidate.getUTCMinutes() === Number(minuteRaw)) &&
      (hourRaw === '*' || candidate.getUTCHours() === Number(hourRaw)) &&
      (dayRaw === '*' || candidate.getUTCDate() === Number(dayRaw)) &&
      (monthRaw === '*' || candidate.getUTCMonth() + 1 === Number(monthRaw)) &&
      (weekdayRaw === '*' || candidate.getUTCDay() === Number(weekdayRaw));
    if (matches) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  return null;
}

function normaliseTelemetryRun(run, source = 'background_job_runs') {
  return {
    id: run.id || (run._id ? String(run._id) : null),
    status: normaliseStatus(run.status),
    trigger: run.trigger || 'scheduler',
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt || run.createdAt || run.startedAt),
    durationMs: Number.isFinite(run.durationMs) ? run.durationMs : null,
    metrics: sanitizeMetrics(run.metrics),
    error: sanitizeError(run.error),
    source,
  };
}

function normaliseSystemCheckRun(run) {
  const checks = Array.isArray(run.checks) ? run.checks : [];
  const failed = checks.filter(check => !check.ok).length;
  const warnings = checks.filter(check => check.ok && check.warning).length;
  return normaliseTelemetryRun(
    {
      ...run,
      status: run.status === 'pass' ? (warnings > 0 ? 'warning' : 'success') : 'failed',
      trigger: run.triggeredBy ? 'manual' : 'scheduler',
      metrics: {
        total: checks.length,
        passed: checks.length - failed,
        failed,
        warnings,
      },
      error: failed > 0 ? `${failed} system check${failed === 1 ? '' : 's'} failed` : null,
    },
    'system_checks'
  );
}

function normaliseActionPromptRun(run) {
  const errors = Number(run.errors || 0);
  return normaliseTelemetryRun(
    {
      ...run,
      status: errors > 0 || run.cappedByLimit ? 'warning' : 'success',
      trigger: run.dryRun ? 'dry-run' : 'scheduler',
      metrics: {
        scanned: Number(run.scanned || 0),
        sent: Number(run.sent || 0),
        skippedCadence: Number(run.skippedCadence || 0),
        errors,
        cappedByLimit: Boolean(run.cappedByLimit),
      },
      error: errors > 0 ? `${errors} supplier record${errors === 1 ? '' : 's'} failed` : null,
    },
    'settings.actionPromptHistory'
  );
}

function normaliseDateAuditRun(run) {
  return normaliseTelemetryRun(
    {
      ...run,
      status: 'success',
      trigger: 'scheduler',
      startedAt: run.timestamp || run.createdAt,
      finishedAt: run.timestamp || run.createdAt,
      metrics: { datesUpdated: true },
    },
    'audit_logs'
  );
}

function normaliseReviewActivity(run) {
  return normaliseTelemetryRun(
    {
      ...run,
      status: 'success',
      trigger: 'scheduler',
      startedAt: run.expiredAt,
      finishedAt: run.expiredAt,
      metrics: { expired: 1 },
    },
    'reviewRequests.expiredAt'
  );
}

async function safeQuery(label, operation, fallback, log = logger) {
  try {
    return await operation();
  } catch (error) {
    log.warn(`[background-jobs] Could not load ${label}:`, error.message);
    return fallback;
  }
}

function classifyHealth(definition, history, now = new Date()) {
  if (!definition.enabled) {
    return 'disabled';
  }
  const latest = history[0] || null;
  if (!latest) {
    return 'unknown';
  }
  if (latest.status === 'failed') {
    return 'failed';
  }
  const latestSuccess = history.find(run => run.status === 'success' || run.status === 'warning');
  const successAt = safeDate(latestSuccess && latestSuccess.finishedAt);
  if (successAt && now.getTime() - successAt.getTime() > definition.staleAfterMs) {
    return 'overdue';
  }
  if (latest.status === 'warning' || latest.status === 'skipped') {
    return 'warning';
  }
  return 'healthy';
}

function getVisibility(definition, history) {
  if (history.some(run => run.source === COLLECTION)) {
    return 'full';
  }
  if (history.length > 0 || definition.legacyTelemetry) {
    return 'partial';
  }
  return 'configuration-only';
}

function buildJob(definition, history, now, runtime = null) {
  const ordered = [...history].sort((a, b) => {
    const aDate = safeDate(a.finishedAt || a.startedAt);
    const bDate = safeDate(b.finishedAt || b.startedAt);
    return (bDate ? bDate.getTime() : 0) - (aDate ? aDate.getTime() : 0);
  });
  const latest = ordered[0] || null;
  const latestSuccess =
    ordered.find(run => run.status === 'success' || run.status === 'warning') || null;
  const latestFailure = ordered.find(run => run.status === 'failed') || null;
  const nextRun =
    (runtime && toIso(runtime.nextRun)) || estimateNextRun(definition, latestSuccess, now);

  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    source: definition.source,
    enabled:
      runtime && typeof runtime.scheduled === 'boolean' ? runtime.scheduled : definition.enabled,
    schedule: (runtime && (runtime.cronExpr || runtime.rule)) || definition.schedule,
    scheduleSource: definition.scheduleSource,
    nextRun,
    health: classifyHealth(
      {
        ...definition,
        enabled:
          runtime && typeof runtime.scheduled === 'boolean'
            ? runtime.scheduled
            : definition.enabled,
      },
      ordered,
      now
    ),
    telemetry: getVisibility(definition, ordered),
    legacyTelemetry: definition.legacyTelemetry,
    lastAttempt: latest ? latest.finishedAt || latest.startedAt : null,
    lastSuccess: latestSuccess ? latestSuccess.finishedAt || latestSuccess.startedAt : null,
    lastFailure: latestFailure ? latestFailure.finishedAt || latestFailure.startedAt : null,
    latestDurationMs: latest ? latest.durationMs : null,
    latestMetrics: latest ? latest.metrics : {},
    latestError: latest ? latest.error : null,
    history: ordered,
  };
}

async function getDashboardData({
  db = dbUnified,
  dateService = null,
  now = new Date(),
  historyLimit = DEFAULT_HISTORY_LIMIT,
  log = logger,
} = {}) {
  const safeLimit = Math.min(
    MAX_HISTORY_LIMIT,
    Math.max(1, Number.parseInt(historyLimit, 10) || DEFAULT_HISTORY_LIMIT)
  );
  const definitions = getDefinitions(now);

  const [telemetryRuns, systemRuns, settings, dateAudits, reviewActivity] = await Promise.all([
    safeQuery(
      'background job runs',
      () =>
        db.findWithOptions(
          COLLECTION,
          {},
          { sort: { startedAt: -1 }, limit: safeLimit * definitions.length }
        ),
      [],
      log
    ),
    safeQuery(
      'system-check history',
      () => db.findWithOptions('system_checks', {}, { sort: { startedAt: -1 }, limit: safeLimit }),
      [],
      log
    ),
    safeQuery('action-prompt history', () => db.read('settings'), {}, log),
    safeQuery(
      'date-management audit history',
      () =>
        db.findWithOptions(
          'audit_logs',
          { action: 'AUTO_DATE_UPDATE' },
          { sort: { timestamp: -1 }, limit: safeLimit }
        ),
      [],
      log
    ),
    safeQuery(
      'review-request expiry activity',
      () =>
        db.findWithOptions(
          'reviewRequests',
          { status: 'expired' },
          { sort: { expiredAt: -1 }, limit: safeLimit }
        ),
      [],
      log
    ),
  ]);

  const telemetryByJob = new Map();
  for (const run of Array.isArray(telemetryRuns) ? telemetryRuns : []) {
    if (!run || !run.jobKey) {
      continue;
    }
    const current = telemetryByJob.get(run.jobKey) || [];
    current.push(normaliseTelemetryRun(run));
    telemetryByJob.set(run.jobKey, current);
  }

  const actionHistory =
    settings && settings.emailAutomation && settings.emailAutomation.actionPrompts
      ? settings.emailAutomation.actionPrompts.runHistory || []
      : [];

  const legacyByJob = new Map([
    [JOB_KEYS.SYSTEM_CHECKS, (systemRuns || []).map(normaliseSystemCheckRun)],
    [JOB_KEYS.ACTION_PROMPTS, actionHistory.map(normaliseActionPromptRun)],
    [JOB_KEYS.DATE_MANAGEMENT, (dateAudits || []).map(normaliseDateAuditRun)],
    [JOB_KEYS.BADGE_EVALUATION, []],
    [JOB_KEYS.REVIEW_REQUEST_MAINTENANCE, (reviewActivity || []).map(normaliseReviewActivity)],
  ]);

  let dateRuntime = null;
  if (dateService && typeof dateService.getStatus === 'function') {
    try {
      dateRuntime = dateService.getStatus();
    } catch (error) {
      log.warn('[background-jobs] Could not read date service runtime status:', error.message);
    }
  }

  const jobs = definitions.map(definition => {
    const persisted = telemetryByJob.get(definition.key) || [];
    const legacy = legacyByJob.get(definition.key) || [];
    const combined = [...persisted, ...legacy]
      .sort(
        (a, b) =>
          new Date(b.finishedAt || b.startedAt || 0) - new Date(a.finishedAt || a.startedAt || 0)
      )
      .slice(0, safeLimit);
    return buildJob(
      definition,
      combined,
      safeDate(now) || new Date(),
      definition.key === JOB_KEYS.DATE_MANAGEMENT ? dateRuntime : null
    );
  });

  const attentionStates = new Set(['failed', 'overdue', 'warning']);
  const summary = {
    total: jobs.length,
    healthy: jobs.filter(job => job.health === 'healthy').length,
    attention: jobs.filter(job => attentionStates.has(job.health)).length,
    failed: jobs.filter(job => job.health === 'failed').length,
    overdue: jobs.filter(job => job.health === 'overdue').length,
    disabled: jobs.filter(job => job.health === 'disabled').length,
    unknown: jobs.filter(job => job.health === 'unknown').length,
    limitedTelemetry: jobs.filter(job => job.telemetry !== 'full').length,
  };

  return {
    generatedAt: (safeDate(now) || new Date()).toISOString(),
    summary,
    jobs,
  };
}

module.exports = {
  COLLECTION,
  DEFAULT_HISTORY_LIMIT,
  JOB_KEYS,
  classifyHealth,
  estimateNextRun,
  getDashboardData,
  getDefinitions,
  recordRun,
  sanitizeError,
  sanitizeMetrics,
};
