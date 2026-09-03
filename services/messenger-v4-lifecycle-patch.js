/**
 * Messenger v4 lifecycle patch
 *
 * Keeps archive and delete as separate user actions without rewriting the
 * whole Messenger v4 route module. Delete is a per-user hard hide from the
 * user's inbox/archive/search, while archive remains reversible.
 */

'use strict';

const { ObjectId } = require('mongodb');
const MessengerV4Service = require('./messenger-v4.service');
const { validateConversation } = require('../models/ConversationV4');

function participantVisibleMatch(userId) {
  return {
    userId,
    isArchived: { $ne: true },
    isDeleted: { $ne: true },
  };
}

function withVisibleCreatorFilter(query, creatorUserId, participantIds = []) {
  const nextQuery = { ...query };
  const andClauses = Array.isArray(nextQuery.$and) ? [...nextQuery.$and] : [];
  const norClauses = Array.isArray(nextQuery.$nor) ? [...nextQuery.$nor] : [];

  if (creatorUserId) {
    andClauses.push({
      participants: { $elemMatch: participantVisibleMatch(creatorUserId) },
    });
  }

  const ids = [...new Set((participantIds || []).filter(Boolean).map(String))];
  if (ids.length > 0) {
    norClauses.push({
      participants: {
        $elemMatch: {
          userId: { $in: ids },
          isDeleted: true,
        },
      },
    });
  }

  if (andClauses.length > 0) {
    nextQuery.$and = andClauses;
  }
  if (norClauses.length > 0) {
    nextQuery.$nor = norClauses;
  }

  return nextQuery;
}

function getParticipant(conversation, userId) {
  return (conversation?.participants || []).find(participant => participant.userId === userId);
}

function isDeletedForUser(conversation, userId) {
  return getParticipant(conversation, userId)?.isDeleted === true;
}

if (!MessengerV4Service.__deleteArchiveLifecyclePatched) {
  MessengerV4Service.prototype.createConversation = async function createConversation(data) {
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
    const validationErrors = validateConversation({
      ...conversationData,
      status: data.status || 'active',
    });
    if (validationErrors.length > 0) {
      throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
    }

    // Block check applies to every conversation type — this method fully
    // replaces the base class's createConversation (which only checked
    // blocks for type === 'direct'), so without this every non-direct type
    // (marketplace/enquiry/supplier_network/support) could be created
    // between two users regardless of a block in either direction.
    if (creatorUserId) {
      const otherCreationIds = normalisedIds.filter(id => id !== creatorUserId);
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

    const participantIds = conversationData.participants.map(p => p.userId).sort();

    // Context conversations represent a specific supplier/listing/package. Do not let
    // generic direct dedupe pull users back into a different old direct thread.
    if (conversationData.context && conversationData.context.referenceId) {
      const existingContextConversation = await this.conversationsCollection.findOne(
        withVisibleCreatorFilter(
          {
            'participants.userId': { $all: participantIds },
            'context.type': conversationData.context.type,
            'context.referenceId': conversationData.context.referenceId,
            status: 'active',
          },
          creatorUserId,
          participantIds
        )
      );

      if (existingContextConversation) {
        this.logger.info('Found existing visible context-based conversation', {
          conversationId: existingContextConversation._id,
          contextType: conversationData.context.type,
        });
        return existingContextConversation;
      }
    } else if (conversationData.type === 'direct' && participantIds.length === 2) {
      const existingConversation = await this.conversationsCollection.findOne(
        withVisibleCreatorFilter(
          {
            type: 'direct',
            'participants.userId': { $all: participantIds },
            status: 'active',
            $expr: { $eq: [{ $size: '$participants' }, 2] },
          },
          creatorUserId,
          participantIds
        )
      );

      if (existingConversation) {
        this.logger.info('Found existing visible direct conversation', {
          conversationId: existingConversation._id,
        });
        return existingConversation;
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
        isDeleted: false,
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

    this.logger.info('Created new visible conversation', {
      conversationId: conversation._id,
      type: conversation.type,
      participantCount: conversation.participants.length,
    });

    return conversation;
  };

  MessengerV4Service.prototype.getConversations = async function getConversations(
    userId,
    filters = {},
    limit = 50,
    skip = 0
  ) {
    const query = {
      'participants.userId': userId,
    };

    query.status = filters.status || 'active';

    const participantFilters = [];
    const baseParticipantFilter = {
      userId,
      isDeleted: { $ne: true },
    };

    if (filters.unread) {
      participantFilters.push({
        participants: {
          $elemMatch: {
            ...baseParticipantFilter,
            unreadCount: { $gt: 0 },
          },
        },
      });
    }

    if (filters.pinned) {
      participantFilters.push({
        participants: {
          $elemMatch: {
            ...baseParticipantFilter,
            isPinned: true,
          },
        },
      });
    }

    if (filters.archived !== undefined) {
      participantFilters.push({
        participants: {
          $elemMatch: {
            ...baseParticipantFilter,
            isArchived: filters.archived,
          },
        },
      });
    } else {
      participantFilters.push({
        participants: {
          $elemMatch: {
            ...baseParticipantFilter,
            isArchived: { $ne: true },
          },
        },
      });
    }

    if (participantFilters.length > 0) {
      query.$and = participantFilters;
    }

    if (filters.search) {
      const escapedSearch = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      query.$or = [
        { 'participants.displayName': searchRegex },
        { 'lastMessage.content': searchRegex },
        { 'context.referenceTitle': searchRegex },
      ];
    }

    const conversations = await this.conversationsCollection
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return await Promise.all(
      conversations.map(conversation => this._hydrateConversationParticipants(conversation))
    );
  };

  MessengerV4Service.prototype.getConversation = async function getConversation(
    conversationId,
    userId
  ) {
    const conversation = await this.conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
      'participants.userId': userId,
    });

    if (!conversation || isDeletedForUser(conversation, userId)) {
      throw new Error('Conversation not found or access denied');
    }

    return await this._hydrateConversationParticipants(conversation);
  };

  MessengerV4Service.prototype.deleteConversation = async function deleteConversation(
    conversationId,
    userId
  ) {
    const conversation = await this.conversationsCollection.findOne({
      _id: new ObjectId(conversationId),
      'participants.userId': userId,
    });

    if (!conversation || isDeletedForUser(conversation, userId)) {
      throw new Error('Conversation not found or access denied');
    }

    const participantIndex = conversation.participants.findIndex(p => p.userId === userId);
    if (participantIndex === -1) {
      throw new Error('User not a participant in this conversation');
    }

    const now = new Date();
    await this.conversationsCollection.updateOne(
      { _id: new ObjectId(conversationId) },
      {
        $set: {
          [`participants.${participantIndex}.isDeleted`]: true,
          [`participants.${participantIndex}.deletedAt`]: now,
          [`participants.${participantIndex}.isArchived`]: false,
          [`participants.${participantIndex}.isPinned`]: false,
          [`participants.${participantIndex}.unreadCount`]: 0,
          updatedAt: now,
        },
      }
    );

    return true;
  };

  MessengerV4Service.prototype.searchMessages = async function searchMessages(
    userId,
    query,
    limit = 50,
    conversationId = null
  ) {
    const userConversationFilter = {
      status: { $ne: 'deleted' },
      participants: {
        $elemMatch: {
          userId,
          isDeleted: { $ne: true },
        },
      },
    };

    if (conversationId) {
      try {
        userConversationFilter._id = new ObjectId(conversationId);
      } catch {
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

    const messages = await this.messagesCollection
      .find({
        conversationId: { $in: conversationIds },
        $text: { $search: query },
        isDeleted: false,
      })
      .limit(limit)
      .toArray();

    const uniqueConvIds = [...new Set(messages.map(m => m.conversationId.toString()))];
    const convDocs = await this.conversationsCollection
      .find({ _id: { $in: uniqueConvIds.map(id => new ObjectId(id)) } })
      .toArray();
    const convMap = new Map(convDocs.map(c => [c._id.toString(), c]));

    return messages.map(msg => {
      const conv = convMap.get(msg.conversationId.toString());
      return {
        ...msg,
        conversation: conv
          ? {
              _id: conv._id,
              type: conv.type,
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
  };

  MessengerV4Service.prototype.getUnreadCount = async function getUnreadCount(userId) {
    const conversations = await this.conversationsCollection
      .find({
        'participants.userId': userId,
        status: 'active',
      })
      .toArray();

    let totalUnread = 0;
    conversations.forEach(conv => {
      const participant = getParticipant(conv, userId);
      if (
        participant &&
        !participant.isArchived &&
        !participant.isDeleted &&
        !participant.isMuted
      ) {
        totalUnread += participant.unreadCount || 0;
      }
    });

    return totalUnread;
  };

  MessengerV4Service.__deleteArchiveLifecyclePatched = true;
}

module.exports = MessengerV4Service;
