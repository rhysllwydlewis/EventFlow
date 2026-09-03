(function initMessagingNotificationsStabilisation(globalScope) {
  'use strict';

  if (!globalScope || globalScope.__efMessagingNotificationsStabilised) {
    return;
  }
  globalScope.__efMessagingNotificationsStabilised = true;

  const DEBUG =
    globalScope.DEBUG === true ||
    (globalScope.location && new URLSearchParams(globalScope.location.search).has('debug')) ||
    ['localhost', '127.0.0.1'].includes(globalScope.location && globalScope.location.hostname);

  function debugLog(...args) {
    if (DEBUG && globalScope.console && typeof globalScope.console.log === 'function') {
      globalScope.console.log('[MessagingNotifications]', ...args);
    }
  }

  function readCookie(name) {
    if (!name || typeof document === 'undefined') {
      return null;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getCsrfToken() {
    if (globalScope.EventFlowCsrf && typeof globalScope.EventFlowCsrf.get === 'function') {
      return globalScope.EventFlowCsrf.get();
    }
    return globalScope.__CSRF_TOKEN__ || readCookie('csrf') || readCookie('csrfToken') || '';
  }

  function ensureCsrfGlobal() {
    const token = getCsrfToken();
    if (token && !globalScope.__CSRF_TOKEN__) {
      globalScope.__CSRF_TOKEN__ = token;
    }
  }

  function isNotificationWrite(url, options) {
    const method = String((options && options.method) || 'GET').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return false;
    }
    let pathname = '';
    try {
      pathname = new URL(String(url || ''), globalScope.location && globalScope.location.origin)
        .pathname;
    } catch {
      pathname = String(url || '').split('?')[0];
    }
    return /^\/api\/(v1\/)?notifications(?:\/|$)/.test(pathname);
  }

  function patchFetchForNotificationCsrf() {
    if (!globalScope.fetch || globalScope.fetch.__efNotificationCsrfPatched) {
      return;
    }
    const originalFetch = globalScope.fetch.bind(globalScope);

    function patchedFetch(input, init = {}) {
      let nextInit = init;
      if (isNotificationWrite(typeof input === 'string' ? input : input && input.url, init)) {
        const headers = new Headers(init.headers || (input && input.headers) || {});
        if (!headers.get('X-CSRF-Token')) {
          headers.set('X-CSRF-Token', getCsrfToken());
        }
        nextInit = { ...init, headers };
      }
      return originalFetch(input, nextInit);
    }

    patchedFetch.__efNotificationCsrfPatched = true;
    globalScope.fetch = patchedFetch;
  }

  function getNotificationKey(notification) {
    if (
      globalScope.EventFlowNotificationState &&
      typeof globalScope.EventFlowNotificationState.getNotificationKey === 'function'
    ) {
      return globalScope.EventFlowNotificationState.getNotificationKey(notification);
    }
    if (!notification || typeof notification !== 'object') {
      return null;
    }
    if (notification.id) {
      return `id:${notification.id}`;
    }
    if (notification._id) {
      return `id:${notification._id}`;
    }
    const meta = notification.metadata || {};
    if (meta.messageId || notification.messageId) {
      return `message:${meta.messageId || notification.messageId}`;
    }
    if (meta.conversationId && (meta.senderId || notification.senderId) && notification.createdAt) {
      return `conversation:${meta.conversationId}:${meta.senderId || notification.senderId}:${notification.createdAt}`;
    }
    return null;
  }

  function updateBadges(count) {
    if (
      globalScope.EventFlowNotificationState &&
      typeof globalScope.EventFlowNotificationState.updateBadges === 'function'
    ) {
      globalScope.EventFlowNotificationState.updateBadges(count);
      return;
    }
    const safeCount = Math.max(0, Number(count) || 0);
    const selectors = [
      '#ef-notification-badge',
      '#notification-badge',
      '#headerNotificationBadge',
      '#notificationBadge',
      '#ef-bottom-dashboard-badge',
      '.notification-badge',
      '.messenger-unread-badge',
    ];
    const seen = new Set();
    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (seen.has(el)) {
          return;
        }
        seen.add(el);
        if (safeCount > 0) {
          el.textContent = safeCount > 99 ? '99+' : String(safeCount);
          el.style.display = '';
          el.setAttribute(
            'aria-label',
            `${safeCount} unread notification${safeCount === 1 ? '' : 's'}`
          );
        } else {
          el.textContent = '';
          el.style.display = 'none';
          el.removeAttribute('aria-label');
        }
      });
    });
  }

  function installNotificationDedupe() {
    const seenKeys = new Set();
    const maxKeys = 250;

    function remember(key) {
      if (!key) {
        return;
      }
      if (!seenKeys.has(key) && seenKeys.size >= maxKeys) {
        seenKeys.delete(seenKeys.values().next().value);
      }
      seenKeys.add(key);
    }

    function handleRealtimeNotification(event) {
      const detail = event && (event.detail || event);
      remember(getNotificationKey(detail));
    }

    globalScope.EventFlowNotificationDedupe = {
      has(notification) {
        const key = getNotificationKey(notification);
        return Boolean(key && seenKeys.has(key));
      },
      remember(notification) {
        remember(getNotificationKey(notification));
      },
      upsert(list, notification) {
        const helpers = globalScope.EventFlowNotificationState;
        if (helpers && typeof helpers.upsertNotification === 'function') {
          return helpers.upsertNotification(list, notification);
        }
        const existing = Array.isArray(list) ? list : [];
        return [notification, ...existing];
      },
    };

    [
      'notification:received',
      'notification',
      'messenger:notification',
      'messaging:notification',
    ].forEach(eventName => {
      globalScope.addEventListener(eventName, handleRealtimeNotification);
    });
  }

  function patchDesktopNotificationPermission() {
    // Prevent repeated permission nags. Permission prompts still happen from a
    // user gesture when explicitly requested by the existing bell click flow.
    globalScope.__efNotificationPermissionAsked =
      globalScope.__efNotificationPermissionAsked || false;
    globalScope.addEventListener(
      'click',
      event => {
        if (
          event.target &&
          event.target.closest &&
          event.target.closest('#ef-notification-btn,#notification-bell')
        ) {
          globalScope.__efNotificationPermissionAsked = true;
        }
      },
      { passive: true }
    );
  }

  function initialise() {
    ensureCsrfGlobal();
    patchFetchForNotificationCsrf();
    installNotificationDedupe();
    patchDesktopNotificationPermission();
    globalScope.addEventListener('messenger:unread-count', event => {
      const count = event.detail && (event.detail.count ?? event.detail.unreadCount);
      updateBadges(count ?? event.detail ?? 0);
    });
    globalScope.addEventListener('notification:unread-count', event => {
      const count = event.detail && (event.detail.count ?? event.detail.unreadCount);
      updateBadges(count ?? event.detail ?? 0);
    });
    debugLog('Stabilisation layer initialised');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
