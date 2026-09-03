/**
 * Messenger v4 Service - Unified Business Logic Layer
 * Gold Standard messaging system with comprehensive features
 */

'use strict';

const { ObjectId } = require('mongodb');
const { validateConversation, validateMessage } = require('../models/ConversationV4');
const { validateBlockedUser, createBlockedUser } = require('../models/BlockedUser');
const contentSanitizer = require('./contentSanitizer');
const spamDetection = require('./spamDetection');
const { getMessagingLimitsForTier } = require('../config/messagingLimits');
const { enqueueNotificationJob } = require('./queue');
const {
  createFanoutState,
  markFanoutQueued,
  markFanoutFailed,
  buildFanoutPayload,
  sanitizeFanoutError,
} = require('./notificationFanout.service');

function enqueueMessageNotificationFanout({ messagesCollection, logger, message, conversation }) {
  if (message.notificationFanout.recipientIds.length === 0) {
    return;
  }

  enqueueNotificationJob(buildFanoutPayload(message, conversation.context?.referenceTitle || ''))
    .then(() => markFanoutQueued(messagesCollection, message._id))
    .catch(async error => {
      await markFanoutFailed(messagesCollection, message._id, error).catch(markError => {
        logger.error('[messenger-v4] Failed to persist notification fan-out failure', {
          error: sanitizeFanoutError(markError),
          messageId: String(message._id),
        });
      });
      logger.error('[messenger-v4] Failed to enqueue notification job', {
        error: sanitizeFanoutError(error),
        messageId: String(message._id),
      });
    });
}

async function autoUnarchiveRecipients({
  conversationsCollection,
  logger,
  conversation,
  conversationId,
  senderId,
}) {
  const userIds = conversation.participants
    .filter(participant => participant.userId !== senderId && participant.isArchived === true)
    .map(participant => participant.userId);
  if (userIds.length === 0) {
    return userIds;
  }

  try {
    // Target participants by userId rather than array index so concurrent
    // participant changes cannot make this update affect the wrong record.
    await conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      { $set: { 'participants.$[p].isArchived': false } },
      { arrayFilters: [{ 'p.userId': { $in: [...new Set(userIds)] } }] }
    );
  } catch (error) {
    logger.error('[messenger-v4] Failed to auto-unarchive recipients', {
      error: error.message,
      conversationId: String(conversationId),
    });
  }
  return userIds;
}

class MessengerV4Service {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger || console;
    this.conversationsCollection = db.collection('conversations_v4');
    this.messagesCollection = db.collection('chat_messages_v4');
    // Per-conversation monotonic sequence counters used to order messages and
    // power gap-detection / reconciliation on the client.  One document per
    // conversation: { _id: <conversationId>, seq: <int> }.
    this.countersCollection = db.collection('conversation_counters');
    this.blockedUsersCollection = db.collection('blockedUsers');
    this.transactionsEnabled = process.env.MONGO_REPLICA_SET === 'true';
    this.mongoClient = db.client || db.s?.client || null;
    if (!this.transactionsEnabled && !MessengerV4Service._txnWarningLogged) {
      this.logger.warn(
        '[messenger-v4] Mongo transactions disabled (set MONGO_REPLICA_SET=true after replica-set migration)'
      );
      MessengerV4Service._txnWarningLogged = true;
    }
  }

  static _displayNameFromUser(user = {}) {
    const first = typeof user.firstName === 'string' ? user.firstName.trim() : '';
    const last = typeof user.lastName === 'string' ? user.lastName.trim() : '';
    const fullName = `${first} ${last}`.trim();
    if (fullName) {
      return fullName;
    }
    const fallbackName = [user.name, user.displayName, user.businessName]
      .find(v => typeof v === 'string' && v.trim())
      ?.trim();
    if (fallbackName) {
      return fallbackName;
    }
    if (typeof user.email === 'string' && user.email.includes('@')) {
      return user.email.split('@')[0] || 'Unknown';
    }
    return 'Unknown';
  }

  static _avatarFromUser(user = {}) {
    return user.avatarUrl || user.avatar || null;
  }

  async _getUserMapByIds(userIds = []) {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
    if (!ids.length) {
      return new Map();
    }
    const usersCollection = this.db.collection('users');
    const users = await usersCollection
      .find(
        { id: { $in: ids } },
        {
          projection: {
            id: 1,
            firstName: 1,
            lastName: 1,
            name: 1,
            displayName: 1,
            businessName: 1,
            email: 1,
            avatarUrl: 1,
            avatar: 1,
          },
        }
      )
      .toArray();
    return new Map(users.map(user => [String(user.id), user]));
  }

  async _hydrateConversationParticipants(conversation) {
    if (!conversation || !Array.isArray(conversation.participants)) {
      return conversation;
    }
    const userMap = await this._getUserMapByIds(conversation.participants.map(p => p.userId));
    return {
      ...conversation,
      participants: conversation.participants.map(participant => {
        const user = userMap.get(String(participant.userId));
        if (!user) {
          return participant;
        }
        return {
          ...participant,
          displayName: MessengerV4Service._displayNameFromUser(user),
          avatar: MessengerV4Service._avatarFromUser(user),
        };
      }),
    };
  }

  /**
   * Allocate the next monotonic `seq` for a conversation.
   * Uses an atomic $inc upsert so concurrent sends cannot collide.
   * @param {ObjectId|string} conversationId
   * @returns {Promise<number>} The newly-allocated sequence number (>=1).
   */
  async _nextSeq(conversationId, options = {}) {
    const session = options.session || null;
    const _id = conversationId instanceof ObjectId ? conversationId : new ObjectId(conversationId);
    // findOneAndUpdate with upsert+returnDocument:'after' gives us an atomic increment.
    // Fall back to a read-then-write when the driver helper isn't available (in-memory
    // test doubles) so unit tests keep working.
    if (typeof this.countersCollection.findOneAndUpdate === 'function') {
      const res = await this.countersCollection.findOneAndUpdate(
        { _id },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after', ...(session ? { session } : {}) }
      );
      // Drivers vary: result may be the doc directly or { value: doc }.
      const doc = res && res.value !== undefined ? res.value : res;
      if (doc && typeof doc.seq === 'number') {
        return doc.seq;
      }
    }
    // Fallback path (test in-memory db).  Not atomic, but tests are single-threaded.
    const existing = await this.countersCollection.findOne({ _id }, session ? { session } : {});
    const next = existing && typeof existing.seq === 'number' ? existing.seq + 1 : 1;
    if (existing) {
      await this.countersCollection.updateOne(
        { _id },
        { $set: { seq: next } },
        session ? { session } : {}
      );
    } else {
      await this.countersCollection.insertOne({ _id, seq: next }, session ? { session } : {});
    }
    return next;
  }

  async _runRetryableTransaction(operation, maxRetries = 3) {
    if (!this.mongoClient || !this.transactionsEnabled) {
      return operation(null);
    }
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const session = this.mongoClient.startSession();
      try {
        let result;
        await session.withTransaction(async () => {
          result = await operation(session);
        });
        await session.endSession();
        return result;
      } catch (err) {
        lastError = err;
        const retryable =
          err?.errorLabels?.includes('TransientTransactionError') ||
          err?.errorLabels?.includes('UnknownTransactionCommitResult');
        await session.endSession();
        if (!retryable || attempt === maxRetries) {
          throw err;
        }
      }
    }
    throw lastError;
  }

  /**
   * Compute the per-viewer delivery/read status of a message.
   * Returns 'sent' | 'delivered' | 'read'.  For messages authored by the
   * viewer, this reflects how far the message has propagated to other
   * recipients (taking the minimum state across all other participants
   * when participant info is available, otherwise the max observed).
   *
   * @param {Object} message
   * @param {string} viewerUserId - The requesting user's id.
   * @param {Array<{userId:string}>} [participants] - Other participants for
   *   own-message aggregation.  When omitted, own-message status is based
   *   purely on whether any non-self user has delivered/read it.
   */
  static computeViewerStatus(message, viewerUserId, participants = null) {
    if (!message) {
      return 'sent';
    }
    const deliveredTo = Array.isArray(message.deliveredTo) ? message.deliveredTo : [];
    const readBy = Array.isArray(message.readBy) ? message.readBy : [];
    const isOwn = message.senderId === viewerUserId;

    if (isOwn) {
      // Own message: report the weakest link across the non-sender recipients.
      // If no recipient list is supplied, fall back to any-recipient heuristics.
      const others = Array.isArray(participants)
        ? participants.filter(p => p.userId && p.userId !== viewerUserId).map(p => p.userId)
        : null;

      if (!others || others.length === 0) {
        if (readBy.some(r => r.userId !== viewerUserId)) {
          return 'read';
        }
        if (deliveredTo.some(d => d.userId !== viewerUserId)) {
          return 'delivered';
        }
        return 'sent';
      }

      const readSet = new Set(readBy.map(r => r.userId));
      const deliveredSet = new Set(deliveredTo.map(d => d.userId));
      const allRead = others.every(uid => readSet.has(uid));
      if (allRead) {
        return 'read';
      }
      const allDelivered = others.every(uid => deliveredSet.has(uid) || readSet.has(uid));
      if (allDelivered) {
        return 'delivered';
      }
      // Anyone read/delivered counts as at least delivered for the sender's tick.
      if (others.some(uid => readSet.has(uid) || deliveredSet.has(uid))) {
        return 'delivered';
      }
      return 'sent';
    }

    // Incoming message: status describes the viewer's own state.
    if (readBy.some(r => r.userId === viewerUserId)) {
      return 'read';
    }
    if (deliveredTo.some(d => d.userId === viewerUserId)) {
      return 'delivered';
    }
    return 'sent';
  }

  /**
   * Create a new conversation (with deduplication)
   * @param {Object} data - Conversation data
   * @param {string} conversationData.type - Conversation type
   * @param {Array} data.participants - Array of participant objects
   * @param {Object} conversationData.context - Optional context information
   * @param {Object} conversationData.metadata - Optional metadata
   * @returns {Object} Created or existing conversation
   */
  async createConversation(data) {
    const creatorUserId = typeof data.creatorUserId === 'string' ? data.creatorUserId.trim() : null;
    const normalisedParticipants = Array.isArray(data.participants)
      ? data.participants
          .map(p => ({ ...p, userId: typeof p.userId === 'string' ? p.userId.trim() : p.userId }))
          .filter(p => typeof p.userId === 'string' && p.userId.length > 0)
      : [];
    const normalisedIds = normalisedParticipants.map(p => p.userId);
    if (normalisedIds.length !== new Set(normalisedIds).size) {
      throw new Error('Validation failed: Duplicate participant IDs are not allowed');
    }
    if (creatorUserId && normalisedIds.every(id => id === creatorUserId)) {
      throw new Error(
        'Validation failed: A conversation must include at least one other participant'
      );
    }
    const conversationData = { ...data, participants: normalisedParticipants };

    // Validate input
    const validationErrors = validateConversation({
      ...conversationData,
      status: data.status || 'active',
    });

    if (validationErrors.length > 0) {
      throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
    }

    // Deduplicate: Check if conversation already exists between same participants
    const participantIds = conversationData.participants.map(p => p.userId).sort();

    // Block check applies to every conversation type, not just 'direct' — a
    // block must stop a conversation being started regardless of type.
    if (creatorUserId) {
      const otherCreationIds = participantIds.filter(id => id !== creatorUserId);
      if (otherCreationIds.length > 0) {
        const blockChecks = await Promise.all(
          otherCreationIds.map(id => this.isBlockedEitherWay(creatorUserId, id))
        );
        if (blockChecks.some(Boolean)) {
          const error = new Error('This conversation could not be started because of a block');
          error.statusCode = 403;
          error.code = 'MESSENGER_BLOCKED';
          throw error;
        }
      }
    }

    // For direct conversations, check if one already exists
    if (conversationData.type === 'direct' && participantIds.length === 2) {
      const existingConversation = await this.conversationsCollection.findOne({
        type: 'direct',
        'participants.userId': { $all: participantIds },
        status: 'active',
        $expr: { $eq: [{ $size: '$participants' }, 2] },
      });

      if (existingConversation) {
        this.logger.info('Found existing direct conversation', {
          conversationId: existingConversation._id,
        });
        return existingConversation;
      }
    }

    // For context-based conversations, check for existing conversation with same context
    if (conversationData.context && conversationData.context.referenceId) {
      const existingContextConversation = await this.conversationsCollection.findOne({
        'participants.userId': { $all: participantIds },
        'context.type': conversationData.context.type,
        'context.referenceId': conversationData.context.referenceId,
        status: 'active',
      });

      if (existingContextConversation) {
        this.logger.info('Found existing context-based conversation', {
          conversationId: existingContextConversation._id,
          contextType: conversationData.context.type,
        });
        return existingContextConversation;
      }
    }

    if (creatorUserId) {
      const threadLimitCheck = await this.checkThreadRateLimit(creatorUserId);
      if (!threadLimitCheck.allowed) {
        const error = new Error(
          threadLimitCheck.message || 'Too many new conversations today. Please try again tomorrow.'
        );
        error.statusCode = 429;
        error.code = 'THREAD_LIMIT_EXCEEDED';
        error.retryAfter = threadLimitCheck.retryAfter || 86400;
        throw error;
      }
    }

    // Create new conversation
    const now = new Date();
    const conversation = {
      type: conversationData.type,
      participants: conversationData.participants.map(p => ({
        userId: p.userId,
        displayName: p.displayName,
        avatar: p.avatar || null,
        role: p.role,
        isPinned: false,
        isMuted: false,
        isArchived: false,
        unreadCount: 0,
        lastReadAt: null,
      })),
      context: conversationData.context || null,
      lastMessage: null,
      metadata: {
        ...(conversationData.metadata || {}),
        ...(creatorUserId ? { createdByUserId: creatorUserId } : {}),
      },
      status: 'active',
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.conversationsCollection.insertOne(conversation);
    conversation._id = result.insertedId;

    this.logger.info('Created new conversation', {
      conversationId: conversation._id,
      type: conversation.type,
      participantCount: conversation.participants.length,
    });

    return conversation;
  }

  /**
   * Get conversations for a user with filtering
   * @param {string} userId - User ID
   * @param {Object} filters - Optional filters (unread, pinned, archived, search)
   * @param {number} limit - Number of conversations to return
   * @param {number} skip - Number of conversations to skip
   * @returns {Array} Array of conversations
   */
  async getConversations(userId, filters = {}, limit = 50, skip = 0) {
    const query = {
      'participants.userId': userId,
    };

    // Apply status filter
    if (filters.status) {
      query.status = filters.status;
    } else {
      query.status = 'active'; // Default to active conversations
    }

    // Build participant-specific filters
    const participantFilters = [];

    if (filters.unread) {
      participantFilters.push({
        participants: {
          $elemMatch: {
            userId: userId,
            unreadCount: { $gt: 0 },
          },
        },
      });
    }

    if (filters.pinned) {
      participantFilters.push({
        participants: {
          $elemMatch: {
            userId: userId,
            isPinned: true,
          },
        },
      });
    }

    if (filters.archived !== undefined) {
      participantFilters.push({
        participants: {
          $elemMatch: {
            userId: userId,
            isArchived: filters.archived,
          },
        },
      });
    } else {
      // Default: exclude archived
      participantFilters.push({
        participants: {
          $elemMatch: {
            userId: userId,
            isArchived: { $ne: true },
          },
        },
      });
    }

    if (participantFilters.length > 0) {
      query.$and = participantFilters;
    }

    // Search filter (in participant names or last message)
    if (filters.search) {
      // Escape regex metacharacters to prevent ReDoS
      const escapedSearch = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      query.$or = [
        { 'participants.displayName': searchRegex },
        { 'lastMessage.content': searchRegex },
        { 'context.referenceTitle': searchRegex },
      ];
    }

    // Exclude conversations that have never had a message sent.
    // messageCount is 0 at creation and is reliably incremented by sendMessage
    // via $inc, so messageCount > 0 is the canonical indicator that at least
    // one real message exists.  Using messageCount (rather than lastMessage)
    // avoids breaking existing unit tests whose mock data sets messageCount
    // but does not always populate lastMessage.
    query.messageCount = { $gt: 0 };

    const conversations = await this.conversationsCollection
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return await Promise.all(
      conversations.map(conversation => this._hydrateConversationParticipants(conversation))
    );
  }

  /**
   * Get a single conversation by ID
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID (for permission check)
   * @returns {Object} Conversation object
   */
  async getConversation(conversationId, userId) {
    const conversation = await this.conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
      'participants.userId': userId,
    });

    if (!conversation) {
      throw new Error('Conversation not found or access denied');
    }

    return await this._hydrateConversationParticipants(conversation);
  }

  /**
   * Get a single conversation by ID without participant check (admin use only).
   * @param {string} conversationId - Conversation ID
   * @returns {Object} Conversation object
   */
  async getConversationAsAdmin(conversationId) {
    const conversation = await this.conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
    });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    return conversation;
  }

  /**
   * Get messages for a conversation without participant check (admin use only).
   * Supports cursor-based pagination identical to getMessages().
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Pagination options
   * @param {string} options.cursor - Cursor for pagination (message ID)
   * @param {number} options.limit - Number of messages to return
   * @returns {Object} Messages and pagination info
   */
  async getMessagesAsAdmin(conversationId, options = {}) {
    // Verify conversation exists (no participant check)
    await this.getConversationAsAdmin(conversationId);

    const limit = Math.min(options.limit || 50, 100);
    const query = {
      conversationId: new ObjectId(conversationId),
      isDeleted: false,
    };

    // Cursor-based pagination
    if (options.cursor) {
      const cursorMessage = await this.messagesCollection.findOne({
        _id: new ObjectId(options.cursor),
        conversationId: new ObjectId(conversationId),
      });

      if (cursorMessage) {
        query.createdAt = { $lt: cursorMessage.createdAt };
      }
    }

    const messages = await this.messagesCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    return {
      messages: messages.reverse(), // Return in chronological order
      hasMore,
      nextCursor: hasMore && messages.length > 0 ? messages[0]._id.toString() : null,
    };
  }

  /**
   * Update conversation settings
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Object} updates - Updates to apply (pin, mute, archive, markRead)
   * @returns {Object} Updated conversation
   */
  async updateConversation(conversationId, userId, updates) {
    const conversation = await this.getConversation(conversationId, userId);

    const updateOps = {};
    const now = new Date();

    // Update participant-specific settings
    const participantIndex = conversation.participants.findIndex(p => p.userId === userId);

    if (participantIndex === -1) {
      throw new Error('User not a participant in this conversation');
    }

    // Coerce to boolean — these fields are matched with $elemMatch elsewhere
    // (getConversations' pinned/archived filters), so writing a non-boolean
    // value here (e.g. a client sending an object) would silently break
    // those queries for this conversation going forward.
    if (updates.isPinned !== undefined) {
      updateOps[`participants.${participantIndex}.isPinned`] = Boolean(updates.isPinned);
    }

    if (updates.isMuted !== undefined) {
      updateOps[`participants.${participantIndex}.isMuted`] = Boolean(updates.isMuted);
    }

    if (updates.isArchived !== undefined) {
      updateOps[`participants.${participantIndex}.isArchived`] = Boolean(updates.isArchived);
    }

    if (updates.markRead) {
      updateOps[`participants.${participantIndex}.unreadCount`] = 0;
      updateOps[`participants.${participantIndex}.lastReadAt`] = now;
    }

    if (updates.markUnread) {
      // Idempotent: mark unread makes the conversation unread without inflating counts.
      const currentUnread = conversation.participants[participantIndex]?.unreadCount || 0;
      updateOps[`participants.${participantIndex}.unreadCount`] =
        currentUnread > 0 ? currentUnread : 1;
    }

    updateOps.updatedAt = now;

    await this.conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      { $set: updateOps }
    );

    return await this.getConversation(conversationId, userId);
  }

  /**
   * Soft delete a conversation (mark as archived for the user)
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @returns {boolean} Success
   */
  async deleteConversation(conversationId, userId) {
    await this.updateConversation(conversationId, userId, { isArchived: true });
    return true;
  }

  /**
   * Send a message in a conversation
   * @param {string} conversationId - Conversation ID
   * @param {Object} messageData - Message data
   * @param {string} messageData.senderId - Sender user ID
   * @param {string} messageData.senderName - Sender display name
   * @param {string} messageData.content - Message content
   * @param {string} messageData.type - Message type (text, image, file, system)
   * @param {Array} messageData.attachments - Optional attachments
   * @param {Object} messageData.replyTo - Optional reply-to message
   * @returns {Object} Created message
   */
  async sendMessage(conversationId, messageData) {
    // Get conversation and verify sender is a participant who hasn't
    // hard-deleted it for themselves — otherwise this would succeed here but
    // the route's post-op getConversation() (for the WS emit) throws
    // afterward, leaving the message persisted but the caller sees an error.
    const conversation = await this.conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
      participants: { $elemMatch: { userId: messageData.senderId, isDeleted: { $ne: true } } },
    });

    if (!conversation) {
      throw new Error('Conversation not found or sender is not a participant');
    }

    // Block check applies to every conversation type, not just 'direct' —
    // a block must stop messages regardless of how the conversation was
    // started (marketplace/enquiry/supplier_network/support all allow the
    // same two users to end up participants together).
    const otherParticipants = conversation.participants.filter(
      p => p.userId !== messageData.senderId
    );
    if (otherParticipants.length > 0) {
      const blockChecks = await Promise.all(
        otherParticipants.map(p => this.isBlockedEitherWay(messageData.senderId, p.userId))
      );
      if (blockChecks.some(Boolean)) {
        const error = new Error('This message could not be delivered because of a block');
        error.statusCode = 403;
        error.code = 'MESSENGER_BLOCKED';
        throw error;
      }
    }

    // Idempotency: if the client supplied a clientMessageId, short-circuit on
    // a retry so double-submits (network retries, lost ACKs) do not produce
    // duplicate rows.  Returning the original message makes the handler
    // idempotent from the caller's perspective.
    const clientMessageId =
      typeof messageData.clientMessageId === 'string' && messageData.clientMessageId.trim()
        ? messageData.clientMessageId.trim().substring(0, 64)
        : null;
    if (clientMessageId) {
      const existing = await this.messagesCollection.findOne({
        conversationId: new ObjectId(conversationId),
        senderId: messageData.senderId,
        clientMessageId,
      });
      if (existing) {
        this.logger.info('Idempotent resend detected — returning existing message', {
          messageId: existing._id,
          conversationId,
          clientMessageId,
        });
        return existing;
      }
    }

    // Validate message
    const validationErrors = validateMessage({
      ...messageData,
      conversationId,
      type: messageData.type || 'text',
    });

    if (validationErrors.length > 0) {
      throw new Error(`Message validation failed: ${validationErrors.join(', ')}`);
    }

    // Sanitize content. contentSanitizer.sanitizeContent() returns '' for null/undefined,
    // but we add the || '' guard explicitly as a defensive measure for attachment-only messages.
    const sanitizedContent = contentSanitizer.sanitizeContent(messageData.content || '');

    const usersCollection = this.db.collection('users');
    const sender = await usersCollection.findOne({ id: messageData.senderId });
    const senderLimits = getMessagingLimitsForTier(sender?.subscriptionTier || 'free');
    if (sanitizedContent.length > senderLimits.maxMessageLength) {
      const error = new Error(
        `Message is too long. Maximum length is ${senderLimits.maxMessageLength} characters.`
      );
      error.statusCode = 413;
      error.code = 'MESSAGE_TOO_LONG';
      error.maxMessageLength = senderLimits.maxMessageLength;
      throw error;
    }

    // Check for spam only when there is text content (attachment-only messages skip text checks)
    if (sanitizedContent.trim().length > 0) {
      const spamCheck = await spamDetection.checkSpam(messageData.senderId, sanitizedContent);
      if (spamCheck.isSpam) {
        throw new Error(`Message flagged as spam: ${spamCheck.reason}`);
      }
    }

    // Check rate limits based on user's subscription tier
    const rateLimitCheck = await this.checkRateLimit(messageData.senderId);
    if (!rateLimitCheck.allowed) {
      throw new Error(`Rate limit exceeded. ${rateLimitCheck.message}`);
    }

    // Create message
    const now = new Date();
    const replyToRawId = messageData.replyToMessageId || messageData.replyTo?._id || null;
    let replyToMessageId = null;
    let replyTo = null;
    if (replyToRawId && ObjectId.isValid(replyToRawId)) {
      replyToMessageId = new ObjectId(replyToRawId);
      const parent = await this.messagesCollection.findOne({
        _id: replyToMessageId,
        conversationId: new ObjectId(conversationId),
      });
      if (parent) {
        replyTo = {
          id: parent._id.toString(),
          snippet: (parent.content || '').substring(0, 120),
          senderId: parent.senderId,
          senderName: parent.senderName,
        };
      }
    }
    const notificationRecipients = conversation.participants
      .filter(p => p.userId !== messageData.senderId && !p.isMuted && !p.isDeleted)
      .map(p => p.userId);
    const message = {
      conversationId: new ObjectId(conversationId),
      senderId: messageData.senderId,
      senderName: messageData.senderName,
      senderAvatar: messageData.senderAvatar || null,
      content: sanitizedContent,
      type: messageData.type || 'text',
      attachments: messageData.attachments || [],
      replyToMessageId,
      replyTo,
      reactions: [],
      readBy: [
        {
          userId: messageData.senderId,
          readAt: now,
        },
      ],
      // Delivery receipts.  Sender is implicitly delivered at send time.
      deliveredTo: [
        {
          userId: messageData.senderId,
          deliveredAt: now,
        },
      ],
      // Monotonic per-conversation sequence; drives client reconciliation
      // (sinceSeq catch-up, gap detection, ordered buffer flush).
      // Assigned immediately before insert in the write path.
      seq: null,
      // Optional client-supplied dedupe key.  Null when absent so the unique
      // partial index only enforces uniqueness on present values.
      clientMessageId: clientMessageId,
      notificationFanout: createFanoutState(notificationRecipients, now),
      editedAt: null,
      isDeleted: false,
      createdAt: now,
    };

    const writeMessageAndConversation = async session => {
      message.seq = await this._nextSeq(conversationId, { session });
      let result;
      try {
        result = await this.messagesCollection.insertOne(message, session ? { session } : {});
      } catch (err) {
        if (clientMessageId && err && (err.code === 11000 || /duplicate key/i.test(err.message))) {
          const existing = await this.messagesCollection.findOne({
            conversationId: new ObjectId(conversationId),
            senderId: messageData.senderId,
            clientMessageId,
          });
          if (existing) {
            return existing;
          }
        }
        throw err;
      }

      if (messageData.__simulateFailureAfterInsert) {
        throw new Error('Simulated failure after insert');
      }

      message._id = result.insertedId;
      const updateOps = {
        lastMessage: {
          content: sanitizedContent.substring(0, 100),
          senderId: messageData.senderId,
          senderName: messageData.senderName,
          sentAt: now,
          type: message.type,
        },
        updatedAt: now,
      };

      const bulkOps = conversation.participants
        .map((participant, index) => {
          if (participant.userId !== messageData.senderId) {
            return {
              updateOne: {
                filter: { _id: new ObjectId(conversationId) },
                update: { $inc: { [`participants.${index}.unreadCount`]: 1 } },
              },
            };
          }
          return null;
        })
        .filter(Boolean);

      await this.conversationsCollection.updateOne(
        { _id: new ObjectId(conversationId) },
        {
          $set: updateOps,
          $inc: { messageCount: 1 },
        },
        session ? { session } : {}
      );

      if (bulkOps.length > 0) {
        await this.conversationsCollection.bulkWrite(bulkOps, session ? { session } : {});
      }
      return message;
    };

    const inserted = await this._runRetryableTransaction(writeMessageAndConversation);
    if (inserted && inserted !== message) {
      return inserted;
    }

    this.logger.info('Message sent', {
      messageId: message._id,
      conversationId,
      senderId: messageData.senderId,
    });

    enqueueMessageNotificationFanout({
      messagesCollection: this.messagesCollection,
      logger: this.logger,
      message,
      conversation,
    });

    // A new incoming message should surface an archived conversation again.
    const autoUnarchivedUserIds = await autoUnarchiveRecipients({
      conversationsCollection: this.conversationsCollection,
      logger: this.logger,
      conversation,
      conversationId,
      senderId: messageData.senderId,
    });

    // Expose the list of auto-unarchived user IDs to the route layer so it
    // can emit conversation-updated WebSocket events to those users.
    message._autoUnarchivedUserIds = autoUnarchivedUserIds;

    return message;
  }

  /**
   * Get messages for a conversation with cursor pagination
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID (for permission check)
   * @param {Object} options - Pagination options
   * @param {string} options.cursor - Cursor for pagination (message ID)
   * @param {number} options.limit - Number of messages to return
   * @returns {Object} Messages and pagination info
   */
  async getMessages(conversationId, userId, options = {}) {
    // Verify user is a participant
    const conversation = await this.getConversation(conversationId, userId);

    const limit = Math.min(options.limit || 50, 100);
    const participantByUserId = new Map(
      (Array.isArray(conversation.participants) ? conversation.participants : []).map(p => [
        String(p.userId),
        p,
      ])
    );
    const query = {
      conversationId: new ObjectId(conversationId),
      isDeleted: false,
    };

    // sinceSeq: forward-catch-up for realtime reconciliation.  When provided
    // we return messages in chronological (ascending-seq) order from
    // (sinceSeq, now], ignoring the cursor-based back-pagination path.
    if (options.sinceSeq !== undefined && options.sinceSeq !== null) {
      const sinceSeq = Number(options.sinceSeq);
      if (Number.isFinite(sinceSeq) && sinceSeq >= 0) {
        query.seq = { $gt: sinceSeq };
        const forward = await this.messagesCollection
          .find(query)
          .sort({ seq: 1 })
          .limit(limit + 1)
          .toArray();
        const hasMore = forward.length > limit;
        if (hasMore) {
          forward.pop();
        }
        const participants = Array.isArray(conversation.participants)
          ? conversation.participants
          : [];
        return {
          messages: forward.map(m => ({
            ...m,
            senderName:
              participantByUserId.get(String(m.senderId))?.displayName || m.senderName || 'Unknown',
            senderAvatar:
              participantByUserId.get(String(m.senderId))?.avatar || m.senderAvatar || null,
            viewerStatus: MessengerV4Service.computeViewerStatus(m, userId, participants),
          })),
          hasMore,
          nextSinceSeq: forward.length > 0 ? forward[forward.length - 1].seq : sinceSeq,
        };
      }
    }

    // Cursor-based pagination (legacy/default: paginate backwards through history)
    if (options.cursor) {
      const cursorMessage = await this.messagesCollection.findOne({
        _id: new ObjectId(options.cursor),
        conversationId: new ObjectId(conversationId),
      });

      if (cursorMessage) {
        query.createdAt = { $lt: cursorMessage.createdAt };
      }
    }

    const messages = await this.messagesCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = messages.length > limit;
    if (hasMore) {
      messages.pop();
    }

    const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
    const ordered = messages.reverse(); // chronological
    return {
      messages: ordered.map(m => ({
        ...m,
        senderName:
          participantByUserId.get(String(m.senderId))?.displayName || m.senderName || 'Unknown',
        senderAvatar: participantByUserId.get(String(m.senderId))?.avatar || m.senderAvatar || null,
        viewerStatus: MessengerV4Service.computeViewerStatus(m, userId, participants),
      })),
      hasMore,
      nextCursor: hasMore && ordered.length > 0 ? ordered[0]._id.toString() : null,
    };
  }

  /**
   * Edit a message (within 15-minute window)
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * @param {string} newContent - New message content
   * @returns {Object} Updated message
   */
  async editMessage(messageId, userId, newContent) {
    if (!newContent || typeof newContent !== 'string' || !newContent.trim()) {
      throw new Error('Message content cannot be empty');
    }

    const message = await this.messagesCollection.findOne({
      _id: new ObjectId(messageId),
      senderId: userId,
      isDeleted: false,
    });

    if (!message) {
      throw new Error('Message not found or access denied');
    }

    // Reject if the author has hard-deleted the conversation for themselves
    // — otherwise the edit would succeed here but the route's post-op
    // getConversation() (for the WS emit) throws afterward.
    const editConversation = await this.conversationsCollection.findOne({
      _id: message.conversationId,
      participants: { $elemMatch: { userId, isDeleted: { $ne: true } } },
    });
    if (!editConversation) {
      throw new Error('Conversation not found or access denied');
    }

    // Check 15-minute edit window
    const fifteenMinutes = 15 * 60 * 1000;
    if (Date.now() - message.createdAt.getTime() > fifteenMinutes) {
      throw new Error('Edit window expired (15 minutes)');
    }

    const sanitizedContent = contentSanitizer.sanitizeContent(newContent);

    await this.messagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      {
        $set: {
          content: sanitizedContent,
          editedAt: new Date(),
        },
      }
    );

    // Update conversation's lastMessage if this was the last message
    const conversation = await this.conversationsCollection.findOne({
      _id: message.conversationId,
      'lastMessage.sentAt': message.createdAt,
      'lastMessage.senderId': message.senderId,
    });

    if (conversation) {
      await this.conversationsCollection.updateOne(
        { _id: message.conversationId },
        {
          $set: {
            'lastMessage.content': sanitizedContent.substring(0, 100),
          },
        }
      );
    }

    return await this.messagesCollection.findOne({ _id: new ObjectId(messageId) });
  }

  /**
   * Delete a message (soft delete)
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * @returns {boolean} Success
   */
  async deleteMessage(messageId, userId) {
    const message = await this.messagesCollection.findOne({
      _id: new ObjectId(messageId),
      senderId: userId,
      isDeleted: false,
    });

    if (!message) {
      throw new Error('Message not found or access denied');
    }

    // Reject if the author has hard-deleted the conversation for themselves
    // — otherwise the delete would succeed here but the route's post-op
    // getConversation() (for the WS emit) throws afterward.
    const deleteConversation = await this.conversationsCollection.findOne({
      _id: message.conversationId,
      participants: { $elemMatch: { userId, isDeleted: { $ne: true } } },
    });
    if (!deleteConversation) {
      throw new Error('Conversation not found or access denied');
    }

    await this.messagesCollection.updateOne(
      { _id: new ObjectId(messageId) },
      {
        $set: {
          content: 'This message was deleted',
          isDeleted: true,
          attachments: [],
        },
      }
    );

    // Recalculate conversation's lastMessage if the deleted message was the preview
    const conversation = await this.conversationsCollection.findOne({
      _id: message.conversationId,
      'lastMessage.sentAt': message.createdAt,
      'lastMessage.senderId': message.senderId,
    });

    if (conversation) {
      const prevMessages = await this.messagesCollection
        .find({
          conversationId: message.conversationId,
          isDeleted: false,
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      const prevMessage = prevMessages[0] || null;

      await this.conversationsCollection.updateOne(
        { _id: message.conversationId },
        {
          $set: {
            lastMessage: prevMessage
              ? {
                  content: (prevMessage.content || '').substring(0, 100),
                  senderId: prevMessage.senderId,
                  senderName: prevMessage.senderName,
                  sentAt: prevMessage.createdAt,
                  type: prevMessage.type,
                }
              : null,
          },
        }
      );
    }

    return true;
  }

  /**
   * Toggle emoji reaction on a message
   * @param {string} messageId - Message ID
   * @param {string} userId - User ID
   * @param {string} userName - User display name
   * @param {string} emoji - Emoji character
   * @returns {Object} Updated message
   */
  async toggleReaction(messageId, userId, userName, emoji) {
    const message = await this.messagesCollection.findOne({
      _id: new ObjectId(messageId),
      isDeleted: false,
    });

    if (!message) {
      throw new Error('Message not found');
    }

    // Verify the user is a participant in the conversation and hasn't
    // hard-deleted it for themselves — otherwise this succeeds here but the
    // route's post-op getConversation() (for the WS emit) throws afterward.
    const conversation = await this.conversationsCollection.findOne({
      _id: message.conversationId,
      participants: { $elemMatch: { userId, isDeleted: { $ne: true } } },
    });

    if (!conversation) {
      throw new Error('Message not found or access denied');
    }

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(r => r.userId === userId && r.emoji === emoji);

    if (existingReaction) {
      // Remove reaction
      await this.messagesCollection.updateOne(
        { _id: new ObjectId(messageId) },
        {
          $pull: {
            reactions: { userId, emoji },
          },
        }
      );
    } else {
      // Add reaction
      await this.messagesCollection.updateOne(
        { _id: new ObjectId(messageId) },
        {
          $push: {
            reactions: { emoji, userId, userName },
          },
        }
      );
    }

    return await this.messagesCollection.findOne({ _id: new ObjectId(messageId) });
  }

  /**
   * Mark conversation as read
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @returns {boolean} Success
   */
  /**
   * Mark conversation as read.
   *
   * When `options.upToSeq` is supplied, only messages up to and including
   * that sequence number are marked — enabling per-message-cursor read
   * receipts for true per-message status.  Omitting it retains the legacy
   * "mark everything read as of now" semantics.
   *
   * @param {string} conversationId
   * @param {string} userId
   * @param {Object} [options]
   * @param {number} [options.upToSeq] - Upper bound on `seq` to mark.
   * @returns {Promise<{modifiedCount:number, readAt:Date, upToSeq:number|null}>}
   */
  async markAsRead(conversationId, userId, options = {}) {
    const conversation = await this.getConversation(conversationId, userId);
    const participantIndex = conversation.participants.findIndex(p => p.userId === userId);

    if (participantIndex === -1) {
      throw new Error('User not a participant');
    }

    const now = new Date();
    const upToSeq =
      options && options.upToSeq !== undefined && options.upToSeq !== null
        ? Number(options.upToSeq)
        : null;

    // Update per-message read receipts.  Scope by seq when supplied so we
    // don't re-scan the entire conversation on every scroll-to-read event.
    const msgQuery = {
      conversationId: new ObjectId(conversationId),
      'readBy.userId': { $ne: userId },
    };
    if (upToSeq !== null && Number.isFinite(upToSeq)) {
      msgQuery.seq = { $lte: upToSeq };
    }
    const modRes = await this.messagesCollection.updateMany(msgQuery, {
      $push: {
        readBy: { userId, readAt: now },
      },
    });

    // Recompute unread cache.  When no upToSeq was supplied (bulk read)
    // the count drops to zero; when scoped, count remaining messages the
    // user hasn't read yet.
    let unreadCount = 0;
    if (upToSeq !== null && Number.isFinite(upToSeq)) {
      unreadCount = await this.messagesCollection.countDocuments({
        conversationId: new ObjectId(conversationId),
        senderId: { $ne: userId },
        'readBy.userId': { $ne: userId },
        isDeleted: false,
      });
    }

    await this.conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      {
        $set: {
          [`participants.${participantIndex}.unreadCount`]: unreadCount,
          [`participants.${participantIndex}.lastReadAt`]: now,
        },
      }
    );

    return {
      modifiedCount: modRes?.modifiedCount || 0,
      readAt: now,
      upToSeq: upToSeq !== null && Number.isFinite(upToSeq) ? upToSeq : null,
    };
  }

  /**
   * Record a delivery receipt for one or more messages.
   *
   * Messages authored by the same user are skipped (self-delivery is set at
   * send time).  Messages where the user has already been recorded as
   * delivered are also skipped so the receipt is idempotent.
   *
   * @param {string} conversationId
   * @param {string} userId
   * @param {Array<string>|string} messageIds - Message id(s) to mark delivered.
   * @returns {Promise<{modifiedCount:number, deliveredAt:Date, messageIds:string[]}>}
   */
  async markAsDelivered(conversationId, userId, messageIds) {
    // Verify participant access up-front so a non-participant cannot probe
    // arbitrary conversation/message ids via delivery receipts.
    await this.getConversation(conversationId, userId);

    const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
    const objectIds = [];
    for (const id of ids) {
      if (typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id)) {
        objectIds.push(new ObjectId(id));
      }
    }
    if (objectIds.length === 0) {
      return { modifiedCount: 0, deliveredAt: new Date(), messageIds: [] };
    }

    const now = new Date();
    const res = await this.messagesCollection.updateMany(
      {
        _id: { $in: objectIds },
        conversationId: new ObjectId(conversationId),
        senderId: { $ne: userId },
        'deliveredTo.userId': { $ne: userId },
      },
      {
        $push: {
          deliveredTo: { userId, deliveredAt: now },
        },
      }
    );

    return {
      modifiedCount: res?.modifiedCount || 0,
      deliveredAt: now,
      messageIds: objectIds.map(id => id.toString()),
    };
  }

  /**
   * Get unread count for a user
   * @param {string} userId - User ID
   * @returns {number} Total unread count
   */
  async getUnreadCount(userId) {
    const conversations = await this.conversationsCollection
      .find({
        'participants.userId': userId,
        status: 'active',
      })
      .toArray();

    let totalUnread = 0;
    conversations.forEach(conv => {
      const participant = conv.participants.find(p => p.userId === userId);
      if (participant && !participant.isArchived && !participant.isMuted) {
        totalUnread += participant.unreadCount || 0;
      }
    });

    return totalUnread;
  }

  /**
   * Block a user. Blocking is one-directional in storage but checked in both
   * directions by isBlocked()/isBlockedEitherWay(), so a block always stops
   * messages flowing either way between the two users.
   */
  async blockUser(userId, blockedUserId, reason) {
    const errors = validateBlockedUser({ userId, blockedUserId });
    if (errors) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }

    const existing = await this.blockedUsersCollection.findOne({ userId, blockedUserId });
    if (existing) {
      return existing;
    }

    const block = createBlockedUser({ userId, blockedUserId, reason });
    await this.blockedUsersCollection.insertOne(block);
    this.logger.info('User blocked', { userId, blockedUserId });
    return block;
  }

  async unblockUser(userId, blockedUserId) {
    const result = await this.blockedUsersCollection.deleteOne({ userId, blockedUserId });
    return result.deletedCount > 0;
  }

  async getBlockedUsers(userId) {
    const blocks = await this.blockedUsersCollection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    if (blocks.length === 0) {
      return [];
    }
    const userMap = await this._getUserMapByIds(blocks.map(b => b.blockedUserId));
    return blocks.map(block => ({
      userId: block.blockedUserId,
      displayName: MessengerV4Service._displayNameFromUser(userMap.get(block.blockedUserId) || {}),
      reason: block.reason || '',
      createdAt: block.createdAt,
    }));
  }

  /**
   * True if either user has blocked the other.
   */
  async isBlockedEitherWay(userIdA, userIdB) {
    const block = await this.blockedUsersCollection.findOne({
      $or: [
        { userId: userIdA, blockedUserId: userIdB },
        { userId: userIdB, blockedUserId: userIdA },
      ],
    });
    return Boolean(block);
  }

  /**
   * Search for contacts (users the current user can message)
   * @param {string} currentUserId - Current user ID
   * @param {string} query - Search query
   * @param {Object} filters - Optional filters (role, etc.)
   * @param {number} limit - Number of results
   * @returns {Array} Array of users
   */
  async searchContacts(currentUserId, query, filters = {}, limit = 20) {
    const usersCollection = this.db.collection('users');
    const searchQuery = {
      // Users are keyed by their string 'id' field (JWT auth), not MongoDB ObjectId '_id'
      id: { $ne: currentUserId },
    };

    if (query) {
      // Escape regex metacharacters to prevent ReDoS
      const escapedQuery = String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedQuery, 'i');
      searchQuery.$or = [
        { displayName: searchRegex },
        { name: searchRegex },
        { businessName: searchRegex },
        { profileName: searchRegex },
        { tradingName: searchRegex },
        { companyName: searchRegex },
        { email: searchRegex },
      ];
    }

    // filters.role may be a single role string or an array of allowed roles
    // (the route defaults to the full allowed-roles list when the caller
    // didn't request a specific one, rather than leaving this unfiltered).
    if (filters.role) {
      searchQuery.role = Array.isArray(filters.role) ? { $in: filters.role } : filters.role;
    }

    if (filters.mode === 'supplier_search') {
      searchQuery.role = 'supplier';
    }

    const users = await usersCollection
      .find(searchQuery)
      .limit(limit)
      .project({
        id: 1,
        displayName: 1,
        name: 1,
        email: 1,
        role: 1,
        avatar: 1,
        avatarUrl: 1,
        profilePhoto: 1,
        logoUrl: 1,
        businessName: 1,
        profileName: 1,
        tradingName: 1,
        companyName: 1,
        category: 1,
        serviceCategory: 1,
        location: 1,
        city: 1,
      })
      .toArray();

    const looksLikeEmail = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    const normalise = value => (typeof value === 'string' ? value.trim() : '');
    const genericNames = new Set(['info', 'admin', 'hello', 'contact', 'sales', 'bookings']);
    const emailLocalPart = email =>
      looksLikeEmail(email) ? email.split('@')[0].toLowerCase() : '';
    const isWeakName = (value, email) => {
      const v = normalise(value).toLowerCase();
      return (
        !v ||
        looksLikeEmail(v) ||
        genericNames.has(v) ||
        (emailLocalPart(email) && v === emailLocalPart(email))
      );
    };
    const firstGood = (...values) => values.map(normalise).find(v => v && !looksLikeEmail(v));

    return users.map(user => {
      const businessLabel = firstGood(
        user.businessName,
        user.profileName,
        user.tradingName,
        user.companyName
      );
      const displayLabel = firstGood(user.displayName, user.name);
      const primaryLabel =
        user.role === 'supplier' && businessLabel && isWeakName(displayLabel, user.email)
          ? businessLabel
          : displayLabel || businessLabel || 'Supplier';
      const descriptor = firstGood(user.serviceCategory, user.category, user.location, user.city);
      const secondaryLabel =
        user.role === 'supplier' ? descriptor || 'Supplier' : 'Existing conversation';

      return {
        // Use the string 'id' field (consistent with JWT auth and all participant lookups)
        userId: user.id,
        id: user.id,
        displayName: primaryLabel,
        primaryLabel,
        secondaryLabel,
        role: user.role || 'customer',
        avatar: user.avatarUrl || user.avatar || user.profilePhoto || user.logoUrl || null,
      };
    });
  }

  /**
   * Full-text search across all user's messages
   * @param {string} userId - User ID
   * @param {string} query - Search query
   * @param {number} limit - Number of results
   * @param {string|null} [conversationId] - Optional: restrict search to a
   *   single conversation.  The conversation is still filtered through the
   *   user's participant list so non-participants cannot probe arbitrary ids.
   * @returns {Array} Array of messages with conversation info
   */
  async searchMessages(userId, query, limit = 50, conversationId = null) {
    // Get user's conversation IDs — exclude hard-deleted conversations from search
    const userConversationFilter = {
      'participants.userId': userId,
      status: { $ne: 'deleted' },
    };

    // Scope to a single conversation when requested.  Adding the id to the
    // participant filter (rather than trusting the caller's value directly)
    // means a non-participant who guesses an id gets zero results.
    if (conversationId) {
      try {
        userConversationFilter._id = new ObjectId(conversationId);
      } catch {
        // Invalid ObjectId — return empty results rather than throwing.
        return [];
      }
    }

    const conversations = await this.conversationsCollection
      .find(userConversationFilter)
      .project({ _id: 1 })
      .toArray();

    const conversationIds = conversations.map(c => c._id);

    if (conversationIds.length === 0) {
      return [];
    }

    // Full-text search
    const messages = await this.messagesCollection
      .find({
        conversationId: { $in: conversationIds },
        $text: { $search: query },
        isDeleted: false,
      })
      .limit(limit)
      .toArray();

    // Enrich with conversation data — single $in query instead of N individual findOnes
    const uniqueConvIds = [...new Set(messages.map(m => m.conversationId.toString()))];
    const convDocs = await this.conversationsCollection
      .find({ _id: { $in: uniqueConvIds.map(id => new ObjectId(id)) } })
      .toArray();
    const convMap = new Map(convDocs.map(c => [c._id.toString(), c]));

    const enrichedMessages = messages.map(msg => {
      const conv = convMap.get(msg.conversationId.toString());
      return {
        ...msg,
        conversation: conv
          ? {
              _id: conv._id,
              type: conv.type,
              // Only expose non-sensitive participant fields
              participants: (conv.participants || []).map(p => ({
                userId: p.userId,
                displayName: p.displayName,
                avatar: p.avatar,
                role: p.role,
              })),
            }
          : null,
      };
    });

    return enrichedMessages;
  }

  /**
   * Check rate limits for messaging
   * @param {string} userId - User ID
   * @returns {Object} Rate limit check result
   */
  async checkRateLimit(userId) {
    // Get user's subscription tier
    const usersCollection = this.db.collection('users');
    const user = await usersCollection.findOne({ id: userId });

    const tier = user?.subscriptionTier || 'free';
    const limits = getMessagingLimitsForTier(tier);

    const now = Date.now();

    // Check messages sent in the last hour
    if (limits.messagesPerHour > 0) {
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const recentHourCount = await this.messagesCollection.countDocuments({
        senderId: userId,
        createdAt: { $gte: oneHourAgo },
      });
      if (recentHourCount >= limits.messagesPerHour) {
        return {
          allowed: false,
          retryAfter: 3600,
          message: `You've reached the limit of ${limits.messagesPerHour} messages per hour. Please wait a moment before sending more.`,
        };
      }
    }

    // Check messages sent today (UTC day boundary)
    if (limits.messagesPerDay > 0) {
      const startOfDay = new Date(now);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const todayCount = await this.messagesCollection.countDocuments({
        senderId: userId,
        createdAt: { $gte: startOfDay },
      });
      if (todayCount >= limits.messagesPerDay) {
        return {
          allowed: false,
          retryAfter: 86400,
          message: `You've reached today's messaging limit of ${limits.messagesPerDay} messages. Limits reset at midnight UTC.`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check whether the user can start a new conversation today.
   * Returns { allowed: true } or { allowed: false, message }.
   */
  async checkThreadRateLimit(userId) {
    const usersCollection = this.db.collection('users');
    const user = await usersCollection.findOne({ id: userId });
    const tier = user?.subscriptionTier || 'free';
    const limits = getMessagingLimitsForTier(tier);

    if (!limits.threadsPerDay || limits.threadsPerDay < 0) {
      return { allowed: true };
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todayThreads = await this.conversationsCollection.countDocuments({
      'metadata.createdByUserId': userId,
      createdAt: { $gte: startOfDay },
    });

    if (todayThreads >= limits.threadsPerDay) {
      return {
        allowed: false,
        retryAfter: 86400,
        message: `You've reached today's limit of ${limits.threadsPerDay} new conversations. Limits reset at midnight UTC.`,
      };
    }
    return { allowed: true };
  }
}

module.exports = MessengerV4Service;
