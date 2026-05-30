const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const helperPath = path.join(process.cwd(), 'public/assets/js/utils/csrf-token.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function loadHelper({ html = '<!doctype html><html><body></body></html>', url = 'https://event-flow.co.uk/' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.eval(helperSource);
  return dom;
}

describe('EventFlowCsrf helper', () => {
  it('prefers window.__CSRF_TOKEN__ when available', () => {
    const dom = loadHelper();
    dom.window.__CSRF_TOKEN__ = 'from-window';

    expect(dom.window.EventFlowCsrf.get()).toBe('from-window');
  });

  it('reads the canonical csrf cookie', () => {
    const dom = loadHelper();
    dom.window.document.cookie = 'csrf=from-cookie; path=/';

    expect(dom.window.EventFlowCsrf.get()).toBe('from-cookie');
  });

  it('falls back to the legacy csrfToken cookie', () => {
    const dom = loadHelper();
    dom.window.document.cookie = 'csrfToken=legacy-token; path=/';

    expect(dom.window.EventFlowCsrf.get()).toBe('legacy-token');
  });

  it('returns an empty string when no token source exists', () => {
    const dom = loadHelper();

    expect(dom.window.EventFlowCsrf.get()).toBe('');
  });
});
