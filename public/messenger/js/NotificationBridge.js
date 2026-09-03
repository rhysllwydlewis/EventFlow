/**
 * NotificationBridge Component
 * Integrates messenger with existing notification system
 */

'use strict';
const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

(function () {
  // Configuration constants
  const NOTIFICATION_AUTO_CLOSE_DELAY = 5000; // 5 seconds
  const UNREAD_COUNT_POLL_INTERVAL = 120000; // 2 minutes
  const BADGE_SELECTORS = [
    '#ef-notification-badge',
    '#unread-messages-count',
    '.messenger-unread-badge',
  ];

  let notificationPermission = 'default';
  let hasRequestedPermission = false;

  /**
   * Update global unread badge in site header
   * @param {number} count - Number of unread messages
   */
  function updateUnreadBadge(count) {
    BADGE_SELECTORS.forEach(selector => {
      const badges = document.querySelectorAll(selector);
      badges.forEach(badge => {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      });
    });
  }

  /**
   * Show browser desktop notification
   * @param {Object} data - Notification data
   * @param {string} data.senderName - Name of message sender
   * @param {string} data.messagePreview - Preview of message content
   * @param {string} data.conversationId - ID of the conversation
   */
  function showDesktopNotification(data) {
    const { senderName, messagePreview, conversationId } = data;

    // Check if notifications are supported
    if (!('Notification' in window)) {
      return;
    }

    // Request permission if not yet asked
    if (notificationPermission === 'default' && !hasRequestedPermission) {
      hasRequestedPermission = true;
      Notification.requestPermission().then(permission => {
        notificationPermission = permission;
        if (permission === 'granted') {
          createNotification(senderName, messagePreview, conversationId);
        }
      });
      return;
    }

    // Show notification if granted
    if (notificationPermission === 'granted') {
      createNotification(senderName, messagePreview, conversationId);
    }
  }

  /**
   * Create and display browser notification
   * @param {string} senderName - Name of message sender
   * @param {string} messagePreview - Preview of message content
   * @param {string} conversationId - ID of the conversation
   */
  function createNotification(senderName, messagePreview, conversationId) {
    const title = senderName || 'New Message';
    const body = messagePreview || 'You have a new message';

    const notification = new Notification(title, {
      body: body,
      icon: '/assets/images/logo.png',
      badge: '/assets/images/logo.png',
      tag: `messenger-${conversationId}`,
      requireInteraction: false,
    });

    notification.onclick = function () {
      window.focus();
      window.location.href = `/messenger/?conversation=${encodeURIComponent(conversationId)}`;
      notification.close();
    };

    // Auto-close after configured delay
    setTimeout(() => notification.close(), NOTIFICATION_AUTO_CLOSE_DELAY);
  }

  /**
   * Handle new message event
   */
  function handleNewMessage(event) {
    const data = event.detail || event;
    const { conversationId, message, sender, unreadCount } = data;

    // Update unread badge
    if (typeof unreadCount === 'number') {
      updateUnreadBadge(unreadCount);
    }

    // Dispatch custom event for other parts of the app
    window.dispatchEvent(
      new CustomEvent('messenger:notification', {
        detail: {
          conversationId: conversationId,
          message: message,
          sender: sender,
        },
      })
    );

    // Show desktop notification if not on messenger page
    if (!window.location.pathname.startsWith('/messenger')) {
      showDesktopNotification({
        senderName: sender?.name || 'Unknown User',
        messagePreview: message?.content || message?.text || 'New message',
        conversationId: conversationId,
      });
    }
  }

  /**
   * Setup WebSocket listeners
   */
  function setupWebSocket() {
    // Socket.IO listener
    if (window.io && typeof window.io === 'function') {
      try {
        const socket = window.io();

        socket.on('messenger:new-message', data => {
          handleNewMessage(data);
        });

        // Also listen for notification events (v2 compatibility)
        socket.on('notification:received', data => {
          if (data.type === 'message' || data.category === 'message') {
            handleNewMessage(data);
          }
        });

        socket.on('notification', data => {
          if (data.type === 'message' || data.category === 'message') {
            handleNewMessage(data);
          }
        });

        // Handle connection errors
        socket.on('error', error => {
          console.error('WebSocket error:', error);
        });

        socket.on('disconnect', () => {
          if (isDevelopment) {
            console.log('WebSocket disconnected, notifications will use polling');
          }
        });

        socket.on('connect', () => {
          if (isDevelopment) {
            console.log('WebSocket connected');
          }
        });
      } catch (error) {
        console.error('Error setting up Socket.IO:', error);
      }
    }

    // Listen for custom events
    window.addEventListener('messenger:new-message', handleNewMessage);
  }

  /**
   * Fetch and update unread count
   */
  async function fetchUnreadCount() {
    try {
      const response = await fetch('/api/v4/messenger/conversations?unreadOnly=true&limit=100', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const conversations = data.conversations || [];
      const totalUnread = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
      updateUnreadBadge(totalUnread);
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  }

  let updateInterval = null;

  /**
   * Initialize notification bridge
   */
  function init() {
    // Check current notification permission
    if ('Notification' in window) {
      notificationPermission = Notification.permission;
    }

    // Setup listeners
    setupWebSocket();

    // Fetch initial unread count
    fetchUnreadCount();

    // Periodically update unread count (store reference for cleanup)
    if (updateInterval) {
      clearInterval(updateInterval);
    }
    updateInterval = setInterval(fetchUnreadCount, UNREAD_COUNT_POLL_INTERVAL);
  }

  /**
   * Cleanup function to stop polling
   */
  function destroy() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded
    init();
  }

  // Export for manual control if needed
  window.NotificationBridge = {
    init,
    destroy,
    updateUnreadBadge,
    fetchUnreadCount,
  };
})();
