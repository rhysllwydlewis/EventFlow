/**
 * Local ESLint rule: eventflow-local/no-direct-notifications
 *
 * Forbids direct calls to `EventFlowNotifications.success/error/warning/info`
 * (and the `window.EventFlowNotifications.*` variant) from everywhere except
 * the dispatcher facade itself. New call sites must route through
 * `NotificationDispatcher` so we have a single place to add validation,
 * throttling, or telemetry.
 *
 * See docs/PRE_MERGE_CHECKLIST_notification-audit.md (Effort 1).
 */
'use strict';

const ALLOWED_FILES = [
  'public/assets/js/notification-dispatcher.js',
  // Error-handler paths are deliberately kept on the low-level primitive so
  // that notification-dispatcher failures don't cause nested errors. These are
  // dead-simple `.error(message)` calls that pre-date the dispatcher.
  'public/assets/js/utils/global-error-handler.js',
  'public/assets/js/app.js',
];

const FORBIDDEN_METHODS = new Set(['success', 'error', 'warning', 'info']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct EventFlowNotifications calls. Route through NotificationDispatcher instead.',
      recommended: false,
    },
    schema: [],
    messages: {
      noDirect:
        'Direct calls to EventFlowNotifications.{{method}}() are not allowed. Use NotificationDispatcher.{{method}}() instead.',
    },
  },

  create(context) {
    const filename = (context.getFilename && context.getFilename()) || '';
    const normalised = filename.replace(/\\/g, '/');
    const isAllowed = ALLOWED_FILES.some(p => normalised.endsWith(p));
    if (isAllowed) {
      return {};
    }

    function check(node) {
      if (node.callee.type !== 'MemberExpression') {
        return;
      }
      const method = node.callee.property && node.callee.property.name;
      if (!FORBIDDEN_METHODS.has(method)) {
        return;
      }
      const object = node.callee.object;
      let objectName = null;
      if (object.type === 'Identifier') {
        objectName = object.name;
      } else if (
        object.type === 'MemberExpression' &&
        object.object &&
        object.object.name === 'window' &&
        object.property &&
        object.property.name === 'EventFlowNotifications'
      ) {
        objectName = 'EventFlowNotifications';
      }
      if (objectName === 'EventFlowNotifications') {
        context.report({
          node,
          messageId: 'noDirect',
          data: { method },
        });
      }
    }

    return {
      CallExpression: check,
    };
  },
};
