/**
 * Notification Service — Multi-Channel Delivery Pipeline
 *
 * @deprecated  Prefer `services/notification.service.js` for new callers.
 *
 * This file is a thin re-export wrapper around the canonical
 * `services/notification.service.js`. It is retained solely for the WebSocket
 * server initialisation path in server.js (`wsServerV2.notificationService`).
 *
 * For creating and querying in-app notifications via the HTTP API
 * (`routes/notifications.js`), use `services/notification.service.js`.
 *
 * If you are adding new notification flows, prefer the canonical service directly.
 */

'use strict';

const CanonicalNotificationService = require('./notification.service');

/**
 * Compatibility wrapper that extends the canonical NotificationService with
 * the `sendNotification()` method used by websocket-server-v2.js.
 *
 * @deprecated Use `services/notification.service.js` directly for new code.
 */
class NotificationService extends CanonicalNotificationService {
  /**
   * Send a notification to a user.
   * Compatibility shim for websocket-server-v2.js — delegates to `create()`.
   *
   * @param {string} userId - Recipient user ID
   * @param {Object} notification - Notification data
   * @returns {Promise<Object>} Created notification
   */
  async sendNotification(userId, notification) {
    return this.create({
      userId,
      type: notification.type || 'system',
      title: notification.title || 'Notification',
      message: notification.message || '',
      metadata: notification.data || {},
    });
  }
}

// Legacy constants — kept for backward compatibility.
const NOTIFICATION_TYPES = {
  MESSAGE: 'message',
  THREAD_CREATED: 'thread_created',
  MENTION: 'mention',
  REACTION: 'reaction',
  SYSTEM: 'system',
};

const CHANNELS = {
  IN_APP: 'inApp',
  EMAIL: 'email',
  PUSH: 'push',
};

const DEFAULT_PREFERENCES = {
  inApp: true,
  email: true,
  push: false,
};

module.exports = {
  NotificationService,
  NOTIFICATION_TYPES,
  CHANNELS,
  DEFAULT_PREFERENCES,
};
