'use strict';

const logger = require('../utils/logger');

// Meta retires each Graph API version roughly two years after release — check
// https://developers.facebook.com/docs/graph-api/changelog for the current
// version and bump this default periodically, or override via the env var.
const GRAPH_API_VERSION = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const FACEBOOK_FETCH_TIMEOUT_MS = 5000;

function createFacebookAuthError(message, statusCode = 401, expose = true) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.expose = expose;
  return err;
}

function getFacebookAppId() {
  return String(process.env.FACEBOOK_APP_ID || '').trim();
}

function getFacebookAppSecret() {
  return String(process.env.FACEBOOK_APP_SECRET || '').trim();
}

function isFacebookConfigured() {
  return Boolean(getFacebookAppId() && getFacebookAppSecret());
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FACEBOOK_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeCodeForAccessToken(code, redirectUri) {
  const appId = getFacebookAppId();
  const appSecret = getFacebookAppSecret();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });

  let result;
  try {
    result = await fetchWithTimeout(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  } catch (error) {
    logger.error('Failed to exchange Facebook authorization code', { message: error.message });
    throw createFacebookAuthError('Facebook sign-in is temporarily unavailable', 503);
  }

  if (!result.ok || !result.body || !result.body.access_token) {
    logger.warn('Facebook code exchange failed', {
      status: result.status,
      error: result.body && result.body.error,
    });
    throw createFacebookAuthError('Invalid Facebook authorization code', 400);
  }

  return result.body.access_token;
}

async function verifyFacebookAccessToken(accessToken) {
  const appId = getFacebookAppId();
  const appSecret = getFacebookAppSecret();
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${appId}|${appSecret}`,
  });

  let result;
  try {
    result = await fetchWithTimeout(`${GRAPH_API_BASE}/debug_token?${params.toString()}`);
  } catch (error) {
    logger.error('Failed to verify Facebook access token', { message: error.message });
    throw createFacebookAuthError('Facebook sign-in is temporarily unavailable', 503);
  }

  const data = result.body && result.body.data;
  if (!result.ok || !data || data.is_valid !== true || String(data.app_id) !== appId) {
    logger.warn('Facebook access token failed verification', { data });
    throw createFacebookAuthError('Invalid Facebook credential', 401);
  }
}

async function fetchFacebookProfile(accessToken) {
  const params = new URLSearchParams({
    fields: 'id,name,first_name,last_name,email',
    access_token: accessToken,
  });

  let result;
  try {
    result = await fetchWithTimeout(`${GRAPH_API_BASE}/me?${params.toString()}`);
  } catch (error) {
    logger.error('Failed to fetch Facebook profile', { message: error.message });
    throw createFacebookAuthError('Facebook sign-in is temporarily unavailable', 503);
  }

  if (!result.ok || !result.body || !result.body.id) {
    logger.warn('Facebook profile request failed', {
      status: result.status,
      error: result.body && result.body.error,
    });
    throw createFacebookAuthError('Invalid Facebook credential', 401);
  }

  return result.body;
}

/**
 * Exchanges an OAuth authorization code for a Facebook access token, verifies
 * that token belongs to this app via Graph API's debug_token (Facebook access
 * tokens are opaque, unlike Google/Apple's signed ID tokens, so there is no
 * local signature to check — the code exchange itself, which requires our
 * app secret, and the app_id check below are what prove this credential was
 * legitimately issued to EventFlow), and returns a normalised profile.
 */
async function verifyFacebookAuthorizationCode(code, redirectUri) {
  if (!isFacebookConfigured()) {
    throw createFacebookAuthError('Facebook sign-in is not configured', 503);
  }
  if (!code || typeof code !== 'string') {
    throw createFacebookAuthError('Facebook authorization code is required', 400);
  }

  const accessToken = await exchangeCodeForAccessToken(code, redirectUri);
  await verifyFacebookAccessToken(accessToken);
  const profile = await fetchFacebookProfile(accessToken);

  if (!profile.email) {
    throw createFacebookAuthError(
      'Facebook did not share an email address for this account. Please allow email access or use another sign-in method.',
      403
    );
  }

  return {
    sub: String(profile.id),
    email: String(profile.email).toLowerCase(),
    name: profile.name || '',
    given_name: profile.first_name || '',
    family_name: profile.last_name || '',
    // Facebook only returns the confirmed email tied to the user's account.
    emailAuthoritative: true,
  };
}

module.exports = {
  getFacebookAppId,
  isFacebookConfigured,
  verifyFacebookAuthorizationCode,
};
