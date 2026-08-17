'use strict';

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { JWT_SECRET, setAuthCookie } = require('../middleware/auth');
const { getFeatureFlags } = require('../middleware/features');
const domainAdmin = require('../middleware/domain-admin');
const appleAuthService = require('../services/appleAuth.service');
const userProvenance = require('../services/userProvenance.service');
const {
  COLLECTION_NAME: ANALYTICS_COLLECTION,
  sanitizeEvent: sanitizeAnalyticsEvent,
} = require('../utils/behaviourAnalytics');

const router = express.Router();
const parseAppleFormPost = express.urlencoded({ extended: false, limit: '32kb' });
const APPLE_LOGIN_PATH = '/api/auth/callback/apple';
const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';
const APPLE_NONCE_COOKIE = 'apple_auth_nonce';
const APPLE_NONCE_MAX_AGE_MS = 10 * 60 * 1000;

function getPublicBaseUrl() {
  const configured = String(process.env.BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (configured && !configured.includes('localhost')) {
    return configured;
  }
  return PRODUCTION_ORIGIN;
}

function getAppleLoginUri() {
  return `${getPublicBaseUrl()}${APPLE_LOGIN_PATH}`;
}

function redirectWithError(res, reason) {
  const safeReason = encodeURIComponent(reason || 'apple_failed');
  return res.redirect(303, `/auth?apple=error&reason=${safeReason}`);
}

function defaultDestinationForRole(role) {
  if (role === 'admin') {
    return '/admin';
  }
  if (role === 'supplier') {
    return '/dashboard/supplier';
  }
  return '/dashboard/customer';
}

/** True if `value` contains an ASCII control character (tab, CR, LF, NUL, ...). */
function hasControlCharacter(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Only same-origin relative paths are ever redirected to. Beyond the `//`
 * (protocol-relative) and backslash checks, this also rejects any control
 * character: browsers strip *raw* control characters from a URL before
 * parsing it, so a value like "/\t/evil.com" would otherwise slip past the
 * "//" check here and later resolve to "//evil.com". Express's
 * Location-header encoding already neutralises this for res.redirect()
 * specifically, but this check must not depend on that.
 */
function isSafeRelativePath(value) {
  return Boolean(
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !hasControlCharacter(value)
  );
}

function getPathname(value) {
  try {
    return new URL(value, PRODUCTION_ORIGIN).pathname;
  } catch (_) {
    return String(value || '')
      .split('?')[0]
      .split('#')[0];
  }
}

function isDestinationAllowedForRole(role, destination) {
  const pathname = getPathname(destination);

  if (role === 'admin') {
    return true;
  }

  if (role === 'supplier') {
    return !pathname.startsWith('/admin') && pathname !== '/dashboard/customer';
  }

  return ![
    '/admin',
    '/dashboard/supplier',
    '/supplier/subscription',
    '/supplier/marketplace-new-listing',
    '/my-marketplace-listings',
  ].some(blockedPath => pathname === blockedPath || pathname.startsWith(`${blockedPath}/`));
}

function decodeState(state) {
  if (!state || typeof state !== 'string') {
    return {};
  }

  try {
    const normalized = state.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function destinationFromState(user, state) {
  const requestedDestination = isSafeRelativePath(state.returnTo) ? state.returnTo : '';
  const destination =
    requestedDestination && isDestinationAllowedForRole(user.role, requestedDestination)
      ? requestedDestination
      : defaultDestinationForRole(user.role);
  const plan = typeof state.plan === 'string' ? state.plan.trim() : '';

  if (plan && !destination.includes('plan=')) {
    return `${destination}${destination.includes('?') ? '&' : '?'}plan=${encodeURIComponent(plan)}`;
  }
  return destination;
}

/**
 * Apple has no equivalent of Google's automatic g_csrf_token double-submit
 * cookie, so EventFlow issues its own single-use nonce via GET /apple/nonce,
 * stores it in a short-lived cookie, and requires the same value back both
 * inside the encoded `state` (CSRF binding) and as the ID token's `nonce`
 * claim (replay protection against a stolen/reused authorization response).
 */
function validateAppleCsrf(req, state) {
  const cookieToken = req.cookies && req.cookies[APPLE_NONCE_COOKIE];
  return Boolean(cookieToken && state.csrf && cookieToken === state.csrf);
}

function clearAppleNonceCookie(res) {
  res.clearCookie(APPLE_NONCE_COOKIE, { path: '/', secure: true, sameSite: 'none' });
}

async function updateLastLogin(userId) {
  try {
    await dbUnified.updateOne(
      'users',
      { id: userId },
      { $set: { lastLoginAt: new Date().toISOString() } }
    );
  } catch (error) {
    logger.error('[APPLE REDIRECT LOGIN] Failed to update lastLoginAt', {
      message: error.message,
    });
  }
}

function cleanStateText(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength || 120);
}

function sanitizeUrl(url) {
  const trimmed = cleanStateText(url, 180);
  if (!trimmed) {
    return undefined;
  }
  if (!validator.isURL(trimmed, { require_protocol: false })) {
    return undefined;
  }
  return trimmed;
}

function sanitizeSocials(socials) {
  if (!socials || typeof socials !== 'object') {
    return {};
  }

  return {
    instagram: sanitizeUrl(socials.instagram),
    facebook: sanitizeUrl(socials.facebook),
    twitter: sanitizeUrl(socials.twitter),
    linkedin: sanitizeUrl(socials.linkedin),
  };
}

function getSignupState(state) {
  const role = state && state.role === 'supplier' ? 'supplier' : 'customer';
  const signupState = {
    role,
    location: cleanStateText(state && state.location, 100),
    postcode: cleanStateText(state && state.postcode, 10),
    company: cleanStateText(state && state.company, 100),
    jobTitle: cleanStateText(state && state.jobTitle, 100),
    website: sanitizeUrl(state && state.website),
    socials: sanitizeSocials(state && state.socials),
    ref: cleanStateText(state && state.ref, 80),
  };

  if (signupState.role !== 'supplier') {
    signupState.company = '';
    signupState.jobTitle = '';
  }

  return signupState;
}

async function validateNewAppleSignupState(signupState) {
  const features = await getFeatureFlags();
  if (!features.registration) {
    const error = new Error(
      'New account registrations are temporarily unavailable. Please try again later.'
    );
    error.statusCode = 503;
    throw error;
  }

  if (signupState.role !== 'supplier') {
    return;
  }

  if (!features.supplierApplications) {
    const error = new Error(
      'Supplier applications are currently disabled. Please try again later.'
    );
    error.statusCode = 503;
    throw error;
  }

  if (!signupState.location) {
    const error = new Error('Location is required for supplier Apple sign up.');
    error.statusCode = 400;
    throw error;
  }

  if (!signupState.company) {
    const error = new Error('Company name is required for supplier Apple sign up.');
    error.statusCode = 400;
    throw error;
  }
}

async function recordSupplierPartnerReferral(refCode, user) {
  if (!refCode) {
    return;
  }

  try {
    const partnerService = require('../services/partnerService');
    const partner = await partnerService.getPartnerByRefCode(String(refCode).trim());
    if (partner && partner.status === 'active') {
      await partnerService.recordReferral({
        partnerId: partner.id,
        supplierUserId: user.id,
        supplierCreatedAt: user.createdAt,
      });
      partnerService.awardReferralSignupBonus(user.id).catch(bonusErr => {
        logger.warn('Partner referral signup bonus failed (non-blocking):', bonusErr.message);
      });
    }
  } catch (_refErr) {
    logger.warn('Partner referral recording failed (non-blocking):', _refErr.message);
  }
}

function parseAppleUserField(rawUser) {
  if (!rawUser || typeof rawUser !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(rawUser);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function buildAppleUser(appleProfile, appleUserInfo, nowIso, signupState = {}) {
  const email = String(appleProfile.email || '').toLowerCase();
  const appleSub = String(appleProfile.sub || '');
  const givenName = String(appleUserInfo?.name?.firstName || '')
    .trim()
    .slice(0, 40);
  const familyName = String(appleUserInfo?.name?.lastName || '')
    .trim()
    .slice(0, 40);
  const fallbackName = email.split('@')[0] || 'Apple user';
  const fullName = (`${givenName} ${familyName}`.trim() || fallbackName).slice(0, 80);
  const requestedRole = signupState.role === 'supplier' ? 'supplier' : 'customer';
  const isOwner = domainAdmin.isOwnerEmail(email);
  const roleDecision = domainAdmin.determineRole(email, requestedRole, true);

  return {
    id: uid('usr'),
    name: fullName,
    firstName: givenName || 'Apple',
    lastName: familyName || 'User',
    email,
    role: isOwner ? 'admin' : roleDecision.role,
    location: signupState.location || 'Not specified',
    postcode: signupState.postcode || undefined,
    company: signupState.company || undefined,
    jobTitle: signupState.jobTitle || undefined,
    website: signupState.website || undefined,
    socials: signupState.socials || {},
    badges: [],
    notify: true,
    notify_account: true,
    notify_marketing: false,
    marketingOptIn: false,
    verified: true,
    isOwner,
    ...userProvenance.appleSignupProvenance(nowIso),
    authProvider: 'apple',
    authProviderIds: { apple: appleSub },
    appleSub,
    appleLinkedAt: nowIso,
    createdAt: nowIso,
  };
}

const APPLE_ATTRIBUTION_KEYS = [
  'attribution_available',
  'first_channel',
  'first_referrer_domain',
  'first_landing_path',
  'first_utm_source',
  'first_utm_medium',
  'first_utm_campaign',
  'first_partner_reference',
  'last_channel',
  'last_referrer_domain',
  'last_landing_path',
  'last_utm_source',
  'last_utm_medium',
  'last_utm_campaign',
  'last_partner_reference',
];

function getAppleSignupAttribution(state) {
  const attribution = state?.attribution;
  if (state?.context !== 'signup' || !attribution) {
    return null;
  }
  const properties = { conversionType: 'registration', signup_method: 'apple' };
  APPLE_ATTRIBUTION_KEYS.forEach(key => {
    const value = attribution[key];
    if (typeof value === 'boolean' || typeof value === 'string') {
      properties[key] = value;
    }
  });
  return properties.attribution_available === true ? properties : null;
}

async function recordAppleSignupAnalytics(user, state) {
  const properties = getAppleSignupAttribution(state);
  const sessionId = cleanStateText(state?.analyticsSessionId, 120);
  if (!properties || !sessionId || !user?.id || user.role === 'admin') {
    return;
  }
  try {
    const event = sanitizeAnalyticsEvent(
      {
        event: 'registration_completed',
        sessionId,
        pagePath: properties.first_landing_path || '/auth',
        pageType: 'auth',
        referrerDomain: properties.first_referrer_domain || 'direct',
        deviceType: 'other',
        timestamp: new Date().toISOString(),
        properties,
      },
      {
        userId: user.id,
        userRole: user.role,
        hashSalt: process.env.ANALYTICS_HASH_SALT || process.env.JWT_SECRET,
      }
    );
    if (event) {
      await dbUnified.insertOne(ANALYTICS_COLLECTION, event);
    }
  } catch (error) {
    logger.warn('[APPLE REDIRECT LOGIN] Signup analytics recording failed', {
      message: error.message,
    });
  }
}

async function findOrCreateAppleUser(appleProfile, appleUserInfo, state = {}) {
  const users = await dbUnified.read('users');
  const email = String(appleProfile.email || '').toLowerCase();
  const appleSub = String(appleProfile.sub || '');
  const nowIso = new Date().toISOString();
  const signupState = getSignupState(state);

  let user = users.find(u => u.appleSub === appleSub || u.authProviderIds?.apple === appleSub);
  const existingByEmail = users.find(u => (u.email || '').toLowerCase() === email);

  if (user && user.email && (user.email || '').toLowerCase() !== email) {
    const error = new Error('Apple account is linked to another user.');
    error.statusCode = 409;
    throw error;
  }

  if (!user && existingByEmail) {
    if (!appleProfile.emailAuthoritative) {
      const error = new Error(
        'An account already exists for this email. Please log in with your password first.'
      );
      error.statusCode = 409;
      throw error;
    }

    user = existingByEmail;
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          appleSub,
          ...userProvenance.appleLinkProvenance(user, nowIso),
          authProviderIds: { ...(user.authProviderIds || {}), apple: appleSub },
          appleLinkedAt: user.appleLinkedAt || nowIso,
        },
      }
    );
    return {
      ...user,
      appleSub,
      ...userProvenance.appleLinkProvenance(user, nowIso),
      authProviderIds: { ...(user.authProviderIds || {}), apple: appleSub },
      appleLinkedAt: user.appleLinkedAt || nowIso,
    };
  }

  if (!user) {
    await validateNewAppleSignupState(signupState);
    user = buildAppleUser(appleProfile, appleUserInfo, nowIso, signupState);
    const insertedUser = await dbUnified.insertOne('users', user);
    if (!insertedUser) {
      logger.error('[APPLE-REDIRECT] insertOne returned null — user account not saved', {
        email: user.email,
      });
      const insertErr = new Error('Failed to create account. Please try again.');
      insertErr.statusCode = 500;
      throw insertErr;
    }

    if (signupState.role === 'supplier') {
      await recordSupplierPartnerReferral(signupState.ref, user);
    }
    return { ...user, __eventflowNewAppleSignup: true };
  }

  if (user.verified === false) {
    const appleVerifyUpdates = userProvenance.appleLinkProvenance(user, nowIso);
    await dbUnified.updateOne('users', { id: user.id }, { $set: appleVerifyUpdates });
    return { ...user, ...appleVerifyUpdates };
  }

  return user;
}

router.get('/apple/nonce', (req, res) => {
  const nonce = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Cache-Control', 'no-store, private');
  res.cookie(APPLE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: APPLE_NONCE_MAX_AGE_MS,
    path: '/',
  });
  res.json({ ok: true, nonce });
});

router.get('/apple/diagnostics', (_req, res) => {
  const clientIds = appleAuthService.getAppleClientIds();
  res.setHeader('Cache-Control', 'no-store, private');
  res.json({
    ok: true,
    appleConfigured: clientIds.length > 0,
    appleClientId: appleAuthService.getAppleClientId(),
    appleClientIdsCount: clientIds.length,
    appleLoginUri: getAppleLoginUri(),
    expectedReturnUrl: `${PRODUCTION_ORIGIN}${APPLE_LOGIN_PATH}`,
    baseUrlConfigured: Boolean(process.env.BASE_URL),
    baseUrlHost: getPublicBaseUrl(),
  });
});

router.get('/callback/apple', (_req, res) => {
  return res.redirect(303, '/auth?apple=callback_requires_post');
});

/**
 * POST /api/auth/callback/apple
 * Receives Apple's Sign in with Apple form_post redirect (response_mode=form_post,
 * response_type=code id_token). Apple only includes the `user` field (name/email)
 * on the very first authorization for a given Apple ID + client — every later
 * sign-in only carries `id_token` and `state`.
 */
router.post('/callback/apple', parseAppleFormPost, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (req.body && req.body.error) {
    logger.info('[APPLE REDIRECT LOGIN] Apple reported an error', {
      error: req.body.error,
    });
    clearAppleNonceCookie(res);
    return redirectWithError(res, String(req.body.error).slice(0, 60));
  }

  const state = decodeState(req.body && req.body.state);

  if (!validateAppleCsrf(req, state)) {
    logger.warn('[APPLE REDIRECT LOGIN] Invalid Apple CSRF/nonce token');
    clearAppleNonceCookie(res);
    return redirectWithError(res, 'apple_csrf');
  }
  clearAppleNonceCookie(res);

  const credential = req.body && req.body.id_token;
  if (!credential) {
    logger.warn('[APPLE REDIRECT LOGIN] Missing id_token in callback');
    return redirectWithError(res, 'missing_credential');
  }

  try {
    const appleProfile = await appleAuthService.verifyAppleCredential(credential, {
      nonce: state.csrf,
    });
    const appleUserInfo = parseAppleUserField(req.body && req.body.user);
    const user = await findOrCreateAppleUser(appleProfile, appleUserInfo, state);
    if (user.__eventflowNewAppleSignup === true) {
      await recordAppleSignupAnalytics(user, state);
    }

    if (user.twoFactorEnabled) {
      logger.info('[APPLE REDIRECT LOGIN] 2FA required; redirecting to auth');
      return res.redirect(303, '/auth?apple=2fa_required');
    }

    await updateLastLogin(user.id);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });

    setAuthCookie(res, token, { remember: true });
    return res.redirect(303, destinationFromState(user, state));
  } catch (error) {
    logger.error('[APPLE REDIRECT LOGIN] Failed', { message: error.message });
    return redirectWithError(res, error.statusCode ? `apple_${error.statusCode}` : 'apple_failed');
  }
});

module.exports = router;
