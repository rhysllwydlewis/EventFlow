/**
 * Admin Notification Helper
 *
 * Fire-and-forget helper that sends a notification to all admin users.
 * Used by routes that need to alert admins of events (new supplier registration,
 * photo approvals, ticket replies, partner joins, etc.).
 *
 * Pattern mirrors the approach in routes/tickets.js and routes/reviews.js.
 * Errors are swallowed with a log warning — notification failure must never
 * break the primary request.
 */

'use strict';

const dbUnified = require('../db-unified');
const mongoDb = require('../db');
const logger = require('../utils/logger');
const NotificationService = require('./notification.service');

/**
 * Notify all admin users of an event.
 *
 * @param {Object} payload
 * @param {string} payload.type       - NotificationType (ticket|system|booking|review|etc.)
 * @param {string} payload.title      - Short notification title
 * @param {string} payload.message    - Longer notification message
 * @param {string} [payload.actionUrl] - URL to navigate to when tapped
 * @param {string} [payload.actionText] - Button label
 * @param {string} [payload.priority]  - 'normal'|'high'
 * @param {Object} [payload.metadata]  - Extra data stored on notification
 * @param {Object} [websocketServer]   - Optional; pass req.app.get('websocketServer') for realtime push
 * @returns {Promise<void>}
 */
async function notifyAdmins(payload, websocketServer = null) {
  try {
    let db = null;
    try {
      db = await mongoDb.getDb();
    } catch {
      // db unavailable — swallow
    }
    if (!db) {
      return;
    }

    const svc = new NotificationService(db, websocketServer);
    const adminUsers = await dbUnified.find('users', { role: 'admin' });

    if (!adminUsers || !adminUsers.length) {
      return;
    }

    await svc.createBatch(
      adminUsers.map(admin => ({
        userId: admin.id,
        type: payload.type || 'system',
        title: payload.title,
        message: payload.message,
        actionUrl: payload.actionUrl || null,
        actionText: payload.actionText || 'View',
        priority: payload.priority || 'normal',
        metadata: payload.metadata || {},
      }))
    );
  } catch (err) {
    logger.warn('[notifyAdmins] non-blocking failure:', err.message);
  }
}

module.exports = { notifyAdmins };
