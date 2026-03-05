/**
 * Notification Service
 * Multi-channel notification delivery (in-app, email, push)
 */

'use strict';

const logger = require('../utils/logger');
const postmark = require('../utils/postmark');
const { getBaseUrl } = require('../utils/config');
// MessageQueue constants (inlined from deleted models/MessageQueue.js)
const { ObjectId: MQObjectId } = require('mongodb');
const MQ_COLLECTION = 'messageQueue';
const QUEUE_STATUS = { PENDING: 'pending', SENDING: 'sending', FAILED: 'failed', SENT: 'sent' };
const MAX_RETRIES = 5;
const MQ_RETRY_INTERVALS = [2, 4, 8, 16, 30];

function createQueueEntry(data) {
  const now = new Date();
  return {
    _id: new MQObjectId(),
    userId: data.userId,
    message: data.message,
    retryCount: 0,
    status: QUEUE_STATUS.PENDING,
    createdAt: now,
    lastAttempt: null,
    nextRetry: now,
    error: null,
    metadata: data.metadata || {},
  };
}

function calculateNextRetry(retryCount) {
  const intervalSeconds = MQ_RETRY_INTERVALS[Math.min(retryCount, MQ_RETRY_INTERVALS.length - 1)];
  return new Date(Date.now() + intervalSeconds * 1000);
}

// Notification types
const NOTIFICATION_TYPES = {
  MESSAGE: 'message',
  THREAD_CREATED: 'thread_created',
  MENTION: 'mention',
  REACTION: 'reaction',
  SYSTEM: 'system',
};

// Notification channels
const CHANNELS = {
  IN_APP: 'inApp',
  EMAIL: 'email',
  PUSH: 'push',
};

// Default preferences
const DEFAULT_PREFERENCES = {
  [CHANNELS.IN_APP]: true,
  [CHANNELS.EMAIL]: true,
  [CHANNELS.PUSH]: false,
  sound: true,
};

// Default queue processor interval in milliseconds (configurable via QUEUE_PROCESSOR_INTERVAL_MS)
const DEFAULT_QUEUE_PROCESSOR_INTERVAL_MS = 30000;

class NotificationService {
  constructor(db, wsServer = null) {
    this.db = db;
    this.wsServer = wsServer;
    this.notificationsCollection = db.collection('notifications');
    this.preferencesCollection = db.collection('notification_preferences');
    this.messageQueueCollection = db.collection(MQ_COLLECTION);
    this.queue = []; // In-memory queue for failed deliveries

    // Start persistent queue processor
    this._startQueueProcessor();
  }

  /**
   * Start the background queue processor for MessageQueue retries
   */
  _startQueueProcessor() {
    const intervalMs = parseInt(
      process.env.QUEUE_PROCESSOR_INTERVAL_MS || String(DEFAULT_QUEUE_PROCESSOR_INTERVAL_MS),
      10
    );
    const processorInterval = setInterval(() => {
      this._processMessageQueue().catch(err => {
        logger.error('Queue processor error', { error: err.message });
      });
    }, intervalMs);
    // Allow process to exit even if this timer is still active
    if (processorInterval.unref) {
      processorInterval.unref();
    }
  }

  /**
   * Process pending items from the persistent MessageQueue
   */
  async _processMessageQueue() {
    try {
      const now = new Date();
      const pendingItems = await this.messageQueueCollection
        .find({
          status: QUEUE_STATUS.PENDING,
          nextRetry: { $lte: now },
        })
        .toArray();

      if (pendingItems.length === 0) {
        return;
      }

      logger.info('Processing persistent message queue', { count: pendingItems.length });

      for (const item of pendingItems) {
        try {
          // Mark as sending
          await this.messageQueueCollection.updateOne(
            { _id: item._id },
            { $set: { status: QUEUE_STATUS.SENDING, lastAttempt: new Date() } }
          );

          const { userId, notification, channel } = item.message;

          if (channel === CHANNELS.IN_APP) {
            await this.deliverInApp(userId, notification, true);
          } else if (channel === CHANNELS.EMAIL) {
            await this.deliverEmail(userId, notification, true);
          } else if (channel === CHANNELS.PUSH) {
            await this.deliverPush(userId, notification, true);
          }

          // Mark as sent on success
          await this.messageQueueCollection.updateOne(
            { _id: item._id },
            { $set: { status: QUEUE_STATUS.SENT } }
          );
        } catch (err) {
          const newRetryCount = (item.retryCount || 0) + 1;
          if (newRetryCount >= MAX_RETRIES) {
            await this.messageQueueCollection.updateOne(
              { _id: item._id },
              {
                $set: {
                  status: QUEUE_STATUS.FAILED,
                  retryCount: newRetryCount,
                  error: err.message,
                },
              }
            );
          } else {
            await this.messageQueueCollection.updateOne(
              { _id: item._id },
              {
                $set: {
                  status: QUEUE_STATUS.PENDING,
                  retryCount: newRetryCount,
                  nextRetry: calculateNextRetry(newRetryCount),
                  error: err.message,
                },
              }
            );
          }
        }
      }
    } catch (err) {
      logger.error('Error processing message queue', { error: err.message });
    }
  }

  /**
   * Persist a failed delivery to the MessageQueue for retry
   */
  async _persistToQueue(userId, notification, channel) {
    try {
      const entry = createQueueEntry({
        userId,
        message: { userId, notification, channel },
        metadata: { channel },
      });
      await this.messageQueueCollection.insertOne(entry);
    } catch (err) {
      logger.error(
        'CRITICAL: Failed to persist to message queue - using in-memory fallback (delivery may be lost on restart)',
        { userId, channel, error: err.message }
      );
      // Fall back to in-memory queue
      this.queue.push({ userId, notification, channel });
    }
  }

  /**
   * Send notification to user
   */
  async sendNotification(userId, notification) {
    try {
      const {
        type,
        title,
        message,
        data = {},
        channels = null, // null = use user preferences
        priority = 'normal', // 'low', 'normal', 'high'
      } = notification;

      // Get user preferences
      const preferences = await this.getUserPreferences(userId);

      // Determine which channels to use
      let activeChannels = channels || [];
      if (!channels) {
        // Use user preferences
        activeChannels = Object.keys(preferences).filter(channel => preferences[channel]);
      }

      // Save notification to database
      const notificationDoc = {
        userId,
        type,
        title,
        message,
        data,
        priority,
        read: false,
        createdAt: new Date(),
      };

      const result = await this.notificationsCollection.insertOne(notificationDoc);
      notificationDoc._id = result.insertedId;

      // Deliver through active channels
      const deliveryPromises = [];

      if (activeChannels.includes(CHANNELS.IN_APP)) {
        deliveryPromises.push(this.deliverInApp(userId, notificationDoc));
      }

      if (activeChannels.includes(CHANNELS.EMAIL)) {
        deliveryPromises.push(this.deliverEmail(userId, notificationDoc));
      }

      if (activeChannels.includes(CHANNELS.PUSH)) {
        deliveryPromises.push(this.deliverPush(userId, notificationDoc));
      }

      // Wait for all deliveries (but don't fail if some fail)
      await Promise.allSettled(deliveryPromises);

      logger.debug('Notification sent', {
        userId,
        type,
        channels: activeChannels,
      });

      return notificationDoc;
    } catch (error) {
      logger.error('Error sending notification', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Deliver notification via WebSocket (in-app)
   * @param {string} userId
   * @param {Object} notification
   * @param {boolean} [skipRetryQueue=false] - When true, re-throws on error instead of queuing (used by queue processor to avoid duplicates)
   */
  async deliverInApp(userId, notification, skipRetryQueue = false) {
    try {
      if (!this.wsServer) {
        logger.warn('WebSocket server not available for in-app notification');
        return;
      }

      this.wsServer.sendNotification(userId, {
        id: notification._id.toString(),
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
        createdAt: notification.createdAt,
      });

      logger.debug('In-app notification delivered', { userId });
    } catch (error) {
      logger.error('Error delivering in-app notification', {
        userId,
        error: error.message,
      });
      if (skipRetryQueue) {
        throw error;
      }
      // Persist for retry
      await this._persistToQueue(userId, notification, CHANNELS.IN_APP);
    }
  }

  /**
   * Deliver notification via email
   * @param {string} userId
   * @param {Object} notification
   * @param {boolean} [skipRetryQueue=false] - When true, re-throws on error instead of queuing (used by queue processor to avoid duplicates)
   */
  async deliverEmail(userId, notification, skipRetryQueue = false) {
    try {
      // Get user email from database
      const usersDb = await this.db.collection('users').findOne({ id: userId });
      if (!usersDb || !usersDb.email) {
        logger.warn('User email not found', { userId });
        return;
      }

      const email = usersDb.email;
      const userName = usersDb.name || 'there';

      // Send email based on notification type
      await postmark.sendMail({
        to: email,
        subject: notification.title,
        template: 'notification',
        templateData: {
          name: userName,
          title: notification.title,
          message: notification.message,
          actionUrl: notification.data?.url || getBaseUrl(),
          actionText: notification.data?.actionText || 'View Details',
        },
        from: postmark.FROM_SUPPORT,
      });

      logger.debug('Email notification delivered', { userId, email });
    } catch (error) {
      logger.error('Error delivering email notification', {
        userId,
        error: error.message,
      });
      if (skipRetryQueue) {
        throw error;
      }
      // Persist for retry
      await this._persistToQueue(userId, notification, CHANNELS.EMAIL);
    }
  }

  /**
   * Deliver notification via push
   * Supports Firebase Cloud Messaging (FCM) for web/Android and APNs for iOS
   *
   * Prerequisites for production:
   * 1. Set FIREBASE_SERVICE_ACCOUNT_KEY environment variable (JSON string)
   * 2. Store user device tokens in user_devices collection
   * 3. Configure FCM in Firebase Console
   *
   * @param {string} userId
   * @param {Object} notification
   * @param {boolean} [skipRetryQueue=false] - When true, re-throws on error instead of queuing (used by queue processor to avoid duplicates)
   */
  async deliverPush(userId, notification, skipRetryQueue = false) {
    try {
      // Check if push notifications are configured
      if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // TODO: Implement Firebase Cloud Messaging by setting FIREBASE_SERVICE_ACCOUNT_KEY.
        // See deliverPush() JSDoc for prerequisites.
        logger.warn(
          'Push notification attempted but FIREBASE_SERVICE_ACCOUNT_KEY is not set - delivery skipped',
          {
            userId,
          }
        );
        return;
      }

      // Get user's device tokens
      const userDevices = await this.db
        .collection('user_devices')
        .find({
          userId,
          active: true,
        })
        .toArray();

      if (!userDevices || userDevices.length === 0) {
        logger.debug('No device tokens found for user', { userId });
        return;
      }

      // Import firebase-admin (lazy load to avoid issues if not configured)
      let admin;
      try {
        // eslint-disable-next-line node/no-missing-require
        admin = require('firebase-admin');

        // Initialize if not already
        if (!admin.apps.length) {
          admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
          });
        }
      } catch (err) {
        logger.warn('Firebase Admin SDK not available', { error: err.message });
        return;
      }

      // Send to each device
      const tokens = userDevices.map(d => d.token);
      const message = {
        notification: {
          title: notification.title,
          body: notification.message,
        },
        data: {
          type: notification.type,
          notificationId: notification._id.toString(),
          url: notification.data?.url || '',
        },
        tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      logger.info('Push notifications sent', {
        userId,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      // Handle failed tokens (remove invalid ones)
      if (response.failureCount > 0) {
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error?.code === 'messaging/invalid-registration-token') {
            invalidTokens.push(tokens[idx]);
          }
        });

        if (invalidTokens.length > 0) {
          await this.db
            .collection('user_devices')
            .updateMany(
              { token: { $in: invalidTokens } },
              { $set: { active: false, deactivatedAt: new Date() } }
            );
          logger.info('Deactivated invalid device tokens', { count: invalidTokens.length });
        }
      }
    } catch (error) {
      logger.error('Error delivering push notification', {
        userId,
        error: error.message,
      });
      if (skipRetryQueue) {
        throw error;
      }
      // Persist for retry
      await this._persistToQueue(userId, notification, CHANNELS.PUSH);
    }
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId) {
    try {
      const prefs = await this.preferencesCollection.findOne({ userId });
      return prefs?.preferences || DEFAULT_PREFERENCES;
    } catch (error) {
      logger.error('Error getting user preferences', {
        userId,
        error: error.message,
      });
      return DEFAULT_PREFERENCES;
    }
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(userId, preferences) {
    try {
      await this.preferencesCollection.updateOne(
        { userId },
        {
          $set: {
            userId,
            preferences,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      logger.info('User notification preferences updated', { userId });

      return preferences;
    } catch (error) {
      logger.error('Error updating user preferences', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const { unreadOnly = false, limit = 50, skip = 0 } = options;

      const query = { userId };
      if (unreadOnly) {
        query.read = false;
      }

      const notifications = await this.notificationsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      return notifications;
    } catch (error) {
      logger.error('Error getting user notifications', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId, userId) {
    try {
      const { ObjectId } = require('mongodb');
      const result = await this.notificationsCollection.updateOne(
        {
          _id: typeof notificationId === 'string' ? new ObjectId(notificationId) : notificationId,
          userId,
        },
        {
          $set: {
            read: true,
            readAt: new Date(),
          },
        }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Error marking notification as read', {
        notificationId,
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    try {
      const result = await this.notificationsCollection.updateMany(
        {
          userId,
          read: false,
        },
        {
          $set: {
            read: true,
            readAt: new Date(),
          },
        }
      );

      return result.modifiedCount;
    } catch (error) {
      logger.error('Error marking all notifications as read', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId) {
    try {
      const count = await this.notificationsCollection.countDocuments({
        userId,
        read: false,
      });

      return count;
    } catch (error) {
      logger.error('Error getting unread count', {
        userId,
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const { ObjectId } = require('mongodb');
      const result = await this.notificationsCollection.deleteOne({
        _id: typeof notificationId === 'string' ? new ObjectId(notificationId) : notificationId,
        userId,
      });

      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Error deleting notification', {
        notificationId,
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process queued notifications (retry failed deliveries)
   */
  async processQueue() {
    if (this.queue.length === 0) {
      return;
    }

    logger.info('Processing notification queue', { count: this.queue.length });

    const itemsToRetry = [...this.queue];
    this.queue = [];

    for (const item of itemsToRetry) {
      try {
        const { userId, notification, channel } = item;

        if (channel === CHANNELS.IN_APP) {
          await this.deliverInApp(userId, notification);
        } else if (channel === CHANNELS.EMAIL) {
          await this.deliverEmail(userId, notification);
        } else if (channel === CHANNELS.PUSH) {
          await this.deliverPush(userId, notification);
        }
      } catch (error) {
        // If still failing, add back to queue (with max retry limit)
        if (!item.retries || item.retries < 3) {
          item.retries = (item.retries || 0) + 1;
          this.queue.push(item);
        }
      }
    }
  }
}

module.exports = {
  NotificationService,
  NOTIFICATION_TYPES,
  CHANNELS,
  DEFAULT_PREFERENCES,
};
