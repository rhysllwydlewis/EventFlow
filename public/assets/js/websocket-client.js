/**
 * EventFlow WebSocket Client
 * Real-time notifications and messaging client
 */

'use strict';
(function () {
  // Check if running in development environment
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  class WebSocketClient {
    constructor(options = {}) {
      this.socket = null;
      this.userId = null;
      this.connected = false;
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.baseReconnectDelay = 1000; // Base delay for exponential backoff
      this.reconnectDelay = 1000;
      this.userNotified = false; // Track if user has been notified about connection issues
      this.maxRetriesReached = false; // Track if max retries reached to stop further attempts

      this.options = {
        autoConnect: options.autoConnect !== false,
        onConnect: options.onConnect || null,
        onDisconnect: options.onDisconnect || null,
        onReconnect: options.onReconnect || null,
        onNotification: options.onNotification || null,
        onMessage: options.onMessage || null,
        onError: options.onError || null,
      };

      this.listeners = new Map();

      if (this.options.autoConnect) {
        this.connect();
      }
    }

    connect() {
      if (this.connected) {
        return;
      }

      // Load socket.io from CDN
      if (typeof io === 'undefined') {
        this.loadSocketIO()
          .then(() => {
            this.initConnection();
          })
          .catch(err => {
            console.error('Failed to load socket.io:', err);
            if (this.options.onError) {
              this.options.onError(err);
            }
          });
      } else {
        this.initConnection();
      }
    }

    loadSocketIO() {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.socket.io/4.8.1/socket.io.min.js';
        script.addEventListener('load', resolve);
        script.addEventListener('error', reject);
        document.head.appendChild(script);
      });
    }

    initConnection() {
      // Stop if max retries already reached
      if (this.maxRetriesReached) {
        if (!this.userNotified) {
          this.userNotified = true;
          console.warn('WebSocket: Max retries reached, using polling fallback');
        }
        return;
      }

      try {
        // Explicitly set connection URL to current origin with /socket.io path
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const socketUrl = `${protocol}//${window.location.host}`;

        this.socket = io(socketUrl, {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          reconnection: false, // Disable Socket.IO's built-in retry logic; we implement custom exponential backoff
          timeout: 20000,
          secure: window.location.protocol === 'https:',
        });

        this.setupEventHandlers();
      } catch (err) {
        console.error('WebSocket connection error:', err);
        if (this.options.onError) {
          this.options.onError(err);
        }
      }
    }

    setupEventHandlers() {
      this.socket.on('connect', () => {
        if (isDevelopment) {
          console.log('WebSocket connected');
        }
        const isReconnect = this.reconnectAttempts > 0;
        this.connected = true;
        this.reconnectAttempts = 0; // Reset on successful connection
        this.userNotified = false; // Reset notification flag on successful connection
        this.maxRetriesReached = false; // Reset max retries flag

        // Authenticate if we have user data
        const user = this.getCurrentUser();
        if (user && user.id) {
          this.authenticate(user.id);
        }

        if (this.options.onConnect) {
          this.options.onConnect({ isReconnect });
        }
        if (isReconnect && this.options.onReconnect) {
          this.options.onReconnect();
        }
      });

      this.socket.on('disconnect', reason => {
        // Reduce console noise - only log in development or first disconnect
        if (isDevelopment && this.reconnectAttempts === 0) {
          console.log('WebSocket disconnected:', reason);
        }
        this.connected = false;

        if (this.options.onDisconnect) {
          this.options.onDisconnect(reason);
        }

        // Attempt to reconnect with exponential backoff
        this.attemptReconnect();
      });

      this.socket.on('auth:success', data => {
        if (isDevelopment) {
          console.log('WebSocket authenticated:', data);
        }
        this.userId = data.userId;
      });

      this.socket.on('auth:error', data => {
        console.error('WebSocket auth error:', data.error);
      });

      this.socket.on('notification', notification => {
        console.log('Notification received:', notification);

        // Show toast notification
        this.showNotification(notification);

        if (this.options.onNotification) {
          this.options.onNotification(notification);
        }
      });

      this.socket.on('message:received', data => {
        console.log('Message received:', data);

        if (this.options.onMessage) {
          this.options.onMessage(data);
        }
      });

      this.socket.on('typing:started', data => {
        this.emit('typing:started', data);
      });

      this.socket.on('typing:stopped', data => {
        this.emit('typing:stopped', data);
      });

      this.socket.on('connect_error', _error => {
        this.reconnectAttempts++;

        // Only log first few errors to reduce console spam
        if (this.reconnectAttempts <= 2) {
          console.warn(
            `WebSocket: Connection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} failed, retrying with exponential backoff...`
          );
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.maxRetriesReached = true;

          // Show user-facing notification only once
          if (!this.userNotified) {
            this.userNotified = true;
            console.warn('WebSocket: Max retries reached, using polling fallback');

            // Show a single user-facing notification
            if (typeof showToast === 'function') {
              showToast('Real-time updates temporarily unavailable. Using fallback mode.', 'info');
            } else if (typeof Toast !== 'undefined' && Toast.info) {
              Toast.info('Real-time updates temporarily unavailable. Using fallback mode.', {
                duration: 5000,
              });
            }
          }

          if (this.options.onError) {
            this.options.onError(new Error('Failed to connect after multiple attempts'));
          }
        } else {
          // Attempt reconnect with exponential backoff
          this.attemptReconnect();
        }
      });
    }

    attemptReconnect() {
      // Don't reconnect if max retries reached
      if (this.maxRetriesReached || this.reconnectAttempts >= this.maxReconnectAttempts) {
        return;
      }

      // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, 16s
      // Use reconnectAttempts directly: attempt 1 = 2^0 = 1s, attempt 2 = 2^1 = 2s, etc.
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      if (this.reconnectAttempts < 2) {
        console.log(
          `WebSocket: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        );
      }

      setTimeout(() => {
        if (!this.connected && !this.maxRetriesReached) {
          this.initConnection();
        }
      }, delay);
    }

    authenticate(userId) {
      this.userId = userId;
      if (this.socket && this.connected) {
        this.socket.emit('auth', { userId });
      }
    }

    joinRoom(room) {
      if (this.socket && this.connected) {
        this.socket.emit('join', room);
      }
    }

    leaveRoom(room) {
      if (this.socket && this.connected) {
        this.socket.emit('leave', room);
      }
    }

    sendMessage(threadId, recipientId, message) {
      if (this.socket && this.connected) {
        this.socket.emit('message:send', { threadId, recipientId, message });
      }
    }

    startTyping(threadId, recipientId) {
      if (this.socket && this.connected) {
        this.socket.emit('typing:start', { threadId, recipientId });
      }
    }

    stopTyping(threadId, recipientId) {
      if (this.socket && this.connected) {
        this.socket.emit('typing:stop', { threadId, recipientId });
      }
    }

    showNotification(notification) {
      // Use the existing toast notification system if available
      if (typeof showToast === 'function') {
        showToast(notification.message, notification.type || 'info');
      } else {
        // Fallback to browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(notification.title || 'EventFlow', {
            body: notification.message,
            icon: '/favicon.svg',
          });
        }
      }
    }

    getCurrentUser() {
      // Use centralized auth state if available
      const authState = window.__authState || window.AuthStateManager;
      if (authState && typeof authState.getUser === 'function') {
        return authState.getUser();
      }
      // Fallback for backwards compatibility
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          return JSON.parse(userStr);
        }
      } catch (err) {
        console.error('Error getting current user:', err);
      }
      return null;
    }

    on(event, callback) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push(callback);
    }

    off(event, callback) {
      if (this.listeners.has(event)) {
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index !== -1) {
          callbacks.splice(index, 1);
        }
      }
    }

    emit(event, data) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).forEach(callback => {
          try {
            callback(data);
          } catch (err) {
            console.error(`Error in event listener for ${event}:`, err);
          }
        });
      }
    }

    disconnect() {
      if (this.socket) {
        this.socket.disconnect();
        this.connected = false;
      }
    }

    requestNotificationPermission() {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          console.log('Notification permission:', permission);
        });
      }
    }
  }

  window.WebSocketClient = WebSocketClient;

  // Export for use in modules
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketClient;
  }
})();
