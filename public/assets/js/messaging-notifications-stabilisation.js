(function initMessagingNotificationsStabilisation(globalScope) {
  'use strict';

  if (!globalScope || globalScope.__efMessagingNotificationsStabilised) return;
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
    if (!name || typeof document === 'undefined') return null;
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
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
    return /\/api\/(v1\/)?notifications\b/.test(String(url || ''));
  }

  function patchFetchForNotificationCsrf() {
    if (!globalScope.fetch || globalScope.fetch.__efNotificationCsrfPatched) return;
    const originalFetch = globalScope.fetch.bind(globalScope);

    async function patchedFetch(input, init = {}) {
      if (isNotificationWrite(typeof input === 'string' ? input : input && input.url, init)) {
        const headers = new Headers(init.headers || (input && input.headers) || {});
        if (!headers.get('X-CSRF-Token')) {
          headers.set('X-CSRF-Token', getCsrfToken());
        }
        init = { ...init, headers };
      }
      return originalFetch(input, init);
    }

    patchedFetch.__efNotificationCsrfPatched = true;
    globalScope.fetch = patchedFetch;
  }

  function getNotificationKey(notification) {
    if (globalScope.EventFlowNotificationState && typeof globalScope.EventFlowNotificationState.getNotificationKey === 'function') {
      return globalScope.EventFlowNotificationState.getNotificationKey(notification);
    }
    if (!notification || typeof notification !== 'object') return null;
    if (notification.id) return `id:${notification.id}`;
    if (notification._id) return `id:${notification._id}`;
    const meta = notification.metadata || {};
    if (meta.messageId || notification.messageId) return `message:${meta.messageId || notification.messageId}`;
    if (meta.conversationId && (meta.senderId || notification.senderId) && notification.createdAt) {
      return `conversation:${meta.conversationId}:${meta.senderId || notification.senderId}:${notification.createdAt}`;
    }
    return null;
  }

  function updateBadges(count) {
    if (globalScope.EventFlowNotificationState && typeof globalScope.EventFlowNotificationState.updateBadges === 'function') {
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
        if (seen.has(el)) return;
        seen.add(el);
        if (safeCount > 0) {
          el.textContent = safeCount > 99 ? '99+' : String(safeCount);
          el.style.display = '';
          el.setAttribute('aria-label', `${safeCount} unread notification${safeCount === 1 ? '' : 's'}`);
        } else {
          el.textContent = '';
          el.style.display = 'none';
          el.removeAttribute('aria-label');
        }
      });
    });
  }

  function patchNotificationArrayDeduping() {
    const seenKeys = new Set();
    const originalDispatch = globalScope.dispatchEvent.bind(globalScope);

    globalScope.dispatchEvent = function dispatchEventWithNotificationDedupe(event) {
      if (event && event.type === 'notification:added' && event.detail) {
        const key = getNotificationKey(event.detail);
        if (key && seenKeys.has(key)) {
          debugLog('Duplicate notification event suppressed', key);
          return true;
        }
        if (key) seenKeys.add(key);
      }
      return originalDispatch(event);
    };

    ['notification:received', 'notification', 'messenger:notification', 'messaging:notification'].forEach(eventName => {
      globalScope.addEventListener(eventName, event => {
        const detail = event.detail || event;
        const key = getNotificationKey(detail);
        if (key) seenKeys.add(key);
      });
    });
  }

  function patchConsoleNoise() {
    if (!globalScope.console || globalScope.console.__efNoisePatched) return;
    const noisyPatterns = [
      /WebSocket connection error/i,
      /WebSocket auth error/i,
      /Notification system: User not logged in/i,
      /Notification bell already initialized/i,
      /Using pre-rendered notification dropdown/i,
      /Bell not found during positioning/i,
      /Bell element appears detached/i,
      /DB not ready \(503\), retrying/i,
    ];

    ['log', 'warn', 'error'].forEach(method => {
      const original = globalScope.console[method] && globalScope.console[method].bind(globalScope.console);
      if (!original) return;
      globalScope.console[method] = (...args) => {
        const message = args.map(arg => (arg && arg.message) || String(arg)).join(' ');
        if (!DEBUG && noisyPatterns.some(pattern => pattern.test(message))) {
          return;
        }
        original(...args);
      };
    });
    globalScope.console.__efNoisePatched = true;
  }

  function patchDesktopNotificationPermission() {
    // Prevent repeated permission nags. Permission prompts still happen from a
    // user gesture when explicitly requested by the existing bell click flow.
    globalScope.__efNotificationPermissionAsked = globalScope.__efNotificationPermissionAsked || false;
    globalScope.addEventListener('click', event => {
      if (event.target && event.target.closest && event.target.closest('#ef-notification-btn,#notification-bell')) {
        globalScope.__efNotificationPermissionAsked = true;
      }
    }, { passive: true });
  }

  function applyVisualPolish() {
    if (document.getElementById('ef-messaging-notification-polish')) return;
    const style = document.createElement('style');
    style.id = 'ef-messaging-notification-polish';
    style.textContent = `
      .notification-dropdown{border-radius:22px!important;border:1px solid rgba(255,255,255,.62)!important;background:rgba(255,255,255,.86)!important;box-shadow:0 24px 70px rgba(15,23,42,.16)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;overflow:hidden!important}.notification-header{background:linear-gradient(135deg,rgba(11,128,115,.08),rgba(19,182,162,.04))!important;border-bottom:1px solid rgba(11,128,115,.12)!important}.notification-empty{padding:28px 18px!important;text-align:center!important;color:#667085!important}.notification-item{border-bottom:1px solid rgba(15,23,42,.06)!important;transition:background .18s ease,transform .18s ease!important}.notification-item:hover{background:rgba(11,128,115,.045)!important}.notification-item--unread{background:linear-gradient(90deg,rgba(11,128,115,.075),rgba(255,255,255,.74))!important}.notification-toast{border-radius:18px!important;border:1px solid rgba(255,255,255,.55)!important;box-shadow:0 18px 44px rgba(15,23,42,.16)!important}.messenger-v4__sidebar,.messenger-v4__chat{scrollbar-gutter:stable}.messenger-v4 [data-empty-state],.messenger-v4__empty-state{border-radius:24px!important;background:linear-gradient(135deg,rgba(255,255,255,.88),rgba(240,253,250,.72))!important;border:1px solid rgba(19,182,162,.18)!important;box-shadow:0 18px 50px rgba(15,23,42,.08)!important}@media(max-width:640px){.notification-dropdown{left:12px!important;right:12px!important;width:auto!important;max-width:none!important;border-radius:20px!important}.notification-toast{left:12px!important;right:12px!important;width:auto!important}}
    `;
    document.head.appendChild(style);
  }

  function initialise() {
    ensureCsrfGlobal();
    patchFetchForNotificationCsrf();
    patchNotificationArrayDeduping();
    patchConsoleNoise();
    patchDesktopNotificationPermission();
    applyVisualPolish();
    globalScope.addEventListener('messenger:unread-count', event => {
      const count = event.detail && (event.detail.count ?? event.detail.unreadCount);
      updateBadges(count ?? event.detail ?? 0);
    });
    globalScope.addEventListener('notification:unread-count', event => {
      const count = event.detail && (event.detail.count ?? event.detail.unreadCount);
      updateBadges(count ?? event.detail ?? 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
