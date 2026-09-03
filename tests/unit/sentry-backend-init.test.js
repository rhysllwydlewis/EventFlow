/**
 * Regression tests for utils/sentry.js's backend Sentry init.
 *
 * Context: this file used to call the class-based Sentry.Integrations.* API
 * and Sentry.Handlers.* middleware, both removed in the @sentry/node v8 SDK
 * that package.json actually pins (^8.0.0). Every call silently threw inside
 * initSentry()'s try/catch, so Sentry was permanently disabled regardless of
 * SENTRY_DSN being set. These tests lock in the v8-compatible rewrite.
 */

'use strict';

function buildMockSentry() {
  return {
    init: jest.fn(),
    mongoIntegration: jest.fn(() => ({ name: 'Mongo' })),
    redisIntegration: jest.fn(() => ({ name: 'Redis' })),
    setupExpressErrorHandler: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    setUser: jest.fn(),
    addBreadcrumb: jest.fn(),
    flush: jest.fn(async () => true),
    close: jest.fn(async () => true),
  };
}

describe('utils/sentry.js backend init (v8 SDK compatibility)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.dontMock('@sentry/node');
  });

  it('does not attempt to initialize Sentry when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    const mockSentry = buildMockSentry();
    jest.doMock('@sentry/node', () => mockSentry);

    const sentry = require('../../utils/sentry');
    const result = sentry.initSentry({});

    expect(result).toBe(false);
    expect(sentry.isEnabled()).toBe(false);
    expect(mockSentry.init).not.toHaveBeenCalled();
  });

  it('initializes successfully using only function-style integrations (no Integrations/Handlers classes)', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.example/1';
    process.env.NODE_ENV = 'production';
    const mockSentry = buildMockSentry();
    jest.doMock('@sentry/node', () => mockSentry);

    const sentry = require('../../utils/sentry');
    const fakeApp = {};
    const result = sentry.initSentry(fakeApp);

    expect(result).toBe(true);
    expect(sentry.isEnabled()).toBe(true);
    expect(mockSentry.init).toHaveBeenCalledTimes(1);

    const initConfig = mockSentry.init.mock.calls[0][0];
    expect(initConfig.dsn).toBe('https://fake@sentry.example/1');
    expect(mockSentry.mongoIntegration).toHaveBeenCalledWith({ useMongoose: false });
    expect(mockSentry.redisIntegration).toHaveBeenCalledTimes(1);
    expect(initConfig.integrations).toEqual([{ name: 'Mongo' }, { name: 'Redis' }]);
  });

  it('does not throw even if the installed SDK lacks the old Integrations/Handlers classes', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.example/1';
    const mockSentry = buildMockSentry();
    // Simulate the real v8 SDK shape: these keys simply don't exist.
    expect(mockSentry.Integrations).toBeUndefined();
    expect(mockSentry.Handlers).toBeUndefined();
    jest.doMock('@sentry/node', () => mockSentry);

    const sentry = require('../../utils/sentry');
    expect(() => sentry.initSentry({})).not.toThrow();
    expect(sentry.isEnabled()).toBe(true);
  });

  it('setupExpressErrorHandler wires the v8 error handler onto the app after routes are mounted', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.example/1';
    const mockSentry = buildMockSentry();
    jest.doMock('@sentry/node', () => mockSentry);

    const sentry = require('../../utils/sentry');
    const fakeApp = { name: 'fake-express-app' };
    sentry.initSentry(fakeApp);
    sentry.setupExpressErrorHandler(fakeApp);

    expect(mockSentry.setupExpressErrorHandler).toHaveBeenCalledWith(fakeApp);
  });

  it('setupExpressErrorHandler is a no-op when Sentry was never enabled', () => {
    delete process.env.SENTRY_DSN;
    const mockSentry = buildMockSentry();
    jest.doMock('@sentry/node', () => mockSentry);

    const sentry = require('../../utils/sentry');
    sentry.initSentry({});
    expect(() => sentry.setupExpressErrorHandler({})).not.toThrow();
    expect(mockSentry.setupExpressErrorHandler).not.toHaveBeenCalled();
  });

  it('getRequestHandler/getTracingHandler/getErrorHandler are pass-through middleware (v8 needs no manual mount)', () => {
    delete process.env.SENTRY_DSN;
    jest.doMock('@sentry/node', () => buildMockSentry());
    const sentry = require('../../utils/sentry');

    const next = jest.fn();
    sentry.getRequestHandler()({}, {}, next);
    sentry.getTracingHandler()({}, {}, next);
    expect(next).toHaveBeenCalledTimes(2);

    const errNext = jest.fn();
    const err = new Error('boom');
    sentry.getErrorHandler()(err, {}, {}, errNext);
    expect(errNext).toHaveBeenCalledWith(err);
  });
});
