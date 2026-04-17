'use strict';

/**
 * ESLint rule tester for the local `no-direct-notifications` rule (B1).
 */

const { RuleTester } = require('eslint');
const rule = require('../../eslint-rules/no-direct-notifications');

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
});

const FORBIDDEN_METHODS = ['success', 'error', 'warning', 'info', 'show', 'clearAll'];
const ALLOWED_FILES = [
  'public/assets/js/notification-dispatcher.js',
  'public/assets/js/utils/global-error-handler.js',
  'public/assets/js/app.js',
];

tester.run('no-direct-notifications', rule, {
  valid: [
    ...ALLOWED_FILES.flatMap(filename =>
      FORBIDDEN_METHODS.flatMap(method => [
        {
          code: `EventFlowNotifications.${method}("allowed");`,
          filename,
        },
        {
          code: `window.EventFlowNotifications.${method}("allowed");`,
          filename,
        },
      ])
    ),
    ...FORBIDDEN_METHODS.map(method => ({
      code:
        method === 'clearAll'
          ? 'NotificationDispatcher.clearAll();'
          : `NotificationDispatcher.${method}("ok");`,
      filename: 'public/assets/js/pages/example.js',
    })),
    {
      code: 'typeof EventFlowNotifications !== "undefined";',
      filename: 'public/assets/js/pages/example.js',
    },
    // Unrelated identifiers with the same method names must not trigger the rule.
    {
      code: 'someOther.success("ok");',
      filename: 'public/assets/js/pages/example.js',
    },
    {
      code: 'window.someOther.clearAll();',
      filename: 'public/assets/js/pages/example.js',
    },
  ],
  invalid: FORBIDDEN_METHODS.flatMap(method => [
    {
      code: `EventFlowNotifications.${method}("boom");`,
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    {
      code: `window.EventFlowNotifications.${method}("boom");`,
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    // Optional-chain variants (common defensive pattern) must also be caught.
    {
      code: `EventFlowNotifications?.${method}("boom");`,
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    {
      code: `window.EventFlowNotifications?.${method}("boom");`,
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
  ]),
});

// RuleTester's `.run()` already produces describe/it blocks, but jest requires
// at least one test in the file to avoid the "no tests" failure.
describe('no-direct-notifications rule module', () => {
  it('exports an ESLint rule with a create function', () => {
    expect(typeof rule.create).toBe('function');
    expect(rule.meta.type).toBe('problem');
  });
});
