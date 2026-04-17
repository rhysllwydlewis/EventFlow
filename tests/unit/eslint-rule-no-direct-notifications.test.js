'use strict';

/**
 * ESLint rule tester for the local `no-direct-notifications` rule (B1).
 */

const { RuleTester } = require('eslint');
const rule = require('../../eslint-rules/no-direct-notifications');

const tester = new RuleTester({
  parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
});

tester.run('no-direct-notifications', rule, {
  valid: [
    {
      code: 'NotificationDispatcher.success("ok");',
      filename: 'public/assets/js/pages/example.js',
    },
    {
      code: 'EventFlowNotifications.success("allowed inside dispatcher");',
      filename: 'public/assets/js/notification-dispatcher.js',
    },
    {
      code: 'EventFlowNotifications.clearAll();',
      filename: 'public/assets/js/pages/example.js',
    },
    {
      code: 'someOther.success("ok");',
      filename: 'public/assets/js/pages/example.js',
    },
  ],
  invalid: [
    {
      code: 'EventFlowNotifications.success("boom");',
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    {
      code: 'EventFlowNotifications.error("boom");',
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    {
      code: 'window.EventFlowNotifications.warning("w");',
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    {
      code: 'EventFlowNotifications.info("i");',
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    // Optional-chain variants (common defensive pattern) must also be caught.
    {
      code: 'window.EventFlowNotifications?.error("boom");',
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
    {
      code: 'EventFlowNotifications?.success("boom");',
      filename: 'public/assets/js/pages/example.js',
      errors: [{ messageId: 'noDirect' }],
    },
  ],
});

// RuleTester's `.run()` already produces describe/it blocks, but jest requires
// at least one test in the file to avoid the "no tests" failure.
describe('no-direct-notifications rule module', () => {
  it('exports an ESLint rule with a create function', () => {
    expect(typeof rule.create).toBe('function');
    expect(rule.meta.type).toBe('problem');
  });
});
