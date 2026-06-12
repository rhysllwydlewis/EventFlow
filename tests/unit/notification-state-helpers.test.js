const fs = require('fs');
const path = require('path');
const vm = require('vm');

const helperPath = path.join(process.cwd(), 'public/assets/js/utils/notification-state.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function createElement() {
  return {
    textContent: '',
    style: { display: 'none' },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
  };
}

function loadHelpers(elementsBySelector = {}) {
  const document = {
    querySelectorAll: jest.fn(selector => elementsBySelector[selector] || []),
  };
  const window = { document };
  window.window = window;
  const sandbox = { window, document, module: { exports: {} } };
  sandbox.globalThis = window;
  vm.createContext(sandbox);
  vm.runInContext(helperSource, sandbox);
  return { window, document, helpers: window.EventFlowNotificationState };
}

describe('EventFlowNotificationState helpers', () => {
  it('deduplicates notifications by canonical id', () => {
    const { helpers } = loadHelpers();
    const list = helpers.dedupeNotifications([
      { id: 'n1', title: 'First' },
      { id: 'n1', title: 'Duplicate' },
      { id: 'n2', title: 'Second' },
    ]);

    expect(list).toHaveLength(2);
    expect(list.map(item => item.id)).toEqual(['n1', 'n2']);
  });

  it('deduplicates message notifications by metadata.messageId', () => {
    const { helpers } = loadHelpers();
    const list = helpers.dedupeNotifications([
      { type: 'message', metadata: { messageId: 'm1' }, message: 'Hello' },
      { type: 'message', metadata: { messageId: 'm1' }, message: 'Hello again' },
    ]);

    expect(list).toHaveLength(1);
  });

  it('upserts an existing notification instead of duplicating it', () => {
    const { helpers } = loadHelpers();
    const list = helpers.upsertNotification([{ id: 'n1', isRead: false }], {
      id: 'n1',
      isRead: true,
    });

    expect(list).toHaveLength(1);
    expect(list[0].isRead).toBe(true);
  });

  it('updates all matching badge elements and hides them at zero', () => {
    const badge = createElement();
    const bottomBadge = createElement();
    const classBadge = createElement();
    const { helpers } = loadHelpers({
      '#ef-notification-badge': [badge],
      '#ef-bottom-dashboard-badge': [bottomBadge],
      '.notification-badge': [classBadge],
    });

    helpers.updateBadges(7);
    expect(badge.textContent).toBe('7');
    expect(bottomBadge.textContent).toBe('7');
    expect(classBadge.textContent).toBe('7');

    helpers.updateBadges(0);
    expect(badge.style.display).toBe('none');
    expect(bottomBadge.style.display).toBe('none');
    expect(classBadge.style.display).toBe('none');
  });
});
