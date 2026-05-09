'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');

const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const { JWT_SECRET, setAuthCookie } = require('../middleware/auth');
const { getFeatureFlags } = require('../middleware/features');
const domainAdmin = require('../middleware/domain-admin');
const googleAuthService = require('../services/googleAuth.service');

const router = express.Router();
const parseGoogleFormPost = express.urlencoded({ extended: false, limit: '32kb' });

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

function isAuthoritativeProfileEmail(googleProfile) {
  if (googleProfile.emailAuthoritative !== undefined) {
    return Boolean(googleProfile.emailAuthoritative);
  }
  const email = String(googleProfile.email || '').toLowerCase();
  return Boolean(googleProfile.email_verified && (email.endsWith('@gmail.com') || googleProfile.hd));
}

function buildGoogleUser(googleProfile, nowIso) {
  const email = String(googleProfile.email || '').toLowerCase();
  const googleSub = String(googleProfile.sub || '');
  const givenName = String(googleProfile.given_name || '').trim().slice(0, 40);
  const familyName = String(googleProfile.family_name || '').trim().slice(0, 40);
  const profileName = String(googleProfile.name || '').trim();
  const fallbackName = email.split('@')[0] || 'Google user';
  const fullName = (profileName || `${givenName} ${familyName}`.trim() || fallbackName).slice(0, 80);
  const [derivedFirstName, ...derivedLastParts] = fullName.split(/\s+/);
  const isOwner = domainAdmin.isOwnerEmail(email);
  const roleDecision = domainAdmin.determineRole(email, 'customer', true);

  return {
    id: uid('usr'),
    name: fullName,
    firstName: givenName || derivedFirstName || 'Google',
    lastName: familyName || derivedLastParts.join(' ') || 'User',
    email,
    role: isOwner ? 'admin' : roleDecision.role,
    location: 'Not specified',
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

async function findOrCreateGoogleUser(googleProfile) {
  const users = await dbUnified.read('users');
  const email = String(googleProfile.email || '').toLowerCase();
  const googleSub = String(googleProfile.sub || '');
  const nowIso = new Date().toISOString();

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
    const features = await getFeatureFlags();
    if (!features.registration) {
      const error = new Error('New account registrations are temporarily unavailable. Please try again later.');
      error.statusCode = 503;
      throw error;
    }

    user = buildGoogleUser(googleProfile, nowIso);
    await dbUnified.insertOne('users', user);
    return user;
  }

  if (user.verified === false) {
    await dbUnified.updateOne('users', { id: user.id }, { $set: { verified: true } });
    return { ...user, verified: true };
  }

  return user;
}

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
    const googleProfile = await googleAuthService.verifyGoogleCredential(credential);
    const user = await findOrCreateGoogleUser(googleProfile);

    if (user.twoFactorEnabled) {
      logger.info('[GOOGLE REDIRECT LOGIN] 2FA required; redirecting to auth');
      return res.redirect(303, '/auth?google=2fa_required');
    }

    await updateLastLogin(user.id);
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });

    setAuthCookie(res, token, { remember: true });
    return res.redirect(303, defaultDestinationForRole(user.role));
  } catch (error) {
    logger.error('[GOOGLE REDIRECT LOGIN] Failed', { message: error.message });
    return redirectWithError(res, error.statusCode ? `google_${error.statusCode}` : 'google_failed');
  }
});

module.exports = router;
