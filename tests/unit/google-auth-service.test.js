'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function setupGoogleAuthService() {
  jest.resetModules();
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  delete process.env.GOOGLE_CLIENT_IDS;

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key-id';
  jwk.alg = 'RS256';
  jwk.use = 'sig';

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'public, max-age=3600' },
    json: async () => ({ keys: [jwk] }),
  });

  const service = require('../../services/googleAuth.service');
  return { privateKey, service };
}

function signGoogleToken(privateKey, overrides = {}) {
  return jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: 'google-sub-123',
      email: 'user@gmail.com',
      email_verified: true,
      name: 'Google User',
      ...overrides,
    },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '1h',
      keyid: 'test-key-id',
    }
  );
}

describe('googleAuth.service', () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  const originalClientIds = process.env.GOOGLE_CLIENT_IDS;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID;
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
    if (originalClientIds === undefined) {
      delete process.env.GOOGLE_CLIENT_IDS;
    } else {
      process.env.GOOGLE_CLIENT_IDS = originalClientIds;
    }
    jest.restoreAllMocks();
  });

  it('uses the first configured GOOGLE_CLIENT_IDS entry when GOOGLE_CLIENT_ID is absent', () => {
    jest.resetModules();
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_IDS =
      'first-client.apps.googleusercontent.com, second-client.apps.googleusercontent.com';

    const service = require('../../services/googleAuth.service');

    expect(service.getGoogleClientId()).toBe('first-client.apps.googleusercontent.com');
    expect(service.getGoogleClientIds()).toEqual([
      'first-client.apps.googleusercontent.com',
      'second-client.apps.googleusercontent.com',
    ]);
  });

  it('rejects verification before network calls when no Google client ID is configured', async () => {
    jest.resetModules();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_IDS;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    global.fetch = jest.fn();

    const service = require('../../services/googleAuth.service');

    await expect(service.verifyGoogleCredential('token')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Google sign-in is not configured',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('verifies a valid Google ID token and exposes authoritative email metadata', async () => {
    const { privateKey, service } = setupGoogleAuthService();
    const token = signGoogleToken(privateKey);

    const payload = await service.verifyGoogleCredential(token);

    expect(payload.sub).toBe('google-sub-123');
    expect(payload.email).toBe('user@gmail.com');
    expect(payload.emailAuthoritative).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a token with the wrong audience', async () => {
    const { privateKey, service } = setupGoogleAuthService();
    const token = signGoogleToken(privateKey, { aud: 'another-client-id' });

    await expect(service.verifyGoogleCredential(token)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid Google credential',
    });
  });

  it('rejects a Google account whose email is not verified', async () => {
    const { privateKey, service } = setupGoogleAuthService();
    const token = signGoogleToken(privateKey, { email_verified: false });

    await expect(service.verifyGoogleCredential(token)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Google account email must be verified before signing in',
    });
  });
});
