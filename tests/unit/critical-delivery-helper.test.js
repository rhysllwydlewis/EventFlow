'use strict';

const helper = require('../../utils/postmark-critical-delivery');

describe('critical delivery helper', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  test('allows fallback outside production', () => {
    process.env.NODE_ENV = 'development';
    const result = { provider: 'outbox', status: 'disabled' };
    expect(helper.assertCriticalDelivery(result, 'Email')).toBe(result);
  });

  test('blocks fallback in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => helper.assertCriticalDelivery({ provider: 'outbox', status: 'disabled' }, 'Email')).toThrow();
  });
});
