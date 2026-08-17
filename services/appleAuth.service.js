'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const logger = require('../utils/logger');

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_ISSUERS = ['https://appleid.apple.com'];
const APPLE_JWKS_TIMEOUT_MS = 5000;

let cachedKeys = new Map();
let cacheExpiresAt = 0;
let refreshPromise = null;

function createAppleAuthError(message, statusCode = 401, expose = true) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.expose = expose;
  return err;
}

function parseClientIds(value) {
  return String(value || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function getAppleClientIds() {
  return parseClientIds(process.env.APPLE_CLIENT_IDS).concat(
    parseClientIds(process.env.APPLE_CLIENT_ID)
  );
}

function getAppleClientId() {
  return getAppleClientIds()[0] || '';
}

function parseMaxAge(cacheControl) {
  const match = String(cacheControl || '').match(/max-age=(\d+)/i);
  if (!match) {
    return 60 * 60;
  }
  return Math.max(60, Number(match[1]) || 60 * 60);
}

async function fetchAppleJwks() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APPLE_JWKS_TIMEOUT_MS);

  try {
    const response = await fetch(APPLE_JWKS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Apple JWKS request failed with status ${response.status}`);
    }
    return {
      body: await response.json(),
      cacheControl: response.headers.get('cache-control'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshAppleKeys() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const { body, cacheControl } = await fetchAppleJwks();
    const nextKeys = new Map();
    for (const jwk of body.keys || []) {
      if (jwk.kid) {
        nextKeys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
      }
    }

    if (!nextKeys.size) {
      throw new Error('Apple JWKS response did not include usable keys');
    }

    cachedKeys = nextKeys;
    cacheExpiresAt = Date.now() + parseMaxAge(cacheControl) * 1000;
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function getAppleKey(kid) {
  if (!kid) {
    throw createAppleAuthError('Invalid Apple credential', 400);
  }

  try {
    if (!cachedKeys.has(kid) || Date.now() >= cacheExpiresAt) {
      await refreshAppleKeys();
    }

    if (!cachedKeys.has(kid)) {
      // Apple may have rotated keys between validation attempts; force one refresh.
      cacheExpiresAt = 0;
      await refreshAppleKeys();
    }
  } catch (error) {
    logger.error('Failed to refresh Apple public keys', { message: error.message });
    throw createAppleAuthError('Apple sign-in is temporarily unavailable', 503);
  }

  const key = cachedKeys.get(kid);
  if (!key) {
    throw createAppleAuthError('Invalid Apple credential', 401);
  }
  return key;
}

function parseAppleBoolean(value) {
  return value === true || value === 'true';
}

function isAuthoritativeAppleEmail(payload) {
  return Boolean(payload.email && parseAppleBoolean(payload.email_verified));
}

/**
 * Verifies an Apple ID token from the Sign in with Apple redirect/form_post flow.
 * `expectedNonce`, when provided, must match the token's `nonce` claim — this is
 * the replay-protection binding between the authorization request we sent and the
 * ID token Apple returns, since Apple has no equivalent of Google's g_csrf_token.
 */
async function verifyAppleCredential(credential, { nonce: expectedNonce } = {}) {
  const clientIds = getAppleClientIds();
  if (!clientIds.length) {
    throw createAppleAuthError('Apple sign-in is not configured', 503);
  }

  if (!credential || typeof credential !== 'string') {
    throw createAppleAuthError('Apple credential is required', 400);
  }

  const decoded = jwt.decode(credential, { complete: true });
  if (!decoded || !decoded.header) {
    throw createAppleAuthError('Invalid Apple credential', 400);
  }

  const key = await getAppleKey(decoded.header.kid);
  try {
    const payload = jwt.verify(credential, key, {
      algorithms: ['RS256'],
      audience: clientIds,
      issuer: APPLE_ISSUERS,
    });

    if (!payload.sub) {
      throw createAppleAuthError('Apple account did not share the required profile fields', 400);
    }

    if (expectedNonce && payload.nonce !== expectedNonce) {
      throw createAppleAuthError('Apple credential nonce mismatch', 401);
    }

    if (!payload.email || !parseAppleBoolean(payload.email_verified)) {
      throw createAppleAuthError('Apple account email must be verified before signing in', 403);
    }

    return {
      ...payload,
      email: String(payload.email).toLowerCase(),
      emailVerified: true,
      isPrivateEmail: parseAppleBoolean(payload.is_private_email),
      emailAuthoritative: isAuthoritativeAppleEmail(payload),
    };
  } catch (error) {
    if (!error.statusCode) {
      logger.warn('Apple credential verification failed', { message: error.message });
      throw createAppleAuthError('Invalid Apple credential', 401);
    }
    throw error;
  }
}

module.exports = {
  getAppleClientId,
  getAppleClientIds,
  isAuthoritativeAppleEmail,
  verifyAppleCredential,
};
