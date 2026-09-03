/**
 * Messenger API Client
 * Handles all HTTP requests to the messenger v4 API
 */

'use strict';

class MessengerAPI {
  constructor() {
    this.baseUrl = '/api/v4/messenger';
  }

  /**
   * Get CSRF token from cookies or meta tag (read fresh on each call)
   */
  getCsrfToken() {
    // Try cookie first (EventFlow pattern).
    // Use indexOf('=') rather than split('=') so that base64 values containing '='
    // are captured in full (split truncates after the first '=').
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }
      const name = trimmed.substring(0, eqIndex);
      if (name === 'csrf' || name === 'csrfToken') {
        try {
          return decodeURIComponent(trimmed.substring(eqIndex + 1));
        } catch (_) {
          continue;
        }
      }
    }

    // Fallback to meta tag
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag && metaTag.content) {
      return metaTag.content;
    }

    // Fallback to globals set by csrf-handler.js
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }
    if (window.csrfToken) {
      return window.csrfToken;
    }

    return '';
  }

  /**
   * Make authenticated request with retry logic
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @param {number} retryCount - Number of retries (default: 0, max: 2)
   * @returns {Promise<Object>} Response data
   */
  async request(endpoint, options = {}, retryCount = 0) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      credentials: 'include',
    };

    // Add CSRF token to POST/PATCH/DELETE requests
    if (['POST', 'PATCH', 'DELETE'].includes(options.method?.toUpperCase())) {
      config.headers['X-CSRF-Token'] = this.getCsrfToken();
    }

    try {
      const response = await fetch(url, config);

      // Retry on 5xx errors (server issues) if not a write operation
      if (response.status >= 500 && response.status < 600 && retryCount < 2) {
        const isReadOperation = !options.method || options.method.toUpperCase() === 'GET';
        if (isReadOperation) {
          // Wait briefly before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 2 ** retryCount * 500));
          return this.request(endpoint, options, retryCount + 1);
        }
      }

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Request failed' }));
        const apiError = new Error(body.error || body.message || 'Request failed');
        apiError.status = response.status;
        apiError.code = body.code;
        apiError.retryAfter = body.retryAfter || response.headers.get('Retry-After') || null;
        apiError.body = body;
        apiError.safeMessage = body.error || body.message || 'Request failed';
        throw apiError;
      }

      return await response.json();
    } catch (error) {
      // Retry on network errors for read operations
      if (error.name === 'TypeError' && retryCount < 2) {
        const isReadOperation = !options.method || options.method.toUpperCase() === 'GET';
        if (isReadOperation) {
          await new Promise(resolve => setTimeout(resolve, 2 ** retryCount * 500));
          return this.request(endpoint, options, retryCount + 1);
        }
      }

      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Create a new conversation (v4 API)
   * @param {Object} params - Conversation parameters
   * @param {string} params.type - Conversation type (direct, marketplace, enquiry, etc.)
   * @param {Array<string>} params.participantIds - Array of participant user IDs
   * @param {Object} params.context - Optional context (for package/supplier references)
   * @param {Object} params.metadata - Optional metadata
   * @returns {Promise<Object>} Created conversation
   */
  createConversation({ type, participantIds, context = null, metadata = {} }) {
    if (!type) {
      throw new Error('Conversation type is required');
    }
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      throw new Error('participantIds must be a non-empty array');
    }

    return this.request('/conversations', {
      method: 'POST',
      body: JSON.stringify({
        type,
        participantIds,
        context,
        metadata,
      }),
    });
  }

  /**
   * Get conversations list
   */
  getConversations(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) {
      params.append('status', filters.status);
    }
    if (filters.unreadOnly) {
      // Server reads 'unread' (not 'unreadOnly')
      params.append('unread', 'true');
    }
    if (filters.pinned) {
      params.append('pinned', 'true');
    }
    if (filters.archived) {
      params.append('archived', 'true');
    }
    if (filters.search) {
      params.append('search', filters.search);
    }

    const queryString = params.toString();
    return this.request(`/conversations${queryString ? `?${queryString}` : ''}`);
  }

  /**
   * Get a specific conversation
   */
  getConversation(conversationId) {
    return this.request(`/conversations/${conversationId}`);
  }

  /**
   * Update conversation (pin, mute, archive)
   */
  updateConversation(conversationId, updates) {
    return this.request(`/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete (archive) conversation
   */
  deleteConversation(conversationId) {
    return this.request(`/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Send a message
   *
   * Accepts either the legacy positional signature
   *   sendMessage(conversationId, content, attachments, replyToId)
   * or an options object:
   *   sendMessage(conversationId, { content, attachments, replyToId, clientMessageId })
   *
   * `clientMessageId` is a short stable string (UUID/ulid/nanoid) that makes
   * the send idempotent across retries — the server will return the existing
   * message rather than creating a duplicate.  When omitted, one is generated.
   */
  async sendMessage(conversationId, contentOrOptions, attachments = [], replyToId = null) {
    // Normalise either signature into local variables.
    let content;
    let atts = attachments || [];
    let reply = replyToId;
    let clientMessageId;
    if (
      contentOrOptions &&
      typeof contentOrOptions === 'object' &&
      !Array.isArray(contentOrOptions)
    ) {
      content = contentOrOptions.content;
      atts = contentOrOptions.attachments || [];
      reply = contentOrOptions.replyToId || null;
      clientMessageId = contentOrOptions.clientMessageId;
    } else {
      content = contentOrOptions;
    }

    // Auto-generate a clientMessageId when not supplied.  This keeps the
    // pipeline idempotent for every caller without requiring opt-in.
    if (!clientMessageId) {
      clientMessageId = this._generateClientMessageId();
    }

    // If we have attachments, use FormData
    if (atts.length > 0) {
      const formData = new FormData();
      // Backend expects field named 'content' (not 'message')
      formData.append('content', content || '');
      // Backend expects 'replyTo' as a JSON string (parsed by multer/body-parser)
      if (reply) {
        formData.append('replyTo', JSON.stringify({ _id: reply }));
        formData.append('replyToMessageId', String(reply));
      }
      formData.append('clientMessageId', clientMessageId);

      // Multer is configured as upload.array('attachments', 10)
      atts.forEach(file => {
        formData.append('attachments', file);
      });

      // For FormData, don't set headers - let browser set Content-Type with boundary
      const url = `${this.baseUrl}/conversations/${conversationId}/messages`;
      const config = {
        method: 'POST',
        credentials: 'include',
        body: formData,
        // Note: Don't set Content-Type header for FormData
        // Browser will automatically set it with correct boundary
      };

      // Add CSRF token as custom header
      config.headers = {
        'X-CSRF-Token': this.getCsrfToken(),
      };

      try {
        const response = await fetch(url, config);

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(error.error || error.message || 'Request failed');
        }

        return await response.json();
      } catch (error) {
        console.error('API request failed:', error);
        throw error;
      }
    }

    // Otherwise use JSON
    // Backend expects 'content' (not 'message') and 'replyTo' (not 'replyToId')
    return this.request(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        replyTo: reply ? { _id: reply } : undefined,
        replyToMessageId: reply || undefined,
        clientMessageId,
      }),
    });
  }

  /**
   * Generate a short opaque idempotency key.  Prefers crypto.randomUUID(),
   * falls back to Math.random so the client still works in older browsers /
   * jsdom test environments.  Value is constrained to the server's accepted
   * alphabet: [A-Za-z0-9._:-], max 64 chars.
   */
  _generateClientMessageId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      // fall through
    }
    const rand = Math.random().toString(36).slice(2);
    return `c-${Date.now().toString(36)}-${rand}`;
  }

  /**
   * Get messages for a conversation
   * Accepts either positional args (conversationId, before, limit)
   * or an options object as the second argument:
   *   (conversationId, { before, limit, sinceSeq })
   *
   * When `sinceSeq` is provided, the server returns messages forward in time
   * from that sequence — used for reconnection catch-up and gap fills.
   */
  getMessages(conversationId, beforeOrOptions = null, limit = 50) {
    let before = beforeOrOptions;
    let resolvedLimit = limit;
    let sinceSeq = null;
    if (beforeOrOptions !== null && typeof beforeOrOptions === 'object') {
      before = beforeOrOptions.before || null;
      resolvedLimit = beforeOrOptions.limit || limit;
      if (beforeOrOptions.sinceSeq !== undefined && beforeOrOptions.sinceSeq !== null) {
        sinceSeq = beforeOrOptions.sinceSeq;
      }
    }

    const params = new URLSearchParams();
    // Backend reads 'cursor' (not 'before') for cursor-based pagination
    if (before) {
      params.append('cursor', before);
    }
    if (resolvedLimit) {
      params.append('limit', resolvedLimit);
    }
    if (sinceSeq !== null) {
      params.append('sinceSeq', String(sinceSeq));
    }

    const queryString = params.toString();
    return this.request(
      `/conversations/${conversationId}/messages${queryString ? `?${queryString}` : ''}`
    );
  }

  /**
   * Edit a message
   */
  editMessage(messageId, newContent) {
    return this.request(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        content: newContent,
      }),
    });
  }

  /**
   * Delete a message
   */
  deleteMessage(messageId) {
    return this.request(`/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Mark conversation as read
   * @param {Object} [options]
   * @param {number} [options.upToSeq] - Upper bound on `seq` to mark (for
   *   cursor-based per-message read receipts).
   */
  markAsRead(conversationId, options = {}) {
    const body =
      options &&
      typeof options === 'object' &&
      options.upToSeq !== undefined &&
      options.upToSeq !== null
        ? JSON.stringify({ upToSeq: options.upToSeq })
        : undefined;
    return this.request(`/conversations/${conversationId}/read`, {
      method: 'POST',
      ...(body ? { body } : {}),
    });
  }

  /**
   * Record delivery receipts for one or more incoming messages.  Silent
   * failure is fine — delivery receipts are a best-effort UX signal and the
   * server will re-reconcile on the next `sinceSeq` fetch.
   */
  markDelivered(conversationId, messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return { success: true, modifiedCount: 0 };
    }
    return this.request(`/conversations/${conversationId}/delivered`, {
      method: 'POST',
      body: JSON.stringify({ messageIds }),
    });
  }

  /**
   * Mark conversation as unread
   */
  markAsUnread(conversationId) {
    return this.updateConversation(conversationId, { markUnread: true });
  }

  /**
   * Toggle reaction on a message
   */
  toggleReaction(messageId, emoji) {
    return this.request(`/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  }

  /**
   * Search messages
   */
  searchMessages(query, conversationId = null) {
    const params = new URLSearchParams();
    params.append('q', query);
    if (conversationId) {
      params.append('conversationId', conversationId);
    }

    return this.request(`/search?${params.toString()}`);
  }

  /**
   * Get contacts for new conversation
   */
  getContacts(searchQuery = '', options = {}) {
    const params = new URLSearchParams();
    if (searchQuery) {
      params.append('q', searchQuery);
    }
    if (options.role) {
      params.append('role', options.role);
    }
    if (options.mode) {
      params.append('mode', options.mode);
    }
    const qs = params.toString();
    return this.request(`/contacts${qs ? `?${qs}` : ''}`);
  }

  /**
   * Search contacts (alias for getContacts)
   */
  searchContacts(query = '', options = {}) {
    return this.getContacts(query, options);
  }

  /**
   * Get unread count
   */
  getUnreadCount() {
    return this.request('/unread-count');
  }

  /**
   * Send typing indicator
   */
  sendTyping(conversationId, isTyping) {
    return this.request(`/conversations/${conversationId}/typing`, {
      method: 'POST',
      body: JSON.stringify({ isTyping }),
    });
  }

  /**
   * List the users the current user has blocked.
   */
  getBlockedUsers() {
    return this.request('/blocked');
  }

  /**
   * Block a user. Blocks are bidirectional in effect — the two users can
   * no longer message each other once blocked.
   */
  blockUser(userId, reason = '') {
    return this.request('/block', {
      method: 'POST',
      body: JSON.stringify({ userId, reason }),
    });
  }

  unblockUser(userId) {
    return this.request(`/block/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Submit a report against a user or a specific message, via the shared
   * site-wide reporting endpoint (not scoped to /api/v4/messenger).
   */
  async reportContent(type, targetId, reason, details = '') {
    const response = await fetch('/api/v1/reports', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': this.getCsrfToken(),
      },
      body: JSON.stringify({ type, targetId, reason, details }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Failed to submit report');
      error.status = response.status;
      throw error;
    }
    return body;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.MessengerAPI = MessengerAPI;
}
