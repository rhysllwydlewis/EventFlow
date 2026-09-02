/**
 * MongoDB Webhook Routes
 *
 * POST /api/webhooks/mongodb — Handles incoming webhook events from MongoDB
 *                               Atlas Database Triggers / App Services.
 *
 * MongoDB Atlas events:
 * - insert / update / replace / delete / drop / rename / invalidate
 *
 * See also: webhooks/mongodbWebhookHandler.js
 *
 * Note: Postmark delivery webhooks (POST /postmark) are handled exclusively by
 * routes/postmark-webhook.js, which is mounted at this same base path ahead of
 * this router in routes/index.js. This file used to also define its own
 * '/postmark' route, but it was shadowed (unreachable — Express never routed a
 * request to it) and had drifted out of sync with the real handler, including
 * failing OPEN instead of closed when webhook credentials were unset in
 * production. Removed to eliminate that dead, misleading, insecure duplicate.
 */

'use strict';

const express = require('express');
const { apiLimiter } = require('../middleware/rateLimits');
const { buildMongodbWebhookHandler } = require('../webhooks/mongodbWebhookHandler');
const router = express.Router();

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
