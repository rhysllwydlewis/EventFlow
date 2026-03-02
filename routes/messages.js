/**
 * Messages Routes
 * Handles customer-supplier messaging functionality
 *
 * SECURITY NOTE: Message text is sanitized using validator.escape() to prevent XSS.
 * This escapes HTML entities (<, >, &, ", ', /) which is sufficient for text content.
 * For future enhancement, consider DOMPurify or sanitize-html if rich text is needed.
 */

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const validator = require('validator');
const { createDeprecationMiddleware } = require('../middleware/legacyMessaging');

// Dependencies injected by server.js
let dbUnified;
let authRequired;
let csrfProtection;
let auditLog;
let uid;
let postmark;

// Constants
const MESSAGE_PREVIEW_MAX_LENGTH = 100;

/**
 * Initialize dependencies from server.js
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (!deps) {
    throw new Error('Messages routes: dependencies object is required');
  }

  // Validate required dependencies
  const required = ['dbUnified', 'authRequired', 'csrfProtection', 'auditLog', 'uid', 'postmark'];

  const missing = required.filter(key => deps[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Messages routes: missing required dependencies: ${missing.join(', ')}`);
  }

  dbUnified = deps.dbUnified;
  authRequired = deps.authRequired;
  csrfProtection = deps.csrfProtection;
  auditLog = deps.auditLog;
  uid = deps.uid;
  postmark = deps.postmark;
}

/**
 * Deferred middleware wrappers
 * These are safe to reference in route definitions at require() time
 * because they defer the actual middleware call to request time,
 * when dependencies are guaranteed to be initialized.
 */
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

function getMessageText(recipientName, senderName, text, baseUrl) {
  const msgPreview = text.trim().substring(0, 200);
  const ellipsis = text.trim().length > 200 ? '...' : '';
  const url = baseUrl || 'https://event-flow.co.uk';
  return `Hello ${recipientName},

You have received a new message from ${senderName}:

"${msgPreview}${ellipsis}"

Log in to EventFlow to view and reply: ${url}/messages

Best regards,
EventFlow Team`;
}

function getMessageHtml(recipientName, senderName, text, baseUrl) {
  const msgPreview = text.trim().substring(0, 200);
  const ellipsis = text.trim().length > 200 ? '...' : '';
  const url = baseUrl || 'https://event-flow.co.uk';
  return [
    `<p>Hello ${recipientName},</p>`,
    `<p>You have received a new message from <strong>${senderName}</strong>:</p>`,
    `<blockquote style="border-left: 3px solid #667eea; padding-left: 12px; margin: 16px 0; color: #4b5563;">${msgPreview}${ellipsis}</blockquote>`,
    `<p><a href="${url}/messages" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">View Message</a></p>`,
    `<p>Best regards,<br>EventFlow Team</p>`,
  ].join('');
}

/**
 * Check if a user is a participant in a thread
 * Supports v1 threads with customerId/supplierId/recipientId fields
 * @param {Object} thread - Thread object
 * @param {string} userId - User ID to check
 * @param {Array} suppliers - Optional suppliers array to avoid redundant DB reads
 * @returns {Promise<boolean>} True if user is a participant in the thread
 */
async function isThreadParticipant(thread, userId, suppliers = null) {
  if (!thread || !userId) {
    return false;
  }

  // Check if user is the customer (thread creator)
  if (thread.customerId === userId) {
    return true;
  }

  // Check if user is the recipient (peer-to-peer messaging)
  if (thread.recipientId === userId) {
    return true;
  }

  // Check if user owns the supplier business
  if (thread.supplierId) {
    const suppliersList = suppliers || (await dbUnified.read('suppliers'));
    return suppliersList.some(s => s.id === thread.supplierId && s.ownerUserId === userId);
  }

  return false;
}

const router = express.Router();

/**
 * Deprecation enforcement middleware for v1 Messages API.
 * Behaviour is controlled by LEGACY_MESSAGING_MODE env var (off|read-only|on).
 * Write endpoints return HTTP 410 when mode is "off" or "read-only".
 */
router.use(
  createDeprecationMiddleware({
    version: 'v1',
    sunset: '2026-12-31',
  })
);

/**
 * GET /api/messages/threads
 * List all conversation threads for the current user
 * Query params: status (open/closed/archived), unreadOnly (boolean)
 * @deprecated Use GET /api/v4/messenger/conversations instead
 */
router.get('/threads', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, unreadOnly } = req.query;

    let threads = await dbUnified.read('threads');

    // Filter threads where user is a participant (regardless of role)
    if (userRole !== 'admin') {
      const suppliers = await dbUnified.read('suppliers');
      const supplierIds = suppliers.filter(s => s.ownerUserId === userId).map(s => s.id);

      threads = threads.filter(
        t =>
          t.customerId === userId || // User is the customer
          t.recipientId === userId || // User is the recipient (peer-to-peer)
          supplierIds.includes(t.supplierId) // User owns the supplier
      );
    }

    // Filter by status if provided
    if (status) {
      threads = threads.filter(t => (t.status || 'open') === status);
    }

    // Filter unread only if requested
    if (unreadOnly === 'true') {
      threads = threads.filter(t => {
        const unread = t.unreadCount || {};
        return (unread[userId] || 0) > 0;
      });
    }

    // Sort by last activity (most recent first)
    threads.sort((a, b) => {
      const aTime = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    res.json({ threads });
  } catch (error) {
    logger.error('Error fetching threads:', error);
    res.status(500).json({ error: 'Failed to fetch threads', details: error.message });
  }
});

/**
 * GET /api/messages/threads/:threadId
 * Get details of a specific thread
 */
router.get('/threads/:threadId', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { threadId } = req.params;

    const threads = await dbUnified.read('threads');
    const thread = threads.find(t => t.id === threadId);

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // Check access permissions
    const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ thread });
  } catch (error) {
    logger.error('Error fetching thread:', error);
    res.status(500).json({ error: 'Failed to fetch thread', details: error.message });
  }
});

/**
 * POST /api/messages/threads
 * Create a new conversation thread
 * Body: { supplierId, packageId?, subject?, eventType?, eventDate?, eventLocation?, guests?, message? }
 */
router.post('/threads', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole !== 'customer') {
      return res.status(403).json({ error: 'Only customers can initiate threads' });
    }

    const { supplierId, packageId, subject, eventType, eventDate, eventLocation, guests, message } =
      req.body;

    if (!supplierId) {
      return res.status(400).json({ error: 'supplierId is required' });
    }

    // Check if there's already an open thread with this supplier
    const threads = await dbUnified.read('threads');
    const existingThread = threads.find(
      t => t.customerId === userId && t.supplierId === supplierId && (t.status || 'open') === 'open'
    );

    if (existingThread) {
      return res.json({ thread: existingThread, isExisting: true });
    }

    // Get supplier and customer names
    const users = await dbUnified.read('users');
    const suppliers = await dbUnified.read('suppliers');

    const customer = users.find(u => u.id === userId);
    const supplier =
      suppliers.find(s => s.id === supplierId) || users.find(u => u.id === supplierId);

    const now = new Date().toISOString();

    // Sanitize message text if provided - stripLow before escape to remove control chars first
    let sanitizedMessage = null;
    let messagePreview = null;
    if (message && typeof message === 'string' && message.trim()) {
      sanitizedMessage = validator.escape(validator.stripLow(message.trim()));
      messagePreview = sanitizedMessage.substring(0, 100);
    }

    const newThread = {
      id: uid(),
      customerId: userId,
      customerName: customer?.name || 'Customer',
      supplierId,
      supplierName: supplier?.name || 'Supplier',
      packageId: packageId || null,
      subject: subject || 'New Inquiry',
      status: 'open',
      eventType: eventType || null,
      eventDate: eventDate || null,
      eventLocation: eventLocation || null,
      guests: guests || null,
      lastMessageAt: sanitizedMessage ? now : null,
      lastMessagePreview: messagePreview,
      unreadCount: sanitizedMessage ? { [supplierId]: 1 } : {},
      createdAt: now,
      updatedAt: now,
    };

    await dbUnified.insertOne('threads', newThread);

    // Create initial message if provided
    let initialMessage = null;
    if (sanitizedMessage) {
      initialMessage = {
        id: uid(),
        threadId: newThread.id,
        fromUserId: userId,
        fromRole: userRole,
        text: sanitizedMessage,
        isDraft: false,
        sentAt: now,
        readBy: [userId],
        attachments: [],
        reactions: [],
        createdAt: now,
        updatedAt: now,
      };
      await dbUnified.insertOne('messages', initialMessage);

      // Send email notification to supplier
      setImmediate(async () => {
        try {
          const supplierEmail = supplier?.email;
          const supplierName = supplier?.name || 'Supplier';
          const customerName = customer?.name || 'Customer';

          if (supplierEmail && supplierName) {
            await postmark.sendMail({
              to: supplierEmail,
              subject: `New message from ${customerName} - EventFlow`,
              text: getMessageText(
                supplierName,
                customerName,
                sanitizedMessage,
                process.env.BASE_URL
              ),
              html: getMessageHtml(
                supplierName,
                customerName,
                sanitizedMessage,
                process.env.BASE_URL
              ),
              from: postmark.FROM_NOREPLY,
            });
          }
        } catch (emailError) {
          logger.error('Failed to send email notification:', emailError);
        }
      });
    }

    // Track enquiry started event
    const supplierAnalytics = require('../utils/supplierAnalytics');
    supplierAnalytics
      .trackEnquiryStarted(supplierId, userId, {
        threadId: newThread.id,
        packageId: packageId || null,
        eventType: eventType || null,
      })
      .catch(err => logger.error('Failed to track enquiry started:', err));

    // Audit log
    auditLog({
      adminId: userId,
      adminEmail: req.user.email,
      action: 'THREAD_CREATED',
      targetType: 'thread',
      targetId: newThread.id,
      details: { supplierId, packageId },
    });

    res.status(201).json({
      thread: newThread,
      message: initialMessage,
      isExisting: false,
    });
  } catch (error) {
    logger.error('Error creating thread:', error);
    res.status(500).json({ error: 'Failed to create thread', details: error.message });
  }
});

/**
 * GET /api/messages/threads/:threadId/messages
 * Get all messages in a thread
 */
router.get('/threads/:threadId/messages', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { threadId } = req.params;

    // Verify access to thread
    const threads = await dbUnified.read('threads');
    const thread = threads.find(t => t.id === threadId);

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages
    let messages = await dbUnified.read('messages');
    messages = messages.filter(m => m.threadId === threadId && !m.isDraft);

    // Sort by creation time (oldest first)
    messages.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return aTime - bTime;
    });

    res.json({ messages });
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }
});

/**
 * POST /api/messages/threads/:threadId/messages
 * Send a new message in a thread
 * Body: { text, isDraft? }
 */
router.post(
  '/threads/:threadId/messages',
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { threadId } = req.params;
      const { text, isDraft, attachments } = req.body;

      if ((!text || text.trim().length === 0) && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: 'Message text or attachments required' });
      }

      // Verify access to thread
      const threads = await dbUnified.read('threads');
      const threadIndex = threads.findIndex(t => t.id === threadId);

      if (threadIndex === -1) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const thread = threads[threadIndex];
      const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Sanitize message text to prevent XSS - stripLow before escape to remove control chars first
      const sanitizedText = text ? validator.escape(validator.stripLow(text.trim())) : '';

      const now = new Date().toISOString();
      const messages = await dbUnified.read('messages');

      const newMessage = {
        id: uid(),
        threadId,
        fromUserId: userId,
        fromRole: userRole,
        text: sanitizedText,
        isDraft: isDraft === true,
        sentAt: isDraft ? null : now,
        readBy: [userId], // Sender has already "read" their own message
        attachments: Array.isArray(attachments) ? attachments : [],
        reactions: [],
        createdAt: now,
        updatedAt: now,
      };

      await dbUnified.insertOne('messages', newMessage);

      // Update thread if not a draft
      if (!isDraft) {
        const recipientId = userRole === 'customer' ? thread.supplierId : thread.customerId;
        if (!thread.unreadCount) {
          thread.unreadCount = {};
        }
        thread.unreadCount[recipientId] = (thread.unreadCount[recipientId] || 0) + 1;

        await dbUnified.updateOne(
          'threads',
          { id: thread.id },
          {
            $set: {
              lastMessageAt: now,
              lastMessagePreview: sanitizedText.substring(0, MESSAGE_PREVIEW_MAX_LENGTH),
              lastMessageText: sanitizedText.substring(0, MESSAGE_PREVIEW_MAX_LENGTH),
              lastMessageSenderId: req.user.id,
              updatedAt: now,
              unreadCount: thread.unreadCount,
            },
          }
        );

        // Track analytics event
        const supplierAnalytics = require('../utils/supplierAnalytics');
        const threadMessages = messages.filter(m => m.threadId === threadId && !m.isDraft);

        if (userRole === 'customer' && threadMessages.length === 1) {
          // First message from customer - this is an enquiry sent
          supplierAnalytics
            .trackEnquirySent(thread.supplierId, userId, {
              threadId,
              messageId: newMessage.id,
            })
            .catch(err => logger.error('Failed to track enquiry sent:', err));
        } else if (userRole === 'supplier') {
          // Supplier replied to a message
          supplierAnalytics
            .trackMessageReply(thread.supplierId, userId, {
              threadId,
              messageId: newMessage.id,
            })
            .catch(err => logger.error('Failed to track message reply:', err));

          // Trigger badge evaluation for supplier (async, non-blocking)
          const badgeManagement = require('../utils/badgeManagement');
          badgeManagement
            .evaluateSupplierBadges(thread.supplierId)
            .catch(err => logger.error('Failed to evaluate supplier badges:', err));
        }

        // Send email notification to recipient (async, non-blocking)
        setImmediate(async () => {
          try {
            const users = await dbUnified.read('users');
            const suppliers = await dbUnified.read('suppliers');

            const sender = users.find(u => u.id === userId);
            const senderName = sender?.name || sender?.email || 'Someone';

            let recipientEmail = null;
            let recipientName = null;

            if (userRole === 'customer') {
              // Customer sent message to supplier
              const supplier =
                suppliers.find(s => s.id === recipientId) || users.find(u => u.id === recipientId);
              recipientEmail = supplier?.email;
              recipientName = supplier?.name || 'Supplier';
            } else {
              // Supplier sent message to customer
              const customer = users.find(u => u.id === recipientId);
              recipientEmail = customer?.email;
              recipientName = customer?.name || 'Customer';
            }

            if (recipientEmail && recipientName) {
              await postmark.sendMail({
                to: recipientEmail,
                subject: `New message from ${senderName} - EventFlow`,
                text: getMessageText(
                  recipientName,
                  senderName,
                  sanitizedText,
                  process.env.BASE_URL
                ),
                html: getMessageHtml(
                  recipientName,
                  senderName,
                  sanitizedText,
                  process.env.BASE_URL
                ),
                from: postmark.FROM_NOREPLY,
              });
            }
          } catch (emailError) {
            logger.error('Error sending message notification email:', emailError);
            // Don't fail the request if email fails
          }
        });
      }

      res.status(201).json({ message: newMessage });
    } catch (error) {
      logger.error('Error creating message:', error);
      res.status(500).json({ error: 'Failed to create message', details: error.message });
    }
  }
);

/**
 * PUT /api/messages/:messageId
 * Update a message (for editing drafts)
 * Body: { text, isDraft? }
 */
router.put('/:messageId', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { text, isDraft } = req.body;

    const messages = await dbUnified.read('messages');
    const messageIndex = messages.findIndex(m => m.id === messageId);

    if (messageIndex === -1) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messages[messageIndex];

    // Only the sender can edit their message
    if (message.fromUserId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only drafts can be edited
    if (!message.isDraft) {
      return res.status(400).json({ error: 'Only draft messages can be edited' });
    }

    const now = new Date().toISOString();

    if (text !== undefined) {
      message.text = text.trim();
    }

    if (isDraft === false) {
      // Convert draft to sent message
      message.isDraft = false;
      message.sentAt = now;

      // Update thread
      const threads = await dbUnified.read('threads');
      const threadIndex = threads.findIndex(t => t.id === message.threadId);
      if (threadIndex !== -1) {
        const thread = threads[threadIndex];
        if (!thread.unreadCount) {
          thread.unreadCount = {};
        }
        const userRole = req.user.role;
        const recipientId = userRole === 'customer' ? thread.supplierId : thread.customerId;
        thread.unreadCount[recipientId] = (thread.unreadCount[recipientId] || 0) + 1;

        await dbUnified.updateOne(
          'threads',
          { id: thread.id },
          {
            $set: {
              lastMessageAt: now,
              lastMessagePreview: message.text.substring(0, MESSAGE_PREVIEW_MAX_LENGTH),
              lastMessageText: message.text.substring(0, MESSAGE_PREVIEW_MAX_LENGTH),
              lastMessageSenderId: req.user.id,
              updatedAt: now,
              unreadCount: thread.unreadCount,
            },
          }
        );
      }
    }

    message.updatedAt = now;
    await dbUnified.updateOne(
      'messages',
      { id: message.id },
      {
        $set: {
          text: message.text,
          isDraft: message.isDraft,
          sentAt: message.sentAt,
          updatedAt: now,
        },
      }
    );

    res.json({ message });
  } catch (error) {
    logger.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message', details: error.message });
  }
});

/**
 * POST /api/messages/threads/:threadId/mark-read
 * Mark all messages in a thread as read for the current user
 */
router.post(
  '/threads/:threadId/mark-read',
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { threadId } = req.params;

      // Verify access to thread
      const threads = await dbUnified.read('threads');
      const threadIndex = threads.findIndex(t => t.id === threadId);

      if (threadIndex === -1) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const thread = threads[threadIndex];
      const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Mark all messages as read
      const messages = await dbUnified.read('messages');
      let updatedCount = 0;

      for (const message of messages) {
        if (message.threadId === threadId && !message.isDraft) {
          if (!message.readBy) {
            message.readBy = [];
          }
          if (!message.readBy.includes(userId)) {
            message.readBy.push(userId);
            updatedCount++;
            await dbUnified.updateOne(
              'messages',
              { id: message.id },
              { $set: { readBy: message.readBy } }
            );
          }
        }
      }

      // Reset unread count for this user
      if (thread.unreadCount && thread.unreadCount[userId]) {
        thread.unreadCount[userId] = 0;
        await dbUnified.updateOne(
          'threads',
          { id: thread.id },
          { $set: { unreadCount: thread.unreadCount } }
        );
      }

      res.json({ success: true, markedRead: updatedCount });
    } catch (error) {
      logger.error('Error marking messages as read:', error);
      res.status(500).json({ error: 'Failed to mark messages as read', details: error.message });
    }
  }
);

/**
 * POST /api/messages/threads/:threadId/mark-unread
 * Mark a thread as unread for the current user
 */
router.post(
  '/threads/:threadId/mark-unread',
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { threadId } = req.params;

      // Verify access to thread
      const threads = await dbUnified.read('threads');
      const threadIndex = threads.findIndex(t => t.id === threadId);

      if (threadIndex === -1) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const thread = threads[threadIndex];
      const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Set unread count to 1 for this user
      if (!thread.unreadCount) {
        thread.unreadCount = {};
      }
      thread.unreadCount[userId] = 1;
      await dbUnified.updateOne(
        'threads',
        { id: thread.id },
        { $set: { unreadCount: thread.unreadCount } }
      );

      res.json({ success: true });
    } catch (error) {
      logger.error('Error marking thread as unread:', error);
      res.status(500).json({ error: 'Failed to mark thread as unread', details: error.message });
    }
  }
);

/**
 * GET /api/messages/drafts
 * Get all draft messages for the current user
 */
router.get('/drafts', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    let messages = await dbUnified.read('messages');
    messages = messages.filter(m => m.fromUserId === userId && m.isDraft === true);

    // Sort by updated time (most recent first)
    messages.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    res.json({ drafts: messages });
  } catch (error) {
    logger.error('Error fetching drafts:', error);
    res.status(500).json({ error: 'Failed to fetch drafts', details: error.message });
  }
});

/**
 * GET /api/messages/sent
 * Get all sent messages for the current user
 */
router.get('/sent', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    let messages = await dbUnified.read('messages');
    messages = messages.filter(m => m.fromUserId === userId && !m.isDraft);

    // Sort by sent time (most recent first)
    messages.sort((a, b) => {
      const aTime = new Date(a.sentAt || a.createdAt).getTime();
      const bTime = new Date(b.sentAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    res.json({ messages });
  } catch (error) {
    logger.error('Error fetching sent messages:', error);
    res.status(500).json({ error: 'Failed to fetch sent messages', details: error.message });
  }
});

/**
 * DELETE /api/messages/:messageId
 * Delete a draft message
 */
router.delete('/:messageId', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;

    const messages = await dbUnified.read('messages');
    const messageIndex = messages.findIndex(m => m.id === messageId);

    if (messageIndex === -1) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messages[messageIndex];

    // Only the sender can delete their message
    if (message.fromUserId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only drafts can be deleted
    if (!message.isDraft) {
      return res.status(400).json({ error: 'Only draft messages can be deleted' });
    }

    await dbUnified.deleteOne('messages', message.id);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting message:', error);
    res.status(500).json({ error: 'Failed to delete message', details: error.message });
  }
});

/**
 * POST /api/messages/:messageId/reactions
 * Toggle a reaction on a message
 */
router.post('/:messageId/reactions', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ error: 'Emoji is required' });
    }

    const messages = await dbUnified.read('messages');
    const messageIndex = messages.findIndex(m => m.id === messageId);

    if (messageIndex === -1) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messages[messageIndex];

    // Initialize reactions array if not exists
    if (!message.reactions) {
      message.reactions = [];
    }

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      r => r.userId === userId && r.emoji === emoji
    );

    if (existingReactionIndex !== -1) {
      // Remove reaction
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Add reaction
      message.reactions.push({
        userId,
        emoji,
        createdAt: new Date().toISOString(),
      });
    }

    await dbUnified.updateOne(
      'messages',
      { id: message.id },
      { $set: { reactions: message.reactions } }
    );

    res.json({ reactions: message.reactions });
  } catch (error) {
    logger.error('Error toggling reaction:', error);
    res.status(500).json({ error: 'Failed to toggle reaction', details: error.message });
  }
});

/**
 * POST /api/messages/threads/:threadId/archive
 * Archive a thread
 */
router.post(
  '/threads/:threadId/archive',
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { threadId } = req.params;

      const threads = await dbUnified.read('threads');
      const threadIndex = threads.findIndex(t => t.id === threadId);

      if (threadIndex === -1) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const thread = threads[threadIndex];
      const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      thread.status = 'archived';
      thread.updatedAt = new Date().toISOString();
      await dbUnified.updateOne(
        'threads',
        { id: thread.id },
        { $set: { status: 'archived', updatedAt: thread.updatedAt } }
      );

      res.json({ success: true, thread });
    } catch (error) {
      logger.error('Error archiving thread:', error);
      res.status(500).json({ error: 'Failed to archive thread', details: error.message });
    }
  }
);

/**
 * POST /api/messages/threads/:threadId/unarchive
 * Unarchive a thread
 */
router.post(
  '/threads/:threadId/unarchive',
  applyAuthRequired,
  applyCsrfProtection,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const { threadId } = req.params;

      const threads = await dbUnified.read('threads');
      const threadIndex = threads.findIndex(t => t.id === threadId);

      if (threadIndex === -1) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      const thread = threads[threadIndex];
      const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      thread.status = 'open';
      thread.updatedAt = new Date().toISOString();
      await dbUnified.updateOne(
        'threads',
        { id: thread.id },
        { $set: { status: 'open', updatedAt: thread.updatedAt } }
      );

      res.json({ success: true, thread });
    } catch (error) {
      logger.error('Error unarchiving thread:', error);
      res.status(500).json({ error: 'Failed to unarchive thread', details: error.message });
    }
  }
);

// ========== API Aliases for Compatibility ==========
// These endpoints provide alternative paths for the same functionality
// to maintain compatibility with existing frontend code

/**
 * GET /api/messages/conversations
 * Alias for /api/messages/threads - List all conversations for the current user
 */
router.get('/conversations', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { status, unreadOnly } = req.query;

    let threads = await dbUnified.read('threads');

    // Read suppliers once for both filtering and enrichment
    const suppliers = await dbUnified.read('suppliers');

    // Filter threads where user is a participant (regardless of role)
    if (userRole !== 'admin') {
      const supplierIds = suppliers.filter(s => s.ownerUserId === userId).map(s => s.id);

      threads = threads.filter(
        t =>
          t.customerId === userId || // User is the customer
          t.recipientId === userId || // User is the recipient (peer-to-peer)
          supplierIds.includes(t.supplierId) // User owns the supplier
      );
    }

    // Filter by status if provided
    if (status) {
      threads = threads.filter(t => (t.status || 'open') === status);
    }

    // Filter unread only if requested
    if (unreadOnly === 'true') {
      threads = threads.filter(t => {
        const unread = t.unreadCount || {};
        return (unread[userId] || 0) > 0;
      });
    }

    // Sort by last activity (most recent first)
    threads.sort((a, b) => {
      const aTime = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });

    // Enrich threads with user/supplier names if missing
    const users = await dbUnified.read('users');

    // Transform to conversation format expected by frontend
    const conversations = threads.map(t => {
      // Enrich supplier name if missing
      let supplierName = t.supplierName;
      if (!supplierName && t.supplierId) {
        const supplier = suppliers.find(s => s.id === t.supplierId);
        supplierName = supplier?.name || 'Supplier';
      }

      // Enrich customer name if missing
      let customerName = t.customerName;
      if (!customerName && t.customerId) {
        const customer = users.find(u => u.id === t.customerId);
        customerName = customer?.name || 'Customer';
      }

      // For marketplace peer-to-peer, also check recipientId
      let recipientName = null;
      if (t.recipientId && t.recipientId !== t.customerId && t.recipientId !== t.supplierId) {
        const recipient = users.find(u => u.id === t.recipientId);
        recipientName = recipient?.name || null;
      }

      return {
        id: t.id,
        supplierName,
        customerName,
        recipientName,
        // Standardize on single preview field for consistency (Issue #17)
        lastMessagePreview: t.lastMessagePreview || t.lastMessageText || '',
        lastMessageSenderId: t.lastMessageSenderId || '',
        lastMessageTime: t.lastMessageAt || t.updatedAt || t.createdAt,
        unreadCount: (t.unreadCount && t.unreadCount[userId]) || 0,
        status: t.status || 'open',
        // Add marketplace context if available
        marketplace: t.marketplace || null,
      };
    });

    res.json({ conversations });
  } catch (error) {
    logger.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations', details: error.message });
  }
});

/**
 * GET /api/messages/unread
 * Get unread message count for a user
 */
router.get('/unread', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const threads = await dbUnified.read('threads');

    let totalUnread = 0;
    threads.forEach(t => {
      if (t.unreadCount && t.unreadCount[userId]) {
        totalUnread += t.unreadCount[userId];
      }
    });

    res.json({ count: totalUnread });
  } catch (error) {
    logger.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count', details: error.message });
  }
});

/**
 * GET /api/messages/:conversationId
 * Alias for /api/messages/threads/:threadId/messages - Get messages in a conversation
 */
router.get('/:conversationId', applyAuthRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { conversationId } = req.params;

    // Verify access to thread
    const threads = await dbUnified.read('threads');
    const thread = threads.find(t => t.id === conversationId);

    if (!thread) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages
    let messages = await dbUnified.read('messages');
    messages = messages.filter(m => m.threadId === conversationId && !m.isDraft);

    // Sort by creation time (oldest first)
    messages.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return aTime - bTime;
    });

    res.json({ messages });
  } catch (error) {
    logger.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }
});

/**
 * POST /api/messages/:conversationId
 * Send a message in a conversation
 */
router.post('/:conversationId', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { conversationId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message text required' });
    }

    // Verify access to thread
    const threads = await dbUnified.read('threads');
    const threadIndex = threads.findIndex(t => t.id === conversationId);

    if (threadIndex === -1) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const thread = threads[threadIndex];
    const hasAccess = userRole === 'admin' || (await isThreadParticipant(thread, userId));

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const now = new Date().toISOString();

    const newMessage = {
      id: uid(),
      threadId: conversationId,
      fromUserId: userId,
      fromRole: userRole,
      text: message.trim(),
      isDraft: false,
      sentAt: now,
      readBy: [userId], // Sender has already "read" their own message
      createdAt: now,
      updatedAt: now,
    };

    await dbUnified.insertOne('messages', newMessage);

    // Update thread
    if (!thread.unreadCount) {
      thread.unreadCount = {};
    }
    const recipientId = userRole === 'customer' ? thread.supplierId : thread.customerId;
    thread.unreadCount[recipientId] = (thread.unreadCount[recipientId] || 0) + 1;

    await dbUnified.updateOne(
      'threads',
      { id: thread.id },
      {
        $set: {
          lastMessageAt: now,
          lastMessagePreview: message.trim().substring(0, MESSAGE_PREVIEW_MAX_LENGTH),
          lastMessageText: message.trim().substring(0, MESSAGE_PREVIEW_MAX_LENGTH),
          lastMessageSenderId: userId,
          updatedAt: now,
          unreadCount: thread.unreadCount,
        },
      }
    );

    // Audit log
    auditLog({
      adminId: userId,
      adminEmail: req.user.email,
      action: 'MESSAGE_SENT',
      targetType: 'message',
      targetId: newMessage.id,
      details: { threadId: conversationId },
    });

    res.status(201).json({ messageId: newMessage.id, message: newMessage });
  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

/**
 * POST /api/messages/:conversationId/read
 * Mark messages in a conversation as read
 */
router.post('/:conversationId/read', applyAuthRequired, applyCsrfProtection, async (req, res) => {
  try {
    const userId = req.user.id;
    const { conversationId } = req.params;

    const threads = await dbUnified.read('threads');
    const threadIndex = threads.findIndex(t => t.id === conversationId);

    if (threadIndex === -1) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const thread = threads[threadIndex];

    // Reset unread count for this user
    if (!thread.unreadCount) {
      thread.unreadCount = {};
    }
    thread.unreadCount[userId] = 0;

    await dbUnified.updateOne(
      'threads',
      { id: thread.id },
      { $set: { unreadCount: thread.unreadCount } }
    );

    // Also update readBy array for all messages in this thread
    const messages = await dbUnified.read('messages');
    for (const m of messages) {
      if (m.threadId === conversationId) {
        if (m.readBy && Array.isArray(m.readBy) && !m.readBy.includes(userId)) {
          m.readBy.push(userId);
          await dbUnified.updateOne('messages', { id: m.id }, { $set: { readBy: m.readBy } });
        } else if (!m.readBy) {
          m.readBy = [userId];
          await dbUnified.updateOne('messages', { id: m.id }, { $set: { readBy: m.readBy } });
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read', details: error.message });
  }
});

module.exports = router;
module.exports.initializeDependencies = initializeDependencies;
