/**
 * Messenger State Management
 * Centralized state for the messenger application
 */

'use strict';

class MessengerState {
  constructor() {
    this.currentUser = null;
    this.conversations = [];
    this.activeConversationId = null;
    this.messages = new Map(); // conversationId → messages[]
    this.typingUsers = new Map(); // conversationId → Set of userIds
    this.presenceMap = new Map(); // userId → { state, lastSeen }
    this.unreadCount = 0;
    this.filters = {
      active: 'all', // all, unread, pinned, archived
      search: '',
    };
    this.listeners = [];
  }

  /**
   * Set current user
   */
  setCurrentUser(user) {
    this.currentUser = user;
    this.emit('userChanged', user);
  }

  /**
   * Set conversations list
   */
  setConversations(conversations) {
    this.conversations = conversations;
    this.emit('conversationsChanged', conversations);
  }

  /**
   * Add or update a conversation
   */
  updateConversation(conversation) {
    const index = this.conversations.findIndex(c => c._id === conversation._id);
    if (index >= 0) {
      this.conversations[index] = conversation;
    } else {
      this.conversations.unshift(conversation);
    }
    this.emit('conversationsChanged', this.conversations);
  }

  /**
   * Add a new conversation (alias for updateConversation)
   */
  addConversation(conversation) {
    return this.updateConversation(conversation);
  }

  /**
   * Set active conversation
   */
  setActiveConversation(conversationId) {
    this.activeConversationId = conversationId;
    this.emit('activeConversationChanged', conversationId);
  }

  /**
   * Get active conversation
   */
  getActiveConversation() {
    if (!this.activeConversationId) {
      return null;
    }
    return this.conversations.find(c => c._id === this.activeConversationId);
  }

  /**
   * Set messages for a conversation
   */
  setMessages(conversationId, messages) {
    this.messages.set(conversationId, messages);
    this.emit('messagesChanged', { conversationId, messages });
  }

  /**
   * Add a message to a conversation
   */
  addMessage(conversationId, message) {
    const messages = this.messages.get(conversationId) || [];
    // Deduplicate: skip if we already have a message with this _id (prevents double-display
    // when the API response and the WebSocket echo both arrive for the same send)
    if (message._id && messages.some(m => String(m._id) === String(message._id))) {
      return;
    }
    messages.push(message);
    this.messages.set(conversationId, messages);
    this.emit('messageAdded', { conversationId, message });
  }

  /**
   * Prepend older messages to a conversation (for infinite scroll)
   */
  prependMessages(conversationId, olderMessages) {
    const messages = this.messages.get(conversationId) || [];
    const combined = [...olderMessages, ...messages];
    this.messages.set(conversationId, combined);
    this.emit('messagesChanged', { conversationId, messages: combined });
  }

  /**
   * Get messages for a conversation
   */
  getMessages(conversationId) {
    return this.messages.get(conversationId) || [];
  }

  /**
   * Update a message (for editing)
   */
  updateMessage(conversationId, messageId, updates) {
    const messages = this.messages.get(conversationId) || [];
    const index = messages.findIndex(m => String(m._id) === String(messageId));

    if (index >= 0) {
      messages[index] = { ...messages[index], ...updates };
      this.messages.set(conversationId, messages);
      this.emit('messageUpdated', { conversationId, messageId, message: messages[index] });
    }
  }

  /**
   * Delete a message
   */
  deleteMessage(conversationId, messageId) {
    const messages = this.messages.get(conversationId) || [];
    const filteredMessages = messages.filter(m => String(m._id) !== String(messageId));

    this.messages.set(conversationId, filteredMessages);
    this.emit('messageDeleted', { conversationId, messageId });
  }

  /**
   * Update reaction on a message
   */
  updateReaction(conversationId, messageId, reaction) {
    const messages = this.messages.get(conversationId) || [];
    const index = messages.findIndex(m => String(m._id) === String(messageId));

    if (index >= 0) {
      const message = messages[index];
      if (!message.reactions) {
        message.reactions = [];
      }

      // Toggle reaction or add it
      const existingIndex = message.reactions.findIndex(
        r => r.emoji === reaction.emoji && r.userId === reaction.userId
      );

      if (existingIndex >= 0) {
        // Remove reaction
        message.reactions.splice(existingIndex, 1);
      } else {
        // Add reaction
        message.reactions.push(reaction);
      }

      this.messages.set(conversationId, messages);
      this.emit('messageUpdated', { conversationId, messageId, message });
    }
  }

  /**
   * Set typing status for a user in a conversation
   */
  setTyping(conversationId, userId, isTyping) {
    if (!this.typingUsers.has(conversationId)) {
      this.typingUsers.set(conversationId, new Set());
    }

    const typingSet = this.typingUsers.get(conversationId);
    if (isTyping) {
      typingSet.add(userId);
    } else {
      typingSet.delete(userId);
    }

    this.emit('typingChanged', { conversationId, typingUsers: Array.from(typingSet) });
  }

  /**
   * Get typing users for a conversation
   */
  getTypingUsers(conversationId) {
    const typingSet = this.typingUsers.get(conversationId);
    return typingSet ? Array.from(typingSet) : [];
  }

  /**
   * Set presence for a user
   */
  setPresence(userId, state) {
    this.presenceMap.set(userId, {
      state: state,
      lastSeen: new Date(),
    });
    this.emit('presenceChanged', { userId, state });
  }

  /**
   * Get presence for a user
   */
  getPresence(userId) {
    return this.presenceMap.get(userId) || { state: 'offline', lastSeen: null };
  }

  /**
   * Set unread count
   */
  setUnreadCount(count) {
    this.unreadCount = count;
    this.emit('unreadCountChanged', count);
  }

  /**
   * Set filter
   */
  setFilter(filterName, value) {
    this.filters[filterName] = value;
    this.emit('filterChanged', this.filters);
  }

  /**
   * Get filtered conversations
   */
  getFilteredConversations() {
    const uid = this.currentUser?.id || this.currentUser?._id;
    let filtered = [...this.conversations];

    // Apply active filter
    if (this.filters.active === 'unread') {
      filtered = filtered.filter(conv => {
        const participant = conv.participants?.find(p => p.userId === uid);
        return participant && participant.unreadCount > 0;
      });
    } else if (this.filters.active === 'pinned') {
      filtered = filtered.filter(conv => {
        const participant = conv.participants?.find(p => p.userId === uid);
        return participant && participant.isPinned;
      });
    } else if (this.filters.active === 'archived') {
      filtered = filtered.filter(conv => {
        const participant = conv.participants?.find(p => p.userId === uid);
        return participant && participant.isArchived;
      });
    } else {
      // 'all' tab — exclude archived conversations (mirroring server-side default behaviour)
      filtered = filtered.filter(conv => {
        const participant = conv.participants?.find(p => p.userId === uid);
        return !participant?.isArchived;
      });
    }

    // Apply search filter
    if (this.filters.search) {
      const searchLower = this.filters.search.toLowerCase();
      filtered = filtered.filter(conv => {
        const otherParticipant = conv.participants?.find(p => p.userId !== uid);
        const nameMatch = otherParticipant?.displayName?.toLowerCase().includes(searchLower);
        const contentMatch = conv.lastMessage?.content?.toLowerCase().includes(searchLower);
        return nameMatch || contentMatch;
      });
    }

    return filtered;
  }

  /**
   * Subscribe to state changes
   */
  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  /**
   * Unsubscribe from state changes
   */
  off(event, callback) {
    this.listeners = this.listeners.filter(l => l.event !== event || l.callback !== callback);
  }

  /**
   * Emit state change event
   */
  emit(event, data) {
    this.listeners.filter(l => l.event === event).forEach(l => l.callback(data));
  }

  /**
   * Clear all state
   */
  clear() {
    this.currentUser = null;
    this.conversations = [];
    this.activeConversationId = null;
    this.messages.clear();
    this.typingUsers.clear();
    this.presenceMap.clear();
    this.unreadCount = 0;
    this.filters = {
      active: 'all',
      search: '',
    };
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.MessengerState = MessengerState;
}
