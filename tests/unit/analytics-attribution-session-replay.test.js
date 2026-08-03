'use strict';

const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('signup attribution and PostHog session replay', () => {
  const bridgeSource = read('public/assets/js/analytics-consent-upgrade.js');
  const replaySource = read('public/assets/js/behaviour-analytics.js');
  const routeSource = read('routes/behaviour-analytics.js');

  test('enables replay by default while retaining an explicit environment kill switch', () => {
    expect(routeSource).toContain("envFlag('POSTHOG_SESSION_RECORDING_ENABLED', true)");
    expect(routeSource).toContain('sessionRecordingEnabled');
    expect(routeSource).toContain('replaySensitivePagesExcluded: true');
  });

  test('keeps replay consent-gated, masked and off on sensitive pages', () => {
    expect(replaySource).toContain('hasAnalyticsConsent()');
    expect(replaySource).toContain('maskAllInputs: true');
    expect(replaySource).toContain('maskTextSelector:');
    expect(replaySource).toContain('disable_session_recording: !replayAllowed');
    expect(replaySource).toContain("'/auth'");
    expect(replaySource).toContain("'/payment'");
    expect(replaySource).toContain("'/messages'");
  });

  test('identifies a completed email registration without sending email or names', () => {
    expect(bridgeSource).toContain("person_profiles: 'identified_only'");
    expect(bridgeSource).toContain('window.posthog.identify(String(user.id)');
    expect(bridgeSource).not.toMatch(/posthog\.identify\([^\n]*(email|name)/i);
    expect(bridgeSource).toContain('disable_session_recording: true');
  });

  test('captures first-touch, last-touch and campaign attribution', () => {
    expect(bridgeSource).toContain("const ATTRIBUTION_KEY = 'ef_attribution_v1'");
    expect(bridgeSource).toContain("params.get('utm_source')");
    expect(bridgeSource).toContain("params.get('utm_medium')");
    expect(bridgeSource).toContain("params.get('utm_campaign')");
    expect(bridgeSource).toContain('first_channel');
    expect(bridgeSource).toContain('first_referrer_domain');
    expect(bridgeSource).toContain('first_landing_path');
    expect(bridgeSource).toContain('last_channel');
  });

  test('attributes successful email registrations to a PostHog conversion event', () => {
    expect(bridgeSource).toContain("event: 'registration_completed'");
    expect(bridgeSource).toContain("signup_method: 'email_password'");
    expect(bridgeSource).toContain(
      'window.posthog.capture(conversion.event, conversion.properties)'
    );
    expect(bridgeSource).toContain('response.ok ? successfulEventFor(request) : null');
  });
});
