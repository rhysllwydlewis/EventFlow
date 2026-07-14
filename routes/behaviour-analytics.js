'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const db = require('../db');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired, getUserFromCookie } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const {
  COLLECTION_NAME,
  DEFAULT_RETENTION_DAYS,
  sanitizeEvent,
  buildSummary,
} = require('../utils/behaviourAnalytics');
const { buildDecisionSummary } = require('../utils/behaviourAnalyticsDecision');

const router = express.Router();
const CONSENT_COOKIE_NAME = 'eventflow_cookie_consent';
const MAX_BATCH_SIZE = 20;
const MAX_BODY_BYTES = 64 * 1024;
const RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SUMMARY_CACHE_TTL_MS = 15 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
let lastRetentionCleanupAt = 0;
let analyticsIndexPromise = null;
const summaryCache = new Map();

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

const collectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: clampInteger(process.env.ANALYTICS_RATE_LIMIT_MAX, 600, 50, 5000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Analytics request limit reached' },
});

function safeHttpsOrigin(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.origin : fallback;
  } catch (_error) {
    return fallback;
  }
}

function safeHttpsUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') {
      return fallback;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch (_error) {
    return fallback;
  }
}

function getConfig() {
  const projectKey = String(process.env.POSTHOG_PROJECT_KEY || '').trim();
  const apiHost = safeHttpsOrigin(process.env.POSTHOG_API_HOST, 'https://eu.i.posthog.com');
  const uiHost = safeHttpsOrigin(process.env.POSTHOG_UI_HOST, 'https://eu.posthog.com');
  const configuredDashboard = safeHttpsUrl(process.env.POSTHOG_DASHBOARD_URL, '');
  const enabled = envFlag('BEHAVIOUR_ANALYTICS_ENABLED', true);

  return {
    enabled,
    heartbeatSeconds: clampInteger(process.env.ANALYTICS_HEARTBEAT_SECONDS, 15, 10, 60),
    retentionDays: clampInteger(
      process.env.ANALYTICS_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      7,
      730
    ),
    posthog: {
      enabled: enabled && Boolean(projectKey),
      projectKey,
      apiHost,
      uiHost,
      dashboardUrl: configuredDashboard || uiHost,
      sessionRecordingEnabled:
        enabled && Boolean(projectKey) && envFlag('POSTHOG_SESSION_RECORDING_ENABLED', false),
    },
  };
}

function isSameSiteRequest(req) {
  const secFetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (secFetchSite && !['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
    return false;
  }

  const origin = req.get('origin');
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).host === req.get('host');
  } catch (_error) {
    return false;
  }
}

function readConsentCookie(req) {
  const parsedCookie =
    req.cookies && typeof req.cookies[CONSENT_COOKIE_NAME] === 'string'
      ? req.cookies[CONSENT_COOKIE_NAME]
      : '';
  if (parsedCookie) {
    return parsedCookie;
  }

  const cookieHeader = String(req.get('cookie') || '');
  const match = cookieHeader
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${CONSENT_COOKIE_NAME}=`));
  return match ? match.slice(CONSENT_COOKIE_NAME.length + 1) : '';
}

function hasAnalyticsConsentCookie(req) {
  const raw = readConsentCookie(req);
  if (!raw) {
    return false;
  }

  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) {
      candidates.push(decoded);
    }
  } catch (_error) {
    // Invalid percent encoding is treated as no consent.
  }

  return candidates.some(candidate => {
    try {
      const consent = JSON.parse(candidate);
      return Boolean(consent && consent.analytics === true);
    } catch (_error) {
      return false;
    }
  });
}

function getRawBodySize(req) {
  const headerLength = Number.parseInt(req.get('content-length') || '0', 10);
  if (Number.isFinite(headerLength) && headerLength > MAX_BODY_BYTES) {
    return headerLength;
  }
  try {
    return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  } catch (_error) {
    return MAX_BODY_BYTES + 1;
  }
}

async function ensureAnalyticsIndexes() {
  if (!db.isMongoAvailable()) {
    return;
  }
  if (!analyticsIndexPromise) {
    analyticsIndexPromise = db
      .getCollection(COLLECTION_NAME)
      .then(collection =>
        Promise.all([
          collection.createIndex({ timestamp: -1 }, { name: 'behaviour_analytics_timestamp_desc' }),
          collection.createIndex(
            { timestamp: 1, event: 1 },
            { name: 'behaviour_analytics_window_event' }
          ),
        ])
      )
      .catch(error => {
        analyticsIndexPromise = null;
        logger.warn('[behaviour-analytics] index creation failed:', error.message);
      });
  }
  await analyticsIndexPromise;
}

function clearSummaryCache() {
  summaryCache.clear();
}

async function removeExpiredEvents(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS).toISOString();
  const removed = await dbUnified.deleteMany(COLLECTION_NAME, { timestamp: { $lt: cutoff } });
  if (removed) {
    clearSummaryCache();
  }
  return removed;
}

function scheduleRetentionCleanup(retentionDays) {
  const now = Date.now();
  if (now - lastRetentionCleanupAt < RETENTION_CHECK_INTERVAL_MS) {
    return;
  }
  lastRetentionCleanupAt = now;
  removeExpiredEvents(retentionDays).catch(error =>
    logger.debug('[behaviour-analytics] retention cleanup failed:', error.message)
  );
}

function reportingWindow(days, offsetDays, now = new Date()) {
  const periodDays = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const offset = clampInteger(offsetDays, 0, 0, 365);
  const end = new Date(now.getTime() - offset * DAY_MS);
  const start = new Date(end.getTime() - periodDays * DAY_MS);
  return { periodDays, offsetDays: offset, start, end };
}

async function loadAdminSummary(days, offsetDays) {
  const window = reportingWindow(days, offsetDays);
  const cacheKey = `${window.periodDays}:${window.offsetDays}`;
  const cached = summaryCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < SUMMARY_CACHE_TTL_MS) {
    return cached.payload;
  }

  await ensureAnalyticsIndexes();
  const events = await dbUnified.find(COLLECTION_NAME, {
    timestamp: {
      $gte: window.start.toISOString(),
      $lt: window.end.toISOString(),
    },
  });
  const summary = buildSummary(events, window.periodDays, window.end);
  summary.decision = buildDecisionSummary(events, summary);
  summary.window = {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    offsetDays: window.offsetDays,
    comparison: window.offsetDays > 0,
  };

  const payload = { success: true, summary };
  summaryCache.set(cacheKey, { createdAt: Date.now(), payload });
  return payload;
}

router.get('/config', (_req, res) => {
  const config = getConfig();
  res.setHeader('Cache-Control', 'no-store, private');
  res.json({
    enabled: config.enabled,
    heartbeatSeconds: config.heartbeatSeconds,
    posthog: {
      enabled: config.posthog.enabled,
      projectKey: config.posthog.enabled ? config.posthog.projectKey : '',
      apiHost: config.posthog.apiHost,
      uiHost: config.posthog.uiHost,
      sessionRecordingEnabled: config.posthog.sessionRecordingEnabled,
    },
  });
});

router.post('/collect', collectLimiter, async (req, res) => {
  const config = getConfig();
  if (!config.enabled) {
    return res.status(202).json({ success: true, accepted: 0, disabled: true });
  }
  if (!isSameSiteRequest(req)) {
    return res.status(403).json({
      success: false,
      error: 'Cross-site analytics requests are blocked',
    });
  }
  if (getRawBodySize(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Analytics payload too large' });
  }
  if (!req.body || req.body.consent !== true || !hasAnalyticsConsentCookie(req)) {
    return res.status(400).json({ success: false, error: 'Analytics consent is required' });
  }

  let incoming = [];
  if (Array.isArray(req.body.events)) {
    incoming = req.body.events.slice(0, MAX_BATCH_SIZE);
  } else if (req.body.event) {
    incoming = [req.body];
  }
  if (incoming.length === 0) {
    return res.status(400).json({ success: false, error: 'No analytics events supplied' });
  }

  try {
    let user = null;
    try {
      user = await getUserFromCookie(req);
    } catch (_error) {
      user = null;
    }

    if (user && user.role === 'admin') {
      return res.status(202).json({ success: true, accepted: 0, excluded: 'admin' });
    }

    const context = {
      userId: user && user.id,
      userRole: user && user.role,
      hashSalt: process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET,
    };
    const sanitized = incoming.map(item => sanitizeEvent(item, context)).filter(Boolean);

    let accepted = 0;
    for (const event of sanitized) {
      const inserted = await dbUnified.insertOne(COLLECTION_NAME, event);
      if (inserted) {
        accepted += 1;
      }
    }

    if (accepted > 0) {
      clearSummaryCache();
      ensureAnalyticsIndexes().catch(() => {});
      scheduleRetentionCleanup(config.retentionDays);
    }

    return res.status(202).json({ success: true, accepted });
  } catch (error) {
    logger.debug('[behaviour-analytics] collect failed:', error.message);
    return res.status(202).json({ success: true, accepted: 0 });
  }
});

router.get('/admin/status', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const config = getConfig();
    await ensureAnalyticsIndexes();
    const [eventCount, latest] = await Promise.all([
      dbUnified.count(COLLECTION_NAME),
      dbUnified.findWithOptions(COLLECTION_NAME, {}, { limit: 1, sort: { timestamp: -1 } }),
    ]);

    res.setHeader('Cache-Control', 'no-store, private');
    return res.json({
      success: true,
      status: {
        enabled: config.enabled,
        eventCount,
        latestEventAt: latest[0] ? latest[0].timestamp : null,
        retentionDays: config.retentionDays,
        heartbeatSeconds: config.heartbeatSeconds,
        posthogConfigured: config.posthog.enabled,
        sessionRecordingEnabled: config.posthog.sessionRecordingEnabled,
        posthogDashboardUrl: config.posthog.enabled ? config.posthog.dashboardUrl : null,
        privacy: {
          consentRequired: true,
          adminTrafficExcluded: true,
          rawIpStored: false,
          rawUserAgentStored: false,
          queryStringsStored: false,
        },
      },
    });
  } catch (error) {
    logger.error('[behaviour-analytics] status failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to load analytics status' });
  }
});

router.get('/admin/summary', authRequired, roleRequired('admin'), async (req, res) => {
  try {
    const payload = await loadAdminSummary(req.query.days, req.query.offsetDays);
    res.setHeader('Cache-Control', 'no-store, private');
    return res.json(payload);
  } catch (error) {
    logger.error('[behaviour-analytics] summary failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to load behaviour analytics' });
  }
});

router.post(
  '/admin/cleanup',
  authRequired,
  roleRequired('admin'),
  csrfProtection,
  async (_req, res) => {
    try {
      const removed = await removeExpiredEvents(getConfig().retentionDays);
      return res.json({ success: true, removed });
    } catch (error) {
      logger.error('[behaviour-analytics] cleanup failed:', error.message);
      return res.status(500).json({ success: false, error: 'Failed to clean analytics events' });
    }
  }
);

module.exports = router;
module.exports._private = {
  getConfig,
  isSameSiteRequest,
  hasAnalyticsConsentCookie,
  getRawBodySize,
  safeHttpsOrigin,
  safeHttpsUrl,
  ensureAnalyticsIndexes,
  removeExpiredEvents,
  scheduleRetentionCleanup,
  reportingWindow,
  loadAdminSummary,
  clearSummaryCache,
};
