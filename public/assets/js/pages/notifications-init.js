'use strict';
(function () {
  // ==========================================
  // STATE
  // ==========================================
  const state = {
    notifications: [],
    currentFilter: 'all',
    limit: 50,
    skip: 0,
    hasMore: false,
    isLoading: false,
    unreadCount: 0,
  };

  // ==========================================
  // AUTHENTICATION CHECK
  // ==========================================
  async function checkAuthentication() {
    try {
      const response = await fetch('/api/v1/auth/me', {
        credentials: 'include',
      });

      if (!response.ok) {
        // User not authenticated, redirect to auth page
        window.location.href = `/auth?redirect=${encodeURIComponent('/notifications')}`;
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking authentication:', error);
      window.location.href = `/auth?redirect=${encodeURIComponent('/notifications')}`;
      return false;
    }
  }

  // ==========================================
  // UTILITY FUNCTIONS
  // ==========================================

  function getCsrfToken() {
    if (window.EventFlowCsrf && typeof window.EventFlowCsrf.get === 'function') {
      return window.EventFlowCsrf.get();
    }
    return window.__CSRF_TOKEN__ || '';
  }

  function upsertNotification(notification) {
    const before = state.notifications.length;
    if (window.EventFlowNotificationDedupe) {
      state.notifications = window.EventFlowNotificationDedupe.upsert(
        state.notifications,
        notification
      );
      window.EventFlowNotificationDedupe.remember(notification);
      return state.notifications.length > before;
    }

    if (
      window.EventFlowNotificationState &&
      typeof window.EventFlowNotificationState.upsertNotification === 'function'
    ) {
      state.notifications = window.EventFlowNotificationState.upsertNotification(
        state.notifications,
        notification
      );
      return state.notifications.length > before;
    }

    state.notifications.unshift(notification);
    return true;
  }

  function escapeHtml(text) {
    if (!text) {
      return '';
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show an inline toast message (top-right) — replaces bare alert() calls.
   * Uses EventFlowNotifications if available; falls back to a simple DOM toast.
   */
  function showToastError(message) {
    if (
      window.NotificationDispatcher &&
      typeof window.NotificationDispatcher.error === 'function'
    ) {
      window.NotificationDispatcher.error(message);
    } else {
      _showSimpleToast(message, '#ef4444');
    }
  }

  function showToastInfo(message) {
    if (window.NotificationDispatcher && typeof window.NotificationDispatcher.info === 'function') {
      window.NotificationDispatcher.info(message);
    } else {
      _showSimpleToast(message, '#0B8073');
    }
  }

  function _showSimpleToast(message, color) {
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.className = 'notif-toast-inner';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 350);
    }, 3500);
  }

  /**
   * Promise-based confirm dialog using a lightweight in-page modal.
   * Replaces bare confirm() calls so the UI doesn't block the main thread.
   */
  function showConfirmDialog(message) {
    return new Promise(resolve => {
      // Remove any existing confirm dialog and its Escape handler
      const existing = document.getElementById('_ef_confirm_dialog');
      if (existing) {
        existing.remove();
      }
      if (window.__efConfirmEscHandler) {
        document.removeEventListener('keydown', window.__efConfirmEscHandler);
        window.__efConfirmEscHandler = null;
      }

      const overlay = document.createElement('div');
      overlay.id = '_ef_confirm_dialog';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Confirm action');
      overlay.className = 'notif-confirm-overlay';

      overlay.innerHTML = `
        <div style="background:#fff;border-radius:10px;max-width:400px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,0.2);padding:1.5rem;font-family:inherit;">
          <p style="margin:0 0 1.25rem;font-size: 0.875rem;color:#111827;">${escapeHtml(message)}</p>
          <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
            <button type="button" id="_ef_confirm_cancel" style="padding:0.5rem 1.25rem;border-radius:6px;border:1px solid #e5e7eb;background:#fff;color:#374151;cursor:pointer;font-size:0.875rem;">Cancel</button>
            <button type="button" id="_ef_confirm_ok" style="padding:0.5rem 1.25rem;border-radius:6px;border:none;background:#0B8073;color:#fff;cursor:pointer;font-size:0.875rem;font-weight:600;">Confirm</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const cleanup = val => {
        overlay.remove();
        document.removeEventListener('keydown', handleEsc);
        window.__efConfirmEscHandler = null;
        resolve(val);
      };
      function handleEsc(e) {
        if (e.key === 'Escape') {
          cleanup(false);
        }
      }
      window.__efConfirmEscHandler = handleEsc;
      document.addEventListener('keydown', handleEsc);
      overlay.querySelector('#_ef_confirm_cancel').addEventListener('click', () => cleanup(false));
      overlay.querySelector('#_ef_confirm_ok').addEventListener('click', () => cleanup(true));
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          cleanup(false);
        }
      });
      overlay.querySelector('#_ef_confirm_ok').focus();
    });
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
    return date.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  }

  function formatAbsoluteTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/London',
    });
  }

  function getNotificationIcon(type) {
    const icons = {
      message: '💬',
      enquiry: '📧',
      system: '⚙️',
      alert: '⚠️',
      success: '✅',
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
    };
    return icons[type] || '🔔';
  }

  // ==========================================
  // API FUNCTIONS
  // ==========================================
  async function fetchNotifications(append = false, retryCount = 0) {
    if (state.isLoading) {
      return;
    }

    state.isLoading = true;
    showLoading(!append);

    try {
      // Build query params based on current filter
      const params = new URLSearchParams({
        limit: state.limit,
        skip: append ? state.skip : 0,
      });

      // Note: Backend only supports unreadOnly filter, not readOnly.
      // For 'read' and 'all' filters, we fetch all notifications and filter client-side for 'read'.
      // This is acceptable as most users have a manageable number of read notifications.
      if (state.currentFilter === 'unread') {
        params.set('unreadOnly', 'true');
      }

      const response = await fetch(`/api/v1/notifications?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 503 && retryCount < 3) {
          state.isLoading = false;
          const delay = Math.pow(2, retryCount + 1) * 1000;
          console.warn(
            `Notifications: DB not ready (503), retrying in ${delay / 1000}s (attempt ${retryCount + 1}/3)`
          );
          setTimeout(() => fetchNotifications(append, retryCount + 1), delay);
          return;
        }
        throw new Error(`Failed to fetch notifications (HTTP ${response.status})`);
      }

      const data = await response.json();

      if (append) {
        state.notifications = [...state.notifications, ...data.notifications];
        state.skip += data.notifications.length;
      } else {
        state.notifications = data.notifications;
        state.skip = data.notifications.length;
      }

      state.unreadCount = data.unreadCount || 0;
      state.hasMore = data.notifications.length === state.limit;

      renderNotifications();
      hideLoading();
      hideError();
    } catch (error) {
      console.error('Error fetching notifications:', error);
      showError();
      hideLoading();
    } finally {
      state.isLoading = false;
    }
  }

  async function markAsRead(notificationId) {
    try {
      const response = await fetch(`/api/v1/notifications/${notificationId}/read`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to mark notification as read');
      }

      // Update local state
      const notification = state.notifications.find(
        n => n._id === notificationId || n.id === notificationId
      );
      if (notification) {
        notification.isRead = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
        renderNotifications();
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
      showToastError('Failed to mark notification as read. Please try again.');
    }
  }

  async function markAllAsRead() {
    if (state.unreadCount === 0) {
      showToastInfo('All notifications are already read.');
      return;
    }

    const confirmed = await showConfirmDialog('Mark all notifications as read?');
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch('/api/v1/notifications/mark-all-read', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to mark all as read');
      }

      // Update local state
      state.notifications.forEach(n => {
        n.isRead = true;
      });
      state.unreadCount = 0;
      renderNotifications();
    } catch (error) {
      console.error('Error marking all as read:', error);
      showToastError('Failed to mark all as read. Please try again.');
    }
  }

  async function deleteNotification(notificationId) {
    const confirmed = await showConfirmDialog('Delete this notification?');
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete notification');
      }

      // Remove from local state
      const notification = state.notifications.find(
        n => n._id === notificationId || n.id === notificationId
      );
      if (notification && !notification.isRead) {
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
      state.notifications = state.notifications.filter(
        n => n._id !== notificationId && n.id !== notificationId
      );
      state.skip = Math.max(0, state.skip - 1);
      renderNotifications();
    } catch (error) {
      console.error('Error deleting notification:', error);
      showToastError('Failed to delete notification. Please try again.');
    }
  }

  async function deleteAllNotifications() {
    if (state.notifications.length === 0) {
      showToastInfo('No notifications to delete.');
      return;
    }

    const confirmed = await showConfirmDialog(
      'Delete all notifications? This action cannot be undone.'
    );
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch('/api/v1/notifications', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete all notifications');
      }

      // Clear local state
      state.notifications = [];
      state.unreadCount = 0;
      state.skip = 0;
      state.hasMore = false;
      renderNotifications();
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      showToastError('Failed to delete all notifications. Please try again.');
    }
  }

  // ==========================================
  // RENDERING FUNCTIONS
  // ==========================================
  function renderNotifications() {
    const container = document.getElementById('notifications-container');
    const loading = document.getElementById('notifications-loading');
    const empty = document.getElementById('notifications-empty');
    const loadMoreContainer = document.getElementById('load-more-container');

    // Hide loading and empty states
    loading.style.display = 'none';
    empty.style.display = 'none';

    // Remove existing notification items (keep loading and empty states)
    const existingItems = container.querySelectorAll('.notification-item');
    existingItems.forEach(item => item.remove());

    // Filter notifications based on current filter
    let filteredNotifications = state.notifications.filter(n => !n.isDismissed);
    if (state.currentFilter === 'read') {
      filteredNotifications = filteredNotifications.filter(n => n.isRead);
    } else if (state.currentFilter === 'unread') {
      // Backend already filters via unreadOnly param; apply client-side as well for consistency.
      filteredNotifications = filteredNotifications.filter(n => !n.isRead);
    }
    // 'all' shows all non-dismissed notifications

    if (filteredNotifications.length === 0) {
      empty.style.display = 'block';
      loadMoreContainer.style.display = 'none';
      return;
    }

    // Render notification items
    filteredNotifications.forEach(notification => {
      const item = createNotificationElement(notification);
      container.appendChild(item);
    });

    // Show/hide load more button
    // Note: For 'read' filter, pagination is disabled because we do client-side filtering.
    // The backend doesn't support a readOnly parameter, so we fetch all notifications
    // and filter them here. This means "load more" would fetch duplicates.
    // This is an acceptable tradeoff for the current implementation.
    if (state.hasMore && state.currentFilter !== 'read') {
      loadMoreContainer.style.display = 'block';
    } else {
      loadMoreContainer.style.display = 'none';
    }
  }

  function createNotificationElement(notification) {
    const item = document.createElement('div');
    item.className = `notification-item${!notification.isRead ? ' notification-item--unread' : ''}`;
    item.setAttribute('data-id', notification._id || notification.id);

    const icon = getNotificationIcon(notification.type);
    const title = escapeHtml(notification.title);
    const message = escapeHtml(notification.message);
    const time = formatTimeAgo(notification.createdAt);
    const fullTime = formatAbsoluteTime(notification.createdAt);

    item.innerHTML = `
      <div class="notification-item-icon">${icon}</div>
      <div class="notification-item-content">
        <div class="notification-item-title">${title}</div>
        <div class="notification-item-message">${message}</div>
        <time class="notification-item-time" datetime="${escapeHtml(notification.createdAt || '')}" title="${escapeHtml(fullTime)}">${time}</time>
      </div>
      <div class="notification-item-actions">
        ${
          !notification.isRead
            ? `
          <button 
            class="notification-item-mark-read" 
            title="Mark as read"
            aria-label="Mark as read"
          >✓</button>
        `
            : ''
        }
        <button 
          class="notification-item-dismiss" 
          title="Delete"
          aria-label="Delete notification"
        >×</button>
      </div>
    `;

    // Click handler for notification item (if has actionUrl)
    if (notification.actionUrl) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', e => {
        // Don't navigate if clicking on action buttons
        if (e.target.closest('.notification-item-actions')) {
          return;
        }

        // Mark as read and navigate
        if (!notification.isRead) {
          markAsRead(notification._id || notification.id);
        }
        window.location.href = notification.actionUrl;
      });
    }

    // Mark as read button
    const markReadBtn = item.querySelector('.notification-item-mark-read');
    if (markReadBtn) {
      markReadBtn.addEventListener('click', e => {
        e.stopPropagation();
        markAsRead(notification._id || notification.id);
      });
    }

    // Delete button
    const dismissBtn = item.querySelector('.notification-item-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', e => {
        e.stopPropagation();
        deleteNotification(notification._id || notification.id);
      });
    }

    return item;
  }

  function showLoading(fullPage = true) {
    if (fullPage) {
      const loading = document.getElementById('notifications-loading');
      loading.style.display = 'block';
    }
  }

  function hideLoading() {
    const loading = document.getElementById('notifications-loading');
    loading.style.display = 'none';
  }

  function showError() {
    const error = document.getElementById('notifications-error');
    error.style.display = 'block';
  }

  function hideError() {
    const error = document.getElementById('notifications-error');
    error.style.display = 'none';
  }

  // ==========================================
  // EVENT HANDLERS
  // ==========================================
  function setupEventListeners() {
    // Filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.getAttribute('data-filter');

        // Update active state
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update state and fetch
        state.currentFilter = filter;
        state.skip = 0;
        fetchNotifications(false);
      });
    });

    // Mark all as read button
    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    markAllReadBtn.addEventListener('click', markAllAsRead);

    // Delete all button
    const deleteAllBtn = document.getElementById('delete-all-btn');
    deleteAllBtn.addEventListener('click', deleteAllNotifications);

    // Load more button
    const loadMoreBtn = document.getElementById('load-more-btn');
    loadMoreBtn.addEventListener('click', () => {
      fetchNotifications(true);
    });

    const retryBtn = document.getElementById('notifications-retry-btn');
    if (retryBtn) {
      retryBtn.dataset.bound = '1';
      retryBtn.addEventListener('click', () => fetchNotifications(false));
    }

    // Listen for real-time notification events
    window.addEventListener('notification:added', e => {
      // Upsert new notification so realtime + refresh echoes do not duplicate it.
      const notification = e.detail;
      const added = upsertNotification(notification);
      if (added && !notification.isRead) {
        state.unreadCount++;
      }
      renderNotifications();
    });
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================
  async function init() {
    // Check authentication first
    const isAuthenticated = await checkAuthentication();
    if (!isAuthenticated) {
      return;
    }

    // Setup event listeners
    setupEventListeners();

    // Fetch initial notifications
    await fetchNotifications(false);
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
