/**
 * Admin Notification Centre — API Routes
 *
 * Provides admin-scoped notification endpoints so the admin navbar bell
 * can surface unread items without mixing with customer/supplier notifications.
 *
 * These routes reuse the existing NotificationService (services/notification.service.js)
 * and the existing notifications collection — no new DB schema required.
 *
 * Mounted at: /api/admin/notifications
 * Auth: authRequired + roleRequired('admin') on every route
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authRequired, roleRequired } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { notificationLimiter } = require('../middleware/rateLimits');
const mongoDb = require('../db');
const logger = require('../utils/logger');
const NotificationService = require('../services/notification.service');
const { getAdminQueueNotifications } = require('./admin-notification-work-queue');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Instantiate NotificationService lazily so the DB connection is always current.
 */
async function getNotifSvc(req) {
  let db;
  try {
    db = await mongoDb.getDb();
  } catch {
    db = null;
  }

  if (!db) {
    throw new Error('Database not connected');
  }

  const ws = req.app && req.app.get ? req.app.get('websocketServer') : null;
  return new NotificationService(db, ws);
}

function getNotificationTime(item) {
  const time = new Date(item.updatedAt || item.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function withAdminQueue(result, queueItems, limit, skip) {
  const storedNotifications = Array.isArray(result.notifications) ? result.notifications : [];
  const mergedNotifications = [...queueItems, ...storedNotifications].sort(
    (a, b) => getNotificationTime(b) - getNotificationTime(a)
  );
  const storedTotal = result.pagination
    ? Number(result.pagination.total) || 0
    : storedNotifications.length;
  const total = storedTotal + queueItems.length;

  return {
    notifications: mergedNotifications.slice(skip, skip + limit),
    pagination: {
      total,
      limit,
      skip,
      hasMore: total > skip + limit,
    },
    unreadCount: (Number(result.unreadCount) || 0) + queueItems.length,
    workQueue: {
      total: queueItems.length,
      items: queueItems,
    },
  };
}

// ── GET /api/admin/notifications ─────────────────────────────────────────────
/**
 * List the current admin's notifications, newest first.
 * Supports: ?unreadOnly=true, ?limit=N, ?skip=N
 */
router.get('/', authRequired, roleRequired('admin'), notificationLimiter, async (req, res) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const skip = Math.max(Number(req.query.skip) || 0, 0);
  const storedFetchLimit = Math.min(limit + skip, 100);
  let result = {
    notifications: [],
    pagination: { total: 0, limit: storedFetchLimit, skip: 0, hasMore: false },
    unreadCount: 0,
  };

  try {
    const svc = await getNotifSvc(req);
    result = await svc.getForUser(req.user.id, {
      unreadOnly,
      limit: storedFetchLimit,
      skip: 0,
    });
  } catch (err) {
    logger.warn('[admin-notif] stored notifications unavailable:', err.message);
  }

  try {
    const queueItems = await getAdminQueueNotifications();
    res.json({ ok: true, ...withAdminQueue(result, queueItems, limit, skip) });
  } catch (err) {
    logger.error('[admin-notif] GET / error:', err.message);
    res.status(503).json({
      ok: false,
      error: 'Notification service unavailable',
      notifications: [],
      unreadCount: 0,
    });
  }
});

// ── GET /api/admin/notifications/unread-count ─────────────────────────────────
router.get(
  '/unread-count',
  authRequired,
  roleRequired('admin'),
  notificationLimiter,
  async (req, res) => {
    let count = 0;
    try {
      const svc = await getNotifSvc(req);
      count = await svc.getUnreadCount(req.user.id);
    } catch (err) {
      logger.warn('[admin-notif] unread-count error:', err.message);
    }

    try {
      const queueItems = await getAdminQueueNotifications();
      res.json({
        ok: true,
        count: count + queueItems.length,
        storedCount: count,
        workQueueCount: queueItems.length,
      });
    } catch (err) {
      logger.warn('[admin-notif] queue unread-count error:', err.message);
      res.json({ ok: true, count });
    }
  }
);

// ── PATCH /api/admin/notifications/:id/read ───────────────────────────────────
router.patch('/:id/read', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const svc = await getNotifSvc(req);
    const ok = await svc.markAsRead(req.params.id, req.user.id);
    res.json({ ok });
  } catch (err) {
    logger.error('[admin-notif] mark-read error:', err.message);
    res.status(500).json({ ok: false });
  }
});

// ── POST /api/admin/notifications/read-all ────────────────────────────────────
router.post('/read-all', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const svc = await getNotifSvc(req);
    const count = await svc.markAllAsRead(req.user.id);
    res.json({ ok: true, count });
  } catch (err) {
    logger.error('[admin-notif] read-all error:', err.message);
    res.status(500).json({ ok: false });
  }
});

// ── DELETE /api/admin/notifications/:id ──────────────────────────────────────
router.delete('/:id', authRequired, roleRequired('admin'), csrfProtection, async (req, res) => {
  try {
    const svc = await getNotifSvc(req);
    const ok = await svc.dismiss(req.params.id, req.user.id);
    res.json({ ok });
  } catch (err) {
    logger.error('[admin-notif] dismiss error:', err.message);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
