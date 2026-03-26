/**
 * ConversationView Component
 * Renders the main chat view with messages, typing indicators, and actions
 */

'use strict';

class ConversationView {
  constructor(container, state, api) {
    this.container = container;
    this.state = state;
    this.api = api;
    this.currentUser = null;
    this.messagesContainer = null;
    this.typingIndicator = null;
    this.contextBanner = null;
    this.scrollContainer = null;
    this.isLoadingMore = false;
    this.hasMoreMessages = true;

    this.init();
  }

  /**
   * Initialize the conversation view
   */
  init() {
    this.render();
    this.attachEventListeners();
  }

  /**
   * Render the conversation view structure
   */
  render() {
    this.container.innerHTML = `
      <div class="messenger-v4__conversation-view">
        <!-- Context Banner (package, supplier info) -->
        <div class="messenger-v4__context-banner" id="contextBanner" style="display: none;">
          <div class="messenger-v4__context-icon"></div>
          <div class="messenger-v4__context-info">
            <div class="messenger-v4__context-title"></div>
            <div class="messenger-v4__context-subtitle"></div>
          </div>
        </div>

        <!-- Messages Container -->
        <div class="messenger-v4__messages-scroll" id="messagesScroll">
          <div class="messenger-v4__messages-container" id="messagesContainer">
            <!-- Messages will be rendered here -->
          </div>
          
          <!-- Typing Indicator -->
          <div class="messenger-v4__typing-indicator" id="typingIndicator" style="display: none;">
            <span class="messenger-v4__typing-dot"></span>
            <span class="messenger-v4__typing-dot"></span>
            <span class="messenger-v4__typing-dot"></span>
            <span class="messenger-v4__typing-text"></span>
          </div>
        </div>

        <!-- Empty State -->
        <div class="messenger-v4__empty-state" id="emptyState">
          <svg class="messenger-v4__empty-icon" width="80" height="80" viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="40" r="35" stroke="currentColor" stroke-width="2" opacity="0.2"/>
            <path d="M25 35 L35 45 L55 25" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
          </svg>
          <p class="messenger-v4__empty-title">No messages yet</p>
          <p class="messenger-v4__empty-subtitle">Start the conversation!</p>
        </div>
      </div>
    `;

    this.messagesContainer = this.container.querySelector('#messagesContainer');
    this.scrollContainer = this.container.querySelector('#messagesScroll');
    this.typingIndicator = this.container.querySelector('#typingIndicator');
    this.contextBanner = this.container.querySelector('#contextBanner');
    this.emptyState = this.container.querySelector('#emptyState');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Scroll event for lazy loading
    if (this.scrollContainer) {
      this.scrollContainer.addEventListener('scroll', this.handleScroll.bind(this));
    }

    // Listen for state changes
    this.state.on('messagesUpdated', this.handleMessagesUpdated.bind(this));
    this.state.on('messageAdded', this.handleMessageAdded.bind(this));
    this.state.on('messageUpdated', this.handleMessageUpdated.bind(this));
    this.state.on('messageDeleted', this.handleMessageDeleted.bind(this));
    this.state.on('typingChanged', this.handleTypingChanged.bind(this));
    this.state.on('conversationChanged', this.handleConversationChanged.bind(this));
  }

  /**
   * Handle scroll for infinite loading
   */
  handleScroll() {
    if (this.isLoadingMore || !this.hasMoreMessages) {
      return;
    }

    const { scrollTop } = this.scrollContainer;

    // Load more when scrolled to top (inverse scroll for chat)
    if (scrollTop < 100) {
      this.loadMoreMessages();
    }
  }

  /**
   * Load more messages (pagination)
   */
  async loadMoreMessages() {
    if (!this.state.activeConversationId || this.isLoadingMore) {
      return;
    }

    this.isLoadingMore = true;
    const conversationId = this.state.activeConversationId;
    const messages = this.state.getMessages(conversationId);

    // Get cursor from oldest message
    const oldestMessage = messages[0];
    const cursor = oldestMessage ? oldestMessage._id : null;

    try {
      const response = await this.api.getMessages(conversationId, cursor);

      if (response.messages && response.messages.length > 0) {
        // Prepend older messages to state (not append - they're older!)
        this.state.prependMessages(conversationId, response.messages);
        this.hasMoreMessages = response.hasMore;
      } else {
        this.hasMoreMessages = false;
      }
    } catch (error) {
      console.error('Error loading more messages:', error);
    } finally {
      this.isLoadingMore = false;
    }
  }

  /**
   * Handle messages updated
   */
  handleMessagesUpdated() {
    this.renderMessages();
  }

  /**
   * Handle new message added
   */
  handleMessageAdded(data) {
    const { message } = data;
    if (message.conversationId === this.state.activeConversationId) {
      this.appendMessage(message);
      this.scrollToBottom(true);
    }
  }

  /**
   * Handle message updated (edited)
   */
  handleMessageUpdated(data) {
    const { messageId } = data;
    const messageEl = this.container.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
      const message = this.state.getMessage(messageId);
      if (message) {
        this.updateMessageElement(messageEl, message);
      }
    }
  }

  /**
   * Handle message deleted
   */
  handleMessageDeleted(data) {
    const { messageId } = data;
    const messageEl = this.container.querySelector(`[data-message-id="${messageId}"]`);
    if (messageEl) {
      messageEl.classList.add('messenger-v4__message--deleted');
      const contentEl = messageEl.querySelector('.messenger-v4__message-content');
      if (contentEl) {
        contentEl.innerHTML =
          '<em class="messenger-v4__message-deleted-text">This message was deleted</em>';
      }
    }
  }

  /**
   * Handle typing indicator changes
   */
  handleTypingChanged(data) {
    const { conversationId, typingUsers } = data;

    if (conversationId !== this.state.activeConversationId) {
      return;
    }

    // Filter out current user
    const otherTypingUsers = typingUsers.filter(userId => userId !== this.currentUser?._id);

    if (otherTypingUsers.length > 0) {
      const conversation = this.state.getConversation(conversationId);
      const names = otherTypingUsers.map(userId => {
        const participant = conversation?.participants?.find(p => p.userId === userId);
        return participant?.displayName || 'Someone';
      });

      const typingText =
        names.length === 1 ? `${names[0]} is typing...` : `${names.join(', ')} are typing...`;

      this.typingIndicator.querySelector('.messenger-v4__typing-text').textContent = typingText;
      this.typingIndicator.style.display = 'flex';
      this.scrollToBottom(false);
    } else {
      this.typingIndicator.style.display = 'none';
    }
  }

  /**
   * Handle conversation changed
   */
  handleConversationChanged(data) {
    const { conversationId } = data;
    if (conversationId) {
      this.loadConversation(conversationId);
    }
  }

  /**
   * Load and display a conversation
   */
  async loadConversation(conversationId) {
    try {
      // Get conversation details
      const conversation = this.state.getConversation(conversationId);

      // Show context banner if conversation has context
      if (conversation?.context) {
        this.renderContextBanner(conversation.context);
      } else {
        this.contextBanner.style.display = 'none';
      }

      // Load messages
      const messages = this.state.getMessages(conversationId);

      if (messages && messages.length > 0) {
        this.renderMessages();
        this.emptyState.style.display = 'none';
      } else {
        // Fetch messages from API
        const response = await this.api.getMessages(conversationId);
        if (response.messages) {
          response.messages.forEach(msg => this.state.addMessage(msg));
          this.renderMessages();
          this.emptyState.style.display = 'none';
        } else {
          this.emptyState.style.display = 'flex';
        }
        this.hasMoreMessages = response.hasMore;
      }

      this.scrollToBottom(false);

      // Mark as read
      await this.api.markAsRead(conversationId);
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  }

  /**
   * Render context banner
   */
  renderContextBanner(context) {
    if (!context || !context.type) {
      return;
    }

    const iconMap = {
      package: '📦',
      supplier_profile: '🏢',
      marketplace_listing: '🛍️',
      find_supplier: '🔍',
    };

    const icon = iconMap[context.type] || '💬';
    const title = context.title || 'Related Item';
    const subtitle = context.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    this.contextBanner.querySelector('.messenger-v4__context-icon').textContent = icon;
    this.contextBanner.querySelector('.messenger-v4__context-title').textContent = title;
    this.contextBanner.querySelector('.messenger-v4__context-subtitle').textContent = subtitle;
    this.contextBanner.style.display = 'flex';
  }

  /**
   * Render all messages
   */
  renderMessages() {
    if (!this.state.activeConversationId) {
      return;
    }

    const messages = this.state.getMessages(this.state.activeConversationId);
    if (!messages || messages.length === 0) {
      this.emptyState.style.display = 'flex';
      this.messagesContainer.innerHTML = '';
      return;
    }

    this.emptyState.style.display = 'none';

    // Group messages by date
    const groupedMessages = this.groupMessagesByDate(messages);

    let html = '';
    for (const [date, msgs] of Object.entries(groupedMessages)) {
      html += `<div class="messenger-v4__date-divider">${date}</div>`;
      msgs.forEach(message => {
        html += this.renderMessage(message);
      });
    }

    this.messagesContainer.innerHTML = html;
    this.attachMessageEventListeners();
  }

  /**
   * Group messages by date
   */
  groupMessagesByDate(messages) {
    const groups = {};

    messages.forEach(message => {
      const date = new Date(message.createdAt);
      const dateKey = this.formatDate(date);

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(message);
    });

    return groups;
  }

  /**
   * Format date for divider
   */
  formatDate(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  /**
   * Render a single message
   */
  renderMessage(message) {
    const isSent = message.senderId === this.currentUser?._id;
    const messageClass = isSent ? 'messenger-v4__message--sent' : 'messenger-v4__message--received';
    const deletedClass = message.isDeleted ? 'messenger-v4__message--deleted' : '';
    const time = new Date(message.createdAt).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return `
      <div class="messenger-v4__message ${messageClass} ${deletedClass}" data-message-id="${message._id}">
        ${!isSent ? `<div class="messenger-v4__message-avatar">${this.getAvatar(message.senderId)}</div>` : ''}
        <div class="messenger-v4__message-bubble">
          ${!isSent ? `<div class="messenger-v4__message-sender">${this.escapeHtml(message.senderName || 'Unknown')}</div>` : ''}
          <div class="messenger-v4__message-content">
            ${message.isDeleted ? '<em class="messenger-v4__message-deleted-text">This message was deleted</em>' : this.escapeHtml(message.content)}
            ${message.isEdited ? '<span class="messenger-v4__message-edited">(edited)</span>' : ''}
          </div>
          ${this.renderAttachments(message.attachments)}
          ${this.renderReactions(message.reactions, message._id)}
          <div class="messenger-v4__message-meta">
            <span class="messenger-v4__message-time">${time}</span>
            ${this.renderReadReceipts(message.readBy)}
          </div>
        </div>
        ${
          isSent
            ? `<div class="messenger-v4__message-actions">
          <button class="messenger-v4__message-action" data-action="react" title="React">
            <span>😊</span>
          </button>
          <button class="messenger-v4__message-action" data-action="edit" title="Edit" ${message.isDeleted ? 'disabled' : ''}>
            <span>✏️</span>
          </button>
          <button class="messenger-v4__message-action" data-action="delete" title="Delete">
            <span>🗑️</span>
          </button>
        </div>`
            : ''
        }
      </div>
    `;
  }

  /**
   * Get user avatar or initials
   * @param {string} userId - User ID
   * @returns {string} Avatar URL or initials
   */
  getAvatar(userId) {
    // Try to get avatar from conversation participants
    const conversation = this.state.getActiveConversation();
    if (conversation && conversation.participants) {
      const participant = conversation.participants.find(p => (p.userId || p._id) === userId);

      if (participant) {
        // Return avatar URL if available
        if (participant.avatar) {
          return `<img src="${this.escapeHtml(participant.avatar)}" alt="Avatar" class="messenger-message__avatar-img" data-fallback-hide data-fallback-show-next />
                  <div class="messenger-message__avatar-fallback" style="display:none;">${this.getInitials(participant)}</div>`;
        }
        // Return initials fallback
        return this.getInitials(participant);
      }
    }

    // Fallback to first character of userId
    return userId?.charAt(0)?.toUpperCase() || '?';
  }

  /**
   * Get user initials from participant data
   * @param {Object} participant - Participant object
   * @returns {string} User initials
   */
  getInitials(participant) {
    const displayName = participant.displayName || participant.name || '';
    if (!displayName) {
      return '?';
    }

    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return displayName.charAt(0).toUpperCase();
  }

  /**
   * Render attachments
   */
  renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) {
      return '';
    }

    return `
      <div class="messenger-v4__message-attachments">
        ${attachments
          .map(att => {
            if (!att) {
              return '';
            }
            if (att.type?.startsWith('image/')) {
              const safeUrl = this.escapeHtml(att.url || '');
              const safeAlt = this.escapeHtml(att.name || 'Image attachment');
              return `<img src="${safeUrl}" alt="${safeAlt}" class="messenger-v4__message-image" loading="lazy" data-fallback-action="attachment-error" />`;
            } else {
              return `
              <a href="${this.escapeHtml(att.url || '')}" target="_blank" rel="noopener noreferrer" class="messenger-v4__message-file">
                <span class="messenger-v4__message-file-icon">📄</span>
                <span class="messenger-v4__message-file-name">${this.escapeHtml(att.name)}</span>
                <span class="messenger-v4__message-file-size">${this.formatFileSize(att.size)}</span>
              </a>
            `;
            }
          })
          .join('')}
      </div>
    `;
  }

  /**
   * Render reactions
   */
  renderReactions(reactions, messageId) {
    if (!reactions || reactions.length === 0) {
      return '';
    }

    // Group reactions by emoji
    const reactionGroups = {};
    reactions.forEach(reaction => {
      if (!reactionGroups[reaction.emoji]) {
        reactionGroups[reaction.emoji] = [];
      }
      reactionGroups[reaction.emoji].push(reaction.userId);
    });

    return `
      <div class="messenger-v4__message-reactions">
        ${Object.entries(reactionGroups)
          .map(
            ([emoji, userIds]) => `
          <button class="messenger-v4__reaction" data-emoji="${emoji}" data-message-id="${messageId}" title="${userIds.length} reaction(s)">
            <span class="messenger-v4__reaction-emoji">${emoji}</span>
            <span class="messenger-v4__reaction-count">${userIds.length}</span>
          </button>
        `
          )
          .join('')}
      </div>
    `;
  }

  /**
   * Render read receipts
   */
  renderReadReceipts(readBy) {
    if (!readBy || readBy.length === 0) {
      return '';
    }

    const count = readBy.length;
    return `<span class="messenger-v4__message-read-receipt" title="${count} read">✓✓</span>`;
  }

  /**
   * Append a single message (for real-time)
   */
  appendMessage(message) {
    const html = this.renderMessage(message);
    this.messagesContainer.insertAdjacentHTML('beforeend', html);
    this.attachMessageEventListeners();
  }

  /**
   * Update message element after edit
   */
  updateMessageElement(messageEl, message) {
    const contentEl = messageEl.querySelector('.messenger-v4__message-content');
    if (contentEl && !message.isDeleted) {
      contentEl.innerHTML = `
        ${this.escapeHtml(message.content)}
        ${message.isEdited ? '<span class="messenger-v4__message-edited">(edited)</span>' : ''}
      `;
    }
  }

  /**
   * Attach event listeners to message actions
   */
  attachMessageEventListeners() {
    // React buttons
    this.container.querySelectorAll('[data-action="react"]').forEach(btn => {
      btn.addEventListener('click', this.handleReact.bind(this));
    });

    // Edit buttons
    this.container.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', this.handleEdit.bind(this));
    });

    // Delete buttons
    this.container.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', this.handleDelete.bind(this));
    });

    // Reaction clicks
    this.container.querySelectorAll('.messenger-v4__reaction').forEach(btn => {
      btn.addEventListener('click', this.handleReactionClick.bind(this));
    });
  }

  /**
   * Handle react action
   */
  async handleReact(event) {
    const messageEl = event.currentTarget.closest('.messenger-v4__message');
    const messageId = messageEl.dataset.messageId;

    // Use custom emoji picker modal
    const emoji = await window.MessengerModals.showEmojiPicker();
    if (emoji) {
      try {
        await this.api.toggleReaction(messageId, emoji);
      } catch (error) {
        console.error('Error adding reaction:', error);
      }
    }
  }

  /**
   * Handle edit action
   */
  async handleEdit(event) {
    const messageEl = event.currentTarget.closest('.messenger-v4__message');
    const messageId = messageEl.dataset.messageId;
    const message = this.state.getMessage(messageId);

    if (!message || message.isDeleted) {
      return;
    }

    // Use custom edit modal
    const newContent = await window.MessengerModals.showEditPrompt(message.content);
    if (newContent && newContent !== message.content) {
      try {
        await this.api.editMessage(messageId, newContent);
      } catch (error) {
        console.error('Error editing message:', error);
        alert('Failed to edit message. It may be too old to edit.');
      }
    }
  }

  /**
   * Handle delete action
   */
  async handleDelete(event) {
    const messageEl = event.currentTarget.closest('.messenger-v4__message');
    const messageId = messageEl.dataset.messageId;

    // Use custom confirmation modal
    const confirmed = await window.MessengerModals.showConfirm(
      'Delete Message',
      'Are you sure you want to delete this message? This action cannot be undone.',
      'Delete',
      'Cancel'
    );

    if (confirmed) {
      try {
        await this.api.deleteMessage(messageId);
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    }
  }

  /**
   * Handle reaction click (toggle own reaction)
   */
  async handleReactionClick(event) {
    const btn = event.currentTarget;
    const emoji = btn.dataset.emoji;
    const messageId = btn.dataset.messageId;

    try {
      await this.api.toggleReaction(messageId, emoji);
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }
  }

  /**
   * Scroll to bottom
   */
  scrollToBottom(smooth = false) {
    if (!this.scrollContainer) {
      return;
    }

    if (smooth) {
      this.scrollContainer.scrollTo({
        top: this.scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    } else {
      this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
    }
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Set current user
   */
  setCurrentUser(user) {
    this.currentUser = user;
  }

  /**
   * Destroy the component
   */
  destroy() {
    this.state.off('messagesUpdated', this.handleMessagesUpdated);
    this.state.off('messageAdded', this.handleMessageAdded);
    this.state.off('messageUpdated', this.handleMessageUpdated);
    this.state.off('messageDeleted', this.handleMessageDeleted);
    this.state.off('typingChanged', this.handleTypingChanged);
    this.state.off('conversationChanged', this.handleConversationChanged);

    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this.handleScroll);
    }
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ConversationView = ConversationView;
}
