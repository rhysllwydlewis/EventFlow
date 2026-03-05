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
const { writeLimiter } = require('../middleware/rateLimits');
const MessengerV4Service = require('../services/messenger-v4.service');
const { CONVERSATION_V4_TYPES } = require('../models/ConversationV4');
const messengerMetrics = require('../services/messengerMetrics');

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
  if (msg.includes('window expired') || msg.includes('Rate limit')) {
    return 429;
  }
  return 500;
}

// Dependencies injected by server.js
let authRequired;
let csrfProtection;
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

function applyCsrfProtection(req, res, next) {
  if (!csrfProtection) {
    return res.status(503).json({ error: 'CSRF service not initialized' });
  }
  return csrfProtection(req, res, next);
}

// Configure multer for attachments
const attachmentStorage = multer.memoryStorage();

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
let _messengerServicePromise = null;
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

      // Validate participantIds: each must be a non-empty string, cap at 50
      if (participantIds.length > 50) {
        return res.status(400).json({ error: 'Too many participants (max 50)' });
      }
      if (participantIds.some(id => typeof id !== 'string' || !id.trim())) {
        return res.status(400).json({ error: 'Each participant ID must be a non-empty string' });
      }

      // Validate type against allowed values (must match ConversationV4 model schema)
      if (!CONVERSATION_V4_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Invalid conversation type' });
      }

      // Get database instance
      const dbInstance = await getDbInstance();

      // Fetch user information for all participants
      // Users are keyed by their string 'id' field (from JWT auth), NOT ObjectId '_id'
      const usersCollection = dbInstance.collection('users');
      const uniqueUserIds = [...new Set([currentUserId, ...participantIds])];
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
        displayName: safeDisplayName(
          user.displayName,
          user.businessName,
          user.name,
          user.firstName
        ),
        avatar: user.avatar || null,
        role: user.role || 'customer',
      }));

      // Create conversation
      const conversation = await (
        await getMessengerService()
      ).createConversation({
        type,
        participants,
        context: context || null,
        metadata: metadata || {},
      });

      // Emit WebSocket event to all participants
      emitToConversation(conversation, 'messenger:v4:conversation-created', {
        conversation,
      });

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
        statusCode: 500,
      });
      res.status(500).json({
        error: error.message || 'Failed to create conversation',
      });
    }
  }
);

/**
 * GET /api/v4/messenger/conversations
 * List conversations for the authenticated user
 */
router.get('/conversations', applyAuthRequired, async (req, res) => {
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
router.get('/conversations/:id', applyAuthRequired, async (req, res) => {
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
      res.status(messengerErrorStatus(msg)).json({
        error: msg || 'Failed to update conversation',
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
      const { content, type = 'text', replyTo } = req.body;

      // Validate message type against allowed values
      const ALLOWED_MESSAGE_TYPES = ['text', 'image', 'file', 'system'];
      if (!ALLOWED_MESSAGE_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Invalid message type' });
      }

      const userId = req.user.id;
      const userName = safeDisplayName(
        req.user.displayName,
        req.user.businessName,
        req.user.name,
        req.user.firstName
      );
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

      // Process attachments if any
      const attachments = [];
      if (req.files && req.files.length > 0) {
        // Save attachments to uploads directory
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'messenger');
        await fs.mkdir(uploadsDir, { recursive: true });

        // Map validated MIME types to safe file extensions so the saved
        // filename is never derived from user-controlled originalname.
        const MIME_TO_EXT = {
          'image/jpeg': '.jpg',
          'image/png': '.png',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'application/pdf': '.pdf',
          'application/msword': '.doc',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'application/vnd.ms-excel': '.xls',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'text/plain': '.txt',
        };

        for (const file of req.files) {
          const ext = MIME_TO_EXT[file.mimetype];
          if (!ext) {
            // Should not reach here because multer fileFilter already rejects
            // unknown MIME types, but guard defensively.
            return res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` });
          }
          const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
          const filepath = path.join(uploadsDir, filename);
          await fs.writeFile(filepath, file.buffer);

          attachments.push({
            url: `/uploads/messenger/${filename}`,
            filename: file.originalname.substring(0, 255),
            mimeType: file.mimetype,
            size: file.size,
          });
        }

        if (attachments.length > 0) {
          messengerMetrics.increment('messenger_v4_attachments_uploaded_total', attachments.length);
        }
      }

      const messageData = {
        senderId: userId,
        senderName: userName,
        senderAvatar: req.user.avatar || null,
        content,
        type,
        attachments,
        replyTo: parsedReplyTo,
      };

      const message = await (await getMessengerService()).sendMessage(conversationId, messageData);

      // Get full conversation for WebSocket emission
      const conversation = await (
        await getMessengerService()
      ).getConversation(conversationId, userId);

      // Emit message to all participants
      emitToConversation(conversation, 'messenger:v4:message', {
        conversationId,
        message,
      });

      // Send email notifications to offline participants
      try {
        const recipientIds = conversation.participants
          .filter(p => p.userId !== userId && !p.isMuted)
          .map(p => p.userId);

        for (const recipientId of recipientIds) {
          // Check if recipient is online (would need presence tracking)
          // For now, send email to all non-muted participants
          const dbInstance = await getDbInstance();
          const recipient = await dbInstance.collection('users').findOne({ id: recipientId });
          if (recipient && recipient.email && postmark && typeof postmark.sendMail === 'function') {
            // Strip CR/LF from both userName and referenceTitle to prevent email header injection
            const safeUserName = userName.replace(/[\r\n]/g, ' ').trim();
            const safeTitle = (conversation.context?.referenceTitle || '')
              .replace(/[\r\n]/g, ' ')
              .trim();
            const contextInfo = safeTitle ? ` (Re: ${safeTitle})` : '';

            await postmark
              .sendMail({
                to: recipient.email,
                subject: `New message from ${safeUserName}${contextInfo}`,
                text: `${safeUserName} sent you a message:\n\n"${(content || '').substring(0, 200)}${(content || '').length > 200 ? '...' : ''}"\n\nView conversation: ${process.env.BASE_URL || 'https://event-flow.co.uk'}/messenger/?conversation=${conversationId}`,
                from: postmark.FROM_NOREPLY,
              })
              .catch(emailError => {
                logger.error('Failed to send email notification:', emailError);
              });
          }
        }
      } catch (notificationError) {
        logger.error('Error sending notifications:', notificationError);
        // Don't fail the request if notifications fail
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
      const statusCode = messengerErrorStatus(msg);
      logger.error('Error sending message:', {
        error: msg,
        userId: req.user?.id,
        conversationId: req.params.id,
        durationMs: Date.now() - startMs,
        statusCode,
      });
      res.status(statusCode).json({
        error: msg || 'Failed to send message',
      });
    }
  }
);

/**
 * GET /api/v4/messenger/conversations/:id/messages
 * Get messages for a conversation (cursor-paginated)
 */
router.get('/conversations/:id/messages', applyAuthRequired, async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    if (!isValidObjectId(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }
    const userId = req.user.id;
    const { cursor, limit = 50 } = req.query;

    // Validate cursor format before it reaches service-level new ObjectId()
    if (cursor && !isValidObjectId(cursor)) {
      return res.status(400).json({ error: 'Invalid cursor' });
    }

    const result = await (
      await getMessengerService()
    ).getMessages(conversationId, userId, {
      cursor,
      limit: Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100),
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
});

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
      const userName = safeDisplayName(
        req.user.displayName,
        req.user.businessName,
        req.user.name,
        req.user.firstName
      );
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
router.get('/unread-count', applyAuthRequired, async (req, res) => {
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
router.get('/contacts', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { q: query, role, limit = 20 } = req.query;

    // Validate role to prevent admin/privileged user enumeration
    const ALLOWED_CONTACT_ROLES = ['customer', 'supplier'];
    const validRole = role && ALLOWED_CONTACT_ROLES.includes(role) ? role : undefined;

    const contacts = await (
      await getMessengerService()
    ).searchContacts(
      userId,
      query && query.substring(0, 200),
      { role: validRole },
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
 * GET /api/v4/messenger/search
 * Full-text search across all user messages
 */
router.get('/search', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { q: query, limit = 50 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Search query is required',
      });
    }

    if (query.length > 200) {
      return res.status(400).json({
        error: 'Search query must be 200 characters or fewer',
      });
    }

    const results = await (
      await getMessengerService()
    ).searchMessages(userId, query, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100));

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
      const userName = safeDisplayName(
        req.user.displayName,
        req.user.businessName,
        req.user.name,
        req.user.firstName
      );
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

      await (await getMessengerService()).markAsRead(conversationId, userId);

      // Emit read receipt to other participants
      const conversation = await (
        await getMessengerService()
      ).getConversation(conversationId, userId);
      conversation.participants.forEach(participant => {
        if (participant.userId !== userId) {
          emitToUser(participant.userId, 'messenger:v4:read', {
            conversationId,
            userId,
            readAt: new Date(),
          });
        }
      });

      res.json({
        success: true,
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

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * GET /api/v4/messenger/admin/conversations
 * List all conversations (admin only).
 * Query params: limit, skip, search, status
 */
router.get('/admin/conversations', applyAuthRequired, async (req, res) => {
  try {
    // Admin role check
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const { limit = 20, skip = 0, search = '', status } = req.query;
    const dbInstance = await getDbInstance();
    const collection = dbInstance.collection('conversations_v4');

    const query = {};
    if (search && search.trim()) {
      const escapedSearch = search
        .substring(0, 200)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { 'lastMessage.content': { $regex: escapedSearch, $options: 'i' } },
        { 'participants.displayName': { $regex: escapedSearch, $options: 'i' } },
        { 'participants.businessName': { $regex: escapedSearch, $options: 'i' } },
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
