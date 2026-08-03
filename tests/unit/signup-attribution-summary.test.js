'use strict';

const { sanitizeEvent, buildSummary } = require('../../utils/behaviourAnalytics');

describe('privacy-safe signup attribution summary', () => {
  const now = new Date('2026-08-03T12:00:00.000Z');

  function registration(overrides = {}) {
    return sanitizeEvent(
      {
        event: 'registration_completed',
        sessionId: overrides.sessionId || 'session-one',
        pagePath: '/auth?secret=removed',
        pageType: 'auth',
        referrerDomain: 'https://www.google.com/search?q=eventflow',
        deviceType: 'mobile',
        timestamp: overrides.timestamp || '2026-08-03T11:00:00.000Z',
        properties: {
          attribution_available: true,
          first_channel: 'organic_search',
          first_referrer_domain: 'https://www.google.com/search?q=private',
          first_landing_path: '/pricing?email=person@example.com',
          first_utm_source: 'google',
          first_utm_campaign: 'summer person@example.com',
          signup_method: overrides.signupMethod || 'email_password',
        },
      },
      {
        now,
        userId: 'usr-private',
        userRole: 'customer',
        hashSalt: 'test-salt',
      }
    );
  }

  test('retains approved attribution fields while removing URLs and personal data', () => {
    const event = registration();
    expect(event.properties).toMatchObject({
      attribution_available: true,
      first_channel: 'organic_search',
      first_referrer_domain: 'google.com',
      first_landing_path: '/pricing',
      first_utm_source: 'google',
      signup_method: 'email_password',
    });
    expect(event.properties.first_utm_campaign).toContain('[redacted-email]');
    expect(JSON.stringify(event)).not.toContain('person@example.com');
    expect(JSON.stringify(event)).not.toContain('usr-private');
  });

  test('builds channel, source and signup-method registration breakdowns', () => {
    const emailRegistration = registration();
    const googleRegistration = registration({
      sessionId: 'session-two',
      signupMethod: 'google',
      timestamp: '2026-08-03T11:30:00.000Z',
    });
    const summary = buildSummary([emailRegistration, googleRegistration], 7, now);
    expect(summary.registrations.total).toBe(2);
    expect(summary.registrations.byChannel).toEqual([{ key: 'organic_search', count: 2 }]);
    expect(summary.registrations.bySource).toEqual([{ key: 'google', count: 2 }]);
    expect(summary.registrations.bySignupMethod).toEqual([
      { key: 'email_password', count: 1 },
      { key: 'google', count: 1 },
    ]);
    expect(summary.registrations.recent[0]).toMatchObject({
      source: 'google',
      landingPath: '/pricing',
      signupMethod: 'google',
    });
  });
});
