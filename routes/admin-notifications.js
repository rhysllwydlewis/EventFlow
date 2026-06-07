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

// Work queue counts are folded into the notification centre in a follow-up patch.

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

// ── GET /api/admin/notifications ─────────────────────────────────────────────
/**
 * List the current admin's notifications, newest first.
 * Supports: ?unreadOnly=true, ?limit=N, ?skip=N
 */
router.get('/', authRequired, roleRequired('admin'), notificationLimiter, async (req, res) => {
  try {
    const svc = await getNotifSvc(req);
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const result = await svc.getForUser(req.user.id, { unreadOnly, limit, skip });
    res.json({ ok: true, ...result });
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
    try {
      const svc = await getNotifSvc(req);
      const count = await svc.getUnreadCount(req.user.id);
      res.json({ ok: true, count });
    } catch (err) {
      logger.warn('[admin-notif] unread-count error:', err.message);
      res.json({ ok: true, count: 0 });
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
