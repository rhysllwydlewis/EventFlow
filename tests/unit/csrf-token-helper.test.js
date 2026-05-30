const fs = require('fs');
const path = require('path');
const vm = require('vm');

const helperPath = path.join(process.cwd(), 'public/assets/js/utils/csrf-token.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function loadHelper({ cookie = '' } = {}) {
  const window = { document: { cookie } };
  window.window = window;
  const sandbox = { window, document: window.document, module: { exports: {} } };
  sandbox.globalThis = window;
  vm.createContext(sandbox);
  vm.runInContext(helperSource, sandbox);
  return window;
}

describe('EventFlowCsrf helper', () => {
  it('prefers window.__CSRF_TOKEN__ when available', () => {
    const window = loadHelper();
    window.__CSRF_TOKEN__ = 'from-window';

    expect(window.EventFlowCsrf.get()).toBe('from-window');
  });

  it('reads the canonical csrf cookie', () => {
    const window = loadHelper({ cookie: 'csrf=from-cookie; path=/' });

    expect(window.EventFlowCsrf.get()).toBe('from-cookie');
  });

  it('falls back to the legacy csrfToken cookie', () => {
    const window = loadHelper({ cookie: 'csrfToken=legacy-token; path=/' });

    expect(window.EventFlowCsrf.get()).toBe('legacy-token');
  });

  it('returns an empty string when no token source exists', () => {
    const window = loadHelper();

    expect(window.EventFlowCsrf.get()).toBe('');
  });
});
