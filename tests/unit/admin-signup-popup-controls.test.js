'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/pages/admin-signup-popup-init.js'),
  'utf8'
);

function createPage() {
  class Element {
    constructor({ id, mode, value = '' } = {}) {
      this.id = id;
      this.dataset = mode ? { mode } : {};
      this.value = value;
      this.attributes = {};
      this.handlers = {};
      this.classes = new Set();
      this.classList = {
        toggle: (name, enabled) => (enabled ? this.classes.add(name) : this.classes.delete(name)),
      };
    }

    addEventListener(event, handler) {
      this.handlers[event] = handler;
    }

    setAttribute(name, value) {
      this.attributes[name] = value;
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    click() {
      return this.handlers.click?.();
    }
  }

  const modeButtons = ['disabled', 'popup', 'banner'].map(mode => new Element({ mode }));
  const elements = {
    signupPopupMode: new Element({ id: 'signupPopupMode', value: 'disabled' }),
    signupPopupDelay: new Element({ id: 'signupPopupDelay', value: '5' }),
    saveSignupPopup: new Element({ id: 'saveSignupPopup' }),
  };
  const document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: selector => (selector === '.signup-popup-mode-btn' ? modeButtons : []),
    querySelector: selector => {
      const match = selector.match(/^\[data-mode="(.+)"\]$/);
      return match ? modeButtons.find(button => button.dataset.mode === match[1]) : null;
    },
  };

  const requests = [];
  const AdminShared = {
    adminFetch: jest.fn(async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'GET') {
        return { mode: 'disabled', delaySeconds: 5 };
      }
      return { success: true };
    }),
    debugError: jest.fn(),
    fetchCSRFToken: jest.fn(async () => {}),
    safeAction: jest.fn(async (_button, action) => action()),
    showToast: jest.fn(),
  };
  vm.runInNewContext(SCRIPT, { AdminShared, document });
  return { document, requests };
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve));
}

describe('admin sign-up popup controls', () => {
  it('changes the selected mode when each mode button is clicked', async () => {
    const { document } = createPage();
    await flushPromises();

    const popupButton = document.querySelector('[data-mode="popup"]');
    popupButton.click();

    expect(document.getElementById('signupPopupMode').value).toBe('popup');
    expect(popupButton.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-mode="disabled"]').getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('saves the selected mode and delay through the admin API', async () => {
    const { document, requests } = createPage();
    await flushPromises();

    document.querySelector('[data-mode="banner"]').click();
    document.getElementById('signupPopupDelay').value = '9';
    document.getElementById('saveSignupPopup').click();
    await flushPromises();

    expect(requests).toContainEqual({
      url: '/api/admin/settings/signup-popup',
      options: { method: 'PUT', body: { mode: 'banner', delaySeconds: 9 } },
    });
  });
});
