'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const logger = require('../utils/logger');

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_JWKS_TIMEOUT_MS = 5000;

let cachedKeys = new Map();
let cacheExpiresAt = 0;
let refreshPromise = null;

function createGoogleAuthError(message, statusCode = 401, expose = true) {
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

function getGoogleClientIds() {
  return parseClientIds(process.env.GOOGLE_CLIENT_IDS).concat(
    parseClientIds(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID)
  );
}

function getGoogleClientId() {
  return getGoogleClientIds()[0] || '';
}

function parseMaxAge(cacheControl) {
  const match = String(cacheControl || '').match(/max-age=(\d+)/i);
  if (!match) {
    return 60 * 60;
  }
  return Math.max(60, Number(match[1]) || 60 * 60);
}

async function fetchGoogleJwks() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_JWKS_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_JWKS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Google JWKS request failed with status ${response.status}`);
    }
    return {
      body: await response.json(),
      cacheControl: response.headers.get('cache-control'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshGoogleKeys() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const { body, cacheControl } = await fetchGoogleJwks();
    const nextKeys = new Map();
    for (const jwk of body.keys || []) {
      if (jwk.kid) {
        nextKeys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
      }
    }

    if (!nextKeys.size) {
      throw new Error('Google JWKS response did not include usable keys');
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

async function getGoogleKey(kid) {
  if (!kid) {
    throw createGoogleAuthError('Invalid Google credential', 400);
  }

  try {
    if (!cachedKeys.has(kid) || Date.now() >= cacheExpiresAt) {
      await refreshGoogleKeys();
    }

    if (!cachedKeys.has(kid)) {
      // Google may have rotated keys between validation attempts; force one refresh.
      cacheExpiresAt = 0;
      await refreshGoogleKeys();
    }
  } catch (error) {
    logger.error('Failed to refresh Google public keys', { message: error.message });
    throw createGoogleAuthError('Google sign-in is temporarily unavailable', 503);
  }

  const key = cachedKeys.get(kid);
  if (!key) {
    throw createGoogleAuthError('Invalid Google credential', 401);
  }
  return key;
}

function isAuthoritativeGoogleEmail(payload) {
  const email = String(payload.email || '').toLowerCase();
  return Boolean(payload.email_verified && (email.endsWith('@gmail.com') || payload.hd));
}

async function verifyGoogleCredential(credential) {
  const clientIds = getGoogleClientIds();
  if (!clientIds.length) {
    throw createGoogleAuthError('Google sign-in is not configured', 503);
  }

  if (!credential || typeof credential !== 'string') {
    throw createGoogleAuthError('Google credential is required', 400);
  }

  const decoded = jwt.decode(credential, { complete: true });
  if (!decoded || !decoded.header) {
    throw createGoogleAuthError('Invalid Google credential', 400);
  }

  const key = await getGoogleKey(decoded.header.kid);
  try {
    const payload = jwt.verify(credential, key, {
      algorithms: ['RS256'],
      audience: clientIds,
      issuer: GOOGLE_ISSUERS,
    });

    if (!payload.sub || !payload.email) {
      throw createGoogleAuthError('Google account did not share the required profile fields', 400);
    }

    if (payload.email_verified !== true) {
      throw createGoogleAuthError('Google account email must be verified before signing in', 403);
    }

    return {
      ...payload,
      email: String(payload.email).toLowerCase(),
      emailAuthoritative: isAuthoritativeGoogleEmail(payload),
    };
  } catch (error) {
    if (!error.statusCode) {
      logger.warn('Google credential verification failed', { message: error.message });
      throw createGoogleAuthError('Invalid Google credential', 401);
    }
    throw error;
  }
}

module.exports = {
  getGoogleClientId,
  getGoogleClientIds,
  isAuthoritativeGoogleEmail,
  verifyGoogleCredential,
};
