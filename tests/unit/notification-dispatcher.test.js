'use strict';

/**
 * Unit tests for NotificationDispatcher (B1).
 *
 * These tests load `notification-dispatcher.js` via a sandboxed `vm` context
 * so the IIFE binds to a fake `window`, mirroring the browser environment.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dispatcherSource = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/notification-dispatcher.js'),
  'utf8'
);

function makeSandbox() {
  const calls = [];
  const sandbox = {
    window: {},
    module: { exports: {} },
    console: { warn: (...args) => calls.push({ kind: 'warn', args }) },
  };
  sandbox.window.console = sandbox.console;
  sandbox.globalThis = sandbox;
  sandbox.window.EventFlowNotifications = {
    success: (message, duration) => calls.push({ kind: 'success', message, duration }),
    error: (message, duration) => calls.push({ kind: 'error', message, duration }),
    warning: (message, duration) => calls.push({ kind: 'warning', message, duration }),
    info: (message, duration) => calls.push({ kind: 'info', message, duration }),
  };
  vm.createContext(sandbox);
  vm.runInContext(dispatcherSource, sandbox);
  return { sandbox, calls, dispatcher: sandbox.window.NotificationDispatcher };
}

describe('NotificationDispatcher', () => {
  it('exposes dispatch + convenience helpers on window', () => {
    const { dispatcher } = makeSandbox();
    expect(typeof dispatcher.dispatch).toBe('function');
    for (const kind of ['success', 'error', 'warning', 'info']) {
      expect(typeof dispatcher[kind]).toBe('function');
    }
  });

  it('routes string input through the matching low-level method', () => {
    const { dispatcher, calls } = makeSandbox();
    dispatcher.success('ok');
    dispatcher.error('boom');
    dispatcher.warning('watch out');
    dispatcher.info('fyi');
    expect(calls.map(c => c.kind)).toEqual(['success', 'error', 'warning', 'info']);
    expect(calls.map(c => c.message)).toEqual(['ok', 'boom', 'watch out', 'fyi']);
  });

  it('passes duration through when caller uses (message, duration) shape', () => {
    const { dispatcher, calls } = makeSandbox();
    dispatcher.success('persist', 2000);
    expect(calls[0]).toMatchObject({ kind: 'success', message: 'persist', duration: 2000 });
  });

  it('normalises rich object input including title prefixing', () => {
    const { dispatcher, calls } = makeSandbox();
    dispatcher.dispatch({ kind: 'info', title: 'Hello', message: 'there' });
    expect(calls[0]).toMatchObject({ kind: 'info', message: 'Hello: there' });
  });

  it('warns when an unknown notification `type` is provided but still dispatches', () => {
    const { dispatcher, calls } = makeSandbox();
    dispatcher.dispatch({ kind: 'info', message: 'm', type: 'not-a-thing' });
    const warn = calls.find(c => c.kind === 'warn');
    expect(warn).toBeDefined();
    expect(warn.args[0]).toMatch(/Unknown notification type/);
    const info = calls.find(c => c.kind === 'info');
    expect(info).toMatchObject({ kind: 'info', message: 'm' });
  });

  it('silently no-ops when EventFlowNotifications is not available', () => {
    const sandbox = { window: {}, module: { exports: {} } };
    vm.createContext(sandbox);
    vm.runInContext(dispatcherSource, sandbox);
    expect(() => sandbox.window.NotificationDispatcher.success('nothing')).not.toThrow();
  });

  it('accepts every server-side NOTIFICATION_TYPES value without warning', () => {
    const { dispatcher, calls } = makeSandbox();
    for (const type of dispatcher.NOTIFICATION_TYPES) {
      dispatcher.dispatch({ kind: 'info', message: type, type });
    }
    const warns = calls.filter(c => c.kind === 'warn');
    expect(warns).toEqual([]);
  });
});
