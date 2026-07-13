'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const SCRIPT_PATH = path.join(ROOT, 'public/assets/js/components/home-mobile-signup.js');
const CSS_PATH = path.join(ROOT, 'public/assets/css/home-mobile-signup.css');
const scriptSource = fs.readFileSync(SCRIPT_PATH, 'utf8');

class FakeClassList {
  constructor(initial = '') {
    this.values = new Set(String(initial).split(/\s+/).filter(Boolean));
  }

  add(...tokens) {
    tokens.forEach(token => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach(token => this.values.delete(token));
  }

  contains(token) {
    return this.values.has(token);
  }

  toString() {
    return Array.from(this.values).join(' ');
  }
}

function matchesSelector(element, selector) {
  if (!element || !selector) {
    return false;
  }
  if (selector.startsWith('#')) {
    return element.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    return element.classList.contains(selector.slice(1));
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.id = '';
    this.hidden = false;
    this.textContent = '';
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this._href = '';
  }

  set className(value) {
    this.classList = new FakeClassList(value);
  }

  get className() {
    return this.classList.toString();
  }

  set href(value) {
    this._href = String(value);
    this.attributes.set('href', this._href);
  }

  get href() {
    return this._href;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    const index = this.children.indexOf(reference);
    child.parentElement = this;
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  setAttribute(name, value) {
    const normalisedValue = String(value);
    this.attributes.set(name, normalisedValue);
    if (name === 'id') {
      this.id = normalisedValue;
    }
    if (name === 'class') {
      this.className = normalisedValue;
    }
    if (name === 'href') {
      this._href = normalisedValue;
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        return child;
      }
      const nested = child.querySelector(selector);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  contains(target) {
    if (this === target) {
      return true;
    }
    return this.children.some(child => child.contains(target));
  }

  get nextElementSibling() {
    if (!this.parentElement) {
      return null;
    }
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] || null : null;
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelector(selector) {
    if (matchesSelector(this.head, selector)) {
      return this.head;
    }
    if (matchesSelector(this.body, selector)) {
      return this.body;
    }
    return this.head.querySelector(selector) || this.body.querySelector(selector);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

function element(tagName, { id = '', className = '', text = '', href = '' } = {}) {
  const node = new FakeElement(tagName);
  node.id = id;
  node.className = className;
  node.textContent = text;
  if (href) {
    node.href = href;
  }
  return node;
}

function buildSharedDocument() {
  const document = new FakeDocument();
  const header = element('header', { className: 'ef-header' });
  const actions = element('div', { className: 'ef-header-actions' });
  const auth = element('a', { id: 'ef-auth-link', text: 'Log in', href: '/auth' });
  const toggle = element('button', { id: 'ef-mobile-toggle', text: 'Menu' });
  const mobileMenu = element('div', { id: 'ef-mobile-menu' });
  const mobileNav = element('nav', { className: 'ef-mobile-nav' });
  const mobileAuth = element('a', {
    id: 'ef-mobile-auth',
    className: 'ef-mobile-link ef-mobile-primary',
    text: 'Log in',
    href: '/auth',
  });

  actions.appendChild(auth);
  actions.appendChild(toggle);
  mobileNav.appendChild(mobileAuth);
  mobileMenu.appendChild(mobileNav);
  header.appendChild(actions);
  header.appendChild(mobileMenu);
  document.body.appendChild(header);
  return document;
}

function buildV2Document() {
  const document = new FakeDocument();
  document.body.className = 'home-v2-page';
  const header = element('header', { className: 'hv2-header' });
  const actions = element('div', { className: 'hv2-actions' });
  const auth = element('a', { id: 'hv2-auth-link', text: 'Log in', href: '/auth' });
  const toggle = element('button', { className: 'hv2-menu', text: 'Menu' });
  const mobileNav = element('nav', { id: 'hv2-mobile-nav', className: 'hv2-mobile-nav' });
  const mobileLogin = element('a', {
    className: 'hv2-mobile-login',
    text: 'Log in',
    href: '/auth',
  });

  actions.appendChild(auth);
  actions.appendChild(toggle);
  header.appendChild(actions);
  mobileNav.appendChild(mobileLogin);
  document.body.appendChild(header);
  document.body.appendChild(mobileNav);
  return document;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createMatchMedia({ mobile = true, reducedMotion = true } = {}) {
  return query => ({
    matches: query.includes('prefers-reduced-motion') ? reducedMotion : mobile,
  });
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function boot(mode, { user = null, reducedMotion = true, fakeTimers = false } = {}) {
  const document = mode === 'v2' ? buildV2Document() : buildSharedDocument();
  const sessionStorage = createStorage();
  const queuedTimers = [];
  const windowListeners = new Map();
  let subscriber = null;

  const window = {
    document,
    sessionStorage,
    matchMedia: createMatchMedia({ mobile: true, reducedMotion }),
    setTimeout(callback) {
      if (fakeTimers) {
        queuedTimers.push(callback);
        return queuedTimers.length;
      }
      return 1;
    },
    clearTimeout() {},
    addEventListener(name, callback) {
      windowListeners.set(name, callback);
    },
  };

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
  window.window = window;

  vm.runInNewContext(scriptSource, {
    window,
    document,
    sessionStorage,
    Promise,
    console,
  });

  return {
    document,
    sessionStorage,
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
    const page = boot('shared');
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
  });

  it('adds the same account discovery pattern to the V2 mobile header and menu', async () => {
    const page = boot('v2');
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
  });

  it('runs a finite first-visit nudge and records it for the current session', async () => {
    const page = boot('shared', {
      reducedMotion: false,
      fakeTimers: true,
    });
    await flushPromises();

    const headerCta = page.document.getElementById('ef-mobile-signup-cta');
    expect(page.queuedTimers).toHaveLength(1);
    expect(headerCta.classList.contains('is-nudging')).toBe(false);

    page.queuedTimers.shift()();

    expect(headerCta.classList.contains('is-nudging')).toBe(true);
    expect(page.sessionStorage.getItem('eventflow_home_mobile_signup_nudge_seen_v1')).toBe('1');
  });

  it('does not schedule the animated nudge when reduced motion is requested', async () => {
    const page = boot('shared', {
      reducedMotion: true,
      fakeTimers: true,
    });
    await flushPromises();

    expect(page.queuedTimers).toHaveLength(0);
    expect(
      page.document.getElementById('ef-mobile-signup-cta').classList.contains('is-nudging')
    ).toBe(false);
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
