/**
 * NotificationDispatcher (B1)
 *
 * A thin facade on top of `EventFlowNotifications` (the low-level toast
 * primitive defined in `notification-system.js`). Every client-side caller
 * that would otherwise call `EventFlowNotifications.success/error/warning/info`
 * directly should route through this module so we have a single place to:
 *   - Normalise notification-like inputs into one shape.
 *   - Validate `type` against the shared `NOTIFICATION_TYPES` enum.
 *   - Add cross-cutting behaviour later (throttling, telemetry, persistence).
 *
 * The low-level primitive (`EventFlowNotifications`) remains available but
 * direct usage is forbidden by the local ESLint rule
 * `no-direct-notifications`. Only this file may call it.
 */
/* eslint-disable no-direct-notifications */
(function initNotificationDispatcher(globalScope) {
  'use strict';

  // Mirror the server-side enum. Keep in sync with `models/index.js`
  // (NOTIFICATION_TYPES) — drift is caught by the enum drift guard test.
  const NOTIFICATION_TYPES = [
    'message',
    'booking',
    'payment',
    'review',
    'system',
    'marketing',
    'reminder',
    'approval',
    'update',
    'ticket',
    'announcement',
  ];

  // Dispatcher-level toast kinds. These are the four visual variants the toast
  // primitive understands, independent of the semantic `type` that comes from
  // the server-side notifications collection.
  const DISPATCHER_KINDS = ['success', 'error', 'warning', 'info'];

  /**
   * Normalise any of the shapes the codebase currently throws around
   * (plain string, legacy `{ message, type }`, server-shaped
   * `{ type, title, message, priority, actionUrl, actionText }`) into a single
   * internal representation.
   *
   * @param {string|Object} input
   * @param {string} defaultKind - toast kind if the input doesn't specify one
   * @returns {Object}
   */
  function normalise(input, defaultKind) {
    const fallbackKind = defaultKind || 'info';
    if (input === null || input === undefined) {
      return { kind: fallbackKind, message: '' };
    }
    if (typeof input === 'string') {
      return { kind: fallbackKind, message: input };
    }
    if (typeof input !== 'object') {
      return { kind: fallbackKind, message: String(input) };
    }
    const kind = DISPATCHER_KINDS.indexOf(input.kind) >= 0 ? input.kind : fallbackKind;
    let message = '';
    if (typeof input.message === 'string') {
      message = input.message;
    } else if (typeof input.body === 'string') {
      message = input.body;
    } else if (typeof input.title === 'string') {
      message = input.title;
    }
    const normalised = { kind, message };
    if (typeof input.title === 'string') {
      normalised.title = input.title;
    }
    if (typeof input.duration === 'number') {
      normalised.duration = input.duration;
    }
    if (typeof input.type === 'string') {
      if (NOTIFICATION_TYPES.indexOf(input.type) === -1) {
        // Unknown semantic type — log but do not throw; the toast layer is
        // still useful and a soft failure is preferable to a blank toast.
        if (globalScope && globalScope.console && typeof globalScope.console.warn === 'function') {
          globalScope.console.warn(
            `[NotificationDispatcher] Unknown notification type "${input.type}". ` +
              `Valid types: ${NOTIFICATION_TYPES.join(', ')}`
          );
        }
      }
      normalised.type = input.type;
    }
    if (typeof input.priority === 'string') {
      normalised.priority = input.priority;
    }
    if (typeof input.actionUrl === 'string') {
      normalised.actionUrl = input.actionUrl;
    }
    if (typeof input.actionText === 'string') {
      normalised.actionText = input.actionText;
    }
    return normalised;
  }

  function lowLevel() {
    if (!globalScope) {
      return null;
    }
    if (
      globalScope.EventFlowNotifications &&
      typeof globalScope.EventFlowNotifications.success === 'function'
    ) {
      return globalScope.EventFlowNotifications;
    }
    return null;
  }

  /**
   * Dispatch a notification through the shared toast primitive.
   * Safe to call in environments where `EventFlowNotifications` has not been
   * loaded — in that case the call silently no-ops.
   *
   * @param {string|Object} input
   * @returns {*} whatever the underlying toast layer returned, or null
   */
  function dispatch(input) {
    const primitive = lowLevel();
    if (!primitive) {
      return null;
    }
    const n = normalise(input, 'info');
    const display = n.title ? `${n.title}: ${n.message}` : n.message;
    return primitive[n.kind](display, n.duration);
  }

  function coerce(kind, input, duration) {
    if (typeof input === 'string' && typeof duration === 'number') {
      return dispatch({ kind, message: input, duration });
    }
    if (typeof input === 'string') {
      return dispatch({ kind, message: input });
    }
    return dispatch(Object.assign({ kind }, input || {}));
  }

  const api = {
    dispatch,
    success: (input, duration) => coerce('success', input, duration),
    error: (input, duration) => coerce('error', input, duration),
    warning: (input, duration) => coerce('warning', input, duration),
    info: (input, duration) => coerce('info', input, duration),
    _normalise: normalise,
    NOTIFICATION_TYPES: NOTIFICATION_TYPES.slice(),
  };

  if (globalScope) {
    globalScope.NotificationDispatcher = api;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
