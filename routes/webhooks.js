/**
 * Postmark & MongoDB Webhook Routes
 *
 * POST /api/webhooks/postmark  — Handles incoming webhook events from Postmark.
 * POST /api/webhooks/mongodb   — Handles incoming webhook events from MongoDB
 *                                Atlas Database Triggers / App Services.
 *
 * Postmark events:
 * - Delivery: Email was successfully delivered
 * - Bounce: Email bounced (hard or soft)
 * - SpamComplaint: Recipient marked email as spam
 * - SubscriptionChange: Recipient unsubscribed via link tracker
 * - Open: Email was opened (if tracking enabled)
 * - Click: Link in email was clicked (if tracking enabled)
 *
 * MongoDB Atlas events:
 * - insert / update / replace / delete / drop / rename / invalidate
 *
 * See also: webhooks/mongodbWebhookHandler.js
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { apiLimiter } = require('../middleware/rateLimits');
const { buildMongodbWebhookHandler } = require('../webhooks/mongodbWebhookHandler');
const router = express.Router();

/**
 * POST /api/webhooks/postmark
 * Handle Postmark webhook events
 *
 * Security: Configure basic auth in Postmark webhook settings for production.
 * Add username/password in Postmark dashboard and set POSTMARK_WEBHOOK_USER
 * and POSTMARK_WEBHOOK_PASS environment variables.
 *
 * Event Types:
 * - Delivery: { RecordType: "Delivery", MessageID, Recipient, DeliveredAt, ... }
 * - Bounce: { RecordType: "Bounce", MessageID, Email, BouncedAt, Type, Description, ... }
 * - SpamComplaint: { RecordType: "SpamComplaint", MessageID, Email, BouncedAt, ... }
 * - SubscriptionChange: { RecordType: "SubscriptionChange", Recipient, ... }
 * - Open: { RecordType: "Open", MessageID, Recipient, ReceivedAt, ... }
 * - Click: { RecordType: "Click", MessageID, Recipient, OriginalLink, ... }
 */
router.post('/postmark', express.json(), (req, res) => {
  try {
    // Basic authentication check (if configured)
    const authHeader = req.headers.authorization;
    const webhookUser = process.env.POSTMARK_WEBHOOK_USER;
    const webhookPass = process.env.POSTMARK_WEBHOOK_PASS;

    if (webhookUser && webhookPass) {
      // Verify basic auth if credentials are configured
      if (!authHeader || !authHeader.startsWith('Basic ')) {
        logger.warn('⚠️  Webhook request missing authentication');
        return res.status(401).json({ error: 'Authentication required' });
      }

      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      if (username !== webhookUser || password !== webhookPass) {
        logger.warn('⚠️  Webhook request with invalid credentials');
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      logger.warn('⚠️  WARNING: Webhook authentication not configured in production!');
      logger.warn('   Set POSTMARK_WEBHOOK_USER and POSTMARK_WEBHOOK_PASS environment variables');
    }

    const event = req.body;
    const db = req.app.locals.db || global.mongoDb?.db;

    // Log the webhook event for monitoring
    logger.info('📬 Postmark webhook received:', {
      type: event.RecordType,
      messageId: event.MessageID,
      recipient: event.Recipient || event.Email,
      timestamp: new Date().toISOString(),
    });

    // Handle different event types
    switch (event.RecordType) {
      case 'Delivery':
        handleDelivery(event, db);
        break;

      case 'Bounce':
        handleBounce(event, db);
        break;

      case 'SpamComplaint':
        handleSpamComplaint(event, db);
        break;

      case 'SubscriptionChange':
        handleSubscriptionChange(event, db);
        break;

      case 'Open':
        handleOpen(event, db);
        break;

      case 'Click':
        handleClick(event, db);
        break;

      default:
        logger.info(`⚠️  Unknown webhook event type: ${event.RecordType}`);
    }

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error('❌ Error processing Postmark webhook:', err);
    // Still respond with 200 to prevent Postmark from retrying
    res.status(200).json({ ok: true, error: err.message });
  }
});

/**
 * Handle successful email delivery
 * @param {Object} event - Postmark delivery event
 * @param {Object} db - MongoDB database instance
 */
async function handleDelivery(event, db) {
  const logger = require('../utils/logger');

  logger.info('Email delivered successfully', {
    messageId: event.MessageID,
    recipient: event.Recipient,
    deliveredAt: event.DeliveredAt,
    tag: event.Tag || 'none',
    stream: event.MessageStream || 'default',
  });

  // Update email delivery status in database
  if (db) {
    try {
      await db.collection('email_logs').updateOne(
        { messageId: event.MessageID },
        {
          $set: {
            status: 'delivered',
            recipient: event.Recipient,
            deliveredAt: new Date(event.DeliveredAt),
            tag: event.Tag,
            messageStream: event.MessageStream,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (error) {
      logger.error('Failed to log email delivery', {
        error: error.message,
        messageId: event.MessageID,
      });
    }
  }
}

/**
 * Handle email bounce
 * Bounces can be "HardBounce" or "SoftBounce"
 * @param {Object} event - Postmark bounce event
 * @param {Object} db - MongoDB database instance
 */
async function handleBounce(event, db) {
  const logger = require('../utils/logger');
  const isHardBounce = event.Type === 'HardBounce';

  logger.error(`Email bounced (${event.Type})`, {
    recipient: event.Email,
    messageId: event.MessageID,
    bouncedAt: event.BouncedAt,
    description: event.Description,
    details: event.Details || 'none',
    isHardBounce,
  });

  // Log bounce in database for monitoring
  if (db) {
    try {
      await db.collection('email_bounces').insertOne({
        email: event.Email,
        messageId: event.MessageID,
        type: event.Type,
        description: event.Description,
        details: event.Details,
        bouncedAt: new Date(event.BouncedAt),
        isHardBounce,
        createdAt: new Date(),
      });

      // Mark email as invalid in database for hard bounces
      if (isHardBounce) {
        await db.collection('users').updateOne(
          { email: event.Email },
          {
            $set: {
              emailBounced: true,
              emailBouncedAt: new Date(event.BouncedAt),
              emailBouncedReason: event.Description,
              emailBouncedType: event.Type,
            },
          }
        );
        logger.warn(`Marked email as invalid due to hard bounce: ${event.Email}`);
      }
    } catch (error) {
      logger.error('Failed to log bounce', {
        error: error.message,
        email: event.Email,
      });
    }
  }
}

/**
 * Handle spam complaint
 * User marked email as spam - critical for deliverability
 * @param {Object} event - Postmark spam complaint event
 * @param {Object} db - MongoDB database instance
 */
async function handleSpamComplaint(event, db) {
  const logger = require('../utils/logger');

  logger.error('Spam complaint received - CRITICAL', {
    recipient: event.Email,
    messageId: event.MessageID,
    complainedAt: event.BouncedAt,
  });

  // Log spam complaint and automatically unsubscribe user
  if (db) {
    try {
      // Log complaint in database
      await db.collection('email_complaints').insertOne({
        email: event.Email,
        messageId: event.MessageID,
        type: 'spam_complaint',
        complainedAt: new Date(event.BouncedAt),
        createdAt: new Date(),
      });

      // Automatically unsubscribe user from all emails
      // This is critical for maintaining good email reputation
      const result = await db.collection('users').updateOne(
        { email: event.Email },
        {
          $set: {
            emailUnsubscribed: true,
            emailUnsubscribedAt: new Date(),
            emailUnsubscribedReason: 'spam_complaint',
            emailPreferences: {
              marketing: false,
              notifications: false,
              updates: false,
            },
          },
        }
      );

      if (result.matchedCount > 0) {
        logger.warn(`Unsubscribed user from all emails due to spam complaint: ${event.Email}`);
      }
    } catch (error) {
      logger.error('Failed to handle spam complaint', {
        error: error.message,
        email: event.Email,
      });
    }
  }
}

/**
 * Handle subscription change (unsubscribe via link tracker)
 * @param {Object} event - Postmark subscription change event
 * @param {Object} db - MongoDB database instance
 */
async function handleSubscriptionChange(event, db) {
  const logger = require('../utils/logger');

  logger.info('Email subscription change', {
    recipient: event.Recipient,
    suppressSending: event.SuppressSending,
    changedAt: event.ChangedAt,
  });

  // Update user preferences in database
  if (db && event.SuppressSending) {
    try {
      await db.collection('users').updateOne(
        { email: event.Recipient },
        {
          $set: {
            emailUnsubscribed: true,
            emailUnsubscribedAt: new Date(event.ChangedAt),
            emailUnsubscribedReason: 'link_tracker_unsubscribe',
          },
        }
      );
      logger.info(`User unsubscribed via link tracker: ${event.Recipient}`);
    } catch (error) {
      logger.error('Failed to update subscription change', {
        error: error.message,
        email: event.Recipient,
      });
    }
  }
}

/**
 * Handle email open (if tracking enabled)
 * @param {Object} event - Postmark open event
 * @param {Object} db - MongoDB database instance
 */
async function handleOpen(event, db) {
  const logger = require('../utils/logger');

  logger.debug('Email opened', {
    recipient: event.Recipient,
    messageId: event.MessageID,
    firstOpen: event.FirstOpen,
    receivedAt: event.ReceivedAt,
  });

  // Track email opens in database for analytics
  if (db) {
    try {
      await db.collection('email_opens').insertOne({
        email: event.Recipient,
        messageId: event.MessageID,
        firstOpen: event.FirstOpen,
        receivedAt: new Date(event.ReceivedAt),
        userAgent: event.UserAgent,
        platform: event.Platform,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log email open', {
        error: error.message,
        messageId: event.MessageID,
      });
    }
  }
}

/**
 * Handle link click (if tracking enabled)
 * @param {Object} event - Postmark click event
 * @param {Object} db - MongoDB database instance
 */
async function handleClick(event, db) {
  const logger = require('../utils/logger');

  logger.debug('Link clicked', {
    recipient: event.Recipient,
    messageId: event.MessageID,
    originalLink: event.OriginalLink,
    clickLocation: event.ClickLocation,
  });

  // Track link clicks in database for analytics
  if (db) {
    try {
      await db.collection('email_clicks').insertOne({
        email: event.Recipient,
        messageId: event.MessageID,
        originalLink: event.OriginalLink,
        clickLocation: event.ClickLocation,
        userAgent: event.UserAgent,
        platform: event.Platform,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log link click', {
        error: error.message,
        messageId: event.MessageID,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// MongoDB Atlas Webhook
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/mongodb
 *
 * Receives MongoDB Atlas Database Trigger / App Services webhook events.
 *
 * Authentication: HMAC-SHA256 signature in X-MongoDB-Webhook-Signature header.
 * Set MONGODB_WEBHOOK_SECRET in your environment and configure the same value
 * in MongoDB Atlas → App Services → Triggers → HTTP Endpoint settings.
 *
 * Event payload: MongoDB Atlas change-event document (operationType, ns, etc.)
 *
 * See webhooks/mongodbWebhookHandler.js for the full handler logic.
 */
router.post('/mongodb', apiLimiter, express.raw({ type: '*/*' }), buildMongodbWebhookHandler());

module.exports = router;
