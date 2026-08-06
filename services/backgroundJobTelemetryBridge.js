'use strict';

require('dotenv').config();

const dbUnified = require('../db-unified');
const logger = require('../utils/logger');
const telemetry = require('./backgroundJobTelemetry.service');

const DATE_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.date');
const BADGE_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.badge');
const ACTION_SERVICE_MARK = Symbol.for('eventflow.backgroundJobTelemetryBridge.actionService');
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

function getRunDate(value) {
  const candidate =
    value && (value.finishedAt || value.createdAt || value.startedAt)
      ? value.finishedAt || value.createdAt || value.startedAt
      : null;
  if (!candidate) {
    return null;
  }
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getFinishedAt(value) {
  return getRunDate(value) || new Date();
}

function isRecentRun(value, now = Date.now(), maxAgeMs = ACTION_PROMPT_WRITE_WINDOW_MS) {
  const date = getRunDate(value);
  return Boolean(date) && Math.abs(now - date.getTime()) <= maxAgeMs;
}

function buildRunIdentity(jobKey, value) {
  const date = getRunDate(value);
  return date ? `${jobKey}:${date.toISOString()}` : null;
}

function wasInsertSuccessful(result) {
  return Boolean(result);
}

function wasWriteVerified(result) {
  return result === true || Boolean(result && result.success === true && result.verified === true);
}

function buildSystemCheckTelemetry(run) {
  const checks = Array.isArray(run && run.checks) ? run.checks : [];
  const failed = checks.filter(check => !check || check.ok !== true).length;
  const warnings = checks.filter(check => check && check.ok === true && check.warning).length;
  const noResults = checks.length === 0;
  const runFailed = noResults || failed > 0 || (run && run.status === 'fail');

  return {
    jobKey: telemetry.JOB_KEYS.SYSTEM_CHECKS,
    status: runFailed ? 'failed' : 'success',
    trigger: run && run.triggeredBy ? 'manual' : 'scheduler',
    startedAt: run && run.startedAt,
    finishedAt: getFinishedAt(run),
    metrics: {
      total: checks.length,
      passed: Math.max(0, checks.length - failed),
      failed,
      warnings,
    },
    error: noResults
      ? 'System check run produced no check results'
      : failed > 0
        ? `${failed} system check${failed === 1 ? '' : 's'} failed`
        : null,
    metadata: { source: 'system_checks' },
  };
}

function buildActionPromptTelemetry(summary) {
  const errors = Number((summary && summary.errors) || 0);
  const cappedByLimit = Boolean(summary && summary.cappedByLimit);

  return {
    jobKey: telemetry.JOB_KEYS.ACTION_PROMPTS,
    status: errors > 0 || cappedByLimit ? 'warning' : 'success',
    trigger: summary && summary.dryRun ? 'dry-run' : summary?.trigger || 'scheduler',
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

function buildActionPromptFailureTelemetry(
  error,
  startedAt,
  finishedAt = new Date(),
  trigger = 'scheduler'
) {
  return {
    jobKey: telemetry.JOB_KEYS.ACTION_PROMPTS,
    status: 'failed',
    trigger,
    startedAt,
    finishedAt,
    metrics: {
      scanned: 0,
      sent: 0,
      skippedCadence: 0,
      errors: 1,
      cappedByLimit: false,
    },
    error: error && error.message ? error.message : String(error || 'Action prompt run failed'),
    metadata: { source: 'actionPromptService.getSupplierActionItems' },
  };
}

function buildDateManagementTelemetry(
  result,
  startedAt,
  finishedAt = new Date(),
  trigger = 'scheduler'
) {
  const validResult = Boolean(result && typeof result === 'object' && !Array.isArray(result));
  const failed = !validResult || Boolean(result && (result.error || result.success === false));
  const disabled =
    validResult &&
    (result.reason === 'Policy review reminders disabled' ||
      result.reason === 'Auto-update disabled');
  const limited =
    validResult &&
    !failed &&
    (result.evidenceAvailable === false ||
      String(result.reason || '').startsWith('No git history available') ||
      result.reason === 'Error checking changes');

  return {
    jobKey: telemetry.JOB_KEYS.DATE_MANAGEMENT,
    status: failed ? 'failed' : disabled ? 'skipped' : limited ? 'warning' : 'success',
    trigger,
    startedAt,
    finishedAt,
    metrics: {
      performed: Boolean(validResult && result.performed),
      changed: Boolean(validResult && result.changed),
      datesUpdated: Boolean(validResult && result.performed && result.success),
      autoUpdateDisabled: Boolean(disabled),
    },
    error: failed
      ? (result && result.error) || 'Legal date management returned no valid result'
      : limited
        ? result.reason
        : null,
    metadata: { source: 'DateManagementService.performMonthlyCheck' },
  };
}

function buildBadgeTelemetry(
  result,
  startedAt,
  finishedAt = new Date(),
  error = null,
  trigger = 'scheduler'
) {
  const validResult = Boolean(result && typeof result === 'object' && !Array.isArray(result));
  const errors = Number((validResult && result.errors) || 0);
  const failed = Boolean(error) || !validResult;

  return {
    jobKey: telemetry.JOB_KEYS.BADGE_EVALUATION,
    status: failed ? 'failed' : errors > 0 ? 'warning' : 'success',
    trigger,
    startedAt,
    finishedAt,
    metrics: {
      total: Number((validResult && result.total) || 0),
      evaluated: Number((validResult && result.evaluated) || 0),
      awarded: Number((validResult && result.awarded) || 0),
      revoked: Number((validResult && result.revoked) || 0),
      errors,
    },
    error: failed
      ? error && error.message
        ? error.message
        : error
          ? String(error)
          : 'Supplier badge evaluation returned no valid result'
      : errors > 0
        ? `${errors} supplier badge evaluation${errors === 1 ? '' : 's'} failed`
        : null,
    metadata: { source: 'badgeManagement.evaluateAllSupplierBadges' },
  };
}

async function persistTelemetry(recordRun, payload, log = logger) {
  try {
    return await recordRun(payload);
  } catch (error) {
    log.warn('[background-jobs] Telemetry bridge could not record run:', error.message);
    return null;
  }
}

async function getPreviousActionRunIdentity(db, key, log) {
  if (key !== 'settings' || !db || typeof db.read !== 'function') {
    return null;
  }
  try {
    const previousSettings = await db.read('settings');
    const previousSummary = previousSettings?.emailAutomation?.actionPrompts?.lastRun;
    return buildRunIdentity(telemetry.JOB_KEYS.ACTION_PROMPTS, previousSummary);
  } catch (error) {
    log.warn(
      '[background-jobs] Could not compare existing action-prompt telemetry:',
      error.message
    );
    return null;
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
        const identity = buildRunIdentity(telemetry.JOB_KEYS.SYSTEM_CHECKS, document);
        if (
          wasInsertSuccessful(result) &&
          collection === 'system_checks' &&
          document &&
          identity &&
          rememberRun(identity)
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
      const previousIdentity = await getPreviousActionRunIdentity(db, key, log);
      const result = await originalWriteAndVerify(key, value, ...rest);
      try {
        const summary = value?.emailAutomation?.actionPrompts?.lastRun;
        const identity = buildRunIdentity(telemetry.JOB_KEYS.ACTION_PROMPTS, summary);
        if (
          wasWriteVerified(result) &&
          key === 'settings' &&
          summary &&
          !summary.dryRun &&
          identity &&
          identity !== previousIdentity &&
          isRecentRun(summary) &&
          rememberRun(identity)
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

function instrumentActionPromptService(
  actionPromptService,
  { recordRun = telemetry.recordRun, log = logger } = {}
) {
  if (
    !actionPromptService ||
    typeof actionPromptService.getSupplierActionItems !== 'function' ||
    actionPromptService[ACTION_SERVICE_MARK]
  ) {
    return actionPromptService;
  }

  const original = actionPromptService.getSupplierActionItems;
  actionPromptService.getSupplierActionItems = async function instrumentedActionPromptItems(
    ...args
  ) {
    const startedAt = new Date();
    const trigger = args[0]?.telemetryTrigger || 'scheduler';
    try {
      return await original.apply(this, args);
    } catch (error) {
      await persistTelemetry(
        recordRun,
        buildActionPromptFailureTelemetry(error, startedAt, new Date(), trigger),
        log
      );
      throw error;
    }
  };
  Object.defineProperty(actionPromptService, ACTION_SERVICE_MARK, { value: true });
  return actionPromptService;
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
    const trigger = args[0]?.trigger || 'scheduler';
    try {
      const result = await original.apply(this, args);
      await persistTelemetry(
        recordRun,
        buildDateManagementTelemetry(result, startedAt, new Date(), trigger),
        log
      );
      return result;
    } catch (error) {
      await persistTelemetry(
        recordRun,
        buildDateManagementTelemetry({ error: error.message }, startedAt, new Date(), trigger),
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
    const trigger = args[0]?.trigger || 'scheduler';
    try {
      const result = await original.apply(this, args);
      await persistTelemetry(
        recordRun,
        buildBadgeTelemetry(result, startedAt, new Date(), null, trigger),
        log
      );
      return result;
    } catch (error) {
      await persistTelemetry(
        recordRun,
        buildBadgeTelemetry(null, startedAt, new Date(), error, trigger),
        log
      );
      throw error;
    }
  };
  Object.defineProperty(badgeManagement, BADGE_MARK, { value: true });
  return badgeManagement;
}

function installServiceHooks({ recordRun = telemetry.recordRun, log = logger } = {}) {
  const actionPromptService = require('./actionPromptService');
  const DateManagementService = require('./dateManagementService');
  const badgeManagement = require('../utils/badgeManagement');
  instrumentActionPromptService(actionPromptService, { recordRun, log });
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
  buildActionPromptFailureTelemetry,
  buildActionPromptTelemetry,
  buildBadgeTelemetry,
  buildDateManagementTelemetry,
  buildRunIdentity,
  buildSystemCheckTelemetry,
  installBackgroundJobTelemetryBridge,
  installDatabaseHooks,
  installServiceHooks,
  instrumentActionPromptService,
  instrumentBadgeManagement,
  instrumentDateManagementService,
  isRecentRun,
  resetSeenRunsForTests,
  wasInsertSuccessful,
  wasWriteVerified,
};
