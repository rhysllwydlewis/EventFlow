/**
 * Messenger v4 Routes - Unified Messenger API
 * Gold Standard messaging system API endpoints
 */

'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { writeLimiter, messengerReadLimiter } = require('../middleware/rateLimits');
const MessengerV4Service = require('../services/messenger-v4.service');
const { CONVERSATION_V4_TYPES, CONVERSATION_CONTEXT_TYPES } = require('../models/ConversationV4');
const NotificationService = require('../services/notification.service');
const messengerMetrics = require('../services/messengerMetrics');
const { setQueueContext } = require('../services/queue');
const { validateMessengerAttachment } = require('../utils/messengerAttachmentValidation');

// Returns true if a string looks like an email address — used to prevent
// email addresses from being stored as participant display names.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function looksLikeEmail(str) {
  return typeof str === 'string' && EMAIL_PATTERN.test(str);
}

// Picks the first value from candidates that is non-empty and not an email.
function safeDisplayName(...candidates) {
  let firstEmail = null;
  for (const c of candidates) {
    if (c && !looksLikeEmail(c)) {
      return c;
    }
    if (c && looksLikeEmail(c) && !firstEmail) {
      firstEmail = c;
    }
  }
  if (firstEmail) {
    return firstEmail.split('@')[0] || firstEmail;
  }
  return 'Unknown';
}

function preferredUserDisplayName(user = {}) {
  const first = typeof user.firstName === 'string' ? user.firstName.trim() : '';
  const last = typeof user.lastName === 'string' ? user.lastName.trim() : '';
  const fullName = `${first} ${last}`.trim();
  if (fullName) {
    return fullName;
  }
  return safeDisplayName(
    user.name,
    user.displayName,
    user.businessName,
    user.firstName,
    user.email
  );
}

const router = express.Router();

// Returns true only for 24-hex-char ObjectId strings; guards every :id param
// before it reaches new ObjectId() in the service to prevent 500 on bad input.
function isValidObjectId(id) {
  return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);
}

// Maps an error message to the appropriate HTTP status code for messenger errors.
function messengerErrorStatus(msg) {
  if (msg.includes('not found')) {
    return 404;
  }
  if (msg.includes('access denied') || msg.includes('not a participant')) {
    return 403;
  }
  if (
    msg.includes('window expired') ||
    msg.includes('Rate limit') ||
    msg.includes("You've reached") ||
    msg.includes('rate limit') ||
    msg.includes('Too many') ||
    msg.includes('spam')
  ) {
    return 429;
  }
  return 500;
}

// Dependencies injected by server.js
let authRequired;
let csrfProtection;
let requireVerifiedUser;
let requireApprovedSupplier;
let db;
// Stored as a getter so the real WS server (initialized after HTTP listen) is always used
let _getWsServer = null;
let postmark;
let logger;

// ---------------------------------------------------------------------------
// Deferred middleware wrappers
// Routes are registered at module-load time, but authRequired/csrfProtection
// are only assigned inside initialize(). These wrappers defer the call so
// Express does not throw "requires a callback function" on undefined.
// ---------------------------------------------------------------------------
function applyAuthRequired(req, res, next) {
  if (!authRequired) {
    return res.status(503).json({ error: 'Auth service not initialized' });
  }
  return authRequired(req, res, next);
}

function applyRequireVerifiedUser(req, res, next) {
  if (!requireVerifiedUser) {
    return res.status(503).json({ error: 'Verification service not initialized' });
  }
  return requireVerifiedUser(req, res, next);
}

function applyRequireApprovedSupplier(req, res, next) {
  if (!requireApprovedSupplier) {
    // If not injected, fall back to allowing the request (not a hard dep)
    return next();
  }
  return requireApprovedSupplier(req, res, next);
}

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

// Configure multer for attachments
const attachmentStorage = multer.memoryStorage();

function createBadAttachmentError(reason) {
  const error = new Error(reason || 'Invalid attachment');
  error.statusCode = 400;
  error.expose = true;
  return error;
}

async function persistValidatedMessengerAttachments(files, options = {}) {
  const incomingFiles = Array.isArray(files) ? files : [];
  if (incomingFiles.length === 0) {
    return [];
  }

  // Validate every in-memory multer file before creating directories or writing
  // bytes. This prevents spoofed/oversized files from leaving partial uploads
  // behind when a later file in the batch fails validation.
  const validatedFiles = incomingFiles.map(file => {
    const validation = validateMessengerAttachment(file);
    if (!validation.ok) {
      throw createBadAttachmentError(validation.reason);
    }
    return { file, validation };
  });

  const fsImpl = options.fsImpl || fs;
  const cryptoImpl = options.cryptoImpl || crypto;
  const uploadsDir = options.uploadsDir || path.join(__dirname, '..', 'uploads', 'messenger');
  await fsImpl.mkdir(uploadsDir, { recursive: true });

  const attachments = [];
  for (const { file, validation } of validatedFiles) {
    const ext = validation.extension;
    const filename = `${cryptoImpl.randomBytes(16).toString('hex')}${ext}`;
    const filepath = path.join(uploadsDir, filename);
    await fsImpl.writeFile(filepath, file.buffer);

    attachments.push({
      url: `/uploads/messenger/${filename}`,
      filename: String(file.originalname || 'attachment').substring(0, 255),
      mimeType: validation.mimetype || file.mimetype,
      size: file.size,
    });
  }

  return attachments;
}

const attachmentFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage: attachmentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10, // Max 10 files per request
  },
  fileFilter: attachmentFileFilter,
});

// Service will be initialized lazily on first request
let _messengerServicePromise = null;

/**
 * Initialize routes with dependencies
 */
function initialize(dependencies) {
  if (!dependencies) {
    throw new Error('Messenger v4 routes: dependencies object is required');
  }

  const required = ['authRequired', 'csrfProtection', 'db', 'logger'];
  const missing = required.filter(key => !dependencies[key]);

  if (missing.length > 0) {
    throw new Error(`Messenger v4 routes: missing required dependencies: ${missing.join(', ')}`);
  }

  authRequired = dependencies.authRequired;
  csrfProtection = dependencies.csrfProtection;
  requireVerifiedUser = dependencies.requireVerifiedUser || null;
  requireApprovedSupplier = dependencies.requireApprovedSupplier || null;

  // db can be either mongoDb module or db instance
  // Store as mongoDb for lazy initialization
  db = dependencies.db;

  // Store a lazy getter so we resolve the WS server on each emit (it is initialized
  // after the HTTP server starts, which is after route initialization).
  // In production, `dependencies.getWebSocketServer` is always provided by routes/index.js.
  // The `wsServer` fallback supports direct calls (e.g., test harnesses or custom setups).
  _getWsServer =
    typeof dependencies.getWebSocketServer === 'function'
      ? dependencies.getWebSocketServer
      : () => dependencies.wsServer || null;
  postmark = dependencies.postmark;
  logger = dependencies.logger;
  getDbInstance()
    .then(dbInstance => {
      setQueueContext({ db: dbInstance, logger, postmark });
    })
    .catch(err => {
      logger.error('Failed to initialize messenger queue context', err);
    });

  // Service will be initialized lazily on first request
  _messengerServicePromise = null;

  logger.info('Messenger v4 routes initialized');

  return router;
}

/**
 * Get database instance (handles both mongoDb module and db instance)
 */
async function getDbInstance() {
  if (db && typeof db.getDb === 'function') {
    // It's the mongoDb module
    return await db.getDb();
  }
  // It's already a db instance
  return db;
}

/**
 * Get or initialize messenger service (promise-based lock prevents TOCTOU race)
 */
async function getMessengerService() {
  if (!_messengerServicePromise) {
    _messengerServicePromise = getDbInstance()
      .then(dbInstance => new MessengerV4Service(dbInstance, logger))
      .catch(err => {
        _messengerServicePromise = null; // allow retry on next request
        throw err;
      });
  }
  return _messengerServicePromise;
}

/**
 * Create a NotificationService instance bound to the current DB and WS server.
 * Instantiated per-request so it always uses the live WS server reference.
 */
async function getNotificationService() {
  const dbInstance = await getDbInstance();
  const ws = _getWsServer ? _getWsServer() : null;
  return new NotificationService(dbInstance, ws);
}

/**
 * Helper: Emit WebSocket event to user
 */
function emitToUser(userId, event, data) {
  const ws = _getWsServer ? _getWsServer() : null;
  if (ws && ws.emitToUser) {
    ws.emitToUser(userId, event, data);
  }
}

/**
 * Helper: Emit WebSocket event to all conversation participants via room broadcast
 */
function emitToConversation(conversation, event, data) {
  const ws = _getWsServer ? _getWsServer() : null;
  if (!ws) {
    return;
  }
  // Prefer room broadcast (emitToConversation) when available: single emit to the
  // conversation:v4:{id} room rather than N individual emits.
  if (ws.emitToConversation) {
    const convId = (conversation._id || conversation.id || '').toString();
    ws.emitToConversation(convId, event, data);
  } else if (ws.emitToUser) {
    conversation.participants.forEach(participant => {
      ws.emitToUser(participant.userId, event, data);
    });
  }
}

// ============================================================================
// CONVERSATION ENDPOINTS
// ============================================================================

/**
 * POST /api/v4/messenger/conversations
 * Create a new conversation
 */
router.post(
  '/conversations',
  applyAuthRequired,
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    const startMs = Date.now();
    try {
      const { type, participantIds, context, metadata } = req.body;
      const currentUserId = req.user.id;

      if (!type || !Array.isArray(participantIds) || participantIds.length === 0) {
        return res.status(400).json({
          error: 'type and participantIds are required',
        });
      }

      // Normalise participant IDs before validation and lookup.
      if (participantIds.length > 50) {
        return res.status(400).json({ error: 'Too many participants (max 50)' });
      }
      if (participantIds.some(id => typeof id !== 'string')) {
        return res.status(400).json({ error: 'Each participant ID must be a non-empty string' });
      }
      const normalisedParticipantIds = participantIds.map(id => id.trim()).filter(Boolean);
      if (normalisedParticipantIds.length === 0) {
        return res.status(400).json({ error: 'Each participant ID must be a non-empty string' });
      }
      if (new Set(normalisedParticipantIds).size !== normalisedParticipantIds.length) {
        return res.status(400).json({ error: 'Duplicate participant IDs are not allowed' });
      }
      const otherIds = normalisedParticipantIds.filter(id => id !== currentUserId);
      if (otherIds.length === 0) {
        return res
          .status(400)
          .json({ error: 'A conversation must include at least one other participant' });
      }

      // Validate type against allowed values (must match ConversationV4 model schema)
      if (!CONVERSATION_V4_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Invalid conversation type' });
      }

      // Validate context.type when a context object is provided
      if (
        context &&
        context.type !== undefined &&
        context.type !== null &&
        !CONVERSATION_CONTEXT_TYPES.includes(context.type)
      ) {
        return res.status(400).json({ error: 'Invalid conversation context type' });
      }

      // Get database instance
      const dbInstance = await getDbInstance();

      // Fetch user information for all participants
      // Users are keyed by their string 'id' field (from JWT auth), NOT ObjectId '_id'
      const usersCollection = dbInstance.collection('users');
      const uniqueUserIds = [...new Set([currentUserId, ...normalisedParticipantIds])];
      const participantUsers = await usersCollection
        .find({
          id: { $in: uniqueUserIds },
        })
        .toArray();

      if (participantUsers.length !== uniqueUserIds.length) {
        return res.status(400).json({
          error: 'One or more participant IDs are invalid',
        });
      }

      // Build participants array.
      // Use the string 'id' field (consistent with JWT auth) so that all
      // participant checks (getConversations, sendMessage, etc.) work with
      // the string user IDs that auth middleware provides.
      const participants = participantUsers.map(user => ({
        userId: user.id,
        displayName: preferredUserDisplayName(user),
        avatar: user.avatarUrl || user.avatar || null,
        role: user.role || 'customer',
      }));

      const isGenericNewMessage = metadata?.source === 'generic_new_message';
      if (isGenericNewMessage && type === 'direct' && !context && participants.length === 2) {
        const currentParticipant = participants.find(p => p.userId === currentUserId);
        const otherParticipant = participants.find(p => p.userId !== currentUserId);
        if (
          currentParticipant?.role === 'supplier' &&
          otherParticipant &&
          otherParticipant.role !== 'supplier'
        ) {
          const existingDirectConversation = await dbInstance
            .collection('conversations_v4')
            .findOne({
              type: 'direct',
              'participants.userId': { $all: [currentParticipant.userId, otherParticipant.userId] },
              status: 'active',
              $expr: { $eq: [{ $size: '$participants' }, 2] },
            });

          if (!existingDirectConversation) {
            return res.status(403).json({
              error:
                'Customers can only be messaged from an existing conversation or valid context.',
              code: 'GENERIC_CUSTOMER_COLD_MESSAGE_BLOCKED',
            });
          }
        }
      }

      const service = await getMessengerService();

      // Create conversation
      const conversation = await service.createConversation({
        type,
        participants,
        context: context || null,
        metadata: metadata || {},
        creatorUserId: currentUserId,
      });

      // Emit WebSocket event to the creator only.
      // We do NOT broadcast to other participants here because the conversation
      // is still empty (lastMessage: null).  Other participants will only see
      // the conversation once a real message arrives via the existing
      // 'messenger:v4:new-message' WS event, which carries the conversation
      // context and is emitted to all participants on message send.
      const wsServer = _getWsServer ? _getWsServer() : null;
      if (wsServer) {
        wsServer.to(currentUserId).emit('messenger:v4:conversation-created', { conversation });
      }

      messengerMetrics.increment('messenger_v4_conversations_created_total');
      logger.info('messenger_v4 conversation_created', {
        userId: currentUserId,
        conversationId: conversation._id,
        type,
        participantCount: participants.length,
        durationMs: Date.now() - startMs,
        statusCode: 201,
      });

      res.status(201).json({
        success: true,
        conversation,
      });
    } catch (error) {
      messengerMetrics.increment('messenger_v4_errors_total');
      logger.error('Error creating conversation:', {
        error: error.message,
        userId: req.user?.id,
        durationMs: Date.now() - startMs,
        statusCode: error.statusCode || messengerErrorStatus(error.message || ''),
      });
      res.status(error.statusCode || messengerErrorStatus(error.message || '')).json({
        error: error.message || 'Failed to create conversation',
        code: error.code,
        retryAfter: error.retryAfter,
      });
    }
  }
);

/**
 * GET /api/v4/messenger/conversations
 * List conversations for the authenticated user
 */
router.get('/conversations', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { unread, pinned, archived, search, status, limit = 50, skip = 0 } = req.query;

    const filters = {};
    if (unread === 'true') {
      filters.unread = true;
    }
    if (pinned === 'true') {
      filters.pinned = true;
    }
    if (archived !== undefined) {
      filters.archived = archived === 'true';
    }
    if (search) {
      filters.search = search.substring(0, 200);
    }
    if (status) {
      const allowedStatuses = ['active', 'closed'];
      if (allowedStatuses.includes(status)) {
        filters.status = status;
      }
    }

    const conversations = await (
      await getMessengerService()
    ).getConversations(
      userId,
      filters,
      Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100),
      Math.max(parseInt(skip, 10) || 0, 0)
    );

    res.json({
      success: true,
      conversations,
      count: conversations.length,
    });
  } catch (error) {
    logger.error('Error fetching conversations:', error);
    res.status(500).json({
      error: 'Failed to fetch conversations',
    });
  }
});

/**
 * GET /api/v4/messenger/conversations/:id
 * Get a specific conversation
 */
router.get('/conversations/:id', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }
    const userId = req.user.id;

    const conversation = await (await getMessengerService()).getConversation(id, userId);

    res.json({
      success: true,
      conversation,
    });
  } catch (error) {
    logger.error('Error fetching conversation:', error);
    const msg = error.message || '';
    res.status(messengerErrorStatus(msg)).json({
      error: msg || 'Failed to fetch conversation',
    });
  }
});

/**
 * PATCH /api/v4/messenger/conversations/:id
 * Update conversation settings
 */
router.patch(
  '/conversations/:id',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const userId = req.user.id;
      const updates = req.body;

      const conversation = await (
        await getMessengerService()
      ).updateConversation(id, userId, updates);

      // Emit update event with the full updated conversation so clients can correctly
      // refresh participant-level fields (isPinned, isArchived, isMuted, unreadCount)
      emitToUser(userId, 'messenger:v4:conversation-updated', {
        conversationId: id,
        conversation,
      });

      res.json({
        success: true,
        conversation,
      });
    } catch (error) {
      logger.error('Error updating conversation:', error);
      const msg = error.message || '';
      res.status(error.statusCode || messengerErrorStatus(msg)).json({
        error: msg || 'Failed to update conversation',
        code: error.code,
        retryAfter: error.retryAfter,
      });
    }
  }
);

/**
 * DELETE /api/v4/messenger/conversations/:id
 * Soft delete a conversation (archive for the user)
 */
router.delete(
  '/conversations/:id',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const userId = req.user.id;

      await (await getMessengerService()).deleteConversation(id, userId);

      emitToUser(userId, 'messenger:v4:conversation-deleted', {
        conversationId: id,
      });

      res.json({
        success: true,
        message: 'Conversation archived',
      });
    } catch (error) {
      logger.error('Error deleting conversation:', error);
      const msg = error.message || '';
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to delete conversation',
      });
    }
  }
);

// ============================================================================
// MESSAGE ENDPOINTS
// ============================================================================

/**
 * POST /api/v4/messenger/conversations/:id/messages
 * Send a message in a conversation
 */
router.post(
  '/conversations/:id/messages',
  applyAuthRequired,
  applyRequireVerifiedUser,
  applyRequireApprovedSupplier,
  applyCsrfProtection,
  writeLimiter,
  upload.array('attachments', 10),
  async (req, res) => {
    const startMs = Date.now();
    try {
      const { id: conversationId } = req.params;
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const { content, type = 'text', replyTo, replyToMessageId, clientMessageId } = req.body;

      // Validate message type against allowed values
      const ALLOWED_MESSAGE_TYPES = ['text', 'image', 'file', 'system'];
      if (!ALLOWED_MESSAGE_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Invalid message type' });
      }

      // clientMessageId: optional; string, max 64 chars, constrained alphabet
      // (UUIDs/ulids/nanoids).  Reject anything else up-front so the service
      // layer only ever sees sanitised values.
      let normalisedClientMessageId = null;
      if (clientMessageId !== undefined && clientMessageId !== null && clientMessageId !== '') {
        if (
          typeof clientMessageId !== 'string' ||
          clientMessageId.length > 64 ||
          !/^[A-Za-z0-9._:-]+$/.test(clientMessageId)
        ) {
          return res.status(400).json({ error: 'Invalid clientMessageId' });
        }
        normalisedClientMessageId = clientMessageId;
      }

      const userId = req.user.id;
      const userName = preferredUserDisplayName(req.user);
      const hasAttachments = req.files && req.files.length > 0;
      if ((!content || content.trim().length === 0) && !hasAttachments) {
        return res.status(400).json({
          error: 'Message content or at least one attachment is required',
        });
      }

      // Validate and parse replyTo before writing any attachment files,
      // so a malformed replyTo returns 400 without orphaning uploads.
      let parsedReplyTo = null;
      if (replyTo) {
        if (typeof replyTo === 'string') {
          try {
            parsedReplyTo = JSON.parse(replyTo);
          } catch {
            return res.status(400).json({ error: 'Invalid replyTo format' });
          }
        } else {
          parsedReplyTo = replyTo;
        }
      }

      // Process attachments if any. Validation verifies MIME signature and
      // size before any file is written to disk.
      let attachments = [];
      if (req.files && req.files.length > 0) {
        try {
          attachments = await persistValidatedMessengerAttachments(req.files);
        } catch (error) {
          if (error.statusCode === 400 && error.expose) {
            return res.status(400).json({ error: error.message });
          }
          throw error;
        }

        if (attachments.length > 0) {
          messengerMetrics.increment('messenger_v4_attachments_uploaded_total', attachments.length);
        }
      }

      const messageData = {
        senderId: userId,
        senderName: userName,
        senderAvatar: req.user.avatarUrl || req.user.avatar || null,
        content,
        type,
        attachments,
        replyTo: parsedReplyTo,
        replyToMessageId: replyToMessageId || parsedReplyTo?._id || null,
        clientMessageId: normalisedClientMessageId,
      };

      const message = await (await getMessengerService()).sendMessage(conversationId, messageData);

      // Extract and strip the internal auto-unarchive metadata before sending to client
      const autoUnarchivedUserIds = Array.isArray(message._autoUnarchivedUserIds)
        ? message._autoUnarchivedUserIds
        : [];
      delete message._autoUnarchivedUserIds;

      // Get full conversation for WebSocket emission
      const conversation = await (
        await getMessengerService()
      ).getConversation(conversationId, userId);

      // Emit message to all participants
      emitToConversation(conversation, 'messenger:v4:message', {
        conversationId,
        message,
      });

      // Notify auto-unarchived recipients so their client moves the conversation
      // back to the main inbox without requiring a manual page reload.
      for (const uid of autoUnarchivedUserIds) {
        try {
          const recipientConv = await (
            await getMessengerService()
          ).getConversation(conversationId, uid);
          emitToUser(uid, 'messenger:v4:conversation-updated', {
            conversationId,
            conversation: recipientConv,
          });
        } catch (err) {
          // Best-effort — the recipient will still see the message on next load.
          // Log with context so production issues are diagnosable.
          logger.warn('messenger_v4 auto-unarchive notification failed', {
            uid,
            conversationId,
            error: err.message,
          });
        }
      }

      messengerMetrics.increment('messenger_v4_messages_sent_total');
      logger.info('messenger_v4 message_sent', {
        userId,
        conversationId,
        messageId: message._id,
        type,
        hasAttachments: attachments.length > 0,
        attachmentCount: attachments.length,
        wsParticipants: conversation.participants.length,
        durationMs: Date.now() - startMs,
        statusCode: 201,
        // NOTE: raw message content is NOT logged intentionally (PII)
      });

      res.status(201).json({
        success: true,
        message,
      });
    } catch (error) {
      messengerMetrics.increment('messenger_v4_errors_total');
      const msg = error.message || '';
      const statusCode = error.statusCode || messengerErrorStatus(msg);
      logger.error('Error sending message:', {
        error: msg,
        userId: req.user?.id,
        conversationId: req.params.id,
        durationMs: Date.now() - startMs,
        statusCode,
      });
      res.status(statusCode).json({
        error: msg || 'Failed to send message',
        code: error.code,
        retryAfter: error.retryAfter,
        maxMessageLength: error.maxMessageLength,
      });
    }
  }
);

/**
 * GET /api/v4/messenger/conversations/:id/messages
 * Get messages for a conversation (cursor-paginated)
 */
router.get(
  '/conversations/:id/messages',
  applyAuthRequired,
  messengerReadLimiter,
  async (req, res) => {
    try {
      const { id: conversationId } = req.params;
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const userId = req.user.id;
      const { cursor, limit = 50, sinceSeq } = req.query;

      // Validate cursor format before it reaches service-level new ObjectId()
      if (cursor && !isValidObjectId(cursor)) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }

      // sinceSeq: non-negative integer string.  When present, the service
      // returns forward-in-time messages for gap reconciliation.
      let parsedSinceSeq = null;
      if (sinceSeq !== undefined) {
        const n = Number(sinceSeq);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          return res.status(400).json({ error: 'Invalid sinceSeq' });
        }
        parsedSinceSeq = n;
      }

      const result = await (
        await getMessengerService()
      ).getMessages(conversationId, userId, {
        cursor,
        limit: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100),
        sinceSeq: parsedSinceSeq,
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error('Error fetching messages:', error);
      const msg = error.message || '';
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to fetch messages',
      });
    }
  }
);

/**
 * PATCH /api/v4/messenger/messages/:id
 * Edit a message
 */
router.patch(
  '/messages/:id',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid message ID' });
      }
      const userId = req.user.id;
      const { content } = req.body;

      if (!content || content.trim().length === 0) {
        return res.status(400).json({
          error: 'Message content is required',
        });
      }

      const message = await (await getMessengerService()).editMessage(id, userId, content);

      // Emit update event
      const conversation = await (
        await getMessengerService()
      ).getConversation(message.conversationId.toString(), userId);
      emitToConversation(conversation, 'messenger:v4:message-edited', {
        messageId: id,
        content: message.content,
        editedAt: message.editedAt,
      });

      res.json({
        success: true,
        message,
      });
    } catch (error) {
      logger.error('Error editing message:', error);
      const msg = error.message || '';
      const editStatus = msg.includes('cannot be empty') ? 400 : messengerErrorStatus(msg);
      res.status(editStatus).json({
        error: msg || 'Failed to edit message',
      });
    }
  }
);

/**
 * DELETE /api/v4/messenger/messages/:id
 * Delete a message
 */
router.delete(
  '/messages/:id',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid message ID' });
      }
      const userId = req.user.id;

      const svc = await getMessengerService();
      const message = await svc.messagesCollection.findOne({
        _id: new ObjectId(id),
        senderId: userId,
        isDeleted: false,
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      await svc.deleteMessage(id, userId);

      // Emit delete event
      const conversation = await svc.getConversation(message.conversationId.toString(), userId);
      emitToConversation(conversation, 'messenger:v4:message-deleted', {
        messageId: id,
      });

      res.json({
        success: true,
        message: 'Message deleted',
      });
    } catch (error) {
      logger.error('Error deleting message:', error);
      res.status(500).json({
        error: 'Failed to delete message',
      });
    }
  }
);

/**
 * POST /api/v4/messenger/messages/:id/reactions
 * Toggle emoji reaction on a message
 */
router.post(
  '/messages/:id/reactions',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid message ID' });
      }
      const userId = req.user.id;
      const userName = preferredUserDisplayName(req.user);
      const { emoji } = req.body;

      if (!emoji || typeof emoji !== 'string') {
        return res.status(400).json({
          error: 'Emoji is required',
        });
      }

      // Limit emoji field length to prevent storing arbitrary long strings
      if (emoji.length > 10) {
        return res.status(400).json({ error: 'Invalid emoji' });
      }

      const message = await (
        await getMessengerService()
      ).toggleReaction(id, userId, userName, emoji);

      // Emit reaction event
      const conversation = await (
        await getMessengerService()
      ).getConversation(message.conversationId.toString(), userId);
      emitToConversation(conversation, 'messenger:v4:reaction', {
        messageId: id,
        reactions: message.reactions,
      });

      res.json({
        success: true,
        message,
      });
    } catch (error) {
      logger.error('Error toggling reaction:', error);
      const msg = error.message || '';
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to toggle reaction',
      });
    }
  }
);

// ============================================================================
// UTILITY ENDPOINTS
// ============================================================================

/**
 * GET /api/v4/messenger/unread-count
 * Get total unread message count for badge
 */
router.get('/unread-count', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const unreadCount = await (await getMessengerService()).getUnreadCount(userId);

    res.json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    logger.error('Error fetching unread count:', error);
    res.status(500).json({
      error: 'Failed to fetch unread count',
    });
  }
});

/**
 * GET /api/v4/messenger/contacts
 * Search for contactable users
 */
router.get('/contacts', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { q: query, role, mode, limit = 20 } = req.query;

    // Validate role to prevent admin/privileged user enumeration
    const ALLOWED_CONTACT_ROLES = ['customer', 'supplier'];
    const supplierOnlyMode = mode === 'supplier_search' || mode === 'supplier_only';
    const requestedRole = supplierOnlyMode ? 'supplier' : role;
    const validRole =
      requestedRole && ALLOWED_CONTACT_ROLES.includes(requestedRole) ? requestedRole : undefined;

    const contacts = await (
      await getMessengerService()
    ).searchContacts(
      userId,
      query && query.substring(0, 200),
      { role: validRole, mode: supplierOnlyMode ? 'supplier_search' : undefined },
      Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
    );

    res.json({
      success: true,
      contacts,
    });
  } catch (error) {
    logger.error('Error searching contacts:', error);
    res.status(500).json({
      error: 'Failed to search contacts',
    });
  }
});

/**
 * GET /api/v4/messenger/blocked
 * List the users the current user has blocked.
 */
router.get('/blocked', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    const blocked = await (await getMessengerService()).getBlockedUsers(req.user.id);
    res.json({ success: true, blocked });
  } catch (error) {
    logger.error('Error listing blocked users:', error);
    res.status(500).json({ error: 'Failed to list blocked users' });
  }
});

/**
 * POST /api/v4/messenger/block
 * Block another user. Blocked messages/conversation attempts are rejected in
 * both directions (see MessengerV4Service#isBlockedEitherWay).
 */
router.post('/block', applyAuthRequired, applyCsrfProtection, writeLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const blockedUserId = typeof req.body.userId === 'string' ? req.body.userId.trim() : '';
    const reason = typeof req.body.reason === 'string' ? req.body.reason.substring(0, 500) : '';

    if (!blockedUserId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (blockedUserId === userId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const block = await (await getMessengerService()).blockUser(userId, blockedUserId, reason);
    res.json({ success: true, block: { userId: block.blockedUserId, reason: block.reason } });
  } catch (error) {
    logger.error('Error blocking user:', error);
    const msg = error.message || '';
    res.status(msg.includes('Validation failed') ? 400 : 500).json({
      error: msg.includes('Validation failed') ? msg : 'Failed to block user',
    });
  }
});

/**
 * DELETE /api/v4/messenger/block/:userId
 * Unblock a previously blocked user.
 */
router.delete(
  '/block/:userId',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const removed = await (
        await getMessengerService()
      ).unblockUser(req.user.id, req.params.userId);
      res.json({ success: true, removed });
    } catch (error) {
      logger.error('Error unblocking user:', error);
      res.status(500).json({ error: 'Failed to unblock user' });
    }
  }
);

/**
 * GET /api/v4/messenger/search
 * Full-text search across all user messages.
 * Optional `conversationId` query param scopes the search to a single
 * conversation (the caller must be a participant; otherwise the conversation
 * is silently excluded by the service layer's participant filter).
 */
router.get('/search', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { q: query, limit = 50, conversationId } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Search query is required',
      });
    }

    if (query.length > 200) {
      return res.status(400).json({
        error: 'Search query must be 200 characters or fewer',
      });
    }

    // Validate optional conversationId scoping — reject clearly-malformed ids
    // up-front rather than silently ignoring them.  Also reject array-shaped
    // values (e.g. `?conversationId=a&conversationId=b`) which Express would
    // otherwise pass through to the downstream ObjectId constructor.
    if (conversationId !== undefined) {
      if (typeof conversationId !== 'string' || !isValidObjectId(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
    }

    const results = await (
      await getMessengerService()
    ).searchMessages(
      userId,
      query,
      Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100),
      conversationId || null
    );

    res.json({
      success: true,
      results,
      count: results.length,
    });
  } catch (error) {
    logger.error('Error searching messages:', error);
    res.status(500).json({
      error: 'Failed to search messages',
    });
  }
});

/**
 * POST /api/v4/messenger/conversations/:id/typing
 * Send typing indicator
 */
router.post(
  '/conversations/:id/typing',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id: conversationId } = req.params;
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const userId = req.user.id;
      const userName = preferredUserDisplayName(req.user);
      // isTyping defaults to true — clients may send false to indicate they stopped typing
      const isTyping = req.body.isTyping !== false;

      // Fetch conversation once — verifies participant access and provides participant list
      const conversation = await (
        await getMessengerService()
      ).getConversation(conversationId, userId);
      conversation.participants.forEach(participant => {
        if (participant.userId !== userId) {
          emitToUser(participant.userId, 'messenger:v4:typing', {
            conversationId,
            userId,
            userName,
            isTyping,
          });
        }
      });

      res.json({
        success: true,
      });
    } catch (error) {
      logger.error('Error sending typing indicator:', error);
      const msg = error.message || '';
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to send typing indicator',
      });
    }
  }
);

/**
 * POST /api/v4/messenger/conversations/:id/read
 * Mark conversation as read
 */
router.post(
  '/conversations/:id/read',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id: conversationId } = req.params;
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const userId = req.user.id;

      // Optional upToSeq — bounds the read receipt so only messages up to and
      // including the supplied seq are marked.  Non-negative integer only.
      let upToSeq = null;
      if (req.body && req.body.upToSeq !== undefined && req.body.upToSeq !== null) {
        const n = Number(req.body.upToSeq);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
          return res.status(400).json({ error: 'Invalid upToSeq' });
        }
        upToSeq = n;
      }

      const readResult = await (
        await getMessengerService()
      ).markAsRead(conversationId, userId, { upToSeq });

      // Emit read receipt to other participants
      const conversation = await (
        await getMessengerService()
      ).getConversation(conversationId, userId);
      conversation.participants.forEach(participant => {
        if (participant.userId !== userId) {
          emitToUser(participant.userId, 'messenger:v4:read', {
            conversationId,
            userId,
            readAt: readResult?.readAt || new Date(),
            upToSeq: readResult?.upToSeq ?? null,
          });
        }
      });

      res.json({
        success: true,
        readAt: readResult?.readAt,
        upToSeq: readResult?.upToSeq ?? null,
        modifiedCount: readResult?.modifiedCount || 0,
      });
    } catch (error) {
      logger.error('Error marking as read:', error);
      const msg = error.message || '';
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to mark as read',
      });
    }
  }
);

/**
 * POST /api/v4/messenger/conversations/:id/delivered
 * Record a delivery receipt for one or more messages.
 * Body: { messageIds: string[] }
 */
router.post(
  '/conversations/:id/delivered',
  applyAuthRequired,
  applyCsrfProtection,
  writeLimiter,
  async (req, res) => {
    try {
      const { id: conversationId } = req.params;
      if (!isValidObjectId(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }
      const userId = req.user.id;
      const { messageIds } = req.body || {};

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ error: 'messageIds array is required' });
      }
      if (messageIds.length > 200) {
        return res.status(400).json({ error: 'Too many messageIds (max 200)' });
      }
      const filtered = messageIds.filter(id => typeof id === 'string' && isValidObjectId(id));
      if (filtered.length === 0) {
        return res.status(400).json({ error: 'No valid messageIds provided' });
      }

      const result = await (
        await getMessengerService()
      ).markAsDelivered(conversationId, userId, filtered);

      // Re-broadcast delivery receipt to the conversation so sender's clients
      // can flip ✓ → ✓✓ without an extra round-trip.  Sender may be offline,
      // which is fine — they'll pick it up on next reconnect via sinceSeq.
      if (result.modifiedCount > 0) {
        const conversation = await (
          await getMessengerService()
        ).getConversation(conversationId, userId);
        emitToConversation(conversation, 'messenger:v4:message-delivered', {
          conversationId,
          userId,
          messageIds: result.messageIds,
          deliveredAt: result.deliveredAt,
        });
      }

      res.json({
        success: true,
        modifiedCount: result.modifiedCount,
        deliveredAt: result.deliveredAt,
      });
    } catch (error) {
      logger.error('Error recording delivery:', error);
      const msg = error.message || '';
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to record delivery',
      });
    }
  }
);

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * GET /api/v4/messenger/admin/conversations
 * List all conversations (admin only).
 * Query params: limit, skip, search, status
 */
router.get('/admin/conversations', applyAuthRequired, messengerReadLimiter, async (req, res) => {
  try {
    // Admin role check
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const { limit = 20, skip = 0, search = '', status } = req.query;
    const dbInstance = await getDbInstance();
    const collection = dbInstance.collection('conversations_v4');

    // Only show conversations where at least one message has been sent.
    // messageCount is 0 at creation; sendMessage increments it via $inc.
    // Conversations with messageCount 0 were created but abandoned —
    // they should not appear in the admin moderation view.
    const query = { messageCount: { $gt: 0 } };
    if (search && search.trim()) {
      const escapedSearch = search
        .substring(0, 200)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { 'lastMessage.content': { $regex: escapedSearch, $options: 'i' } },
        { 'participants.displayName': { $regex: escapedSearch, $options: 'i' } },
        { 'participants.businessName': { $regex: escapedSearch, $options: 'i' } },
        // Canonical schema is `context.referenceTitle`; keep the legacy
        // `context.title` clause for backward compatibility with any
        // pre-migration rows still in the collection.
        { 'context.referenceTitle': { $regex: escapedSearch, $options: 'i' } },
        { 'context.title': { $regex: escapedSearch, $options: 'i' } },
      ];
    }
    if (status) {
      // Admins can filter by a broader set of statuses
      const allowedAdminStatuses = ['active', 'closed'];
      if (allowedAdminStatuses.includes(status)) {
        query.status = status;
      }
    }

    const [conversations, total] = await Promise.all([
      collection
        .find(query)
        .sort({ updatedAt: -1 })
        .skip(Math.max(parseInt(skip, 10) || 0, 0))
        .limit(Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100))
        .toArray(),
      collection.countDocuments(query),
    ]);

    res.json({ success: true, conversations, total });
  } catch (error) {
    logger.error('Admin: error listing conversations:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

/**
 * GET /api/v4/messenger/admin/conversations/:id
 * Get a single conversation by ID for admin moderation (no participant check).
 */
router.get('/admin/conversations/:id', applyAuthRequired, writeLimiter, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const conversation = await (await getMessengerService()).getConversationAsAdmin(id);

    res.json({ success: true, conversation });
  } catch (error) {
    logger.error('Admin: error fetching conversation:', error);
    const msg = error.message || '';
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * GET /api/v4/messenger/admin/conversations/:id/messages
 * Get messages for any conversation for admin moderation (no participant check).
 * Query params: cursor, limit
 */
router.get(
  '/admin/conversations/:id/messages',
  applyAuthRequired,
  writeLimiter,
  async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin access required' });
      }

      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }

      const { cursor, limit } = req.query;
      const options = {};
      if (cursor && isValidObjectId(cursor)) {
        options.cursor = cursor;
      }
      if (limit) {
        const parsedLimit = parseInt(limit, 10);
        if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
          options.limit = parsedLimit;
        }
      }

      const result = await (await getMessengerService()).getMessagesAsAdmin(id, options);

      res.json({ success: true, ...result });
    } catch (error) {
      logger.error('Admin: error fetching messages:', error);
      const msg = error.message || '';
      if (msg.includes('not found')) {
        return res.status(404).json({ error: msg });
      }
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  }
);

/**
 * GET /api/v4/messenger/admin/metrics
 * Return in-memory messenger v4 operational counters (admin only).
 */
router.get('/admin/metrics', applyAuthRequired, writeLimiter, (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    res.json({
      success: true,
      metrics: messengerMetrics.getAll(),
      collectedAt: new Date().toISOString(),
      note: 'Counters reset on process restart. Integrate with external monitoring for persistence.',
    });
  } catch (error) {
    logger.error('Admin: error fetching metrics:', error);
    next(error);
  }
});

module.exports = { router, initialize };

module.exports._private = {
  persistValidatedMessengerAttachments,
  createBadAttachmentError,
};
