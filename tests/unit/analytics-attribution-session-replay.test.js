'use strict';

const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('signup attribution and PostHog session replay', () => {
  const browserSource = read('public/assets/js/analytics-consent-upgrade.js');
  const routeSource = read('routes/behaviour-analytics.js');

  test('enables replay by default while retaining an explicit environment kill switch', () => {
    expect(routeSource).toContain("envFlag('POSTHOG_SESSION_RECORDING_ENABLED', true)");
    expect(routeSource).toContain('sessionRecordingEnabled');
    expect(routeSource).toContain('replaySensitivePagesExcluded: true');
  });

  test('keeps replay consent-gated, masked and off on sensitive pages', () => {
    expect(browserSource).toContain('hasAnalyticsConsent()');
    expect(browserSource).toContain('maskAllInputs: true');
    expect(browserSource).toContain('maskTextSelector:');
    expect(browserSource).toContain('disable_session_recording: sensitive || !provider.sessionRecordingEnabled');
    expect(browserSource).toContain("'/auth'");
    expect(browserSource).toContain("'/payment'");
    expect(browserSource).toContain("'/messages'");
  });

  test('creates identified-only PostHog profiles without sending email or names', () => {
    expect(browserSource).toContain("person_profiles: 'identified_only'");
    expect(browserSource).toContain('window.posthog.identify(String(user.id)');
    expect(browserSource).not.toContain('person_profiles: \'never\'');
    expect(browserSource).not.toMatch(/posthog\.identify\([^\n]*(email|name)/i);
  });

  test('captures first-touch, last-touch and campaign attribution', () => {
    expect(browserSource).toContain("const ATTRIBUTION_KEY = 'ef_attribution_v1'");
    expect(browserSource).toContain("params.get('utm_source')");
    expect(browserSource).toContain("params.get('utm_medium')");
    expect(browserSource).toContain("params.get('utm_campaign')");
    expect(browserSource).toContain('first_channel');
    expect(browserSource).toContain('first_referrer_domain');
    expect(browserSource).toContain('first_landing_path');
    expect(browserSource).toContain('last_channel');
  });

  test('attributes email and Google registrations to an identified conversion event', () => {
    expect(browserSource).toContain("capturePostHog('registration_completed'");
    expect(browserSource).toContain("signup_method: 'email_password'");
    expect(browserSource).toContain("signup_method: 'google'");
    expect(browserSource).toContain("const GOOGLE_SIGNUP_PENDING_KEY = 'ef_google_signup_pending'");
  });

  test('explicitly starts recordings on eligible pages', () => {
    expect(browserSource).toContain('window.posthog.startSessionRecording?.()');
  });
});
