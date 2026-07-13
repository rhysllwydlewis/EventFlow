'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'public/assets/js/components/home-mobile-signup.js');
const CSS_PATH = path.join(ROOT, 'public/assets/css/home-mobile-signup.css');
const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

function createMatchMedia({ mobile = true, reducedMotion = true } = {}) {
  return query => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : mobile,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  });
}

function sharedMarkup() {
  return `<!doctype html><html><head></head><body>
    <header class="ef-header">
      <div class="ef-header-actions">
        <a id="ef-auth-link" href="/auth">Log in</a>
        <button id="ef-mobile-toggle" type="button">Menu</button>
      </div>
      <div id="ef-mobile-menu">
        <nav class="ef-mobile-nav">
          <a id="ef-mobile-auth" class="ef-mobile-link ef-mobile-primary" href="/auth">Log in</a>
        </nav>
      </div>
    </header>
  </body></html>`;
}

function v2Markup() {
  return `<!doctype html><html><head></head><body class="home-v2-page">
    <header class="hv2-header">
      <div class="hv2-actions">
        <a id="hv2-auth-link" href="/auth">Log in</a>
        <button class="hv2-menu" type="button">Menu</button>
      </div>
    </header>
    <nav id="hv2-mobile-nav" class="hv2-mobile-nav">
      <a class="hv2-mobile-login" href="/auth">Log in</a>
    </nav>
  </body></html>`;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function boot(html, { user = null, reducedMotion = true, fakeTimers = false } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://event-flow.co.uk/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  let subscriber = null;
  const queuedTimers = [];

  window.matchMedia = createMatchMedia({ mobile: true, reducedMotion });
  if (fakeTimers) {
    window.setTimeout = callback => {
      queuedTimers.push(callback);
      return queuedTimers.length;
    };
    window.clearTimeout = () => {};
  }

  const manager = {
    subscribe(callback) {
      subscriber = callback;
      return () => {};
    },
    init() {
      return Promise.resolve({ user });
    },
  };
  window.AuthStateManager = manager;
  window.__authState = manager;
  window.eval(scriptSource);

  return {
    dom,
    window,
    document: window.document,
    queuedTimers,
    notifyAuth(nextUser) {
      if (subscriber) {
        subscriber({ user: nextUser });
      }
    },
  };
}

describe('homepage mobile sign-up CTA', () => {
  it('adds a visible sign-up action to the shared V1/V3 header and keeps Log in in the burger menu', async () => {
    const page = boot(sharedMarkup());
    await flushPromises();

    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    const menuCta = page.document.getElementById('ef-mobile-signup-menu');
    const login = page.document.getElementById('ef-mobile-auth');

    expect(headerCta).not.toBeNull();
    expect(headerCta.textContent).toBe('Sign up');
    expect(headerCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(headerCta.hidden).toBe(false);
    expect(menuCta).not.toBeNull();
    expect(menuCta.textContent).toBe('Create free account');
    expect(menuCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(menuCta.hidden).toBe(false);
    expect(login).not.toBeNull();
    expect(login.textContent).toBe('Log in');
    expect(login.getAttribute('href')).toBe('/auth');
    expect(login.classList.contains('ef-mobile-primary')).toBe(false);
    expect(menuCta.nextElementSibling).toBe(login);

    page.notifyAuth({ id: 'usr_1', role: 'customer' });
    expect(headerCta.hidden).toBe(true);
    expect(menuCta.hidden).toBe(true);

    page.dom.window.close();
  });

  it('adds the same account discovery pattern to the V2 mobile header and menu', async () => {
    const page = boot(v2Markup());
    await flushPromises();

    const headerCta = page.document.getElementById('hv2-mobile-signup-cta');
    const menuCta = page.document.getElementById('hv2-mobile-signup-menu');
    const login = page.document.querySelector('.hv2-mobile-login');

    expect(headerCta).not.toBeNull();
    expect(headerCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(headerCta.hidden).toBe(false);
    expect(menuCta).not.toBeNull();
    expect(menuCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(menuCta.hidden).toBe(false);
    expect(login.textContent).toBe('Log in');
    expect(menuCta.nextElementSibling).toBe(login);

    page.dom.window.close();
  });

  it('runs a finite first-visit nudge and records it for the current session', async () => {
    const page = boot(sharedMarkup(), {
      reducedMotion: false,
      fakeTimers: true,
    });
    await flushPromises();

    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    expect(page.queuedTimers).toHaveLength(1);
    expect(headerCta.classList.contains('is-nudging')).toBe(false);

    page.queuedTimers.shift()();

    expect(headerCta.classList.contains('is-nudging')).toBe(true);
    expect(page.window.sessionStorage.getItem('eventflow_home_mobile_signup_nudge_seen_v1')).toBe(
      '1'
    );

    page.dom.window.close();
  });

  it('does not schedule the animated nudge when reduced motion is requested', async () => {
    const page = boot(sharedMarkup(), {
      reducedMotion: true,
      fakeTimers: true,
    });
    await flushPromises();

    expect(page.queuedTimers).toHaveLength(0);
    expect(
      page.document.getElementById('ef-mobile-signup-cta').classList.contains('is-nudging')
    ).toBe(false);

    page.dom.window.close();
  });

  it('keeps the glow finite and includes reduced-motion safeguards', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const homeLoader = fs.readFileSync(path.join(ROOT, 'public/assets/js/home.js'), 'utf8');
    const v2Loader = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/home-v2-navbar-parity.js'),
      'utf8'
    );

    expect(css).toContain('@keyframes ef-home-mobile-signup-glow');
    expect(css).toMatch(/ef-home-mobile-signup-glow[^;]+\s3\sboth/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(homeLoader).toContain('/assets/js/components/home-mobile-signup.js?v=1.0.0');
    expect(v2Loader).toContain('/assets/js/components/home-mobile-signup.js?v=1.0.0');
  });
});
