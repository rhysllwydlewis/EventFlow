'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function setupAppleAuthService() {
  jest.resetModules();
  process.env.APPLE_CLIENT_ID = 'uk.co.event-flow.web';
  delete process.env.APPLE_CLIENT_IDS;

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

  const service = require('../../services/appleAuth.service');
  return { privateKey, service };
}

function signAppleToken(privateKey, overrides = {}) {
  return jwt.sign(
    {
      iss: 'https://appleid.apple.com',
      aud: process.env.APPLE_CLIENT_ID,
      sub: 'apple-sub-123',
      email: 'user@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
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

describe('appleAuth.service', () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.APPLE_CLIENT_ID;
  const originalClientIds = process.env.APPLE_CLIENT_IDS;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalClientId === undefined) {
      delete process.env.APPLE_CLIENT_ID;
    } else {
      process.env.APPLE_CLIENT_ID = originalClientId;
    }
    if (originalClientIds === undefined) {
      delete process.env.APPLE_CLIENT_IDS;
    } else {
      process.env.APPLE_CLIENT_IDS = originalClientIds;
    }
    jest.restoreAllMocks();
  });

  it('uses the first configured APPLE_CLIENT_IDS entry when APPLE_CLIENT_ID is absent', () => {
    jest.resetModules();
    delete process.env.APPLE_CLIENT_ID;
    process.env.APPLE_CLIENT_IDS = 'first-services-id,second-services-id';

    const service = require('../../services/appleAuth.service');

    expect(service.getAppleClientId()).toBe('first-services-id');
    expect(service.getAppleClientIds()).toEqual(['first-services-id', 'second-services-id']);
  });

  it('rejects verification before network calls when no Apple client ID is configured', async () => {
    jest.resetModules();
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_CLIENT_IDS;
    global.fetch = jest.fn();

    const service = require('../../services/appleAuth.service');

    await expect(service.verifyAppleCredential('token')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Apple sign-in is not configured',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('verifies a valid Apple ID token and exposes authoritative email metadata', async () => {
    const { privateKey, service } = setupAppleAuthService();
    const token = signAppleToken(privateKey);

    const payload = await service.verifyAppleCredential(token);

    expect(payload.sub).toBe('apple-sub-123');
    expect(payload.email).toBe('user@privaterelay.appleid.com');
    expect(payload.isPrivateEmail).toBe(true);
    expect(payload.emailAuthoritative).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a token with the wrong audience', async () => {
    const { privateKey, service } = setupAppleAuthService();
    const token = signAppleToken(privateKey, { aud: 'another-services-id' });

    await expect(service.verifyAppleCredential(token)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid Apple credential',
    });
  });

  it('rejects an Apple account whose email is not verified', async () => {
    const { privateKey, service } = setupAppleAuthService();
    const token = signAppleToken(privateKey, { email_verified: 'false' });

    await expect(service.verifyAppleCredential(token)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Apple account email must be verified before signing in',
    });
  });

  it('rejects a token whose nonce does not match the expected value', async () => {
    const { privateKey, service } = setupAppleAuthService();
    const token = signAppleToken(privateKey, { nonce: 'actual-nonce' });

    await expect(
      service.verifyAppleCredential(token, { nonce: 'expected-nonce' })
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Apple credential nonce mismatch',
    });
  });

  it('accepts a token whose nonce matches the expected value', async () => {
    const { privateKey, service } = setupAppleAuthService();
    const token = signAppleToken(privateKey, { nonce: 'matching-nonce' });

    const payload = await service.verifyAppleCredential(token, { nonce: 'matching-nonce' });
    expect(payload.sub).toBe('apple-sub-123');
  });
});
