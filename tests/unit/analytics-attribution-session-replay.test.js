'use strict';

const fs = require('fs');
const path = require('path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

describe('signup attribution and PostHog session replay', () => {
  const bridgeSource = read('public/assets/js/analytics-consent-upgrade.js');
  const replaySource = read('public/assets/js/behaviour-analytics.js');
  const routeSource = read('routes/behaviour-analytics.js');
  const behaviourUtilitySource = read('utils/behaviourAnalytics.js');
  const googleClientSource = read('public/assets/js/pages/auth-google-init.js');
  const googleServerSource = read('routes/google-redirect-auth.js');
  const adminDashboardSource = read('public/assets/js/pages/admin-init.js');
  const adminBehaviourSource = read('public/assets/js/pages/admin-behaviour-analytics.js');

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
    expect(bridgeSource).toContain(
      'identifyRegisteredUser(response).then(captureRegistration, captureRegistration)'
    );
  });

  test('clears stored attribution when analytics consent is withdrawn', () => {
    expect(bridgeSource).toContain('function clearAttribution()');
    expect(bridgeSource).toContain('window.localStorage.removeItem(ATTRIBUTION_KEY)');
    expect(bridgeSource).toContain('authPostHogStarted = false');
  });

  test('retains attribution in first-party analytics and exposes a signup-source report', () => {
    expect(behaviourUtilitySource).toContain("'first_channel'");
    expect(behaviourUtilitySource).toContain("'signup_method'");
    expect(behaviourUtilitySource).toContain('buildRegistrationSummary(events)');
    expect(adminBehaviourSource).toContain('baRegistrationChannels');
    expect(adminBehaviourSource).toContain('renderRegistrationSources(summary.registrations)');
  });

  test('carries consented attribution through a new Google signup', () => {
    expect(googleClientSource).toContain('state.attribution = attribution');
    expect(googleClientSource).toContain('state.analyticsSessionId = analyticsSessionId');
    expect(googleServerSource).toContain("signup_method: 'google'");
    expect(googleServerSource).toContain('recordGoogleSignupAnalytics(user, state)');
  });

  test('uses a real rolling seven-day comparison on the admin KPI', () => {
    expect(adminDashboardSource).toContain('summary.newPrevious7');
    expect(adminDashboardSource).not.toContain('const prevUsers = 0');
    expect(adminDashboardSource).not.toContain('this week');
  });
});
