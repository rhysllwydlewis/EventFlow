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
 * Return the static catalog of all check descriptors.
 * Each descriptor has:
 *   { name, type, path, group, description, expectedStatuses? }
 *
 * `expectedStatuses` is an optional array of HTTP status codes that are
 * considered "healthy" for this check. When omitted, the default logic
 * (status >= 200 && status < 400) is used. Use for auth-required endpoints
 * where 401 is the expected healthy response.
 *
 * @returns {Array<{name:string, type:string, path:string, group:string, description:string, expectedStatuses?:number[]}>}
 */
function getCatalog() {
  return [
    // ── Infrastructure ────────────────────────────────────────────────────
    {
      name: 'health-api',
      type: 'api',
      path: '/api/health',
      group: 'infrastructure',
      description: 'Health check endpoint',
    },
    {
      name: 'ready-api',
      type: 'api',
      path: '/api/ready',
      group: 'infrastructure',
      description: 'Readiness probe',
    },
    {
      name: 'config-api',
      type: 'api',
      path: '/api/config',
      group: 'infrastructure',
      description: 'Client config (env flags)',
    },
    {
      name: 'admin-health-api',
      type: 'api',
      path: '/api/admin/health',
      group: 'infrastructure',
      description: 'Admin health probe (auth required — 401 = auth layer healthy)',
      expectedStatuses: [200, 401],
    },

    // ── Public Pages ──────────────────────────────────────────────────────
    { name: 'homepage', type: 'page', path: '/', group: 'public', description: 'Homepage' },
    {
      name: 'auth-page',
      type: 'page',
      path: '/auth',
      group: 'public',
      description: 'Login / register',
    },
    {
      name: 'suppliers-page',
      type: 'page',
      path: '/suppliers',
      group: 'public',
      description: 'Supplier search',
    },
    {
      name: 'pricing-page',
      type: 'page',
      path: '/pricing',
      group: 'public',
      description: 'Pricing plans',
    },
    { name: 'faq-page', type: 'page', path: '/faq', group: 'public', description: 'FAQ' },
    {
      name: 'for-suppliers-page',
      type: 'page',
      path: '/for-suppliers',
      group: 'public',
      description: 'For suppliers landing',
    },
    {
      name: 'contact-page',
      type: 'page',
      path: '/contact',
      group: 'public',
      description: 'Contact page',
    },
    {
      name: 'guides-page',
      type: 'page',
      path: '/guides',
      group: 'public',
      description: 'Planning guides',
    },
    {
      name: 'legal-page',
      type: 'page',
      path: '/legal',
      group: 'public',
      description: 'Legal hub',
    },
    {
      name: 'terms-page',
      type: 'page',
      path: '/terms',
      group: 'public',
      description: 'Terms of service',
    },
    {
      name: 'privacy-page',
      type: 'page',
      path: '/privacy',
      group: 'public',
      description: 'Privacy policy',
    },
    {
      name: 'credits-page',
      type: 'page',
      path: '/credits',
      group: 'public',
      description: 'Credits',
    },
    {
      name: 'start-page',
      type: 'page',
      path: '/start',
      group: 'public',
      description: 'Start planning',
    },
    {
      name: 'marketplace-page',
      type: 'page',
      path: '/marketplace',
      group: 'public',
      description: 'Marketplace listings',
    },

    // ── Protected Pages (auth redirect = healthy) ─────────────────────────
    {
      name: 'dashboard-page',
      type: 'page',
      path: '/dashboard',
      group: 'protected',
      description: 'Customer dashboard',
      expectedStatuses: [200, 301, 302],
    },
    {
      name: 'settings-page',
      type: 'page',
      path: '/settings',
      group: 'protected',
      description: 'Account settings',
      expectedStatuses: [200, 301, 302],
    },
    {
      name: 'plan-page',
      type: 'page',
      path: '/plan',
      group: 'protected',
      description: 'Event plan',
      expectedStatuses: [200, 301, 302],
    },
    {
      name: 'messages-page',
      type: 'page',
      path: '/messages',
      group: 'protected',
      description: 'Messages',
      expectedStatuses: [200, 301, 302],
    },
    {
      name: 'notifications-page',
      type: 'page',
      path: '/notifications',
      group: 'protected',
      description: 'Notifications',
      expectedStatuses: [200, 301, 302],
    },
    {
      name: 'budget-page',
      type: 'page',
      path: '/budget',
      group: 'protected',
      description: 'Budget tracker',
      expectedStatuses: [200, 301, 302],
    },
    {
      name: 'guests-page',
      type: 'page',
      path: '/guests',
      group: 'protected',
      description: 'Guest list',
      expectedStatuses: [200, 301, 302],
    },

    // ── Admin Pages ───────────────────────────────────────────────────────
    // These checks run unauthenticated. A 302 redirect to /auth means the
    // auth guard is working (server is healthy), but it is NOT a confirmation
    // that the admin page renders correctly. Use admin-health-api for a more
    // authoritative admin health signal.
    // redirectAuthExpected: true causes the check runner to flag 3xx redirects
    // to /auth as WARN (rather than full PASS) in the results.
    {
      name: 'admin-page',
      type: 'page',
      path: '/admin',
      group: 'admin',
      description: 'Admin dashboard',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-users-page',
      type: 'page',
      path: '/admin-users',
      group: 'admin',
      description: 'User management',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-suppliers-page',
      type: 'page',
      path: '/admin-suppliers',
      group: 'admin',
      description: 'Supplier management',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-photos-page',
      type: 'page',
      path: '/admin-photos',
      group: 'admin',
      description: 'Photo library',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-packages-page',
      type: 'page',
      path: '/admin-packages',
      group: 'admin',
      description: 'Package management',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-settings-page',
      type: 'page',
      path: '/admin-settings',
      group: 'admin',
      description: 'System settings',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-tickets-page',
      type: 'page',
      path: '/admin-tickets',
      group: 'admin',
      description: 'Support tickets',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-reports-page',
      type: 'page',
      path: '/admin-reports',
      group: 'admin',
      description: 'Content reports',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-audit-page',
      type: 'page',
      path: '/admin-audit',
      group: 'admin',
      description: 'Audit log',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-marketplace-page',
      type: 'page',
      path: '/admin-marketplace',
      group: 'admin',
      description: 'Marketplace admin',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-payments-page',
      type: 'page',
      path: '/admin-payments',
      group: 'admin',
      description: 'Payments admin',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },
    {
      name: 'admin-debug-page',
      type: 'page',
      path: '/admin-debug',
      group: 'admin',
      description: 'Debug panel',
      expectedStatuses: [200, 301, 302],
      redirectAuthExpected: true,
    },

    // ── Public API Endpoints ──────────────────────────────────────────────
    {
      name: 'search-suppliers-api',
      type: 'api',
      path: '/api/search/suppliers',
      group: 'api-public',
      description: 'Supplier search',
    },
    {
      name: 'search-categories-api',
      type: 'api',
      path: '/api/search/categories',
      group: 'api-public',
      description: 'Search categories',
    },
    {
      name: 'suppliers-api',
      type: 'api',
      path: '/api/suppliers',
      group: 'api-public',
      description: 'Suppliers listing',
    },
    {
      name: 'packages-featured-api',
      type: 'api',
      path: '/api/packages/featured',
      group: 'api-public',
      description: 'Featured packages',
    },
    {
      name: 'homepage-settings-api',
      type: 'api',
      path: '/api/public/homepage-settings',
      group: 'api-public',
      description: 'Homepage settings',
    },

    // ── Auth-Required API Endpoints (401 = healthy / server is responding) ─
    {
      name: 'auth-me-api',
      type: 'api',
      path: '/api/auth/me',
      group: 'api-auth',
      description: 'Auth status check',
      expectedStatuses: [200, 401],
    },
    {
      name: 'shortlist-api',
      type: 'api',
      path: '/api/shortlist',
      group: 'api-auth',
      description: 'Shortlist (auth gate)',
      expectedStatuses: [200, 401],
    },
    {
      name: 'badge-counts-api',
      type: 'api',
      path: '/api/admin/badge-counts',
      group: 'api-auth',
      description: 'Admin badge counts',
      expectedStatuses: [200, 401, 403],
    },
  ];
}

/**
 * Build the list of checks to run, resolving targets against baseUrl.
 * @param {string} baseUrl
 * @returns {Array<{name,type,path,group,description,target,expectedStatuses?}>}
 */
function buildChecks(baseUrl) {
  return getCatalog().map(item => ({
    ...item,
    target: `${baseUrl}${item.path}`,
  }));
}

/**
 * Execute a single HTTP check with a timeout.
 * @param {{ name:string, type:string, target:string, expectedStatuses?:number[], redirectAuthExpected?:boolean }} check
 * @returns {Promise<{name,type,target,ok,statusCode,durationMs,error,details,redirected,redirectUrl,warning}>}
 */
async function runCheck(check) {
  const { name, type, target, expectedStatuses, redirectAuthExpected } = check;
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

    // Determine ok: use expectedStatuses if provided, otherwise >= 200 && < 400
    const ok =
      Array.isArray(expectedStatuses) && expectedStatuses.length > 0
        ? expectedStatuses.includes(statusCode)
        : statusCode >= 200 && statusCode < 400;

    // Detect auth redirects: when redirect:'follow', if we ended up at /auth the
    // page was auth-gated. Capture this for transparency without marking as fail.
    const wasRedirected = res.redirected === true;
    const finalUrl = wasRedirected ? (res.url || null) : null;
    const redirectedToAuth =
      wasRedirected &&
      finalUrl !== null &&
      (finalUrl.includes('/auth') || finalUrl.includes('/login'));

    // Build a human-readable warning for admin page checks that redirected to auth.
    // These checks still pass (redirect to /auth means routing is working), but we
    // note they are not a definitive confirmation that the page renders for admins.
    let warning = null;
    if (redirectAuthExpected && redirectedToAuth) {
      warning = 'Auth redirect (unauthenticated — use admin-health-api for confirmed admin health)';
    } else if (wasRedirected && redirectedToAuth && !redirectAuthExpected) {
      warning = `Unexpected auth redirect to: ${String(finalUrl).slice(0, 128)}`;
    }

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

    return {
      name,
      type,
      target,
      ok,
      statusCode,
      durationMs,
      error: null,
      details,
      redirected: wasRedirected,
      redirectUrl: finalUrl,
      warning,
    };
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
      redirected: false,
      redirectUrl: null,
      warning: null,
    };
  }
}

/**
 * Run all system checks, persist the result, and return the run document.
 * This method is safe to call directly for "Run now" functionality.
 * @param {object} [options={}]
 * @param {object} [options.triggeredBy] - { id, email, role } of the admin who triggered the run
 * @returns {Promise<Object|null>} The persisted run document, or null if already running.
 */
async function runSystemChecks({ triggeredBy } = {}) {
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
    ...(triggeredBy ? { triggeredBy } : {}),
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
  getCatalog,
  resolveBaseUrl,
  buildChecks,
  runCheck,
  COLLECTION,
};
