'use strict';

function setupFacebookAuthService({ fetchImpl } = {}) {
  jest.resetModules();
  process.env.FACEBOOK_APP_ID = 'test-facebook-app-id';
  process.env.FACEBOOK_APP_SECRET = 'test-facebook-app-secret';

  global.fetch = fetchImpl || jest.fn();

  return require('../../services/facebookAuth.service');
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('facebookAuth.service', () => {
  const originalFetch = global.fetch;
  const originalAppId = process.env.FACEBOOK_APP_ID;
  const originalAppSecret = process.env.FACEBOOK_APP_SECRET;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalAppId === undefined) {
      delete process.env.FACEBOOK_APP_ID;
    } else {
      process.env.FACEBOOK_APP_ID = originalAppId;
    }
    if (originalAppSecret === undefined) {
      delete process.env.FACEBOOK_APP_SECRET;
    } else {
      process.env.FACEBOOK_APP_SECRET = originalAppSecret;
    }
    jest.restoreAllMocks();
  });

  it('reports configured only when both the app ID and app secret are set', () => {
    jest.resetModules();
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    const service = require('../../services/facebookAuth.service');

    expect(service.isFacebookConfigured()).toBe(false);
    expect(service.getFacebookAppId()).toBe('');
  });

  it('rejects verification before network calls when Facebook is not configured', async () => {
    jest.resetModules();
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    global.fetch = jest.fn();
    const service = require('../../services/facebookAuth.service');

    await expect(
      service.verifyFacebookAuthorizationCode('code', 'https://event-flow.co.uk/callback')
    ).rejects.toMatchObject({ statusCode: 503, message: 'Facebook sign-in is not configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing authorization code', async () => {
    const service = setupFacebookAuthService();

    await expect(
      service.verifyFacebookAuthorizationCode('', 'https://event-flow.co.uk/callback')
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('verifies a valid authorization code end to end and returns a normalised profile', async () => {
    const fetchImpl = jest.fn(async url => {
      if (url.includes('/oauth/access_token')) {
        return jsonResponse(200, { access_token: 'user-access-token', token_type: 'bearer' });
      }
      if (url.includes('/debug_token')) {
        return jsonResponse(200, {
          data: { is_valid: true, app_id: 'test-facebook-app-id' },
        });
      }
      if (url.includes('/me')) {
        return jsonResponse(200, {
          id: 'fb-sub-123',
          name: 'Facebook User',
          first_name: 'Facebook',
          last_name: 'User',
          email: 'user@example.com',
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const service = setupFacebookAuthService({ fetchImpl });

    const profile = await service.verifyFacebookAuthorizationCode(
      'auth-code',
      'https://event-flow.co.uk/api/auth/callback/facebook'
    );

    expect(profile).toMatchObject({
      sub: 'fb-sub-123',
      email: 'user@example.com',
      emailAuthoritative: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects when the code exchange fails', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(400, { error: { message: 'Invalid authorization code' } })
    );
    const service = setupFacebookAuthService({ fetchImpl });

    await expect(
      service.verifyFacebookAuthorizationCode('bad-code', 'https://event-flow.co.uk/callback')
    ).rejects.toMatchObject({ statusCode: 400, message: 'Invalid Facebook authorization code' });
  });

  it('rejects when debug_token reports the access token belongs to a different app', async () => {
    const fetchImpl = jest.fn(async url => {
      if (url.includes('/oauth/access_token')) {
        return jsonResponse(200, { access_token: 'user-access-token' });
      }
      if (url.includes('/debug_token')) {
        return jsonResponse(200, { data: { is_valid: true, app_id: 'someone-elses-app' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const service = setupFacebookAuthService({ fetchImpl });

    await expect(
      service.verifyFacebookAuthorizationCode('code', 'https://event-flow.co.uk/callback')
    ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid Facebook credential' });
  });

  it('rejects when Facebook does not share an email address', async () => {
    const fetchImpl = jest.fn(async url => {
      if (url.includes('/oauth/access_token')) {
        return jsonResponse(200, { access_token: 'user-access-token' });
      }
      if (url.includes('/debug_token')) {
        return jsonResponse(200, { data: { is_valid: true, app_id: 'test-facebook-app-id' } });
      }
      if (url.includes('/me')) {
        return jsonResponse(200, { id: 'fb-sub-123', name: 'Facebook User' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const service = setupFacebookAuthService({ fetchImpl });

    await expect(
      service.verifyFacebookAuthorizationCode('code', 'https://event-flow.co.uk/callback')
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
