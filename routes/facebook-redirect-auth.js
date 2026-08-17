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
const facebookAuthService = require('../services/facebookAuth.service');
const userProvenance = require('../services/userProvenance.service');
const {
  COLLECTION_NAME: ANALYTICS_COLLECTION,
  sanitizeEvent: sanitizeAnalyticsEvent,
} = require('../utils/behaviourAnalytics');

const router = express.Router();
const FACEBOOK_LOGIN_PATH = '/api/auth/callback/facebook';
const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';
const FACEBOOK_CSRF_COOKIE = 'facebook_auth_csrf';
const FACEBOOK_CSRF_MAX_AGE_MS = 10 * 60 * 1000;

function getPublicBaseUrl() {
  const configured = String(process.env.BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (configured && !configured.includes('localhost')) {
    return configured;
  }
  return PRODUCTION_ORIGIN;
}

function getFacebookLoginUri() {
  return `${getPublicBaseUrl()}${FACEBOOK_LOGIN_PATH}`;
}

function redirectWithError(res, reason) {
  const safeReason = encodeURIComponent(reason || 'facebook_failed');
  return res.redirect(303, `/auth?facebook=error&reason=${safeReason}`);
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
 * Facebook's OAuth dialog redirects back with a plain top-level GET (unlike
 * Google/Apple's form_post credential callbacks), so the standard OAuth
 * `state` double-submit pattern applies directly: a random value is issued
 * via GET /facebook/csrf, stored in a short-lived cookie, and must come back
 * unchanged inside the encoded `state` query parameter.
 */
function validateFacebookCsrf(req, state) {
  const cookieToken = req.cookies && req.cookies[FACEBOOK_CSRF_COOKIE];
  return Boolean(cookieToken && state.csrf && cookieToken === state.csrf);
}

function clearFacebookCsrfCookie(res) {
  res.clearCookie(FACEBOOK_CSRF_COOKIE, { path: '/' });
}

async function updateLastLogin(userId) {
  try {
    await dbUnified.updateOne(
      'users',
      { id: userId },
      { $set: { lastLoginAt: new Date().toISOString() } }
    );
  } catch (error) {
    logger.error('[FACEBOOK REDIRECT LOGIN] Failed to update lastLoginAt', {
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

async function validateNewFacebookSignupState(signupState) {
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
    const error = new Error('Location is required for supplier Facebook sign up.');
    error.statusCode = 400;
    throw error;
  }

  if (!signupState.company) {
    const error = new Error('Company name is required for supplier Facebook sign up.');
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

function buildFacebookUser(facebookProfile, nowIso, signupState = {}) {
  const email = String(facebookProfile.email || '').toLowerCase();
  const facebookSub = String(facebookProfile.sub || '');
  const givenName = String(facebookProfile.given_name || '')
    .trim()
    .slice(0, 40);
  const familyName = String(facebookProfile.family_name || '')
    .trim()
    .slice(0, 40);
  const profileName = String(facebookProfile.name || '').trim();
  const fallbackName = email.split('@')[0] || 'Facebook user';
  const fullName = (profileName || `${givenName} ${familyName}`.trim() || fallbackName).slice(
    0,
    80
  );
  const [derivedFirstName, ...derivedLastParts] = fullName.split(/\s+/);
  const requestedRole = signupState.role === 'supplier' ? 'supplier' : 'customer';
  const isOwner = domainAdmin.isOwnerEmail(email);
  const roleDecision = domainAdmin.determineRole(email, requestedRole, true);

  return {
    id: uid('usr'),
    name: fullName,
    firstName: givenName || derivedFirstName || 'Facebook',
    lastName: familyName || derivedLastParts.join(' ') || 'User',
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
    ...userProvenance.facebookSignupProvenance(nowIso),
    authProvider: 'facebook',
    authProviderIds: { facebook: facebookSub },
    facebookSub,
    facebookLinkedAt: nowIso,
    createdAt: nowIso,
  };
}

const FACEBOOK_ATTRIBUTION_KEYS = [
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

function getFacebookSignupAttribution(state) {
  const attribution = state?.attribution;
  if (state?.context !== 'signup' || !attribution) {
    return null;
  }
  const properties = { conversionType: 'registration', signup_method: 'facebook' };
  FACEBOOK_ATTRIBUTION_KEYS.forEach(key => {
    const value = attribution[key];
    if (typeof value === 'boolean' || typeof value === 'string') {
      properties[key] = value;
    }
  });
  return properties.attribution_available === true ? properties : null;
}

async function recordFacebookSignupAnalytics(user, state) {
  const properties = getFacebookSignupAttribution(state);
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
    logger.warn('[FACEBOOK REDIRECT LOGIN] Signup analytics recording failed', {
      message: error.message,
    });
  }
}

async function findOrCreateFacebookUser(facebookProfile, state = {}) {
  const users = await dbUnified.read('users');
  const email = String(facebookProfile.email || '').toLowerCase();
  const facebookSub = String(facebookProfile.sub || '');
  const nowIso = new Date().toISOString();
  const signupState = getSignupState(state);

  let user = users.find(
    u => u.facebookSub === facebookSub || u.authProviderIds?.facebook === facebookSub
  );
  const existingByEmail = users.find(u => (u.email || '').toLowerCase() === email);

  if (user && user.email && (user.email || '').toLowerCase() !== email) {
    const error = new Error('Facebook account is linked to another user.');
    error.statusCode = 409;
    throw error;
  }

  if (!user && existingByEmail) {
    if (!facebookProfile.emailAuthoritative) {
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
          facebookSub,
          ...userProvenance.facebookLinkProvenance(user, nowIso),
          authProviderIds: { ...(user.authProviderIds || {}), facebook: facebookSub },
          facebookLinkedAt: user.facebookLinkedAt || nowIso,
        },
      }
    );
    return {
      ...user,
      facebookSub,
      ...userProvenance.facebookLinkProvenance(user, nowIso),
      authProviderIds: { ...(user.authProviderIds || {}), facebook: facebookSub },
      facebookLinkedAt: user.facebookLinkedAt || nowIso,
    };
  }

  if (!user) {
    await validateNewFacebookSignupState(signupState);
    user = buildFacebookUser(facebookProfile, nowIso, signupState);
    const insertedUser = await dbUnified.insertOne('users', user);
    if (!insertedUser) {
      logger.error('[FACEBOOK-REDIRECT] insertOne returned null — user account not saved', {
        email: user.email,
      });
      const insertErr = new Error('Failed to create account. Please try again.');
      insertErr.statusCode = 500;
      throw insertErr;
    }

    if (signupState.role === 'supplier') {
      await recordSupplierPartnerReferral(signupState.ref, user);
    }
    return { ...user, __eventflowNewFacebookSignup: true };
  }

  if (user.verified === false) {
    const facebookVerifyUpdates = userProvenance.facebookLinkProvenance(user, nowIso);
    await dbUnified.updateOne('users', { id: user.id }, { $set: facebookVerifyUpdates });
    return { ...user, ...facebookVerifyUpdates };
  }

  return user;
}

router.get('/facebook/csrf', (req, res) => {
  const csrf = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Cache-Control', 'no-store, private');
  res.cookie(FACEBOOK_CSRF_COOKIE, csrf, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: FACEBOOK_CSRF_MAX_AGE_MS,
    path: '/',
  });
  res.json({ ok: true, csrf });
});

router.get('/facebook/diagnostics', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.json({
    ok: true,
    facebookConfigured: facebookAuthService.isFacebookConfigured(),
    facebookAppId: facebookAuthService.getFacebookAppId(),
    facebookLoginUri: getFacebookLoginUri(),
    expectedRedirectUri: `${PRODUCTION_ORIGIN}${FACEBOOK_LOGIN_PATH}`,
    baseUrlConfigured: Boolean(process.env.BASE_URL),
    baseUrlHost: getPublicBaseUrl(),
  });
});

/**
 * GET /api/auth/callback/facebook
 * Receives Facebook's OAuth authorization-code redirect. Facebook always
 * redirects back with a plain top-level GET (never a form_post), carrying
 * `code` and `state`, or `error`/`error_reason` if the user declined.
 */
router.get('/callback/facebook', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (req.query && req.query.error) {
    logger.info('[FACEBOOK REDIRECT LOGIN] Facebook reported an error', {
      error: req.query.error,
      reason: req.query.error_reason,
    });
    clearFacebookCsrfCookie(res);
    return redirectWithError(res, String(req.query.error_reason || req.query.error).slice(0, 60));
  }

  const state = decodeState(req.query && req.query.state);

  if (!validateFacebookCsrf(req, state)) {
    logger.warn('[FACEBOOK REDIRECT LOGIN] Invalid Facebook CSRF token');
    clearFacebookCsrfCookie(res);
    return redirectWithError(res, 'facebook_csrf');
  }
  clearFacebookCsrfCookie(res);

  const code = req.query && req.query.code;
  if (!code) {
    logger.warn('[FACEBOOK REDIRECT LOGIN] Missing authorization code in callback');
    return redirectWithError(res, 'missing_code');
  }

  try {
    const facebookProfile = await facebookAuthService.verifyFacebookAuthorizationCode(
      code,
      getFacebookLoginUri()
    );
    const user = await findOrCreateFacebookUser(facebookProfile, state);
    if (user.__eventflowNewFacebookSignup === true) {
      await recordFacebookSignupAnalytics(user, state);
    }

    if (user.twoFactorEnabled) {
      logger.info('[FACEBOOK REDIRECT LOGIN] 2FA required; redirecting to auth');
      return res.redirect(303, '/auth?facebook=2fa_required');
    }

    await updateLastLogin(user.id);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });

    setAuthCookie(res, token, { remember: true });
    return res.redirect(303, destinationFromState(user, state));
  } catch (error) {
    logger.error('[FACEBOOK REDIRECT LOGIN] Failed', { message: error.message });
    return redirectWithError(
      res,
      error.statusCode ? `facebook_${error.statusCode}` : 'facebook_failed'
    );
  }
});

module.exports = router;
