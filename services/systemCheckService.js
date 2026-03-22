/**
 * System Check Service
 * Daily automated health checks for the EventFlow application.
 *
 * Runs a configurable set of checks against the live site, stores each run
 * as a document in the `system_checks` MongoDB collection, and exposes a
 * method to schedule the job via node-schedule.
 *
 * Environment variables:
 *   SYSTEM_CHECKS_ENABLED   - 'false' to disable (default: enabled in production)
 *   SYSTEM_CHECKS_CRON      - cron expression (default: '0 3 * * *')
 *   SYSTEM_CHECKS_BASE_URL  - override base URL (default: BASE_URL or localhost:PORT)
 */

'use strict';

const schedule = require('node-schedule');
const dbUnified = require('../db-unified');
const logger = require('../utils/logger');

const COLLECTION = 'system_checks';
const DEFAULT_CRON = '0 3 * * *';
const CHECK_TIMEOUT_MS = 10000; // 10 s per check

// In-memory lock to prevent overlapping runs
let _running = false;

/**
 * Derive the base URL for checks.
 * Priority: SYSTEM_CHECKS_BASE_URL > BASE_URL > http://localhost:<PORT|3000>
 * @returns {string}
 */
function resolveBaseUrl() {
  if (process.env.SYSTEM_CHECKS_BASE_URL) {
    return process.env.SYSTEM_CHECKS_BASE_URL.replace(/\/$/, '');
  }
  if (process.env.BASE_URL) {
    return process.env.BASE_URL.replace(/\/$/, '');
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

/**
 * Build the list of checks to run.
 * Each check descriptor:
 *   { name, type, target }   — target is a path, resolved against baseUrl
 * @param {string} baseUrl
 * @returns {Array<{name:string, type:string, target:string}>}
 */
function buildChecks(baseUrl) {
  return [
    { name: 'health-api', type: 'api', target: `${baseUrl}/api/health` },
    { name: 'ready-api', type: 'api', target: `${baseUrl}/api/ready` },
    { name: 'homepage', type: 'page', target: `${baseUrl}/` },
    { name: 'auth-page', type: 'page', target: `${baseUrl}/auth` },
  ];
}

/**
 * Execute a single HTTP check with a timeout.
 * @param {{ name:string, type:string, target:string }} check
 * @returns {Promise<{name,type,target,ok,statusCode,durationMs,error,details}>}
 */
async function runCheck(check) {
  const { name, type, target } = check;
  const startMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  try {
    const res = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'EventFlow-SystemCheck/1.0' },
      redirect: 'follow',
    });

    clearTimeout(timer);
    const durationMs = Date.now() - startMs;
    const statusCode = res.status;
    const ok = statusCode >= 200 && statusCode < 400;

    // For API checks, attempt to parse JSON for extra details
    const details = {};
    if (type === 'api' && ok) {
      try {
        const body = await res.json();
        if (body && typeof body === 'object') {
          // Capture health status field if present (never expose sensitive data)
          if (body.status) {
            details.status = String(body.status).slice(0, 64);
          }
        }
      } catch {
        // JSON parse failure is non-fatal
      }
    }

    return { name, type, target, ok, statusCode, durationMs, error: null, details };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - startMs;

    // Sanitize error message — strip any potential secrets or full URLs
    const errorMsg =
      err.name === 'AbortError'
        ? `Timeout after ${CHECK_TIMEOUT_MS}ms`
        : String(err.message || 'Unknown error').slice(0, 256);

    return {
      name,
      type,
      target,
      ok: false,
      statusCode: null,
      durationMs,
      error: errorMsg,
      details: {},
    };
  }
}

/**
 * Run all system checks, persist the result, and return the run document.
 * This method is safe to call directly for "Run now" functionality.
 * @returns {Promise<Object>} The persisted run document.
 */
async function runSystemChecks() {
  if (_running) {
    logger.warn('[SystemCheck] A run is already in progress — skipping overlapping run');
    return null;
  }

  _running = true;
  const startedAt = new Date();
  const baseUrl = resolveBaseUrl();
  const environment = process.env.NODE_ENV || 'development';

  logger.info(`[SystemCheck] Starting system checks (${environment}) against ${baseUrl}`);

  let checks = [];
  try {
    const checkDefs = buildChecks(baseUrl);
    checks = await Promise.all(checkDefs.map(runCheck));
  } catch (err) {
    logger.error('[SystemCheck] Unexpected error running checks:', err.message);
  }

  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;
  const anyFailed = checks.some(c => !c.ok);
  const status = anyFailed ? 'fail' : 'pass';

  const failedCount = checks.filter(c => !c.ok).length;
  logger.info(
    `[SystemCheck] Run complete — status=${status}, ` +
      `${checks.length - failedCount}/${checks.length} checks passed, ` +
      `duration=${durationMs}ms`
  );

  const runDoc = {
    startedAt,
    finishedAt,
    durationMs,
    status,
    environment,
    baseUrl,
    checks,
  };

  // Persist to MongoDB (non-fatal: log warning and continue if unavailable)
  try {
    await dbUnified.insertOne(COLLECTION, runDoc);
    logger.info('[SystemCheck] Run persisted to MongoDB');
  } catch (dbErr) {
    logger.warn('[SystemCheck] Could not persist run to MongoDB:', dbErr.message);
    logger.warn('[SystemCheck] Run result (not saved):', JSON.stringify(runDoc));
  }

  _running = false;
  return runDoc;
}

/**
 * Return the latest N system-check runs, newest first.
 * @param {number} [limit=30]
 * @returns {Promise<Array>}
 */
async function getRecentRuns(limit = 30) {
  try {
    return await dbUnified.findWithOptions(COLLECTION, {}, { sort: { startedAt: -1 }, limit });
  } catch (err) {
    logger.error('[SystemCheck] Error fetching recent runs:', err.message);
    return [];
  }
}

/**
 * Schedule daily system checks.
 * Respects SYSTEM_CHECKS_ENABLED and SYSTEM_CHECKS_CRON env vars.
 * @returns {{ scheduled: boolean, cronExpr: string, nextRun: Date|null }}
 */
function scheduleChecks() {
  // Default: enabled in production, disabled in other environments unless explicitly set
  const enabledEnv = process.env.SYSTEM_CHECKS_ENABLED;
  const isProduction = process.env.NODE_ENV === 'production';
  const enabled =
    enabledEnv !== undefined ? enabledEnv !== 'false' && enabledEnv !== '0' : isProduction;

  if (!enabled) {
    logger.info('[SystemCheck] Scheduler disabled (SYSTEM_CHECKS_ENABLED != true)');
    return { scheduled: false, cronExpr: null, nextRun: null };
  }

  const cronExpr = process.env.SYSTEM_CHECKS_CRON || DEFAULT_CRON;

  const job = schedule.scheduleJob(cronExpr, async () => {
    try {
      await runSystemChecks();
    } catch (err) {
      logger.error('[SystemCheck] Scheduled run failed:', err.message);
    }
  });

  if (!job) {
    logger.error('[SystemCheck] Failed to schedule job — invalid cron expression?', cronExpr);
    return { scheduled: false, cronExpr, nextRun: null };
  }

  const nextRun = job.nextInvocation();
  logger.info(
    `[SystemCheck] Scheduled daily checks: cron="${cronExpr}", nextRun=${nextRun ? nextRun.toISOString() : 'unknown'}`
  );

  return { scheduled: true, cronExpr, nextRun };
}

module.exports = {
  runSystemChecks,
  scheduleChecks,
  getRecentRuns,
  resolveBaseUrl,
  buildChecks,
  runCheck,
  COLLECTION,
};
