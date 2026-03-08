/**
 * EventFlow Notification System - Client
 * Real-time notification handling with WebSocket and desktop notifications
 *
 * Features:
 * - Real-time notifications via WebSocket
 * - Desktop notifications (with permission)
 * - Notification bell UI with unread count
 * - Notification dropdown/panel
 * - Mark as read/dismiss functionality
 * - Sound notifications
 * - Grouped notifications
 */

(function () {
  'use strict';

  // Check if running in development environment
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // ==========================================
  // STATE
  // ==========================================

  const state = {
    notifications: [],
    unreadCount: 0,
    socket: null,
    isConnected: false,
    hasDesktopPermission: false,
    isInitialized: false,
    isInitializing: false,
    soundEnabled: localStorage.getItem('ef_notification_sound_enabled') !== 'false',
  };

  // ==========================================
  // CONSTANTS
  // ==========================================

  // Debounce delay to prevent double-firing of touch and click events on hybrid devices
  const TOUCH_DEBOUNCE_MS = 500;

  // ==========================================
  // LOADING STATE MANAGEMENT
  // ==========================================

  function setBellLoadingState(loading) {
    const bell =
      document.getElementById('ef-notification-btn') ||
      document.getElementById('notification-bell');

    if (bell) {
      if (loading) {
        bell.classList.add('ef-notification-loading');
        bell.disabled = true;
        bell.setAttribute('aria-busy', 'true');
      } else {
        bell.classList.remove('ef-notification-loading');
        bell.disabled = false;
        bell.removeAttribute('aria-busy');
      }
    }
  }

  // ==========================================
  // WEBSOCKET CONNECTION
  // ==========================================

  function initWebSocket() {
    try {
      // Load Socket.IO from CDN
      const script = document.createElement('script');
      script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
      script.onload = () => {
        connectWebSocket();
      };
      script.onerror = () => {
        console.error('Failed to load Socket.IO');
        // Show user-friendly error message
        showWebSocketError(
          'Failed to load real-time notifications. Some features may be unavailable.'
        );
      };
      document.head.appendChild(script);
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
      showWebSocketError('Failed to initialize real-time notifications.');
    }
  }

  function connectWebSocket() {
    try {
      if (!window.io) {
        console.error('Socket.IO not loaded');
        showWebSocketError('Real-time notifications unavailable.');
        return;
      }

      // Connect to WebSocket server
      state.socket = window.io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
      });

      state.socket.on('connect', () => {
        state.isConnected = true;
        if (isDevelopment) {
          console.log('WebSocket connected');
        }
        hideWebSocketError();

        // Authenticate with user ID if available
        const user = getUserFromStorage();
        if (user && user.id) {
          state.socket.emit('auth', { userId: user.id });
        }
      });

      state.socket.on('disconnect', () => {
        state.isConnected = false;
        if (isDevelopment) {
          console.log('WebSocket disconnected');
        }
      });

      state.socket.on('connect_error', error => {
        console.error('WebSocket connection error:', error);
        showWebSocketError('Connection to notification server failed. Retrying...');
      });

      state.socket.on('auth:success', data => {
        if (isDevelopment) {
          console.log('WebSocket authenticated:', data.userId);
        }
      });

      state.socket.on('auth:error', data => {
        console.error('WebSocket auth error:', data.error);
      });

      // Listen for real-time notifications
      // v1 WebSocket server emits 'notification'
      state.socket.on('notification', notification => {
        handleRealtimeNotification(notification);
      });

      // v2 WebSocket server emits 'notification:received'
      state.socket.on('notification:received', notification => {
        handleRealtimeNotification(notification);
      });

      // Listen for auth state changes
      window.addEventListener('auth-state-changed', event => {
        const user = event.detail.user;
        if (user && user.id) {
          if (state.socket && state.socket.connected) {
            state.socket.emit('auth', { userId: user.id });
          }
        } else {
          // User logged out, disconnect
          if (state.socket) {
            state.socket.close();
          }
        }
      });
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
      showWebSocketError('Failed to connect to notification server.');
    }
  }

  // Listen for message notifications from messaging system
  window.addEventListener('messaging:notification', event => {
    const { type, title, message, actionUrl, metadata } = event.detail;

    // Add to notification list if notification system is initialized
    if (state.isInitialized) {
      addMessageNotification({
        type,
        title,
        message,
        actionUrl,
        metadata,
        timestamp: new Date(),
        isRead: false,
      });

      // Update unread count
      state.unreadCount++;
      updateUnreadBadge();

      // Show desktop notification if permitted
      if (state.hasDesktopPermission) {
        showDesktopNotification({ title, message, actionUrl });
      }

      // Play sound if enabled
      if (state.soundEnabled) {
        playNotificationSound();
      }
    }
  });

  // Listen for messenger:notification events dispatched by NotificationBridge.js
  // This bridges the message badge system with the notification dropdown
  window.addEventListener('messenger:notification', event => {
    const { conversationId, message, sender } = event.detail;

    if (state.isInitialized) {
      const senderName = sender?.name || 'Unknown User';
      const messagePreview = message?.content || message?.text || 'New message';
      const actionUrl = conversationId
        ? `/messenger?conversation=${conversationId}`
        : '/messenger';

      addMessageNotification({
        type: 'message',
        title: senderName,
        message: messagePreview,
        actionUrl,
        metadata: conversationId ? { conversationId } : {},
        icon: '💬',
        createdAt: new Date(),
        isRead: false,
      });

      // Update unread count
      state.unreadCount++;
      updateBellBadge();

      // Show desktop notification if permitted
      if (state.hasDesktopPermission) {
        showDesktopNotification({ title: senderName, message: messagePreview, actionUrl });
      }

      // Play sound if enabled
      if (state.soundEnabled) {
        playNotificationSound();
      }
    }
  });

  // Listen for messages being marked as read
  window.addEventListener('messaging:marked-read', async event => {
    const { conversationId } = event.detail;

    // Find and mark related notifications as read
    // Check both conversationId and threadId for compatibility
    const messageNotifications = state.notifications.filter(
      n =>
        n.type === 'message' &&
        (n.metadata?.conversationId === conversationId ||
          n.metadata?.threadId === conversationId) &&
        !n.isRead
    );

    for (const notification of messageNotifications) {
      await markAsRead(notification.id);
    }
  });

  function showWebSocketError(message) {
    // Show a non-intrusive error message
    const errorDiv = document.getElementById('ws-error-message') || document.createElement('div');
    errorDiv.id = 'ws-error-message';
    errorDiv.className = 'ws-error-message';
    errorDiv.textContent = message;
    errorDiv.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(239, 68, 68, 0.95);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      max-width: 300px;
    `;

    if (!document.getElementById('ws-error-message')) {
      document.body.appendChild(errorDiv);
    }
  }

  function hideWebSocketError() {
    const errorDiv = document.getElementById('ws-error-message');
    if (errorDiv) {
      errorDiv.remove();
    }
  }

  // ==========================================
  // NOTIFICATION API
  // ==========================================

  async function fetchNotifications(options = {}) {
    try {
      const query = new URLSearchParams({
        limit: options.limit || 50,
        skip: options.skip || 0,
        unreadOnly: options.unreadOnly || false,
      });

      const response = await fetch(`/api/v1/notifications?${query}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();
      state.notifications = data.notifications;
      state.unreadCount = data.unreadCount;

      updateUI();
      return data;
    } catch (error) {
      console.error('Error fetching notifications:', error);
      return null;
    }
  }

  function getCsrfToken() {
    if (window.__CSRF_TOKEN__) return window.__CSRF_TOKEN__;
    const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function markAsRead(notificationId) {
    try {
      const response = await fetch(`/api/v1/notifications/${notificationId}/read`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
        },
      });

      if (response.ok) {
        // Update local state
        const notification = state.notifications.find(n => n.id === notificationId);
        if (notification) {
          notification.isRead = true;
          notification.readAt = new Date().toISOString();
        }

        state.unreadCount = Math.max(0, state.unreadCount - 1);
        updateUI();
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }

  async function markAllAsRead() {
    try {
      const response = await fetch('/api/v1/notifications/mark-all-read', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
        },
      });

      if (response.ok) {
        // Update all local notifications
        state.notifications.forEach(n => {
          n.isRead = true;
          n.readAt = new Date().toISOString();
        });

        state.unreadCount = 0;
        updateUI();
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }

  async function dismissNotification(notificationId) {
    try {
      const response = await fetch(`/api/v1/notifications/${notificationId}/dismiss`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
        },
      });

      if (response.ok) {
        // Remove from local state
        state.notifications = state.notifications.filter(n => n.id !== notificationId);
        updateUI();
      }
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  }

  async function deleteNotification(notificationId) {
    try {
      const response = await fetch(`/api/v1/notifications/${notificationId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': getCsrfToken(),
        },
      });

      if (response.ok) {
        // Remove from local state
        const notification = state.notifications.find(n => n.id === notificationId);
        if (notification && !notification.isRead) {
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }

        state.notifications = state.notifications.filter(n => n.id !== notificationId);
        updateUI();
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  }

  // ==========================================
  // REAL-TIME NOTIFICATION HANDLING
  // ==========================================

  function handleRealtimeNotification(notification) {
    // Add to state
    state.notifications.unshift(notification);
    state.unreadCount++;

    // Update UI
    updateUI();

    // Show desktop notification if permitted
    if (state.hasDesktopPermission) {
      showDesktopNotification(notification);
    }

    // Play sound if enabled
    if (state.soundEnabled) {
      playNotificationSound();
    }

    // Show in-app toast notification
    showToastNotification(notification);
  }

  /**
   * Add a message notification to the notification list
   * Used for messaging system integration
   */
  function addMessageNotification(notification) {
    // Generate a unique ID if not provided
    if (!notification.id) {
      notification.id = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }

    // Add to state
    state.notifications.unshift(notification);

    // Update UI
    updateUI();

    // Show in-app toast notification
    showToastNotification(notification);

    // Emit event for other components
    window.dispatchEvent(
      new CustomEvent('notification:added', {
        detail: notification,
      })
    );
  }

  /**
   * Update the unread badge count
   */
  function updateUnreadBadge() {
    updateBellBadge();
  }

  // ==========================================
  // DESKTOP NOTIFICATIONS
  // ==========================================

  function requestDesktopPermission() {
    if (!('Notification' in window)) {
      console.log('Desktop notifications not supported');
      return;
    }

    if (Notification.permission === 'granted') {
      state.hasDesktopPermission = true;
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        state.hasDesktopPermission = permission === 'granted';
      });
    }
  }

  function showDesktopNotification(notification) {
    if (!state.hasDesktopPermission) {
      return;
    }

    try {
      const desktopNotif = new Notification(notification.title, {
        body: notification.message,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: notification.id,
        requireInteraction: notification.priority === 'urgent',
        silent: !state.soundEnabled,
      });

      desktopNotif.onclick = () => {
        window.focus();
        if (notification.actionUrl) {
          window.location.href = notification.actionUrl;
        }
        desktopNotif.close();
      };
    } catch (error) {
      console.error('Error showing desktop notification:', error);
    }
  }

  // ==========================================
  // SOUND NOTIFICATIONS
  // ==========================================

  function playNotificationSound() {
    try {
      // Check if notification sounds are enabled (use state as single source of truth)
      if (!state.soundEnabled) {
        return; // Don't play sound if disabled
      }

      // Get volume from settings (default 30%)
      const volumePercent = parseInt(localStorage.getItem('ef_notification_volume') || '30', 10);
      const volume = volumePercent / 100;

      // Create a simple notification sound using Web Audio API
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);

      // Clean up AudioContext after playback to prevent resource leaks
      oscillator.onended = function () {
        audioContext.close();
      };
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  }

  // ==========================================
  // TOAST NOTIFICATIONS
  // ==========================================

  function showToastNotification(notification) {
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.innerHTML = `
      <div class="notification-toast-icon">${notification.icon || '🔔'}</div>
      <div class="notification-toast-content">
        <div class="notification-toast-title">${escapeHtml(notification.title)}</div>
        <div class="notification-toast-message">${escapeHtml(notification.message)}</div>
      </div>
      <button class="notification-toast-close" aria-label="Close">×</button>
    `;

    // Add close handler
    const closeBtn = toast.querySelector('.notification-toast-close');
    closeBtn.addEventListener('click', () => {
      toast.classList.add('notification-toast--hiding');
      setTimeout(() => toast.remove(), 300);
    });

    // Add click handler for whole toast
    toast.addEventListener('click', e => {
      if (e.target === closeBtn) {
        return;
      }

      markAsRead(notification.id);

      if (notification.actionUrl) {
        window.location.href = notification.actionUrl;
      }

      toast.classList.add('notification-toast--hiding');
      setTimeout(() => toast.remove(), 300);
    });

    // Add to page
    let container = document.getElementById('notification-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-toast-container';
      document.body.appendChild(container);
    }

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('notification-toast--hiding');
        setTimeout(() => toast.remove(), 300);
      }
    }, 5000);
  }

  // ==========================================
  // UI UPDATES
  // ==========================================

  function updateUI() {
    updateBellBadge();
    updateDropdown();
  }

  function updateBellBadge() {
    // Support both old and new notification bell IDs
    const badge = document.querySelector('.notification-badge, #ef-notification-badge, .ef-badge');
    if (badge) {
      if (state.unreadCount > 0) {
        badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function updateDropdown() {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) {
      return;
    }

    const list = dropdown.querySelector('.notification-list');
    if (!list) {
      return;
    }

    if (state.notifications.length === 0) {
      list.innerHTML = '<div class="notification-empty">No notifications</div>';
      return;
    }

    list.innerHTML = state.notifications
      .slice(0, 10)
      .map(
        n => `
      <div class="notification-item ${n.isRead ? '' : 'notification-item--unread'}" 
           data-id="${n.id}">
        <div class="notification-item-icon">${n.icon || '🔔'}</div>
        <div class="notification-item-content">
          <div class="notification-item-title">${escapeHtml(n.title)}</div>
          <div class="notification-item-message">${escapeHtml(n.message)}</div>
          <div class="notification-item-time">${formatTimeAgo(n.createdAt)}</div>
        </div>
        ${
          !n.isRead
            ? '<button class="notification-item-mark-read" data-action="mark-read" aria-label="Mark as read">✓</button>'
            : ''
        }
        <button class="notification-item-dismiss" data-action="dismiss" aria-label="Dismiss">×</button>
      </div>
    `
      )
      .join('');

    // Add event listeners
    list.querySelectorAll('.notification-item').forEach(item => {
      const id = item.dataset.id;

      item.addEventListener('click', e => {
        if (e.target.dataset.action) {
          return;
        } // Let button handlers deal with it

        const notification = state.notifications.find(n => n.id === id);
        if (notification) {
          markAsRead(id);
          if (notification.actionUrl) {
            window.location.href = notification.actionUrl;
          }
        }
      });

      const markReadBtn = item.querySelector('[data-action="mark-read"]');
      if (markReadBtn) {
        markReadBtn.addEventListener('click', e => {
          e.stopPropagation();
          markAsRead(id);
        });
      }

      const dismissBtn = item.querySelector('[data-action="dismiss"]');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', e => {
          e.stopPropagation();
          dismissNotification(id);
        });
      }
    });
  }

  function setDropdownOpen(dropdown, isOpen) {
    if (!dropdown) {
      return;
    }

    dropdown.classList.toggle('notification-dropdown--open', isOpen);

    // Some pages render inline style="display:none" and may not include
    // the CSS rule with !important. Keep inline display in sync while still
    // allowing CSS to control preferred layout mode (block/flex).
    if (isOpen) {
      // Let stylesheet decide display first.
      dropdown.style.removeProperty('display');
      // If styles still resolve to hidden, force visible fallback.
      if (window.getComputedStyle(dropdown).display === 'none') {
        dropdown.style.display = 'block';
      }
    } else {
      dropdown.style.display = 'none';
    }
  }

  // ==========================================
  // DROPDOWN TOGGLE
  // ==========================================

  function initDropdown() {
    // Prevent multiple initializations using guard flag
    if (window.__notificationBellInitialized) {
      console.log('Notification bell already initialized');
      return true;
    }

    // Support both old and new notification bell IDs
    const bell =
      document.getElementById('notification-bell') ||
      document.getElementById('ef-notification-btn');
    if (!bell) {
      console.warn('Notification bell button not found');
      return false;
    }

    // Mark initialized only after we have a bell element to bind to.
    window.__notificationBellInitialized = true;

    // Position dropdown below bell with viewport boundary detection
    const positionDropdown = dropdown => {
      // Always get fresh reference to avoid stale DOM reference
      const currentBell =
        document.getElementById('ef-notification-btn') ||
        document.getElementById('notification-bell');
      if (!currentBell) {
        console.warn('Bell not found during positioning');
        // Fallback positioning if bell not found
        dropdown.style.top = '64px';
        dropdown.style.right = '16px';
        return;
      }

      const rect = currentBell.getBoundingClientRect();

      // Fallback positioning if getBoundingClientRect returns 0/0 (detached element)
      if (rect.bottom === 0 && rect.right === 0) {
        console.warn('Bell element appears detached, using fallback positioning');
        dropdown.style.top = '64px';
        dropdown.style.right = '16px';
        return;
      }

      // Calculate initial position below the bell
      let top = rect.bottom + 8;
      let right = window.innerWidth - rect.right;

      // Get dropdown dimensions (may need to show it temporarily to measure)
      const dropdownRect = dropdown.getBoundingClientRect();
      const dropdownWidth = dropdownRect.width || 380; // Default width from CSS
      const dropdownHeight = dropdownRect.height || 500; // Max height from CSS

      // Viewport boundary detection
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Check if dropdown goes off the right edge
      const dropdownLeft = viewportWidth - right - dropdownWidth;
      if (dropdownLeft < 16) {
        // Adjust to keep 16px padding from left edge
        right = viewportWidth - dropdownWidth - 16;
      }

      // Check if dropdown goes off the bottom edge
      if (top + dropdownHeight > viewportHeight - 16) {
        // Position above the bell instead
        top = rect.top - dropdownHeight - 8;

        // If still off screen, position at top with margin
        if (top < 16) {
          top = 16;
        }
      }

      dropdown.style.top = `${top}px`;
      dropdown.style.right = `${right}px`;
    };

    // Find pre-rendered dropdown or create if not found
    let dropdown = document.getElementById('notification-dropdown');
    let needsEventListeners = false;

    if (!dropdown) {
      // Fallback: Create dropdown if not pre-rendered (for backward compatibility)
      console.warn('Notification dropdown not pre-rendered, creating dynamically');
      needsEventListeners = true;
      dropdown = document.createElement('div');
      dropdown.id = 'notification-dropdown';
      dropdown.className = 'notification-dropdown';
      dropdown.innerHTML = `
        <div class="notification-header">
          <h3>Notifications</h3>
          <button class="notification-mark-all" id="notification-mark-all-read" type="button">
            Mark all as read
          </button>
        </div>
        <div class="notification-list"></div>
        <div class="notification-footer">
          <a href="/notifications" class="notification-view-all">View all</a>
        </div>
      `;

      document.body.appendChild(dropdown);
    } else {
      // Pre-rendered dropdown found, just ensure it's properly initialized
      console.log('Using pre-rendered notification dropdown');
      // Mark that we need to attach event listeners
      needsEventListeners = true;
    }

    // Toggle dropdown - Mobile-friendly event handling
    let touchHandled = false;

    const handleBellToggle = e => {
      e.stopPropagation();
      e.preventDefault();

      const isOpening = !dropdown.classList.contains('notification-dropdown--open');
      setDropdownOpen(dropdown, isOpening);

      if (isOpening) {
        positionDropdown(dropdown);
        fetchNotifications();
      }
    };

    // Add both touch and click support for mobile reliability
    bell.addEventListener(
      'touchend',
      e => {
        touchHandled = true;
        handleBellToggle(e);
        // Reset flag after debounce delay to allow click events on non-touch devices
        setTimeout(() => {
          touchHandled = false;
        }, TOUCH_DEBOUNCE_MS);
      },
      { passive: false }
    );

    bell.addEventListener('click', e => {
      // Skip if already handled by touch event
      if (touchHandled) {
        return;
      }
      handleBellToggle(e);
    });

    // Close on outside click (only attach once)
    if (needsEventListeners) {
      document.addEventListener('click', e => {
        // Query bell to check if click is outside
        const currentBell =
          document.getElementById('ef-notification-btn') ||
          document.getElementById('notification-bell');
        if (currentBell && !currentBell.contains(e.target) && !dropdown.contains(e.target)) {
          setDropdownOpen(dropdown, false);
        }
      });

      // Close on escape key
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dropdown.classList.contains('notification-dropdown--open')) {
          setDropdownOpen(dropdown, false);
        }
      });

      // Mark all as read handler
      const markAllBtn = dropdown.querySelector('#notification-mark-all-read');
      if (markAllBtn) {
        markAllBtn.addEventListener('click', markAllAsRead);
      }
    }

    return true;
  }

  // ==========================================
  // UTILITIES
  // ==========================================

  function getUserFromStorage() {
    // Use centralized auth state if available
    const authState = window.__authState || window.AuthStateManager;
    if (authState && typeof authState.getUser === 'function') {
      return authState.getUser();
    }
    // Fallback
    try {
      const userStr = localStorage.getItem('user');
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  }

  async function getCurrentUser() {
    const authState = window.__authState || window.AuthStateManager;

    // Ensure auth state has completed its async initialization before reading user.
    if (authState && typeof authState.init === 'function') {
      try {
        await authState.init();
      } catch (error) {
        console.warn(
          'Notification system: auth state init failed, falling back to localStorage',
          error
        );
      }
    }

    return getUserFromStorage();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) {
      return 'Just now';
    }
    if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86400) {
      return `${Math.floor(seconds / 3600)}h ago`;
    }
    if (seconds < 604800) {
      return `${Math.floor(seconds / 86400)}d ago`;
    }
    return date.toLocaleDateString();
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  async function init() {
    try {
      // Prevent duplicate initialization from multiple script inclusions.
      if (state.isInitialized || state.isInitializing) {
        return;
      }

      state.isInitializing = true;

      const user = await getCurrentUser();
      if (!user) {
        // Not logged in, don't initialize notifications
        console.log('Notification system: User not logged in, skipping initialization');
        state.isInitializing = false;
        return;
      }

      // Initialize dropdown first so click handlers are guaranteed before marking init complete.
      const dropdownInitialized = initDropdown();
      if (!dropdownInitialized) {
        console.warn('Notification system: bell/dropdown not ready, will retry on auth updates');
        state.isInitializing = false;
        return;
      }

      state.isInitialized = true;

      console.log('Notification system: Initializing for user', user.id);

      // Set loading state
      setBellLoadingState(true);

      // Initialize WebSocket
      initWebSocket();

      // Fetch initial notifications
      fetchNotifications()
        .then(() => {
          // Remove loading state after initial fetch
          setBellLoadingState(false);
        })
        .catch(() => {
          // Still remove loading state even on error
          setBellLoadingState(false);
        });

      // Request desktop notification permission after a delay
      setTimeout(() => {
        requestDesktopPermission();
      }, 5000);

      // Expose methods for external use
      window.__notificationSystem = {
        fetch: fetchNotifications,
        markAsRead,
        markAllAsRead,
        dismiss: dismissNotification,
        delete: deleteNotification,
        toggleSound: () => {
          state.soundEnabled = !state.soundEnabled;
          // Sync with localStorage so settings page stays in sync
          localStorage.setItem('ef_notification_sound_enabled', state.soundEnabled);
          return state.soundEnabled;
        },
        // Expose reinit for debugging
        reinit: () => {
          window.__notificationBellInitialized = false;
          initDropdown();
        },
      };

      console.log('Notification system: Initialization complete');

      // Fire custom event to signal that notification system is ready
      window.dispatchEvent(
        new CustomEvent('notification-system-ready', {
          detail: { initialized: true, userId: user.id },
        })
      );
    } catch (error) {
      console.error('Notification system: Initialization failed', error);
      setBellLoadingState(false);
    } finally {
      state.isInitializing = false;
    }
  }

  async function ensureInitializedOnLogin(user) {
    if (!user || state.isInitialized) {
      return;
    }

    await init();
  }

  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // If auth state resolves after this script runs, initialize then.
  window.addEventListener('__auth-state-updated', event => {
    ensureInitializedOnLogin(event.detail?.user);
  });

  // Backward compatibility for any legacy auth event emitters.
  window.addEventListener('auth-state-changed', event => {
    ensureInitializedOnLogin(event.detail?.user);
  });
})();
