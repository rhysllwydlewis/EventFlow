'use strict';

const fs = require('fs');
const path = require('path');
const { injectGlobalAnalyticsScripts } = require('../../utils/template-renderer');
const behaviourAnalyticsRoutes = require('../../routes/behaviour-analytics');

const ROOT = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('global behaviour analytics injection', () => {
  test('injects consent and analytics scripts once on public HTML', () => {
    const html = '<!doctype html><html><head></head><body><main>Page</main></body></html>';
    const first = injectGlobalAnalyticsScripts(html, '/suppliers.html');
    const second = injectGlobalAnalyticsScripts(first, '/suppliers.html');

    expect(first).toContain('/assets/js/cookie-consent.js');
    expect(first).toContain('/assets/js/analytics-consent-upgrade.js');
    expect(first).toContain('/assets/js/behaviour-analytics.js');
    expect((second.match(/behaviour-analytics\.js/g) || []).length).toBe(1);
  });

  test('keeps public tracking off admin pages and links the admin analytics extension', () => {
    const html = '<html><head></head><body></body></html>';
    const adminAnalytics = injectGlobalAnalyticsScripts(html, '/admin-analytics.html');
    const otherAdmin = injectGlobalAnalyticsScripts(html, '/admin-users.html');

    expect(adminAnalytics).toContain('/assets/js/pages/admin-behaviour-analytics.js');
    expect(adminAnalytics).not.toContain('/assets/js/behaviour-analytics.js');
    expect(otherAdmin).not.toContain('/assets/js/behaviour-analytics.js');
    expect(otherAdmin).not.toContain('/assets/js/pages/admin-behaviour-analytics.js');
  });
});

describe('analytics consent and privacy wiring', () => {
  test('leaves the consent cookie to the consent module alone', () => {
    const source = read('public/assets/js/analytics-consent-upgrade.js');

    // This module used to intercept the Accept All buttons and rewrite the
    // cookie itself, to work around cookie-consent.js recording
    // `analytics: false` from them. That is fixed at source, and the workaround
    // had to go: it wrote a fixed three-field record, so it silently discarded
    // the visitor's advertising decision.
    expect(source).not.toContain('#cookie-consent-accept, #cookie-prefs-accept-all');
    expect(source).not.toContain('eventflow_cookie_consent');
    expect(source).toContain("window.addEventListener('cookieConsentChanged'");
  });

  test('leaves the consent banner and dialog copy to the consent module', () => {
    const source = read('public/assets/js/analytics-consent-upgrade.js');

    // The bridge used to rewrite this copy at runtime, matching on the phrase
    // "functional cookies" — which the corrected banner text still contains, so
    // the override kept replacing a message naming analytics and advertising
    // with one that mentions neither.
    expect(source).not.toContain('cookie-consent-message p');
    expect(source).not.toContain('cookie-prefs-category-desc');

    const banner = read('public/assets/js/cookie-consent.js');
    expect(banner).toContain('analytics cookies');
    expect(banner).toContain('advertising cookies for Google Ads conversion measurement');
  });

  test('cache-busts the consent module everywhere it is referenced', () => {
    // Most public pages hard-code the cookie-consent.js tag, so the server-side
    // injection is skipped for them and its version query never reaches them.
    // Assets are served with `max-age=604800`, so a stale hard-coded version
    // leaves returning visitors running the previous consent script for a week —
    // with the current analytics bridge, which no longer compensates for its
    // "Accept All" bug. The two references have to move together.
    const injected = read('utils/template-renderer.js').match(
      /assets\/js\/cookie-consent\.js\?v=([\d.]+)/
    );
    expect(injected).not.toBeNull();

    const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(file => file.endsWith('.html'));
    const versions = new Set();
    pages.forEach(file => {
      const source = read(path.join('public', file));
      for (const match of source.matchAll(/assets\/js\/cookie-consent\.js\?v=([\d.]+)/g)) {
        versions.add(match[1]);
      }
    });

    expect(versions.size).toBeLessThanOrEqual(1);
    if (versions.size === 1) {
      expect([...versions][0]).toBe(injected[1]);
    }
  });

  test('keeps the consent module as the single writer of the consent cookie', () => {
    const writers = [
      'public/assets/js/analytics-consent-upgrade.js',
      'public/assets/js/behaviour-analytics.js',
      'public/assets/js/google-ads-tag.js',
    ].filter(file => read(file).includes('eventflow_cookie_consent'));

    expect(writers).toEqual([]);
    expect(read('public/assets/js/cookie-consent.js')).toContain('eventflow_cookie_consent');
  });

  test('tracks real key conversions only after a successful application response', () => {
    const source = read('public/assets/js/analytics-consent-upgrade.js');
    expect(source).toContain('response.ok ? successfulEventFor(request) : null');
    expect(source).toContain("event: 'registration_completed'");
    expect(source).toContain("event: 'quote_request_submitted'");
    expect(source).toContain("event: 'package_created'");
    expect(source).toContain('me\\/packages');
    expect(source).not.toContain("event: 'package_published'");
    expect(source).not.toContain('options.body');
  });

  test('bridges consented public page views to PostHog Web Analytics once', () => {
    const source = read('public/assets/js/analytics-consent-upgrade.js');
    expect(source).toContain("window.posthog.capture('$pageview'");
    expect(source).toContain('$current_url: currentUrl');
    expect(source).toContain('$pathname: currentPath()');
    expect(source).toContain('capturedPostHogPage === currentUrl');
    expect(source).toContain('POSTHOG_PAGEVIEW_TIMEOUT_MS');
    expect(source).toContain("window.addEventListener('cookieConsentChanged'");
    expect(source).toContain("'/auth'");
    expect(source).toContain("'/payment'");
    expect(source).toContain('return `${window.location.origin}${currentPath()}`;');
    expect(source).not.toContain('phc_');
  });

  test('pairs each consented PostHog pageview with a reliable privacy-safe pageleave', () => {
    const bridgeSource = read('public/assets/js/analytics-consent-upgrade.js');
    const collectorSource = read('public/assets/js/behaviour-analytics.js');
    const pageShowStart = bridgeSource.indexOf('function handlePostHogPageShow(event)');
    // Ends at whatever declaration follows, rather than at one named function,
    // so removing a neighbour does not silently widen the slice.
    const pageShowEnd = bridgeSource.indexOf('\n  function ', pageShowStart + 1);
    const pageShowHandler = bridgeSource.slice(pageShowStart, pageShowEnd);

    expect(bridgeSource).toMatch(/window\.posthog\.capture\(\s*'\$pageleave'/);
    expect(bridgeSource).toContain("window.addEventListener('pagehide', capturePostHogPageleave)");
    expect(bridgeSource).toContain("window.addEventListener('pageshow', handlePostHogPageShow)");
    expect(bridgeSource).toContain("transport: 'sendBeacon'");
    expect(bridgeSource).toContain('event?.persisted !== true');
    expect(bridgeSource).toContain('capturedPostHogPageleave');
    expect(bridgeSource).toContain('capturedPostHogPage !== currentUrl');
    expect(bridgeSource).toContain('!hasAnalyticsConsent()');
    expect(bridgeSource).not.toContain('$pageview_duration');
    expect(collectorSource).toContain('capture_pageleave: false');
    expect(pageShowStart).toBeGreaterThan(-1);
    expect(pageShowEnd).toBeGreaterThan(pageShowStart);
    expect(pageShowHandler).toContain('capturedPostHogPageleave = false');
    expect(pageShowHandler).not.toContain('queuePostHogPageview');
  });

  test('measures active time only while the page is visible and focused', () => {
    const source = read('public/assets/js/behaviour-analytics.js');
    expect(source).toContain("document.visibilityState === 'visible' && document.hasFocus()");
    expect(source).toContain("window.addEventListener('blur'");
    expect(source).toContain("window.addEventListener('pagehide'");
    expect(source).toContain('navigator.sendBeacon');
  });

  test('uses secure browser randomness and never falls back to Math.random', () => {
    const source = read('public/assets/js/behaviour-analytics.js');
    expect(source).toContain('window.crypto.getRandomValues(bytes)');
    expect(source).not.toContain('Math.random');
  });

  test('masks replay inputs and strips query strings before optional PostHog capture', () => {
    const source = read('public/assets/js/behaviour-analytics.js');
    expect(source).toContain('maskAllInputs: true');
    expect(source).toContain("request.name = request.name.split('?')[0]");
    expect(source).toContain('opt_out_capturing_by_default: true');
    expect(source).toContain("person_profiles: 'never'");
    expect(source).not.toContain('posthog.identify');
    expect(source).toContain('/supplier/profile-customization');
    expect(source).toMatch(/if \(isSensitiveInteractionPage\(\)\)\s*\{?\s*return;/);
    expect(source).toContain("defaults: '2026-05-30'");
  });
});

describe('admin analytics live refresh and PostHog guidance', () => {
  test('refreshes the analytics page every 15 seconds only while visible', () => {
    const source = read('public/assets/js/pages/admin-analytics-init.js');
    expect(source).toContain('const AUTO_REFRESH_INTERVAL_MS = 15 * 1000');
    expect(source).toContain(
      "document.addEventListener('visibilitychange', handleVisibilityChange)"
    );
    expect(source).toContain("document.visibilityState !== 'visible'");
    expect(source).toContain('refreshButton.click()');
    expect(source).toContain('Paused while this tab is hidden');
  });

  test('does not present the general PostHog homepage as a project dashboard', () => {
    const source = read('public/assets/js/pages/admin-analytics-init.js');
    expect(source).toContain('function isSpecificPostHogDestination');
    expect(source).toContain('/^\\/project\\/[^/]+(?:\\/|$)/');
    expect(source).toContain('POSTHOG_DASHBOARD_URL in Railway');
    expect(source).toContain('link.hidden = true');
  });
});

describe('behaviour analytics server protections', () => {
  const { hasAnalyticsConsentCookie, safeHttpsUrl, getConfig } = behaviourAnalyticsRoutes._private;

  test('requires an analytics-enabled consent cookie', () => {
    const enabled = encodeURIComponent(
      JSON.stringify({
        v: 1,
        essential: true,
        functional: true,
        analytics: true,
      })
    );
    const disabled = encodeURIComponent(
      JSON.stringify({
        v: 1,
        essential: true,
        functional: true,
        analytics: false,
      })
    );

    const request = value => ({
      cookies: { eventflow_cookie_consent: value },
      get: () => '',
    });

    expect(hasAnalyticsConsentCookie(request(enabled))).toBe(true);
    expect(hasAnalyticsConsentCookie(request(disabled))).toBe(false);
    expect(hasAnalyticsConsentCookie(request('invalid'))).toBe(false);
  });

  test('preserves a configured PostHog project path while rejecting non-HTTPS URLs', () => {
    expect(safeHttpsUrl('https://eu.posthog.com/project/12345/dashboard/7')).toBe(
      'https://eu.posthog.com/project/12345/dashboard/7'
    );
    expect(safeHttpsUrl('http://eu.posthog.com/project/12345', '')).toBe('');
  });

  test('keeps the full configured PostHog dashboard URL in admin status configuration', () => {
    const previous = process.env.POSTHOG_DASHBOARD_URL;
    const previousKey = process.env.POSTHOG_PROJECT_KEY;
    process.env.POSTHOG_PROJECT_KEY = 'phc_test';
    process.env.POSTHOG_DASHBOARD_URL = 'https://eu.posthog.com/project/12345/dashboard/7';

    try {
      expect(getConfig().posthog.dashboardUrl).toBe(
        'https://eu.posthog.com/project/12345/dashboard/7'
      );
    } finally {
      if (previous === undefined) {
        delete process.env.POSTHOG_DASHBOARD_URL;
      } else {
        process.env.POSTHOG_DASHBOARD_URL = previous;
      }
      if (previousKey === undefined) {
        delete process.env.POSTHOG_PROJECT_KEY;
      } else {
        process.env.POSTHOG_PROJECT_KEY = previousKey;
      }
    }
  });
});
