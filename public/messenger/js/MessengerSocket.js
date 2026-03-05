/**
 * Messenger WebSocket Client
 * Handles real-time communication via Socket.IO
 */

'use strict';

class MessengerSocket {
  constructor(state) {
    this.state = state;
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
  }

  /**
   * Connect to WebSocket server
   */
  connect(userId) {
    if (!window.io) {
      console.error('Socket.IO not available');
      return;
    }

    this.socket = window.io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: this.reconnectDelay,
      reconnectionAttempts: this.maxReconnectAttempts,
    });

    this.setupEventHandlers(userId);
  }

  /**
   * Setup Socket.IO event handlers
   */
  setupEventHandlers(userId) {
    // Connection events
    this.socket.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;

      // Authenticate
      this.socket.emit('auth', { userId });

      // Rejoin active conversation if any
      if (this.state.activeConversationId) {
        this.joinConversation(this.state.activeConversationId);
      }

      // Dispatch custom event
      window.dispatchEvent(new CustomEvent('messenger:connected'));
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      window.dispatchEvent(new CustomEvent('messenger:disconnected'));
    });

    this.socket.on('auth:success', _data => {
      // Authentication successful
    });

    // Messenger v4 events (upgraded naming convention)
    this.socket.on('messenger:v4:message', data => {
      window.dispatchEvent(new CustomEvent('messenger:new-message', { detail: data }));
    });

    this.socket.on('messenger:v4:typing', data => {
      this.state.setTyping(data.conversationId, data.userId, data.isTyping);
      window.dispatchEvent(new CustomEvent('messenger:typing', { detail: data }));
    });

    this.socket.on('messenger:v4:conversation-created', data => {
      window.dispatchEvent(new CustomEvent('messenger:new-conversation', { detail: data }));
    });

    this.socket.on('messenger:v4:conversation-updated', data => {
      window.dispatchEvent(new CustomEvent('messenger:conversation-updated', { detail: data }));
    });

    this.socket.on('messenger:v4:conversation-deleted', data => {
      window.dispatchEvent(new CustomEvent('messenger:conversation-deleted', { detail: data }));
    });

    this.socket.on('messenger:v4:message-edited', data => {
      window.dispatchEvent(new CustomEvent('messenger:message-edited', { detail: data }));
    });

    this.socket.on('messenger:v4:message-deleted', data => {
      window.dispatchEvent(new CustomEvent('messenger:message-deleted', { detail: data }));
    });

    this.socket.on('messenger:v4:reaction', data => {
      window.dispatchEvent(new CustomEvent('messenger:reaction-updated', { detail: data }));
    });

    this.socket.on('messenger:v4:read', data => {
      window.dispatchEvent(new CustomEvent('messenger:conversation-read', { detail: data }));
    });

    this.socket.on('presence:changed', data => {
      this.state.setPresence(data.userId, data.state);
      window.dispatchEvent(new CustomEvent('messenger:presence', { detail: data }));
    });

    // Error handling
    this.socket.on('error', error => {
      console.error('WebSocket error:', error);
    });

    this.socket.on('connect_error', error => {
      console.error('Connection error:', error);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.warn('Max reconnection attempts reached');
        // Socket.IO will continue trying with exponential backoff
        // For additional resilience, implement HTTP polling in MessengerApp
        window.dispatchEvent(new CustomEvent('messenger:connection-failed'));
      }
    });
  }

  /**
   * Join a conversation room (v4)
   */
  joinConversation(conversationId) {
    if (!this.isConnected || !this.socket) {
      return;
    }

    this.socket.emit('messenger:v4:join-conversation', { conversationId });
  }

  /**
   * Leave a conversation room (v4)
   */
  leaveConversation(conversationId) {
    if (!this.isConnected || !this.socket) {
      return;
    }

    this.socket.emit('messenger:v4:leave-conversation', { conversationId });
  }

  /**
   * Send typing indicator
   */
  sendTyping(conversationId, isTyping, userName) {
    if (!this.isConnected || !this.socket) {
      return;
    }

    this.socket.emit('messenger:typing', { conversationId, isTyping, userName: userName || '' });
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if connected
   */
  isSocketConnected() {
    return this.isConnected && this.socket && this.socket.connected;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.MessengerSocket = MessengerSocket;
}
