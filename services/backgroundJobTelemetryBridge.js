'use strict';

require('dotenv').config();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const telemetry = require('./backgroundJobTelemetry.service');

const DATE_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.date');
const BADGE_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.badge');
const INSERT_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.insertOne');
const WRITE_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.writeAndVerify');
const MAX_SEEN_RUNS = 200;
const ACTION_PROMPT_WRITE_WINDOW_MS = 10 * 60 * 1000;
const seenRuns = new Map();

function rememberRun(key) {
  if (!key || seenRuns.has(key)) {
    return false;
  }
  seenRuns.set(key, Date.now());
  while (seenRuns.size > MAX_SEEN_RUNS) {
    seenRuns.delete(seenRuns.keys().next().value);
  }
  return true;
}

function resetSeenRunsForTests() {
  seenRuns.clear();
}

function getFinishedAt(value) {
  return value && (value.finishedAt || value.createdAt || value.startedAt)
    ? value.finishedAt || value.createdAt || value.startedAt
    : new Date();
}

function isRecentRun(value, now = Date.now(), maxAgeMs = ACTION_PROMPT_WRITE_WINDOW_MS) {
  const finishedAt = getFinishedAt(value);
  const date = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
  return !Number.isNaN(date.getTime()) && Math.abs(now - date.getTime()) <= maxAgeMs;
}

function buildRunIdentity(jobKey, value) {
  const finishedAt = getFinishedAt(value);
  const date = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
  return `${jobKey}:${Number.isNaN(date.getTime()) ? String(finishedAt) : date.toISOString()}`;
}

function buildSystemCheckTelemetry(run) {
  const checks = Array.isArray(run && run.checks) ? run.checks : [];
  const failed = checks.filter(check => !check || check.ok !== true).length;
  const warnings = checks.filter(check => check && check.ok === true && check.warning).length;

  return {
    jobKey: telemetry.JOB_KEYS.SYSTEM_CHECKS,
    status: failed > 0 || (run && run.status === 'fail') ? 'failed' : 'success',
    trigger: run && run.triggeredBy ? 'manual' : 'scheduler',
    startedAt: run && run.startedAt,
    finishedAt: getFinishedAt(run),
    metrics: {
      total: checks.length,
      passed: Math.max(0, checks.length - failed),
      failed,
      warnings,
    },
    error: failed > 0 ? `${failed} system check${failed === 1 ? '' : 's'} failed` : null,
    metadata: { source: 'system_checks' },
  };
}

function buildActionPromptTelemetry(summary) {
  const errors = Number((summary && summary.errors) || 0);
  const cappedByLimit = Boolean(summary && summary.cappedByLimit);

  return {
    jobKey: telemetry.JOB_KEYS.ACTION_PROMPTS,
    status: errors > 0 || cappedByLimit ? 'warning' : 'success',
    trigger: summary && summary.dryRun ? 'dry-run' : 'scheduler',
    startedAt: summary && summary.startedAt,
    finishedAt: getFinishedAt(summary),
    metrics: {
      scanned: Number((summary && summary.scanned) || 0),
      sent: Number((summary && summary.sent) || 0),
      skippedCadence: Number((summary && summary.skippedCadence) || 0),
      errors,
      cappedByLimit,
    },
    error: errors > 0 ? `${errors} supplier record${errors === 1 ? '' : 's'} failed` : null,
    metadata: { source: 'settings.emailAutomation.actionPrompts.lastRun' },
  };
}

function buildDateManagementTelemetry(result, startedAt, finishedAt = new Date()) {
  const failed = Boolean(result && (result.error || result.success === false));
  const disabled = result && result.reason === 'Auto-update disabled';

  return {
    jobKey: telemetry.JOB_KEYS.DATE_MANAGEMENT,
    status: failed ? 'failed' : disabled ? 'skipped' : 'success',
    trigger: 'scheduler',
    startedAt,
    finishedAt,
    metrics: {
      performed: Boolean(result && result.performed),
      changed: Boolean(result && result.changed),
      datesUpdated: Boolean(result && result.success),
      autoUpdateDisabled: Boolean(disabled),
    },
    error: failed ? result.error || 'Legal date management did not complete successfully' : null,
    metadata: { source: 'DateManagementService.performMonthlyCheck' },
  };
}

function buildBadgeTelemetry(result, startedAt, finishedAt = new Date(), error = null) {
  const errors = Number((result && result.errors) || 0);
  const failed = Boolean(error);

  return {
    jobKey: telemetry.JOB_KEYS.BADGE_EVALUATION,
    status: failed ? 'failed' : errors > 0 ? 'warning' : 'success',
    trigger: 'scheduler',
    startedAt,
    finishedAt,
    metrics: {
      total: Number((result && result.total) || 0),
      evaluated: Number((result && result.evaluated) || 0),
      awarded: Number((result && result.awarded) || 0),
      revoked: Number((result && result.revoked) || 0),
      errors,
    },
    error: failed
      ? error.message || String(error)
      : errors > 0
        ? `${errors} supplier badge evaluation${errors === 1 ? '' : 's'} failed`
        : null,
    metadata: { source: 'badgeManagement.evaluateAllSupplierBadges' },
  };
}

async function persistTelemetry(recordRun, payload, log = logger) {
  try {
    await recordRun(payload);
  } catch (error) {
    log.warn('[background-jobs] Telemetry bridge could not record run:', error.message);
  }
}

function installDatabaseHooks({
  db = dbUnified,
  recordRun = telemetry.recordRun,
  log = logger,
} = {}) {
  if (db.insertOne && !db.insertOne[INSERT_MARK]) {
    const originalInsertOne = db.insertOne.bind(db);
    const wrappedInsertOne = async function wrappedInsertOne(collection, document, ...rest) {
      const result = await originalInsertOne(collection, document, ...rest);
      try {
        if (
          result !== false &&
          collection === 'system_checks' &&
          document &&
          rememberRun(buildRunIdentity(telemetry.JOB_KEYS.SYSTEM_CHECKS, document))
        ) {
          await persistTelemetry(recordRun, buildSystemCheckTelemetry(document), log);
        }
      } catch (error) {
        log.warn('[background-jobs] Could not bridge system-check telemetry:', error.message);
      }
      return result;
    };
    Object.defineProperty(wrappedInsertOne, INSERT_MARK, { value: true });
    db.insertOne = wrappedInsertOne;
  }

  if (db.writeAndVerify && !db.writeAndVerify[WRITE_MARK]) {
    const originalWriteAndVerify = db.writeAndVerify.bind(db);
    const wrappedWriteAndVerify = async function wrappedWriteAndVerify(key, value, ...rest) {
      const result = await originalWriteAndVerify(key, value, ...rest);
      try {
        const summary = value?.emailAutomation?.actionPrompts?.lastRun;
        if (
          result !== false &&
          key === 'settings' &&
          summary &&
          !summary.dryRun &&
          isRecentRun(summary) &&
          rememberRun(buildRunIdentity(telemetry.JOB_KEYS.ACTION_PROMPTS, summary))
        ) {
          await persistTelemetry(recordRun, buildActionPromptTelemetry(summary), log);
        }
      } catch (error) {
        log.warn('[background-jobs] Could not bridge action-prompt telemetry:', error.message);
      }
      return result;
    };
    Object.defineProperty(wrappedWriteAndVerify, WRITE_MARK, { value: true });
    db.writeAndVerify = wrappedWriteAndVerify;
  }

  return db;
}

function instrumentDateManagementService(
  DateManagementService,
  { recordRun = telemetry.recordRun, log = logger } = {}
) {
  const prototype = DateManagementService && DateManagementService.prototype;
  if (!prototype || typeof prototype.performMonthlyCheck !== 'function' || prototype[DATE_MARK]) {
    return DateManagementService;
  }

  const original = prototype.performMonthlyCheck;
  prototype.performMonthlyCheck = async function instrumentedMonthlyCheck(...args) {
    const startedAt = new Date();
    try {
      const result = await original.apply(this, args);
      await persistTelemetry(
        recordRun,
        buildDateManagementTelemetry(result, startedAt, new Date()),
        log
      );
      return result;
    } catch (error) {
      await persistTelemetry(
        recordRun,
        buildDateManagementTelemetry({ error: error.message }, startedAt, new Date()),
        log
      );
      throw error;
    }
  };
  Object.defineProperty(prototype, DATE_MARK, { value: true });
  return DateManagementService;
}

function instrumentBadgeManagement(
  badgeManagement,
  { recordRun = telemetry.recordRun, log = logger } = {}
) {
  if (
    !badgeManagement ||
    typeof badgeManagement.evaluateAllSupplierBadges !== 'function' ||
    badgeManagement[BADGE_MARK]
  ) {
    return badgeManagement;
  }

  const original = badgeManagement.evaluateAllSupplierBadges;
  badgeManagement.evaluateAllSupplierBadges = async function instrumentedBadgeEvaluation(...args) {
    const startedAt = new Date();
    try {
      const result = await original.apply(this, args);
      await persistTelemetry(recordRun, buildBadgeTelemetry(result, startedAt, new Date()), log);
      return result;
    } catch (error) {
      await persistTelemetry(
        recordRun,
        buildBadgeTelemetry(null, startedAt, new Date(), error),
        log
      );
      throw error;
    }
  };
  Object.defineProperty(badgeManagement, BADGE_MARK, { value: true });
  return badgeManagement;
}

function installServiceHooks({ recordRun = telemetry.recordRun, log = logger } = {}) {
  const DateManagementService = require('./dateManagementService');
  const badgeManagement = require('../utils/badgeManagement');
  instrumentDateManagementService(DateManagementService, { recordRun, log });
  instrumentBadgeManagement(badgeManagement, { recordRun, log });
}

function installBackgroundJobTelemetryBridge(options = {}) {
  installDatabaseHooks(options);
  installServiceHooks(options);
  return { installed: true };
}

if (process.env.BACKGROUND_JOB_TELEMETRY_BRIDGE_AUTOINSTALL !== 'false') {
  installBackgroundJobTelemetryBridge();
}

module.exports = {
  buildActionPromptTelemetry,
  buildBadgeTelemetry,
  buildDateManagementTelemetry,
  buildSystemCheckTelemetry,
  installBackgroundJobTelemetryBridge,
  installDatabaseHooks,
  installServiceHooks,
  instrumentBadgeManagement,
  instrumentDateManagementService,
  isRecentRun,
  resetSeenRunsForTests,
};
