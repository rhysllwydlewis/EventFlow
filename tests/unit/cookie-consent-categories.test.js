'use strict';

/**
 * Consent categories are a legal statement as much as a code one: the Cookie
 * Policy at /legal#cookies tells visitors that advertising is a separate choice
 * from analytics, that "Accept All" grants every optional category, and that
 * withdrawing advertising consent takes effect. These tests hold the runtime to
 * those promises.
 *
 * The client script is executed in a `vm` against a hand-built DOM stub, the
 * same approach analytics-independent-hardening.test.js uses, because this
 * project has no jsdom test environment.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const CONSENT_SOURCE = fs.readFileSync(
  path.join(ROOT, 'public/assets/js/cookie-consent.js'),
  'utf8'
);

const COOKIE_NAME = 'eventflow_cookie_consent';

/** A stub element that records the listeners and mutations the script performs. */
function stubElement(id) {
  return {
    id: id || '',
    className: '',
    innerHTML: '',
    checked: false,
    parentNode: null,
    style: {},
    listeners: {},
    classList: { add: jest.fn(), remove: jest.fn(), toggle: jest.fn() },
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
    focus: jest.fn(),
    appendChild: jest.fn(),
    removeChild: jest.fn(),
    addEventListener(name, handler) {
      this.listeners[name] = handler;
    },
    removeEventListener: jest.fn(),
    querySelector: () => stubElement(),
    querySelectorAll: () => [],
  };
}

function loadConsentScript(initialCookie) {
  const elements = new Map();
  const dispatched = [];
  let cookieJar = initialCookie ? `${COOKIE_NAME}=${initialCookie}` : '';

  const documentObject = {
    // 'complete' lets the script initialise on load, exactly as it does on a
    // page where the stylesheet-blocked parse has already finished, so the
    // banner's real button handlers are registered.
    readyState: 'complete',
    get cookie() {
      return cookieJar;
    },
    set cookie(value) {
      const [pair] = value.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const raw = pair.slice(separator + 1);
      if (/expires=[^;]*1970/.test(value) || value.includes('expires=Thu, 01 Jan 1970')) {
        cookieJar = '';
        return;
      }
      cookieJar = `${name}=${raw}`;
    },
    body: stubElement('body'),
    addEventListener: jest.fn(),
    createElement: () => stubElement(),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, stubElement(id));
      }
      return elements.get(id);
    },
    querySelectorAll: () => [],
  };

  const windowObject = {
    location: { protocol: 'https:' },
    addEventListener: jest.fn(),
    dispatchEvent: event => dispatched.push(event),
    requestAnimationFrame: callback => callback(),
    CustomEvent: function CustomEvent(type, options) {
      this.type = type;
      this.detail = options && options.detail;
    },
  };
  windowObject.window = windowObject;

  const context = {
    window: windowObject,
    document: documentObject,
    localStorage: { removeItem: jest.fn(), getItem: () => null, setItem: jest.fn() },
    location: windowObject.location,
    console: { warn: jest.fn(), error: jest.fn() },
    setTimeout: callback => {
      callback();
      return 1;
    },
    clearTimeout: jest.fn(),
    requestAnimationFrame: windowObject.requestAnimationFrame,
  };
  // The script constructs a bare `CustomEvent`, so it has to exist as a global
  // in the sandbox and not only as a property of `window`.
  context.CustomEvent = windowObject.CustomEvent;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(CONSENT_SOURCE, context);

  const readCookie = () => {
    const raw = cookieJar.slice(cookieJar.indexOf('=') + 1);
    return raw ? JSON.parse(decodeURIComponent(raw)) : null;
  };

  return {
    api: windowObject.CookieConsent,
    elements,
    dispatched,
    readCookie,
    documentObject,
    /** Clicks one of the banner's buttons by id. */
    clickBannerButton(id) {
      elements.get(id).listeners.click();
    },
    /** Opens the preferences dialog, then clicks one of its buttons by id. */
    openPreferencesAndClick(id, toggles) {
      windowObject.CookieConsent.openPreferences();
      Object.entries(toggles || {}).forEach(([toggleId, checked]) => {
        documentObject.getElementById(toggleId).checked = checked;
      });
      elements.get(id).listeners.click();
    },
  };
}

describe('cookie consent categories', () => {
  it('exposes four categories, all optional ones denied before a decision', () => {
    const { api } = loadConsentScript();

    expect(api.getConsent()).toEqual({
      essential: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
    expect(api.hasConsent()).toBe(false);
  });

  it('grants every optional category from the banner’s Accept All', () => {
    const consent = loadConsentScript();

    consent.clickBannerButton('cookie-consent-accept');

    expect(consent.readCookie()).toMatchObject({
      essential: true,
      functional: true,
      analytics: true,
      marketing: true,
    });
  });

  it('denies every optional category from the banner’s Reject', () => {
    const consent = loadConsentScript();

    consent.clickBannerButton('cookie-consent-reject');

    expect(consent.readCookie()).toMatchObject({
      functional: false,
      analytics: false,
      marketing: false,
    });
  });

  it('keeps advertising separate from analytics in the preferences dialog', () => {
    const consent = loadConsentScript();

    consent.openPreferencesAndClick('cookie-prefs-save', {
      'cookie-pref-functional': true,
      'cookie-pref-analytics': true,
      'cookie-pref-marketing': false,
    });

    // Consenting to measurement must not switch advertising on.
    expect(consent.readCookie()).toMatchObject({
      functional: true,
      analytics: true,
      marketing: false,
    });
  });

  it('records an advertising-only choice', () => {
    const consent = loadConsentScript();

    consent.openPreferencesAndClick('cookie-prefs-save', {
      'cookie-pref-functional': false,
      'cookie-pref-analytics': false,
      'cookie-pref-marketing': true,
    });

    expect(consent.readCookie()).toMatchObject({
      functional: false,
      analytics: false,
      marketing: true,
    });
  });

  it('treats a record written before advertising existed as no advertising consent', () => {
    const legacy = encodeURIComponent(
      JSON.stringify({ v: 1, essential: true, functional: true, analytics: true })
    );
    const { api } = loadConsentScript(legacy);

    expect(api.getConsent()).toEqual({
      essential: true,
      functional: true,
      analytics: true,
      marketing: false,
    });
  });

  it('migrates the legacy string values without granting advertising', () => {
    expect(loadConsentScript('accepted').api.getConsent()).toEqual({
      essential: true,
      functional: true,
      analytics: false,
      marketing: false,
    });
    expect(loadConsentScript('rejected').api.getConsent()).toEqual({
      essential: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
  });

  it('publishes the marketing decision on the consent change event', () => {
    const consent = loadConsentScript();

    consent.clickBannerButton('cookie-consent-accept');

    const event = consent.dispatched.find(candidate => candidate.type === 'cookieConsentChanged');
    expect(event.detail).toMatchObject({ analytics: true, marketing: true });
  });

  it('does not describe analytics as unused', () => {
    // The dialog told visitors analytics was "currently unused" long after
    // PostHog and the Google Ads tag were live.
    expect(CONSENT_SOURCE).not.toMatch(/currently unused/i);
  });
});
