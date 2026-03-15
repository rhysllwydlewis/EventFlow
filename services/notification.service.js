/**
 * Notification Service
 * Handles creation, retrieval, and management of user notifications
 * Integrates with WebSocket for real-time delivery
 */

'use strict';

const crypto = require('crypto');

// Use crypto.randomUUID() instead of uuid package
const uuidv4 = () => crypto.randomUUID();

class NotificationService {
  constructor(db, websocketServer) {
    this.db = db;
    this.websocketServer = websocketServer;
    this.collection = db.collection('notifications');
  }

  /**
   * Create a new notification
   * @param {Object} data - Notification data
   * @returns {Promise<Object>} Created notification
   */
  async create(data) {
    const notification = {
      id: uuidv4(),
      userId: data.userId,
      type: data.type || 'system',
      title: data.title,
      message: data.message,
      actionUrl: data.actionUrl || null,
      actionText: data.actionText || null,
      icon: data.icon || this._getDefaultIcon(data.type),
      priority: data.priority || 'normal',
      category: data.category || null,
      metadata: data.metadata || {},
      isRead: false,
      readAt: null,
      isDismissed: false,
      dismissedAt: null,
      expiresAt: data.expiresAt || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.collection.insertOne(notification);

    // Send real-time notification if WebSocket is available and user is online
    if (this.websocketServer && this.websocketServer.isUserOnline(data.userId)) {
      this.websocketServer.sendNotification(data.userId, {
        ...notification,
        _realtime: true,
      });
    }

    return notification;
  }

  /**
   * Create multiple notifications (batch)
   * @param {Array<Object>} notifications - Array of notification data
   * @returns {Promise<Array>} Created notifications
   */
  async createBatch(notifications) {
    const notificationsToInsert = notifications.map(data => ({
      id: uuidv4(),
      userId: data.userId,
      type: data.type || 'system',
      title: data.title,
      message: data.message,
      actionUrl: data.actionUrl || null,
      actionText: data.actionText || null,
      icon: data.icon || this._getDefaultIcon(data.type),
      priority: data.priority || 'normal',
      category: data.category || null,
      metadata: data.metadata || {},
      isRead: false,
      readAt: null,
      isDismissed: false,
      dismissedAt: null,
      expiresAt: data.expiresAt || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    await this.collection.insertMany(notificationsToInsert);

    // Send real-time notifications
    if (this.websocketServer) {
      for (const notification of notificationsToInsert) {
        if (this.websocketServer.isUserOnline(notification.userId)) {
          this.websocketServer.sendNotification(notification.userId, {
            ...notification,
            _realtime: true,
          });
        }
      }
    }

    return notificationsToInsert;
  }

  /**
   * Get notifications for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Notifications and metadata
   */
  async getForUser(userId, options = {}) {
    const { limit = 50, skip = 0, unreadOnly = false, type = null, priority = null } = options;

    const conditions = [
      { userId },
      { isDismissed: { $ne: true } },
      { $or: this._buildExpiryFilter() },
    ];

    if (unreadOnly) {
      conditions.push({ isRead: false });
    }

    if (type) {
      conditions.push({ type });
    }

    if (priority) {
      conditions.push({ priority });
    }

    const query = { $and: conditions };

    const unreadQuery = {
      $and: [
        { userId },
        { isDismissed: { $ne: true } },
        { isRead: false },
        { $or: this._buildExpiryFilter() },
      ],
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(query),
      this.collection.countDocuments(unreadQuery),
    ]);

    return {
      notifications,
      pagination: {
        total,
        limit,
        skip,
        hasMore: total > skip + limit,
      },
      unreadCount,
    };
  }

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID (for verification)
   * @returns {Promise<boolean>} Success status
   */
  async markAsRead(notificationId, userId) {
    const result = await this.collection.updateOne(
      { id: notificationId, userId },
      {
        $set: {
          isRead: true,
          readAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of notifications marked as read
   */
  async markAllAsRead(userId) {
    const result = await this.collection.updateMany(
      { userId, isRead: false },
      {
        $set: {
          isRead: true,
          readAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    return result.modifiedCount;
  }

  /**
   * Dismiss notification
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID (for verification)
   * @returns {Promise<boolean>} Success status
   */
  async dismiss(notificationId, userId) {
    const result = await this.collection.updateOne(
      { id: notificationId, userId },
      {
        $set: {
          isDismissed: true,
          dismissedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    );

    return result.modifiedCount > 0;
  }

  /**
   * Delete notification
   * @param {string} notificationId - Notification ID
   * @param {string} userId - User ID (for verification)
   * @returns {Promise<boolean>} Success status
   */
  async delete(notificationId, userId) {
    const result = await this.collection.deleteOne({
      id: notificationId,
      userId,
    });

    return result.deletedCount > 0;
  }

  /**
   * Delete all notifications for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of notifications deleted
   */
  async deleteAll(userId) {
    const result = await this.collection.deleteMany({ userId });
    return result.deletedCount;
  }

  /**
   * Get unread count for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Unread count
   */
  async getUnreadCount(userId) {
    return await this.collection.countDocuments({
      $and: [
        { userId },
        { isRead: false },
        { isDismissed: { $ne: true } },
        { $or: this._buildExpiryFilter() },
      ],
    });
  }

  /**
   * Clean up expired notifications
   * @returns {Promise<number>} Number of notifications deleted
   */
  async cleanupExpired() {
    const now = new Date().toISOString();
    const result = await this.collection.deleteMany({
      expiresAt: { $lte: now },
    });

    return result.deletedCount;
  }

  /**
   * Build the expiry filter used to exclude expired notifications
   * @private
   */
  _buildExpiryFilter() {
    const now = new Date().toISOString();
    return [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }];
  }

  /**
   * Get default icon for notification type
   * @private
   */
  _getDefaultIcon(type) {
    const icons = {
      message: '💬',
      booking: '📅',
      payment: '💳',
      review: '⭐',
      system: 'ℹ️',
      marketing: '📢',
      reminder: '⏰',
      approval: '✅',
      update: '🔔',
      ticket: '🎫',
    };

    return icons[type] || '🔔';
  }

  /**
   * Create notification for new message
   */
  async notifyNewMessage(recipientUserId, senderName, threadId, messagePreview = null) {
    const messageText = messagePreview
      ? `${senderName}: ${messagePreview}`
      : `${senderName} sent you a message`;

    return await this.create({
      userId: recipientUserId,
      type: 'message',
      title: 'New Message',
      message: messageText,
      actionUrl: `/messenger/?conversation=${threadId}`,
      actionText: 'View Message',
      priority: 'high',
      metadata: {
        threadId,
        senderName,
        messagePreview: messagePreview || '',
      },
    });
  }

  /**
   * Create notification for booking update
   */
  async notifyBookingUpdate(userId, supplierName, status) {
    return await this.create({
      userId,
      type: 'booking',
      title: 'Booking Update',
      message: `${supplierName} has ${status} your booking`,
      actionUrl: '/plan',
      actionText: 'View Details',
      priority: 'high',
    });
  }

  /**
   * Create notification for payment
   */
  async notifyPayment(userId, amount, description) {
    return await this.create({
      userId,
      type: 'payment',
      title: 'Payment Processed',
      message: `Payment of £${amount} for ${description}`,
      actionUrl: '/settings/billing',
      actionText: 'View Receipt',
      priority: 'normal',
    });
  }

  /**
   * Create notification for new review
   */
  async notifyNewReview(supplierUserId, customerName, rating) {
    return await this.create({
      userId: supplierUserId,
      type: 'review',
      title: 'New Review',
      message: `${customerName} left a ${rating}-star review`,
      actionUrl: '/reviews',
      actionText: 'View Review',
      priority: 'normal',
    });
  }

  /**
   * Create system notification
   */
  async notifySystem(userId, title, message, actionUrl = null) {
    return await this.create({
      userId,
      type: 'system',
      title,
      message,
      actionUrl,
      actionText: actionUrl ? 'View Details' : null,
      priority: 'normal',
    });
  }

  /**
   * Create notification for new support ticket (sent to admin)
   */
  async notifyNewTicket(adminUserId, senderName, ticketId, subject) {
    return await this.create({
      userId: adminUserId,
      type: 'ticket',
      title: 'New Support Ticket',
      message: `${senderName} submitted a new ticket: ${subject}`,
      actionUrl: '/admin-tickets',
      actionText: 'View Ticket',
      priority: 'high',
      icon: '🎫',
      metadata: { ticketId, senderName, subject },
    });
  }

  /**
   * Create notification for a reply on an existing ticket (sent to admin)
   */
  async notifyTicketReply(adminUserId, senderName, ticketId, subject) {
    return await this.create({
      userId: adminUserId,
      type: 'ticket',
      title: 'New Ticket Reply',
      message: `${senderName} replied to ticket: ${subject}`,
      actionUrl: '/admin-tickets',
      actionText: 'View Ticket',
      priority: 'normal',
      icon: '🎫',
      metadata: { ticketId, senderName, subject },
    });
  }
}

module.exports = NotificationService;
