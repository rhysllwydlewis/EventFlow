'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { injectGlobalAnalyticsScripts } = require('../../utils/template-renderer');

const ROOT = path.join(__dirname, '../..');
const SOURCE = fs.readFileSync(
  path.join(ROOT, 'public/assets/js/analytics-consent-upgrade.js'),
  'utf8'
);

function executeBridge(pathname = '/suppliers') {
  const listeners = {};
  const insertedScripts = [];
  const classList = { remove: jest.fn() };
  const originalGetConsent = jest.fn(() => ({
    essential: true,
    functional: true,
    analytics: true,
  }));
  const cookieConsent = { getConsent: originalGetConsent };

  const documentObject = {
    readyState: 'loading',
    cookie: '',
    body: {
      classList,
      querySelectorAll: () => [],
    },
    addEventListener: jest.fn((name, handler) => {
      listeners[`document:${name}`] = handler;
    }),
    querySelectorAll: () => [],
    createElement: () => ({}),
    getElementsByTagName: () => [
      {
        parentNode: {
          insertBefore: script => insertedScripts.push(script),
        },
      },
    ],
  };

  const windowObject = {
    location: {
      pathname,
      origin: 'https://event-flow.co.uk',
      protocol: 'https:',
      hostname: 'event-flow.co.uk',
      href: `https://event-flow.co.uk${pathname}`,
    },
    CookieConsent: cookieConsent,
    addEventListener: jest.fn((name, handler) => {
      listeners[`window:${name}`] = handler;
    }),
    dispatchEvent: jest.fn(),
    setTimeout: jest.fn(() => 1),
    clearTimeout: jest.fn(),
    fetch: jest.fn(),
  };
  windowObject.window = windowObject;

  function CustomEvent(type, options) {
    this.type = type;
    this.detail = options && options.detail;
  }

  const context = {
    window: windowObject,
    document: documentObject,
    CustomEvent,
    MutationObserver: undefined,
    URL,
    Date,
    Set,
    Array,
    Object,
    String,
    console,
  };

  vm.runInNewContext(SOURCE, context, { filename: 'analytics-consent-upgrade.js' });

  return {
    classList,
    cookieConsent,
    documentObject,
    insertedScripts,
    listeners,
    originalGetConsent,
    windowObject,
  };
}

describe('independent analytics privacy hardening', () => {
  test('sanitises inherited PostHog URL properties after any existing before_send hook', () => {
    const runtime = executeBridge('/suppliers');
    const existingHook = jest.fn(event => {
      event.properties.$referrer = 'https://event-flow.co.uk/verify?token=added-by-hook';
      return event;
    });

    runtime.windowObject.posthog.init('phc_test', {
      api_host: 'https://eu.i.posthog.com',
      before_send: existingHook,
    });

    expect(runtime.insertedScripts).toHaveLength(1);
    expect(runtime.windowObject.posthog._i).toHaveLength(1);
    const config = runtime.windowObject.posthog._i[0][1];
    expect(config.mask_personal_data_properties).toBe(true);
    expect(config.disable_capture_url_hashes).toBe(true);

    const event = config.before_send({
      event: 'page_view',
      properties: {
        $current_url: 'https://event-flow.co.uk/verify?token=secret#section',
        $session_entry_url: 'https://event-flow.co.uk/suppliers?q=photographer',
      },
      $set_once: {
        $initial_referrer: 'https://example.com/referral?email=person@example.com',
      },
    });

    expect(existingHook).toHaveBeenCalledTimes(1);
    expect(event.properties.$current_url).toBe('https://event-flow.co.uk/verify');
    expect(event.properties.$session_entry_url).toBe('https://event-flow.co.uk/suppliers');
    expect(event.properties.$referrer).toBe('https://event-flow.co.uk/verify');
    expect(event.$set_once.$initial_referrer).toBe('https://example.com/referral');
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('person@example.com');
  });

  test('forces analytics off and prevents PostHog loading on token-bearing verification pages', () => {
    const runtime = executeBridge('/verify');

    expect(runtime.originalGetConsent).toHaveBeenCalledTimes(0);
    expect(runtime.windowObject.CookieConsent.getConsent().analytics).toBe(false);
    expect(runtime.originalGetConsent).toHaveBeenCalledTimes(1);

    runtime.windowObject.posthog.init('phc_test', {
      api_host: 'https://eu.i.posthog.com',
    });

    expect(runtime.insertedScripts).toHaveLength(0);
    expect(runtime.windowObject.posthog._i).toHaveLength(0);
  });

  test('no longer hijacks Accept All or rewrites the consent cookie', () => {
    const runtime = executeBridge('/suppliers');

    // cookie-consent.js now records every optional category from Accept All, so
    // this bridge has no reason to intercept the click — and every reason not
    // to, since its fixed three-field record dropped the advertising decision.
    expect(runtime.listeners['document:click']).toBeUndefined();
    expect(runtime.documentObject.cookie).not.toContain('eventflow_cookie_consent');
  });

  test('forces advertising off alongside analytics on sensitive pages', () => {
    const runtime = executeBridge('/messages');

    // The Google Ads tag reads the marketing category, so the sensitive-page
    // guard has to suppress that too or the tag would run where PostHog cannot.
    const guarded = runtime.windowObject.CookieConsent.getConsent();
    expect(guarded.analytics).toBe(false);
    expect(guarded.marketing).toBe(false);
  });

  test('uses a new asset URL so browsers do not retain the pre-hardening bridge for a week', () => {
    const html = injectGlobalAnalyticsScripts(
      '<!doctype html><html><head></head><body></body></html>',
      '/suppliers.html'
    );

    expect(html).toContain('/assets/js/analytics-consent-upgrade.js?v=5');
    expect(html).not.toContain('/assets/js/analytics-consent-upgrade.js?v=4');
    expect(html).not.toContain('/assets/js/analytics-consent-upgrade.js?v=2');
    expect(html).not.toContain('/assets/js/analytics-consent-upgrade.js?v=1');

    // A cached copy of the pre-advertising consent module would keep writing
    // records with no marketing decision, so its URL moves too.
    expect(html).toContain('/assets/js/cookie-consent.js?v=3.0.0');
    expect(html).not.toContain('/assets/js/cookie-consent.js?v=2.1.1');
  });
});
