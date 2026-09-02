/**
 * Supplier Dashboard WebSocket Notifications
 * Handles real-time enquiry notifications via WebSocket
 * Extracted from inline script to comply with CSP directive
 */

'use strict';
(function () {
  let ws = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_RECONNECT_DELAY = 3000;
  const originalTitle = document.title;
  let enquiryCount = 0;
  let fallbackNotificationShown = false;

  // Show user-facing notification when real-time is unavailable
  function showFallbackNotification() {
    if (fallbackNotificationShown) {
      return;
    }
    fallbackNotificationShown = true;

    if (typeof Toast !== 'undefined' && Toast.info) {
      Toast.info(
        'Real-time notifications temporarily unavailable. Refresh page to see new enquiries.',
        {
          duration: 8000,
        }
      );
    }
  }

  function initWebSocket() {
    if (typeof WebSocket === 'undefined') {
      if (reconnectAttempts === 0) {
        console.info('WebSocket not supported in this browser');
        showFallbackNotification();
      }
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = function () {
        if (reconnectAttempts > 0) {
          console.info('WebSocket reconnected successfully');
        }
        reconnectAttempts = 0;
        fallbackNotificationShown = false;

        const user = window.AuthStateManager?.getUser?.();
        if (user?.uid) {
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              channel: 'enquiries',
              userId: user.uid,
            })
          );
        }
      };

      ws.onmessage = function (event) {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'new_enquiry') {
            handleNewEnquiry(data);
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e);
        }
      };

      ws.onerror = function () {
        // Only log once per connection attempt
        if (reconnectAttempts === 0) {
          console.warn('WebSocket connection failed');
        }
      };

      ws.onclose = function () {
        attemptReconnect();
      };
    } catch (error) {
      if (reconnectAttempts === 0) {
        console.error('Failed to create WebSocket:', error);
      }
      attemptReconnect();
    }
  }

  function attemptReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;

      // Exponential backoff with jitter
      const jitter = Math.random() * 1000;
      const delay = Math.min(
        BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1) + jitter,
        30000
      );

      // Only log every 3rd attempt to reduce noise
      if (reconnectAttempts % 3 === 1) {
        console.info(
          `Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
        );
      }

      setTimeout(initWebSocket, delay);
    } else {
      // Max attempts reached - show user notification
      console.warn(
        'WebSocket connection failed after maximum attempts. Real-time updates unavailable.'
      );
      showFallbackNotification();
    }
  }

  function handleNewEnquiry(data) {
    enquiryCount++;

    updateBadge();

    if ('Notification' in window && Notification.permission === 'granted') {
      showDesktopNotification(data);
    } else if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showDesktopNotification(data);
        }
      });
    }

    playNotificationSound();
    updateTabTitle();
  }

  function updateBadge() {
    const badge =
      document.getElementById('enquiry-badge') ||
      document.querySelector('[data-enquiry-badge]') ||
      document.getElementById('ef-notification-badge');

    if (badge) {
      if (enquiryCount > 0) {
        badge.textContent = enquiryCount > 99 ? '99+' : enquiryCount.toString();
        badge.style.display = 'flex';

        badge.classList.add('badge-pulse');
        setTimeout(() => badge.classList.remove('badge-pulse'), 300);
      } else {
        badge.textContent = '';
        badge.style.display = 'none';
      }
    }
  }

  function showDesktopNotification(data) {
    const notification = new Notification('New Enquiry', {
      body: data.message || 'You have a new customer enquiry',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: `enquiry-${Date.now()}`,
    });

    notification.onclick = function () {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 10000);
  }

  function playNotificationSound() {
    try {
      // Check if notification sounds are enabled
      const soundEnabled = localStorage.getItem('ef_notification_sound_enabled');
      if (soundEnabled === 'false') {
        return; // Don't play sound if disabled
      }

      // Get volume from settings (default 30%)
      const volumePercent = parseInt(localStorage.getItem('ef_notification_volume') || '30', 10);
      const volume = volumePercent / 100;

      // Create notification sound using Web Audio API
      // This approach is consistent with public/assets/js/notifications.js
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // 800Hz sine wave (pleasant notification tone)
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      // Volume control with fade out
      gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      // Play for 0.5 seconds
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

  function updateTabTitle() {
    document.title = `(${enquiryCount}) ${originalTitle}`;
  }

  window.addEventListener('focus', () => {
    enquiryCount = 0;
    document.title = originalTitle;
    updateBadge();
  });

  // LEGACY WEBSOCKET CODE - DISABLED
  // WebSocket connections are now handled by Messenger v4 (MessengerSocket.js).
  // This legacy code is preserved but disabled to prevent conflicts.
  // If you need to re-enable it, uncomment the lines below.
  /*
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWebSocket);
  } else {
    initWebSocket();
  }
  
  window.addEventListener('beforeunload', function() {
    if (ws) {
      ws.close();
    }
  });
  */
})();
