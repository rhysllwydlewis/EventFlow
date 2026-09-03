'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'public/assets/js/components/home-mobile-signup.js');
const NUDGE_KEY = 'eventflow_home_mobile_signup_nudge_seen_v2';
const ACTIVE_CLASS = 'ef-home-mobile-signup-active';
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
  assert.ok(stylesheet, 'The mobile sign-up stylesheet link should be created.');
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

async function run() {
  {
    const page = boot(sharedMarkup());
    await page.ready();
    const header = page.document.querySelector('.ef-header');
    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    const menuCta = page.document.getElementById('ef-mobile-signup-menu');
    const login = page.document.getElementById('ef-mobile-auth');
    assert.equal(header.classList.contains(ACTIVE_CLASS), true);
    assert.equal(headerCta.textContent, 'Sign up');
    assert.equal(headerCta.getAttribute('href'), '/auth?tab=create');
    assert.equal(headerCta.hidden, false);
    assert.equal(menuCta.textContent, 'Create account');
    assert.equal(menuCta.getAttribute('href'), '/auth?tab=create');
    assert.equal(menuCta.nextElementSibling, login);
    assert.equal(login.textContent, 'Log in');
    assert.equal(login.classList.contains('ef-mobile-primary'), false);
    page.notifyAuth({ id: 'usr_1', role: 'customer' });
    assert.equal(header.classList.contains(ACTIVE_CLASS), false);
    assert.equal(headerCta.hidden, true);
    assert.equal(menuCta.hidden, true);
    close(page);
  }

  {
    const page = boot(v2Markup(), { user: { id: 'usr_2', role: 'supplier' } });
    await page.ready();
    const headerCta = page.document.getElementById('hv2-mobile-signup-cta');
    const menuCta = page.document.getElementById('hv2-mobile-signup-menu');
    const login = page.document.querySelector('.hv2-mobile-login');
    assert.equal(headerCta.getAttribute('href'), '/auth?tab=create');
    assert.equal(menuCta.getAttribute('href'), '/auth?tab=create');
    assert.equal(menuCta.nextElementSibling, login);
    assert.equal(headerCta.hidden, true);
    assert.equal(menuCta.hidden, true);
    close(page);
  }

  {
    const page = boot(sharedMarkup(), { stylesheetOutcome: 'error' });
    await page.ready();
    const header = page.document.querySelector('.ef-header');
    const login = page.document.getElementById('ef-mobile-auth');
    assert.equal(page.document.getElementById('ef-mobile-signup-cta'), null);
    assert.equal(page.document.getElementById('ef-mobile-signup-menu'), null);
    assert.equal(header.classList.contains(ACTIVE_CLASS), false);
    assert.equal(login.classList.contains('ef-mobile-primary'), true);
    assert.equal(login.classList.contains('ef-home-mobile-login'), false);
    close(page);
  }

  {
    const page = boot(sharedMarkup(), { reducedMotion: false });
    await page.ready();
    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    assert.equal(page.timers.filter(Boolean).length, 1);
    assert.equal(page.window.localStorage.getItem(NUDGE_KEY), null);
    page.timers[0]();
    assert.equal(headerCta.classList.contains('is-nudging'), true);
    assert.equal(page.window.localStorage.getItem(NUDGE_KEY), '1');
    assert.equal(page.timers.filter(Boolean).length, 2);
    close(page);
  }

  {
    const returning = boot(sharedMarkup(), { reducedMotion: false, seen: true });
    await returning.ready();
    assert.equal(returning.timers.filter(Boolean).length, 0);
    close(returning);

    const reducedMotion = boot(sharedMarkup(), { reducedMotion: true });
    await reducedMotion.ready();
    assert.equal(reducedMotion.timers.filter(Boolean).length, 0);
    close(reducedMotion);
  }

  console.log('Homepage mobile sign-up behaviour passed in the Node 22 jsdom runtime.');
}

run().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
