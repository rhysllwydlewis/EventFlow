'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { JWT_SECRET, setAuthCookie } = require('../middleware/auth');
const { getFeatureFlags } = require('../middleware/features');
const domainAdmin = require('../middleware/domain-admin');
const googleAuthService = require('../services/googleAuth.service');

const router = express.Router();
const parseGoogleFormPost = express.urlencoded({ extended: false, limit: '32kb' });
const GOOGLE_LOGIN_PATH = '/api/auth/callback/google';
const PRODUCTION_ORIGIN = 'https://event-flow.co.uk';

function getPublicBaseUrl() {
  const configured = String(process.env.BASE_URL || '').trim().replace(/\/$/, '');
  if (configured && !configured.includes('localhost')) {
    return configured;
  }
  return PRODUCTION_ORIGIN;
}

function getGoogleLoginUri() {
  return `${getPublicBaseUrl()}${GOOGLE_LOGIN_PATH}`;
}

function redirectWithError(res, reason) {
  const safeReason = encodeURIComponent(reason || 'google_failed');
  return res.redirect(303, `/auth?google=error&reason=${safeReason}`);
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

function isSafeRelativePath(value) {
  return Boolean(
    typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
  );
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
  const destination = isSafeRelativePath(state.returnTo) ? state.returnTo : defaultDestinationForRole(user.role);
  const plan = typeof state.plan === 'string' ? state.plan.trim() : '';
  if (plan && !destination.includes('plan=')) {
    return `${destination}${destination.includes('?') ? '&' : '?'}plan=${encodeURIComponent(plan)}`;
  }
  return destination;
}

function validateGoogleDoubleSubmitCsrf(req) {
  const bodyToken = req.body && req.body.g_csrf_token;
  const cookieToken = req.cookies && req.cookies.g_csrf_token;
  return Boolean(bodyToken && cookieToken && bodyToken === cookieToken);
}

async function updateLastLogin(userId) {
  try {
    await dbUnified.updateOne(
      'users',
      { id: userId },
      { $set: { lastLoginAt: new Date().toISOString() } }
    );
  } catch (error) {
    logger.error('[GOOGLE REDIRECT LOGIN] Failed to update lastLoginAt', { message: error.message });
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

async function validateNewGoogleSignupState(signupState) {
  const features = await getFeatureFlags();
  if (!features.registration) {
    const error = new Error('New account registrations are temporarily unavailable. Please try again later.');
    error.statusCode = 503;
    throw error;
  }

  if (signupState.role !== 'supplier') {
    return;
  }

  if (!features.supplierApplications) {
    const error = new Error('Supplier applications are currently disabled. Please try again later.');
    error.statusCode = 503;
    throw error;
  }

  if (!signupState.location) {
    const error = new Error('Location is required for supplier Google sign up.');
    error.statusCode = 400;
    throw error;
  }

  if (!signupState.company) {
    const error = new Error('Company name is required for supplier Google sign up.');
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

function isAuthoritativeProfileEmail(googleProfile) {
  if (googleProfile.emailAuthoritative !== undefined) {
    return Boolean(googleProfile.emailAuthoritative);
  }
  const email = String(googleProfile.email || '').toLowerCase();
  return Boolean(googleProfile.email_verified && (email.endsWith('@gmail.com') || googleProfile.hd));
}

function buildGoogleUser(googleProfile, nowIso, signupState = {}) {
  const email = String(googleProfile.email || '').toLowerCase();
  const googleSub = String(googleProfile.sub || '');
  const givenName = String(googleProfile.given_name || '').trim().slice(0, 40);
  const familyName = String(googleProfile.family_name || '').trim().slice(0, 40);
  const profileName = String(googleProfile.name || '').trim();
  const fallbackName = email.split('@')[0] || 'Google user';
  const fullName = (profileName || `${givenName} ${familyName}`.trim() || fallbackName).slice(0, 80);
  const [derivedFirstName, ...derivedLastParts] = fullName.split(/\s+/);
  const requestedRole = signupState.role === 'supplier' ? 'supplier' : 'customer';
  const isOwner = domainAdmin.isOwnerEmail(email);
  const roleDecision = domainAdmin.determineRole(email, requestedRole, true);

  return {
    id: uid('usr'),
    name: fullName,
    firstName: givenName || derivedFirstName || 'Google',
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
    authProvider: 'google',
    authProviderIds: { google: googleSub },
    googleSub,
    googleLinkedAt: nowIso,
    avatarUrl: googleProfile.picture || undefined,
    createdAt: nowIso,
  };
}

async function findOrCreateGoogleUser(googleProfile, state = {}) {
  const users = await dbUnified.read('users');
  const email = String(googleProfile.email || '').toLowerCase();
  const googleSub = String(googleProfile.sub || '');
  const nowIso = new Date().toISOString();
  const signupState = getSignupState(state);

  let user = users.find(u => u.googleSub === googleSub || u.authProviderIds?.google === googleSub);
  const existingByEmail = users.find(u => (u.email || '').toLowerCase() === email);

  if (user && user.email && (user.email || '').toLowerCase() !== email) {
    const error = new Error('Google account is linked to another user.');
    error.statusCode = 409;
    throw error;
  }

  if (!user && existingByEmail) {
    if (!isAuthoritativeProfileEmail(googleProfile)) {
      const error = new Error('An account already exists for this email. Please log in with your password first.');
      error.statusCode = 409;
      throw error;
    }

    user = existingByEmail;
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          googleSub,
          authProvider: user.authProvider || 'local',
          authProviderIds: { ...(user.authProviderIds || {}), google: googleSub },
          googleLinkedAt: user.googleLinkedAt || nowIso,
          verified: user.verified === false ? true : user.verified,
          avatarUrl: user.avatarUrl || googleProfile.picture || undefined,
        },
      }
    );
    return { ...user, googleSub, verified: user.verified === false ? true : user.verified };
  }

  if (!user) {
    await validateNewGoogleSignupState(signupState);
    user = buildGoogleUser(googleProfile, nowIso, signupState);
    await dbUnified.insertOne('users', user);

    if (signupState.role === 'supplier') {
      await recordSupplierPartnerReferral(signupState.ref, user);
    }
    return user;
  }

  if (user.verified === false) {
    await dbUnified.updateOne('users', { id: user.id }, { $set: { verified: true } });
    return { ...user, verified: true };
  }

  return user;
}

router.get('/google/diagnostics', (_req, res) => {
  const clientIds = googleAuthService.getGoogleClientIds();
  res.setHeader('Cache-Control', 'no-store, private');
  res.json({
    ok: true,
    googleConfigured: clientIds.length > 0,
    googleClientId: googleAuthService.getGoogleClientId(),
    googleClientIdsCount: clientIds.length,
    googleLoginUri: getGoogleLoginUri(),
    expectedAuthorizedJavaScriptOrigin: PRODUCTION_ORIGIN,
    expectedAuthorizedRedirectUri: `${PRODUCTION_ORIGIN}${GOOGLE_LOGIN_PATH}`,
    baseUrlConfigured: Boolean(process.env.BASE_URL),
    baseUrlHost: getPublicBaseUrl(),
  });
});

router.get('/callback/google', (_req, res) => {
  return res.redirect(303, '/auth?google=callback_requires_post');
});

/**
 * POST /api/auth/callback/google
 * Receives the Sign in with Google redirect-mode credential form post.
 * This is not an OAuth authorization-code callback; Google posts an ID token
 * credential here, protected by Google's double-submit g_csrf_token check.
 */
router.post('/callback/google', parseGoogleFormPost, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  if (!validateGoogleDoubleSubmitCsrf(req)) {
    logger.warn('[GOOGLE REDIRECT LOGIN] Invalid Google CSRF token');
    return redirectWithError(res, 'google_csrf');
  }

  const credential = req.body && req.body.credential;
  if (!credential) {
    logger.warn('[GOOGLE REDIRECT LOGIN] Missing credential in callback');
    return redirectWithError(res, 'missing_credential');
  }

  try {
    const state = decodeState(req.body && req.body.state);
    const googleProfile = await googleAuthService.verifyGoogleCredential(credential);
    const user = await findOrCreateGoogleUser(googleProfile, state);

    if (user.twoFactorEnabled) {
      logger.info('[GOOGLE REDIRECT LOGIN] 2FA required; redirecting to auth');
      return res.redirect(303, '/auth?google=2fa_required');
    }

    await updateLastLogin(user.id);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });

    setAuthCookie(res, token, { remember: true });
    return res.redirect(303, destinationFromState(user, state));
  } catch (error) {
    logger.error('[GOOGLE REDIRECT LOGIN] Failed', { message: error.message });
    return redirectWithError(res, error.statusCode ? `google_${error.statusCode}` : 'google_failed');
  }
});

module.exports = router;
