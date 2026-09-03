/**
 * Offline Message Queue Manager
 * Handles message queuing, retry logic, and localStorage persistence
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  class OfflineQueueManager {
    constructor() {
      this.storageKey = 'eventflow_message_queue';
      this.retryIntervals = [2000, 4000, 8000, 16000, 30000]; // ms
      this.maxRetries = 5;
      this.processing = false;
      this.apiVersion = window.EVENTFLOW_API_VERSION || 'v2';
    }

    /**
     * Initialize queue manager
     */
    init() {
      // Load queued messages from localStorage
      this.loadQueue();

      // Listen for online/offline events
      window.addEventListener('online', () => this.onOnline());
      window.addEventListener('offline', () => this.onOffline());

      // Process queue on startup if online
      if (navigator.onLine) {
        this.processQueue();
      }

      // Set up periodic queue check (every 30 seconds)
      setInterval(() => {
        if (navigator.onLine && !this.processing) {
          this.processQueue();
        }
      }, 30000);

      if (isDevelopment) {
        console.log('✅ Offline queue manager initialized');
      }
    }

    /**
     * Load queue from localStorage
     */
    loadQueue() {
      try {
        const data = localStorage.getItem(this.storageKey);
        return data ? JSON.parse(data) : [];
      } catch (error) {
        console.error('Failed to load queue from localStorage:', error);
        return [];
      }
    }

    /**
     * Save queue to localStorage
     */
    saveQueue(queue) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(queue));
      } catch (error) {
        console.error('Failed to save queue to localStorage:', error);
      }
    }

    /**
     * Add message to queue
     */
    async queueMessage(message) {
      const queue = this.loadQueue();

      const queueEntry = {
        id: this.generateId(),
        message,
        retryCount: 0,
        status: 'pending',
        createdAt: new Date().toISOString(),
        lastAttempt: null,
        nextRetry: new Date().toISOString(),
        error: null,
      };

      queue.push(queueEntry);
      this.saveQueue(queue);

      // Update UI
      this.updateMessageStatus(message.tempId || queueEntry.id, 'sending');

      // Try to send immediately if online
      if (navigator.onLine) {
        await this.processQueue();
      }

      return queueEntry.id;
    }

    /**
     * Process queue - send pending messages
     */
    async processQueue() {
      if (this.processing) {
        return;
      }

      this.processing = true;
      const queue = this.loadQueue();
      const now = Date.now();

      for (let i = queue.length - 1; i >= 0; i--) {
        const entry = queue[i];

        // Skip if not ready for retry
        const nextRetry = new Date(entry.nextRetry).getTime();
        if (entry.status === 'pending' && nextRetry > now) {
          continue;
        }

        // Skip if max retries exceeded
        if (entry.retryCount >= this.maxRetries) {
          entry.status = 'failed';
          this.updateMessageStatus(entry.id, 'failed', entry.error);
          continue;
        }

        // Try to send
        entry.status = 'sending';
        entry.lastAttempt = new Date().toISOString();
        this.saveQueue(queue);

        try {
          await this.sendMessage(entry.message);

          // Success - remove from queue
          queue.splice(i, 1);
          this.updateMessageStatus(entry.id, 'sent');
        } catch (error) {
          // Failed - update retry info
          entry.retryCount++;
          entry.error = error.message;
          entry.status = 'pending';

          // Calculate next retry time
          const retryInterval =
            this.retryIntervals[Math.min(entry.retryCount - 1, this.retryIntervals.length - 1)];
          entry.nextRetry = new Date(Date.now() + retryInterval).toISOString();

          this.updateMessageStatus(entry.id, 'retrying', error.message, entry.retryCount);
        }
      }

      this.saveQueue(queue);
      this.processing = false;
    }

    /**
     * Send message via API
     */
    async sendMessage(message) {
      const token = this.getAuthToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/${this.apiVersion}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send message');
      }

      return response.json();
    }

    /**
     * Retry failed message manually
     */
    async retryMessage(queueId) {
      const queue = this.loadQueue();
      const entry = queue.find(e => e.id === queueId);

      if (!entry) {
        console.error('Queue entry not found:', queueId);
        return;
      }

      // Reset retry info
      entry.retryCount = 0;
      entry.status = 'pending';
      entry.nextRetry = new Date().toISOString();
      entry.error = null;

      this.saveQueue(queue);
      await this.processQueue();
    }

    /**
     * Remove message from queue
     */
    removeMessage(queueId) {
      const queue = this.loadQueue();
      const index = queue.findIndex(e => e.id === queueId);

      if (index !== -1) {
        queue.splice(index, 1);
        this.saveQueue(queue);
        this.updateMessageStatus(queueId, 'removed');
      }
    }

    /**
     * Get queued messages count
     */
    getQueuedCount() {
      const queue = this.loadQueue();
      return queue.filter(e => e.status !== 'sent').length;
    }

    /**
     * Update message status in UI
     */
    updateMessageStatus(messageId, status, error = null, retryCount = 0) {
      // Emit custom event for UI to listen
      const event = new CustomEvent('message-queue-status', {
        detail: {
          messageId,
          status,
          error,
          retryCount,
        },
      });
      window.dispatchEvent(event);

      // Update message element if exists
      const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageEl) {
        const statusEl = messageEl.querySelector('.message-status');
        if (statusEl) {
          statusEl.textContent = this.getStatusText(status, retryCount);
          statusEl.className = `message-status status-${status}`;

          if (error) {
            statusEl.title = error;
          }
        }
      }
    }

    /**
     * Get status text for display
     */
    getStatusText(status, retryCount = 0) {
      const statusMap = {
        pending: 'Queued',
        sending: 'Sending...',
        sent: 'Sent',
        failed: 'Failed',
        retrying: `Retrying (${retryCount}/${this.maxRetries})`,
        removed: 'Cancelled',
      };
      return statusMap[status] || status;
    }

    /**
     * Handle online event
     */
    onOnline() {
      if (isDevelopment) {
        console.log('🌐 Connection restored');
      }
      this.updateConnectionStatus(true);
      this.processQueue();
    }

    /**
     * Handle offline event
     */
    onOffline() {
      if (isDevelopment) {
        console.log('📴 Connection lost');
      }
      this.updateConnectionStatus(false);
    }

    /**
     * Update connection status indicator
     */
    updateConnectionStatus(isOnline) {
      const indicator = document.getElementById('connection-status');
      if (indicator) {
        indicator.className = isOnline ? 'online' : 'offline';
        indicator.textContent = isOnline ? 'Online' : 'Offline';
      }

      // Show/hide queue indicator
      const queueCount = this.getQueuedCount();
      const queueIndicator = document.getElementById('queue-indicator');
      if (queueIndicator) {
        if (queueCount > 0) {
          queueIndicator.textContent = `${queueCount} message${queueCount > 1 ? 's' : ''} queued`;
          queueIndicator.style.display = 'block';
        } else {
          queueIndicator.style.display = 'none';
        }
      }
    }

    /**
     * Get auth token
     */
    getAuthToken() {
      // Try multiple sources
      return (
        localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || window.authToken
      );
    }

    /**
     * Generate unique ID
     */
    generateId() {
      return `queue_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Clear all queued messages
     */
    clearQueue() {
      localStorage.removeItem(this.storageKey);
      this.updateConnectionStatus(navigator.onLine);
    }
  }

  // Create global instance
  window.offlineQueueManager = new OfflineQueueManager();

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.offlineQueueManager.init();
    });
  } else {
    window.offlineQueueManager.init();
  }

  // Export for module systems
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OfflineQueueManager;
  }
})();
