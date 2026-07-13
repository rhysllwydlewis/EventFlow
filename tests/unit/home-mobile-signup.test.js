'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'public/assets/js/components/home-mobile-signup.js');
const CSS_PATH = path.join(ROOT, 'public/assets/css/home-mobile-signup.css');
const NUDGE_KEY = 'eventflow_home_mobile_signup_nudge_seen_v2';
const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

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
  await Promise.resolve();
}

function boot(
  html,
  { user = null, reducedMotion = true, seen = false, stylesheetOutcome = 'load' } = {}
) {
  const dom = new JSDOM(html, {
    url: 'https://event-flow.co.uk/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const timers = [];
  let subscriber = null;

  window.matchMedia = query => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : true,
    media: query,
  });
  window.setTimeout = callback => {
    timers.push(callback);
    return timers.length;
  };
  window.clearTimeout = id => {
    timers[id - 1] = null;
  };

  if (seen) {
    window.localStorage.setItem(NUDGE_KEY, '1');
  }

  const authManager = {
    subscribe(callback) {
      subscriber = callback;
      return () => {};
    },
    init() {
      return Promise.resolve({ user });
    },
  };

  window.AuthStateManager = authManager;
  window.__authState = authManager;
  window.eval(scriptSource);

  const stylesheet = window.document.getElementById('ef-home-mobile-signup-css');
  stylesheet.dispatchEvent(new window.Event(stylesheetOutcome));

  return {
    dom,
    window,
    document: window.document,
    timers,
    async ready() {
      await flushPromises();
    },
    notifyAuth(nextUser) {
      subscriber?.({ user: nextUser });
    },
  };
}

function close(page) {
  page.dom.window.close();
}

describe('homepage mobile sign-up CTA', () => {
  it('adds Sign up to the shared V1/V3 header and keeps both account actions in the burger menu', async () => {
    const page = boot(sharedMarkup());
    await page.ready();

    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    const menuCta = page.document.getElementById('ef-mobile-signup-menu');
    const login = page.document.getElementById('ef-mobile-auth');

    expect(headerCta.textContent).toBe('Sign up');
    expect(headerCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(headerCta.hidden).toBe(false);
    expect(menuCta.textContent).toBe('Create free account');
    expect(menuCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(menuCta.nextElementSibling).toBe(login);
    expect(login.textContent).toBe('Log in');
    expect(login.classList.contains('ef-mobile-primary')).toBe(false);

    page.notifyAuth({ id: 'usr_1', role: 'customer' });
    expect(headerCta.hidden).toBe(true);
    expect(menuCta.hidden).toBe(true);

    close(page);
  });

  it('applies the same account-discovery pattern to V2 and stays hidden for signed-in users', async () => {
    const page = boot(v2Markup(), {
      user: { id: 'usr_2', role: 'supplier' },
    });
    await page.ready();

    const headerCta = page.document.getElementById('hv2-mobile-signup-cta');
    const menuCta = page.document.getElementById('hv2-mobile-signup-menu');
    const login = page.document.querySelector('.hv2-mobile-login');

    expect(headerCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(menuCta.getAttribute('href')).toBe('/auth?tab=create');
    expect(menuCta.nextElementSibling).toBe(login);
    expect(headerCta.hidden).toBe(true);
    expect(menuCta.hidden).toBe(true);

    close(page);
  });

  it('keeps the original burger-menu login treatment if the CTA stylesheet fails', async () => {
    const page = boot(sharedMarkup(), { stylesheetOutcome: 'error' });
    await page.ready();

    const login = page.document.getElementById('ef-mobile-auth');
    expect(page.document.getElementById('ef-mobile-signup-cta')).toBeNull();
    expect(page.document.getElementById('ef-mobile-signup-menu')).toBeNull();
    expect(login.classList.contains('ef-mobile-primary')).toBe(true);
    expect(login.classList.contains('ef-home-mobile-login')).toBe(false);

    close(page);
  });

  it('starts a finite first-visit glow and records it only when the glow actually begins', async () => {
    const page = boot(sharedMarkup(), { reducedMotion: false });
    await page.ready();

    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    expect(page.timers.filter(Boolean)).toHaveLength(1);
    expect(page.window.localStorage.getItem(NUDGE_KEY)).toBeNull();

    page.timers[0]();

    expect(headerCta.classList.contains('is-nudging')).toBe(true);
    expect(page.window.localStorage.getItem(NUDGE_KEY)).toBe('1');
    expect(page.timers.filter(Boolean)).toHaveLength(2);

    close(page);
  });

  it('does not repeat the glow for returning visitors or users who prefer reduced motion', async () => {
    const returning = boot(sharedMarkup(), { reducedMotion: false, seen: true });
    await returning.ready();
    expect(returning.timers.filter(Boolean)).toHaveLength(0);
    close(returning);

    const reducedMotion = boot(sharedMarkup(), { reducedMotion: true });
    await reducedMotion.ready();
    expect(reducedMotion.timers.filter(Boolean)).toHaveLength(0);
    close(reducedMotion);
  });

  it('keeps assets versioned, touch targets accessible and V2 hover contrast intact', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const homeLoader = fs.readFileSync(path.join(ROOT, 'public/assets/js/home.js'), 'utf8');
    const v2Loader = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/home-v2-navbar-parity.js'),
      'utf8'
    );

    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@keyframes ef-home-mobile-signup-glow');
    expect(css).toMatch(/ef-home-mobile-signup-glow[^;]+\s3\sboth/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.home-v2-page .hv2-mobile-nav .hv2-mobile-signup-menu:hover');
    expect(homeLoader).toContain('/assets/css/home-mobile-signup.css?v=1.1.0');
    expect(homeLoader).toContain('/assets/js/components/home-mobile-signup.js?v=1.1.0');
    expect(v2Loader).toContain('/assets/css/home-mobile-signup.css?v=1.1.0');
    expect(v2Loader).toContain('/assets/js/components/home-mobile-signup.js?v=1.1.0');
  });
});