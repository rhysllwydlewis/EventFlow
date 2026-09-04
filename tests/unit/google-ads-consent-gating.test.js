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
  // Mutable so a test can change what `getConsent()` reports mid-session, the
  // way analytics-consent-upgrade.js's sensitive-page guard does.
  const state = { consent };

  const documentObject = {
    readyState: 'complete',
    head: { appendChild: script => injectedScripts.push(script) },
    createElement: () => ({}),
    addEventListener: jest.fn(),
  };

  const windowObject = {
    CookieConsent: consent === null ? undefined : { getConsent: () => state.consent },
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
    windowObject,
    /** True only if the queue entries are Arguments objects, as gtag.js needs. */
    queueIsArgumentsShaped: () =>
      (windowObject.dataLayer || []).every(
        entry => Object.prototype.toString.call(entry) === '[object Arguments]'
      ),
    consentCommands: kind =>
      commands().filter(command => command[0] === 'consent' && command[1] === kind),
    /** Sets what `getConsent()` reports, then fires the change event. */
    setConsent(next, detail) {
      state.consent = next;
      windowListeners.cookieConsentChanged({ detail: detail || next });
    },
  };
}

describe('Google Ads tag consent gating', () => {
  it('touches nothing at all before advertising consent', () => {
    const tag = loadTag({ essential: true, functional: false, analytics: false, marketing: false });

    // `window.gtag` must not exist yet: pages/locations.js and utils/analytics.js
    // both use its presence as their own consent check, so defining it early
    // would let their events queue into dataLayer unconsented.
    expect(tag.windowObject.gtag).toBeUndefined();
    expect(tag.windowObject.dataLayer).toBeUndefined();
    expect(tag.injectedScripts).toHaveLength(0);
  });

  it('declares the denied Consent Mode default ahead of the grant and config', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: false, marketing: true });

    const kinds = tag.commands().map(command => `${command[0]}:${command[1]}`);
    expect(kinds.slice(0, 2)).toEqual(['consent:default', 'consent:update']);
    expect(kinds).toContain(`config:${'AW-16705708195'}`);

    const [defaults] = tag.consentCommands('default');
    expect(defaults[2]).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });

  it('queues commands as Arguments objects, which is what gtag.js reads', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: false, marketing: true });

    // A rest-parameter array looks equivalent but is not recognised as a gtag
    // command, which would silently drop the consent and config calls.
    expect(tag.queueIsArgumentsShaped()).toBe(true);
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

    tag.setConsent({ essential: true, functional: true, analytics: true, marketing: true });

    expect(tag.injectedScripts).toHaveLength(1);
  });

  it('re-reads consent rather than trusting the event detail', () => {
    // On sensitive pages analytics-consent-upgrade.js wraps `getConsent` to force
    // advertising off, but the event detail comes straight from the consent
    // module and bypasses that wrapper. Taking the detail at face value would
    // inject gtag.js on exactly the pages the guard exists to protect.
    const guarded = { essential: true, functional: true, analytics: false, marketing: false };
    const tag = loadTag(guarded);

    tag.setConsent(guarded, { analytics: true, marketing: true });

    expect(tag.injectedScripts).toHaveLength(0);
    expect(tag.consentCommands('update')).toHaveLength(0);
  });

  it('sends a denied update when advertising consent is withdrawn', () => {
    const tag = loadTag({ essential: true, functional: true, analytics: true, marketing: true });

    tag.setConsent({ essential: true, functional: true, analytics: true, marketing: false });

    const updates = tag.consentCommands('update');
    expect(updates).toHaveLength(2);
    AD_SIGNALS.forEach(signal => expect(updates[1][2][signal]).toBe('denied'));
  });

  it('does not re-inject the script when consent is re-granted', () => {
    const granted = { essential: true, functional: true, analytics: true, marketing: true };
    const tag = loadTag(granted);

    tag.setConsent({ ...granted, marketing: false });
    tag.setConsent(granted);

    expect(tag.injectedScripts).toHaveLength(1);
    // granted → denied → granted, with no duplicate updates for unchanged state.
    expect(tag.consentCommands('update')).toHaveLength(3);
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
