'use strict';

/**
 * The Google Ads tag is the only advertising technology on the site, and the
 * Cookie Policy promises three things about it: it loads only on advertising
 * consent (not analytics consent), it never loads on admin pages, and
 * withdrawing consent takes effect for the rest of the session. gtag.js cannot
 * be unloaded once injected, so that last promise is kept with a Consent Mode
 * `denied` update rather than by removing the script.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { injectGlobalAnalyticsScripts } = require('../../utils/template-renderer');

const ROOT = path.join(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/assets/js/google-ads-tag.js'), 'utf8');
const AD_SIGNALS = ['ad_storage', 'ad_user_data', 'ad_personalization'];

function loadTag(consent) {
  const injectedScripts = [];
  const windowListeners = {};

  const documentObject = {
    readyState: 'complete',
    head: { appendChild: script => injectedScripts.push(script) },
    createElement: () => ({}),
    addEventListener: jest.fn(),
  };

  const windowObject = {
    CookieConsent: consent === null ? undefined : { getConsent: () => consent },
    addEventListener: (name, handler) => {
      windowListeners[name] = handler;
    },
  };
  windowObject.window = windowObject;

  const context = { window: windowObject, document: documentObject };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  /** The gtag command queue, as ['consent', 'update', {...}] style tuples. */
  const commands = () => (windowObject.dataLayer || []).map(entry => Array.from(entry));

  return {
    injectedScripts,
    commands,
    consentCommands: kind =>
      commands().filter(command => command[0] === 'consent' && command[1] === kind),
    changeConsent: detail => windowListeners.cookieConsentChanged({ detail }),
  };
}

describe('Google Ads tag consent gating', () => {
  it('declares denied advertising defaults before anything loads', () => {
    const tag = loadTag({ essential: true, functional: false, analytics: false, marketing: false });

    const [defaults] = tag.consentCommands('default');
    expect(defaults[2]).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    expect(tag.injectedScripts).toHaveLength(0);
  });

  it('does not load on analytics consent alone', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: true, marketing: false });

    expect(tag.injectedScripts).toHaveLength(0);
    expect(tag.consentCommands('update')).toHaveLength(0);
  });

  it('loads and grants when advertising consent is present at page load', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: false, marketing: true });

    expect(tag.injectedScripts).toHaveLength(1);
    expect(tag.injectedScripts[0].src).toContain('googletagmanager.com/gtag/js?id=AW-16705708195');

    const [update] = tag.consentCommands('update');
    AD_SIGNALS.forEach(signal => expect(update[2][signal]).toBe('granted'));
  });

  it('loads when advertising consent is granted later in the session', () => {
    const tag = loadTag({ essential: true, functional: false, analytics: false, marketing: false });
    expect(tag.injectedScripts).toHaveLength(0);

    tag.changeConsent({ analytics: true, marketing: true });

    expect(tag.injectedScripts).toHaveLength(1);
  });

  it('sends a denied update when advertising consent is withdrawn', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: true, marketing: true });

    tag.changeConsent({ analytics: true, marketing: false });

    const updates = tag.consentCommands('update');
    expect(updates).toHaveLength(2);
    AD_SIGNALS.forEach(signal => expect(updates[1][2][signal]).toBe('denied'));
  });

  it('does not re-inject the script when consent is re-granted', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: true, marketing: true });

    tag.changeConsent({ marketing: false });
    tag.changeConsent({ marketing: true });

    expect(tag.injectedScripts).toHaveLength(1);
  });

  it('stays inert when the consent module is unavailable', () => {
    const tag = loadTag(null);

    expect(tag.injectedScripts).toHaveLength(0);
    expect(tag.consentCommands('update')).toHaveLength(0);
  });

  it('is injected on public pages and withheld from admin pages', () => {
    const html = '<!doctype html><html><head></head><body><main>Page</main></body></html>';

    expect(injectGlobalAnalyticsScripts(html, '/suppliers.html')).toContain(
      '/assets/js/google-ads-tag.js'
    );
    expect(injectGlobalAnalyticsScripts(html, '/admin-settings.html')).not.toContain(
      '/assets/js/google-ads-tag.js'
    );
  });
});
