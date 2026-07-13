'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { authRequired, roleRequired, getUserFromCookie } = require('../middleware/auth');
const {
  COLLECTION_NAME,
  DEFAULT_RETENTION_DAYS,
  sanitizeEvent,
  buildSummary,
} = require('../utils/behaviourAnalytics');

const router = express.Router();
const MAX_BATCH_SIZE = 20;
const MAX_BODY_BYTES = 64 * 1024;

const collectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.ANALYTICS_RATE_LIMIT_MAX || '600', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Analytics request limit reached' },
});

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

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

function getConfig() {
  const projectKey = String(process.env.POSTHOG_PROJECT_KEY || '').trim();
  const apiHost = safeHttpsOrigin(process.env.POSTHOG_API_HOST, 'https://eu.i.posthog.com');
  const uiHost = safeHttpsOrigin(process.env.POSTHOG_UI_HOST, 'https://eu.posthog.com');
  const configuredDashboard = safeHttpsOrigin(process.env.POSTHOG_DASHBOARD_URL, '');
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
    const parsed = new URL(origin);
    return parsed.host === req.get('host');
  } catch (_error) {
    return false;
  }
}

function getRawBodySize(req) {
  const headerLength = Number.parseInt(req.get('content-length') || '0', 10);
  if (Number.isFinite(headerLength) && headerLength > 0) {
    return headerLength;
  }
  try {
    return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  } catch (_error) {
    return MAX_BODY_BYTES + 1;
  }
}

async function removeExpiredEvents(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return dbUnified.deleteMany(COLLECTION_NAME, { timestamp: { $lt: cutoff } });
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
    return res.status(403).json({ success: false, error: 'Cross-site analytics requests are blocked' });
  }
  if (getRawBodySize(req) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false, error: 'Analytics payload too large' });
  }
  if (!req.body || req.body.consent !== true) {
    return res.status(400).json({ success: false, error: 'Analytics consent is required' });
  }

  const incoming = Array.isArray(req.body.events)
    ? req.body.events.slice(0, MAX_BATCH_SIZE)
    : req.body.event
      ? [req.body]
      : [];

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

    const context = {
      userId: user && user.id,
      userRole: user && user.role,
      hashSalt: process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET,
    };

    const sanitized = incoming.map(item => sanitizeEvent(item, context)).filter(Boolean);
    for (const event of sanitized) {
      await dbUnified.insertOne(COLLECTION_NAME, event);
    }

    // Keep retention bounded without adding work to every beacon request.
    if (Math.random() < 0.02) {
      removeExpiredEvents(config.retentionDays).catch(error =>
        logger.debug('[behaviour-analytics] retention cleanup failed:', error.message)
      );
    }

    return res.status(202).json({ success: true, accepted: sanitized.length });
  } catch (error) {
    // Analytics must never interfere with the public website experience.
    logger.debug('[behaviour-analytics] collect failed:', error.message);
    return res.status(202).json({ success: true, accepted: 0 });
  }
});

router.get('/admin/status', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const config = getConfig();
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
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const events = await dbUnified.find(COLLECTION_NAME, { timestamp: { $gte: cutoff } });
    const summary = buildSummary(events, days);

    res.setHeader('Cache-Control', 'no-store, private');
    return res.json({ success: true, summary });
  } catch (error) {
    logger.error('[behaviour-analytics] summary failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to load behaviour analytics' });
  }
});

router.post('/admin/cleanup', authRequired, roleRequired('admin'), async (_req, res) => {
  try {
    const removed = await removeExpiredEvents(getConfig().retentionDays);
    return res.json({ success: true, removed });
  } catch (error) {
    logger.error('[behaviour-analytics] cleanup failed:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to clean analytics events' });
  }
});

module.exports = router;
module.exports._private = {
  getConfig,
  isSameSiteRequest,
  getRawBodySize,
  removeExpiredEvents,
};