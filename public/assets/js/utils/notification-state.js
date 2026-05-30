(function initNotificationStateHelpers(globalScope) {
  'use strict';

  const DEFAULT_BADGE_SELECTORS = [
    '#ef-notification-badge',
    '#notification-badge',
    '#headerNotificationBadge',
    '#notificationBadge',
    '#ef-bottom-dashboard-badge',
    '.notification-badge',
    '.messenger-unread-badge',
  ];

  function normaliseCount(value) {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) return 0;
    return Math.floor(count);
  }

  function getNotificationKey(notification) {
    if (!notification || typeof notification !== 'object') return null;
    if (notification.id) return `id:${notification.id}`;
    if (notification._id) return `id:${notification._id}`;
    const metadata = notification.metadata || {};
    if (metadata.messageId) return `message:${metadata.messageId}`;
    if (notification.messageId) return `message:${notification.messageId}`;
    if (metadata.conversationId && metadata.senderId && notification.createdAt) {
      return `conversation:${metadata.conversationId}:${metadata.senderId}:${notification.createdAt}`;
    }
    if (metadata.threadId && metadata.senderName && notification.createdAt) {
      return `thread:${metadata.threadId}:${metadata.senderName}:${notification.createdAt}`;
    }
    return null;
  }

  function upsertNotification(list, notification) {
    const existing = Array.isArray(list) ? list : [];
    const key = getNotificationKey(notification);
    if (!key) return [notification, ...existing];
    const index = existing.findIndex(item => getNotificationKey(item) === key);
    if (index === -1) return [notification, ...existing];
    const next = existing.slice();
    next[index] = { ...next[index], ...notification };
    return next;
  }

  function dedupeNotifications(list) {
    const output = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(notification => {
      const key = getNotificationKey(notification);
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      output.push(notification);
    });
    return output;
  }

  function updateBadges(count, selectors) {
    const safeCount = normaliseCount(count);
    const seen = new Set();
    const selectorList = Array.isArray(selectors) && selectors.length ? selectors : DEFAULT_BADGE_SELECTORS;
    selectorList.forEach(selector => {
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

  const api = {
    DEFAULT_BADGE_SELECTORS: DEFAULT_BADGE_SELECTORS.slice(),
    normaliseCount,
    getNotificationKey,
    upsertNotification,
    dedupeNotifications,
    updateBadges,
  };

  if (globalScope) {
    globalScope.EventFlowNotificationState = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
