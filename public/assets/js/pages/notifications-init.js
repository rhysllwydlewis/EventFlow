(function () {
  'use strict';

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
  function escapeHtml(text) {
    if (!text) {
      return '';
    }
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
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
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
      alert('Failed to mark notification as read. Please try again.');
    }
  }

  async function markAllAsRead() {
    if (state.unreadCount === 0) {
      alert('All notifications are already read.');
      return;
    }

    if (!confirm('Mark all notifications as read?')) {
      return;
    }

    try {
      const response = await fetch('/api/v1/notifications/mark-all-read', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
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
      alert('Failed to mark all as read. Please try again.');
    }
  }

  async function deleteNotification(notificationId) {
    if (!confirm('Delete this notification?')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
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
      alert('Failed to delete notification. Please try again.');
    }
  }

  async function deleteAllNotifications() {
    if (state.notifications.length === 0) {
      alert('No notifications to delete.');
      return;
    }

    if (!confirm('Delete all notifications? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch('/api/v1/notifications', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window.__CSRF_TOKEN__ || '',
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
      alert('Failed to delete all notifications. Please try again.');
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

    item.innerHTML = `
      <div class="notification-item-icon">${icon}</div>
      <div class="notification-item-content">
        <div class="notification-item-title">${title}</div>
        <div class="notification-item-message">${message}</div>
        <div class="notification-item-time">${time}</div>
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

    // Listen for real-time notification events
    window.addEventListener('notification:added', e => {
      // Prepend new notification to the list
      const notification = e.detail;
      state.notifications.unshift(notification);
      if (!notification.isRead) {
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
