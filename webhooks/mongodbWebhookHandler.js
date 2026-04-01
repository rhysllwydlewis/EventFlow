/**
 * MongoDB Webhook Handler
 *
 * Handles incoming webhook events from MongoDB Atlas (Database Triggers /
 * App Services HTTP Endpoints).
 *
 * Authentication
 * --------------
 * MongoDB Atlas Trigger webhooks can be verified with an HMAC-SHA256
 * signature.  Set MONGODB_WEBHOOK_SECRET to a strong random secret; Atlas
 * will include the signature in the request header:
 *
 *   X-MongoDB-Webhook-Signature: sha256=<hex_digest>
 *
 * The digest is computed as HMAC-SHA256(rawBody, secret).
 *
 * Idempotency
 * -----------
 * Each Atlas change event carries a unique `_id.{_data}` value.  The handler
 * records processed IDs in the `mongodb_webhook_events` collection and skips
 * duplicates, so retried deliveries are safe.
 *
 * Environment variables
 * ---------------------
 *   MONGODB_WEBHOOK_SECRET   - HMAC-SHA256 signing secret (required in production)
 *   MONGODB_WEBHOOK_ENABLED  - 'false' to disable the endpoint (default: enabled)
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

const SIGNATURE_HEADER = 'x-mongodb-webhook-signature';
const IDEMPOTENCY_COLLECTION = 'mongodb_webhook_events';
const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the HMAC-SHA256 signature sent by MongoDB Atlas.
 *
 * @param {Buffer} rawBody   - The raw request body bytes.
 * @param {string} header    - The value of X-MongoDB-Webhook-Signature.
 * @param {string} secret    - The shared secret (MONGODB_WEBHOOK_SECRET).
 * @returns {boolean}
 */
function verifySignature(rawBody, header, secret) {
  if (!header || !secret) {
    return false;
  }

  // Header format: "sha256=<hex>"
  const [algorithm, receivedHex] = header.split('=');
  if (algorithm !== 'sha256' || !receivedHex) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedHex, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable string key from the Atlas change-event _id.
 * Atlas change-event IDs are objects like { _data: "..." }; we serialise
 * the entire object so that the key is deterministic.
 *
 * @param {*} eventId - The _id field from the change event.
 * @returns {string}
 */
function deriveEventKey(eventId) {
  if (!eventId) {
    return null;
  }
  if (typeof eventId === 'string') {
    return eventId;
  }
  try {
    return JSON.stringify(eventId);
  } catch {
    return String(eventId);
  }
}

/**
 * Check whether an event has already been processed; record it if not.
 * Returns true if this is a duplicate (should be skipped).
 *
 * @param {Object} db       - MongoDB Db instance.
 * @param {string} eventKey - The serialised event _id.
 * @returns {Promise<boolean>}
 */
async function isDuplicate(db, eventKey) {
  if (!db || !eventKey) {
    return false;
  }

  const col = db.collection(IDEMPOTENCY_COLLECTION);
  const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);

  try {
    const result = await col.findOneAndUpdate(
      { eventKey },
      {
        $setOnInsert: {
          eventKey,
          processedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'before' }
    );

    // Purge stale entries opportunistically (non-blocking)
    col.deleteMany({ processedAt: { $lt: cutoff } }).catch(() => {});

    // If a pre-existing document was returned, this is a duplicate
    return result !== null;
  } catch (err) {
    // On error, log and allow processing (fail-open for non-duplicates)
    logger.error('[mongodb-webhook] Idempotency check error:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event type handlers
// ---------------------------------------------------------------------------

/**
 * Handle an Atlas "insert" change event.
 * @param {Object} event - The full change event document.
 * @param {Object} db    - MongoDB Db instance.
 */
async function handleInsert(event, db) {
  logger.info('[mongodb-webhook] Insert event', {
    collection: event.ns?.coll,
    documentId: String(event.documentKey?._id ?? 'unknown'),
    operationType: event.operationType,
  });

  if (db) {
    try {
      await db.collection('mongodb_webhook_log').insertOne({
        operationType: event.operationType,
        collection: event.ns?.coll,
        database: event.ns?.db,
        documentId: event.documentKey?._id,
        fullDocument: event.fullDocument || null,
        receivedAt: new Date(),
      });
    } catch (err) {
      logger.error('[mongodb-webhook] Failed to log insert event:', err.message);
    }
  }
}

/**
 * Handle Atlas "update" and "replace" change events.
 * @param {Object} event - The full change event document.
 * @param {Object} db    - MongoDB Db instance.
 */
async function handleUpdate(event, db) {
  logger.info('[mongodb-webhook] Update/replace event', {
    collection: event.ns?.coll,
    documentId: String(event.documentKey?._id ?? 'unknown'),
    operationType: event.operationType,
    updatedFields: event.updateDescription?.updatedFields
      ? Object.keys(event.updateDescription.updatedFields)
      : [],
  });

  if (db) {
    try {
      await db.collection('mongodb_webhook_log').insertOne({
        operationType: event.operationType,
        collection: event.ns?.coll,
        database: event.ns?.db,
        documentId: event.documentKey?._id,
        updatedFields: event.updateDescription?.updatedFields || null,
        removedFields: event.updateDescription?.removedFields || null,
        receivedAt: new Date(),
      });
    } catch (err) {
      logger.error('[mongodb-webhook] Failed to log update event:', err.message);
    }
  }
}

/**
 * Handle Atlas "delete" change events.
 * @param {Object} event - The full change event document.
 * @param {Object} db    - MongoDB Db instance.
 */
async function handleDelete(event, db) {
  logger.info('[mongodb-webhook] Delete event', {
    collection: event.ns?.coll,
    documentId: String(event.documentKey?._id ?? 'unknown'),
    operationType: event.operationType,
  });

  if (db) {
    try {
      await db.collection('mongodb_webhook_log').insertOne({
        operationType: event.operationType,
        collection: event.ns?.coll,
        database: event.ns?.db,
        documentId: event.documentKey?._id,
        receivedAt: new Date(),
      });
    } catch (err) {
      logger.error('[mongodb-webhook] Failed to log delete event:', err.message);
    }
  }
}

/**
 * Handle Atlas "drop" / "dropDatabase" / "rename" / "invalidate" events.
 * @param {Object} event - The full change event document.
 * @param {Object} db    - MongoDB Db instance.
 */
async function handleSchemaEvent(event, db) {
  logger.warn('[mongodb-webhook] Schema-level event received', {
    operationType: event.operationType,
    collection: event.ns?.coll,
    database: event.ns?.db,
  });

  if (db) {
    try {
      await db.collection('mongodb_webhook_log').insertOne({
        operationType: event.operationType,
        collection: event.ns?.coll,
        database: event.ns?.db,
        receivedAt: new Date(),
      });
    } catch (err) {
      logger.error('[mongodb-webhook] Failed to log schema event:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

/**
 * Build the Express request handler for the MongoDB webhook endpoint.
 *
 * Accepts configuration overrides for testability (avoids module-level env
 * reads so tests can inject values without touching process.env).
 *
 * @param {{ webhookSecret?: string, enabled?: boolean, nodeEnv?: string }} [cfg]
 * @returns {Function} Express async middleware
 */
function buildMongodbWebhookHandler(cfg = {}) {
  const webhookSecret =
    cfg.webhookSecret !== undefined ? cfg.webhookSecret : process.env.MONGODB_WEBHOOK_SECRET;
  const enabled =
    cfg.enabled !== undefined
      ? cfg.enabled
      : process.env.MONGODB_WEBHOOK_ENABLED !== 'false';
  const nodeEnv = cfg.nodeEnv !== undefined ? cfg.nodeEnv : process.env.NODE_ENV;

  /**
   * POST /api/webhooks/mongodb
   */
  return async function mongodbWebhookHandler(req, res) {
    if (!enabled) {
      return res.status(503).json({ error: 'MongoDB webhook endpoint is disabled' });
    }

    const rawBody = req.body; // Expected to be a Buffer (use express.raw())
    const sigHeader = req.headers[SIGNATURE_HEADER];

    // ── Signature verification ────────────────────────────────────────────
    if (webhookSecret) {
      if (!verifySignature(rawBody, sigHeader, webhookSecret)) {
        logger.warn('[mongodb-webhook] Signature verification failed', {
          hasHeader: !!sigHeader,
          ip: req.ip,
        });
        return res.status(400).json({ error: 'Webhook signature verification failed' });
      }
    } else if (nodeEnv === 'production') {
      // Fail closed in production: never process unsigned webhooks
      logger.error(
        '[mongodb-webhook] MONGODB_WEBHOOK_SECRET is not set in production — rejecting request'
      );
      return res
        .status(400)
        .json({ error: 'Webhook signature verification required in production' });
    } else {
      logger.warn(
        '[mongodb-webhook] ⚠️  Signature verification skipped (MONGODB_WEBHOOK_SECRET not set)'
      );
    }

    // ── Parse body ────────────────────────────────────────────────────────
    let event;
    try {
      event = JSON.parse(rawBody.toString());
    } catch (err) {
      logger.error('[mongodb-webhook] Failed to parse webhook body:', err.message);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const operationType = event.operationType || 'unknown';
    const eventKey = deriveEventKey(event._id);

    logger.info('[mongodb-webhook] Received event', {
      operationType,
      collection: event.ns?.coll,
      hasEventKey: !!eventKey,
    });

    // ── Idempotency ───────────────────────────────────────────────────────
    const db = req.app && req.app.locals && req.app.locals.db;
    if (eventKey) {
      const duplicate = await isDuplicate(db, eventKey);
      if (duplicate) {
        logger.info('[mongodb-webhook] Duplicate event — skipping', { operationType, eventKey });
        return res.json({ received: true, duplicate: true });
      }
    }

    // ── Dispatch ──────────────────────────────────────────────────────────
    try {
      switch (operationType) {
        case 'insert':
          await handleInsert(event, db);
          break;

        case 'update':
        case 'replace':
          await handleUpdate(event, db);
          break;

        case 'delete':
          await handleDelete(event, db);
          break;

        case 'drop':
        case 'dropDatabase':
        case 'rename':
        case 'invalidate':
          await handleSchemaEvent(event, db);
          break;

        default:
          logger.info('[mongodb-webhook] Unknown operation type:', operationType);
      }
    } catch (err) {
      logger.error('[mongodb-webhook] Error processing event:', err.message, {
        operationType,
        eventKey,
      });
      // Return 200 so Atlas does not retry on application errors (retries
      // are guarded by the idempotency store)
      return res.status(200).json({ received: true, error: 'Processing error' });
    }

    return res.json({ received: true });
  };
}

module.exports = {
  buildMongodbWebhookHandler,
  verifySignature,
  deriveEventKey,
};
