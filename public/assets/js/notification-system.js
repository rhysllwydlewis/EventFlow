/**
 * EventFlow Unified Notification System
 * A centralized, glassmorphism-themed notification system
 * @version 2.0.0
 */
'use strict';

(function () {
  // Configuration
  const CONFIG = {
    defaultDuration: 5000,
    animationDuration: 300,
    maxNotifications: 5,
    position: 'top-right',
  };

  /**
   * NotificationSystem - Centralized notification manager
   */
  class NotificationSystem {
    constructor() {
      this.container = null;
      this.notifications = [];
      this.init();
    }

    /**
     * Initialize the notification container
     */
    init() {
      if (this.container) {
        return;
      }

      this.container = document.createElement('div');
      this.container.id = 'eventflow-notification-container';
      this.container.className = 'ef-notification-container';
      this.container.setAttribute('role', 'region');
      this.container.setAttribute('aria-label', 'Notifications');
      this.container.setAttribute('aria-live', 'polite');
      document.body.appendChild(this.container);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(unsafe) {
      if (typeof unsafe !== 'string') {
        return '';
      }
      const div = document.createElement('div');
      div.textContent = unsafe;
      return div.innerHTML;
    }

    /**
     * Get icon for notification type
     */
    getIcon(type) {
      const icons = {
        success:
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        error:
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        warning:
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
        info: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      };
      return icons[type] || icons.info;
    }

    /**
     * Show a notification
     * @param {string} message - The notification message
     * @param {string} type - Type: success, error, warning, info
     * @param {number} duration - Duration in ms (0 for persistent)
     * @returns {HTMLElement} - The notification element
     */
    show(message, type = 'info', duration = null) {
      this.init();

      const actualDuration = duration !== null ? duration : CONFIG.defaultDuration;
      const id = `notification-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      // Create notification element
      const notification = document.createElement('div');
      notification.id = id;
      notification.className = `ef-notification ef-notification--${type}`;
      // `role="alert"` implies aria-live="assertive"; `role="status"` implies
      // aria-live="polite". The container has aria-live="polite" so setting
      // the role alone gives errors the "assertive" semantics they need.
      notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
      notification.setAttribute('aria-atomic', 'true');

      // Icon bubble with glass effect
      const icon = this.getIcon(type);

      // Build notification content
      notification.innerHTML = `
        <div class="ef-notification__icon-bubble">
          ${icon}
        </div>
        <div class="ef-notification__content">
          <span class="ef-notification__message">${this.escapeHtml(message)}</span>
        </div>
        <button class="ef-notification__close" aria-label="Dismiss notification" type="button">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      `;

      // Close button functionality
      const closeBtn = notification.querySelector('.ef-notification__close');
      closeBtn.addEventListener('click', () => {
        this.dismiss(notification);
      });

      // Add to container
      this.container.appendChild(notification);
      this.notifications.push(notification);

      // Trigger slide-in animation
      requestAnimationFrame(() => {
        notification.classList.add('ef-notification--visible');
      });

      // For errors, add shake animation
      if (type === 'error') {
        setTimeout(() => {
          notification.classList.add('ef-notification--shake');
          setTimeout(() => {
            notification.classList.remove('ef-notification--shake');
          }, 500);
        }, 100);
      }

      // Auto-dismiss
      if (actualDuration > 0) {
        setTimeout(() => {
          this.dismiss(notification);
        }, actualDuration);
      }

      // Enforce max notifications
      this.enforceMaxNotifications();

      return notification;
    }

    /**
     * Dismiss a notification
     * @param {HTMLElement} notification - The notification element
     */
    dismiss(notification) {
      if (!notification || !notification.parentNode) {
        return;
      }

      notification.classList.remove('ef-notification--visible');
      notification.classList.add('ef-notification--hiding');

      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
          const index = this.notifications.indexOf(notification);
          if (index > -1) {
            this.notifications.splice(index, 1);
          }
        }
      }, CONFIG.animationDuration);
    }

    /**
     * Enforce maximum number of notifications
     */
    enforceMaxNotifications() {
      if (this.notifications.length > CONFIG.maxNotifications) {
        const toRemove = this.notifications.length - CONFIG.maxNotifications;
        for (let i = 0; i < toRemove; i++) {
          this.dismiss(this.notifications[i]);
        }
      }
    }

    /**
     * Show success notification
     * @param {string} message - The message
     * @param {number} duration - Duration in ms
     */
    success(message, duration = null) {
      return this.show(message, 'success', duration);
    }

    /**
     * Show error notification
     * @param {string} message - The message
     * @param {number} duration - Duration in ms
     */
    error(message, duration = null) {
      return this.show(message, 'error', duration);
    }

    /**
     * Show warning notification
     * @param {string} message - The message
     * @param {number} duration - Duration in ms
     */
    warning(message, duration = null) {
      return this.show(message, 'warning', duration);
    }

    /**
     * Show info notification
     * @param {string} message - The message
     * @param {number} duration - Duration in ms
     */
    info(message, duration = null) {
      return this.show(message, 'info', duration);
    }

    /**
     * Clear all notifications
     */
    clearAll() {
      const notificationsCopy = [...this.notifications];
      notificationsCopy.forEach(notification => {
        this.dismiss(notification);
      });
    }
  }

  // Create global instance
  window.EventFlowNotifications = new NotificationSystem();

  // Initialize container on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.EventFlowNotifications.init();
    });
  }
})();
