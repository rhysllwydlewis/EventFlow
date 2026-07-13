'use strict';

const fs = require('fs');
const path = require('path');
const { injectGlobalAnalyticsScripts } = require('../../utils/template-renderer');

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
  test('corrects both Accept All actions to include analytics consent', () => {
    const source = read('public/assets/js/analytics-consent-upgrade.js');
    expect(source).toContain("analytics: true");
    expect(source).toContain('#cookie-consent-accept, #cookie-prefs-accept-all');
    expect(source).toContain("new CustomEvent('cookieConsentChanged'");
  });

  test('measures active time only while the page is visible and focused', () => {
    const source = read('public/assets/js/behaviour-analytics.js');
    expect(source).toContain("document.visibilityState === 'visible' && document.hasFocus()");
    expect(source).toContain("window.addEventListener('blur'");
    expect(source).toContain("window.addEventListener('pagehide'");
    expect(source).toContain('navigator.sendBeacon');
  });

  test('masks replay inputs and strips query strings before optional PostHog capture', () => {
    const source = read('public/assets/js/behaviour-analytics.js');
    expect(source).toContain('maskAllInputs: true');
    expect(source).toContain("request.name = request.name.split('?')[0]");
    expect(source).toContain('opt_out_capturing_by_default: true');
    expect(source).toContain("defaults: '2026-05-30'");
  });
});
