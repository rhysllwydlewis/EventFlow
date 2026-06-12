const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stateSource = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/utils/notification-state.js'),
  'utf8'
);
const stabilisationSource = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/messaging-notifications-stabilisation.js'),
  'utf8'
);

function createElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    attributes: {},
    textContent: '',
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

function makeSandbox() {
  const listeners = new Map();
  const elements = {
    '#ef-notification-badge': [createElement('span')],
    '.ef-badge': [Object.assign(createElement('span'), { textContent: 'keep' })],
  };
  const document = {
    cookie: 'csrf=from-cookie',
    readyState: 'complete',
    head: createElement('head'),
    createElement,
    getElementById: jest.fn(() => null),
    querySelectorAll: jest.fn(selector => elements[selector] || []),
    addEventListener: jest.fn((eventName, handler) => {
      listeners.set(eventName, [...(listeners.get(eventName) || []), handler]);
    }),
  };
  const fetchCalls = [];
  const window = {
    document,
    location: { search: '', hostname: 'event-flow.co.uk', origin: 'https://event-flow.co.uk' },
    DEBUG: false,
    console,
    Headers: global.Headers,
    URL,
    URLSearchParams,
    fetch: jest.fn((input, init) => {
      fetchCalls.push([input, init]);
      return Promise.resolve({ ok: true, input, init });
    }),
    addEventListener: jest.fn((eventName, handler) => {
      listeners.set(eventName, [...(listeners.get(eventName) || []), handler]);
    }),
    dispatchEvent: jest.fn(event => {
      (listeners.get(event.type) || []).forEach(handler => handler(event));
      return true;
    }),
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
  };
  window.window = window;
  const sandbox = {
    window,
    document,
    console,
    Headers: global.Headers,
    URL,
    URLSearchParams,
    module: { exports: {} },
  };
  sandbox.globalThis = window;
  vm.createContext(sandbox);
  vm.runInContext(stateSource, sandbox);
  const originalDispatch = window.dispatchEvent;
  const originalConsoleLog = console.log;
  vm.runInContext(stabilisationSource, sandbox);
  return { window, document, elements, fetchCalls, originalDispatch, originalConsoleLog };
}

describe('messaging-notifications-stabilisation runtime', () => {
  it('does not monkey-patch window.dispatchEvent or console methods', () => {
    const { window, originalDispatch, originalConsoleLog } = makeSandbox();

    expect(window.__efMessagingNotificationsStabilised).toBe(true);
    expect(window.dispatchEvent).toBe(originalDispatch);
    expect(window.console.log).toBe(originalConsoleLog);
  });

  it('adds CSRF only to notification write requests', async () => {
    const { window, fetchCalls } = makeSandbox();
    window.__CSRF_TOKEN__ = 'csrf-123';

    await window.fetch('/api/v1/notifications/n1/read', { method: 'PUT' });
    await window.fetch('/api/v1/messenger/conversations', { method: 'POST' });
    await window.fetch('/api/v1/notifications?limit=10', { method: 'GET' });

    const notificationWrite = fetchCalls[0][1];
    expect(notificationWrite.headers.get('X-CSRF-Token')).toBe('csrf-123');
    expect(fetchCalls[1][1].headers).toBeUndefined();
    expect(fetchCalls[2][1].headers).toBeUndefined();
  });

  it('dedupe helper does not pre-mark notification:added before page handlers run', () => {
    const { window } = makeSandbox();
    const notification = { id: 'n1', title: 'First', isRead: false };

    window.dispatchEvent(new window.CustomEvent('notification:added', { detail: notification }));

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(window.EventFlowNotificationDedupe.has(notification)).toBe(false);
  });

  it('dedupe helper remembers socket/realtime notifications and upserts duplicates', () => {
    const { window } = makeSandbox();
    const first = { id: 'n1', title: 'First', isRead: false };
    const second = { id: 'n1', title: 'First updated', isRead: true };

    window.dispatchEvent(new window.CustomEvent('notification:received', { detail: first }));

    expect(window.EventFlowNotificationDedupe.has(first)).toBe(true);
    expect(window.EventFlowNotificationDedupe.upsert([first], second)).toEqual([second]);
  });

  it('updates only known notification badge selectors', () => {
    const { window, elements } = makeSandbox();

    window.dispatchEvent(
      new window.CustomEvent('notification:unread-count', { detail: { count: 4 } })
    );

    expect(elements['#ef-notification-badge'][0].textContent).toBe('4');
    expect(elements['.ef-badge'][0].textContent).toBe('keep');
  });
});
