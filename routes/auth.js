/**
 * Authentication Routes
 * Handles user registration, login, logout, password reset, and verification
 */

'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const logger = require('../utils/logger');
const dbUnified = require('../db-unified');
const { uid } = require('../store');
const {
  JWT_SECRET,
  authRequired,
  setAuthCookie,
  clearAuthCookie,
  getUserFromCookie,
} = require('../middleware/auth');
const { passwordOk } = require('../middleware/validation');
const {
  authLimiter,
  resendEmailLimiter,
  strictAuthLimiter,
  passwordResetLimiter,
  registrationLimiter,
  tokenLinkLimiter,
  writeLimiter,
} = require('../middleware/rateLimits');
const { csrfProtection } = require('../middleware/csrf');
const { featureRequired, getFeatureFlags } = require('../middleware/features');
const postmark = require('../utils/postmark');
const tokenUtils = require('../utils/token');
const { validateToken } = require('../middleware/token');
const domainAdmin = require('../middleware/domain-admin');
const googleAuthService = require('../services/googleAuth.service');
const userProvenance = require('../services/userProvenance.service');
const partnerRegistrationRisk = require('../services/partnerRegistrationRiskService');
const { ensureSupplierProfileForUser } = require('../services/supplierProfileProvisioning.service');
const { getFounderSignupBadges } = require('../utils/founderBadge');
const { sleep } = require('../utils/helpers');

const router = express.Router();
const supplierRegistrationRiskGuard = partnerRegistrationRisk.registrationRiskGuard({
  roleResolver: req => (req.body?.role === 'supplier' ? 'supplier' : null),
});

// Bcrypt hash (cost 10, matching registration) of an arbitrary fixed placeholder
// string, computed once at module load rather than hardcoded as a literal so it
// doesn't read as a checked-in credential to secret scanners — it isn't one; it's
// not derived from any real password or account. POST /login compares against
// this when no account matches the submitted email so that a nonexistent account
// still pays the same bcrypt.compare cost as a real one — otherwise "no such
// user" returns near-instantly while a wrong password for a real account takes
// tens of milliseconds, letting an attacker enumerate registered emails purely
// from response timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('eventflow-login-timing-safety-placeholder', 10);

// This will be set by the main server.js when mounting these routes (legacy compatibility)
// eslint-disable-next-line no-unused-vars
let _sendMailFn = null;
let _verifyAltcha = null;

/**
 * Set the sendMail function (injected from server.js) - legacy compatibility
 * @param {Function} fn - The sendMail function
 */
function setSendMailFunction(fn) {
  _sendMailFn = fn;
}

/**
 * Inject shared dependencies
 * @param {Object} deps - Dependencies object
 */
function initializeDependencies(deps) {
  if (deps.verifyAltcha) {
    _verifyAltcha = deps.verifyAltcha;
  }
}

/**
 * Helper function to update user's last login timestamp
 * @param {string} userId - User ID
 */
async function updateLastLogin(userId) {
  try {
    await dbUnified.updateOne(
      'users',
      { id: userId },
      { $set: { lastLoginAt: new Date().toISOString() } }
    );
  } catch (e) {
    logger.error('Failed to update lastLoginAt', e);
  }
}

function trimString(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeEmail(value) {
  return trimString(value).toLowerCase();
}

function isUsableEmail(value) {
  return validator.isEmail(value);
}

function sanitizeOptionalUrl(url) {
  const trimmed = trimString(url, 300);
  if (!trimmed) {
    return undefined;
  }

  if (!validator.isURL(trimmed, { require_protocol: false })) {
    return undefined;
  }

  return trimmed;
}

function getStoredTokenStatus(user, token, tokenField, expiresField) {
  if (!user || !token || user[tokenField] !== token) {
    return { valid: false, reason: 'missing_or_replaced' };
  }

  if (user[expiresField]) {
    const expiresAt = new Date(user[expiresField]);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
      return { valid: false, reason: 'expired' };
    }
  } else {
    return { valid: false, reason: 'missing_expiry' };
  }

  return { valid: true };
}

function applyAdminVerificationUpgrade(user, updates) {
  if (domainAdmin.shouldUpgradeToAdminOnVerification(user.email)) {
    const previousRole = user.role;
    updates.role = 'admin';
    logger.info('User auto-promoted to admin (admin domain verified)', { previousRole });
  }

  return updates;
}

/**
 * POST /api/auth/register
 * Register a new user account
 *
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Create a new user account with email and password
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: SecurePassword123!
 *               firstName:
 *                 type: string
 *                 example: John
 *               lastName:
 *                 type: string
 *                 example: Doe
 *               role:
 *                 type: string
 *                 enum: [customer, supplier]
 *                 example: customer
 *               location:
 *                 type: string
 *                 example: New York, NY
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 *       503:
 *         description: Feature temporarily unavailable
 */
router.post(
  '/register',
  async (req, res, next) => {
    // Check supplier application feature flag if registering as supplier
    if ((req.body || {}).role === 'supplier') {
      const features = await getFeatureFlags();
      if (!features.supplierApplications) {
        return res.status(503).json({
          error: 'Feature temporarily unavailable',
          message: 'Supplier applications are currently disabled. Please try again later.',
          feature: 'supplierApplications',
        });
      }
    }
    // Check registration feature flag for all registrations
    next();
  },
  featureRequired('registration'),
  csrfProtection, // CSRF guard — was missing from registration unlike all other auth POSTs
  registrationLimiter, // Tighter than authLimiter: each attempt triggers bcrypt + email send
  supplierRegistrationRiskGuard,
  async (req, res) => {
    const {
      firstName,
      lastName,
      email,
      password,
      role,
      location,
      postcode,
      company,
      jobTitle,
      website,
      socials,
      captchaToken,
      ref: refCode,
      claimSupplierId,
    } = req.body || {};

    // Verify ALTCHA token when the verifier is available
    if (_verifyAltcha) {
      const captchaResult = await _verifyAltcha(captchaToken);
      if (!captchaResult.success) {
        return res
          .status(400)
          .json({ error: captchaResult.error || 'CAPTCHA verification failed' });
      }
    }

    // Both firstName and lastName are required fields
    const userFirstName = trimString(firstName, 40);
    const userLastName = trimString(lastName, 40);
    const userFullName = `${userFirstName} ${userLastName}`.trim();
    const normalizedEmail = normalizeEmail(email);

    // Required fields validation — firstName and lastName are always required
    if (!userFirstName || !userLastName) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    // Reject names that are purely non-alphabetic (e.g. ";;;", "<script>", "123").
    // \p{L} matches any Unicode letter — covers Latin, Arabic, Chinese, Hebrew, Cyrillic, etc.
    if (!/\p{L}/u.test(userFirstName) || !/\p{L}/u.test(userLastName)) {
      return res
        .status(400)
        .json({ error: 'First and last name must contain at least one letter' });
    }
    if (!normalizedEmail || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
      });
    }
    if (!isUsableEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (typeof password !== 'string' || password.length > 1024) {
      // bcrypt silently truncates at 72 bytes; a multi-KB password is either a
      // mistake or a DoS probe — reject before we spend cycles hashing it.
      return res.status(400).json({ error: 'Password is too long (maximum 1,024 characters)' });
    }
    if (!passwordOk(password)) {
      return res.status(400).json({ error: 'Weak password' });
    }

    const roleFinal = role === 'supplier' || role === 'customer' ? role : 'customer';

    // Role-specific required field validation
    const userLocation = trimString(location, 100);
    const userCompany = trimString(company, 100);

    if (!userLocation) {
      return res.status(400).json({ error: 'Location is required' });
    }
    if (roleFinal === 'supplier' && !userCompany) {
      return res.status(400).json({ error: 'Company name is required for suppliers' });
    }

    // ── Duplicate-email check (indexed findOne, BEFORE bcrypt.hash) ──────────────
    // Doing this before hashing saves ~177 ms on every duplicate attempt.
    // The unique index on users.email also protects against the race-condition
    // window between this check and the later insertOne.
    const existingUser = await dbUnified.findOne('users', { email: normalizedEmail });
    if (existingUser) {
      if (domainAdmin.isOwnerEmail(normalizedEmail)) {
        return res.status(409).json({
          error: 'Email already registered',
          message: 'This email is reserved for the system owner account.',
        });
      }
      return res.status(409).json({ error: 'Email already registered' });
    }
    if (domainAdmin.isOwnerEmail(normalizedEmail) && !existingUser) {
      // Owner doesn't exist yet — should only happen via seed, but allow it.
      logger.warn('Owner account being created through registration (should use seed)');
    }

    // Parse socials object
    const socialsParsed = socials
      ? {
          instagram: sanitizeOptionalUrl(socials.instagram),
          facebook: sanitizeOptionalUrl(socials.facebook),
          twitter: sanitizeOptionalUrl(socials.twitter),
          linkedin: sanitizeOptionalUrl(socials.linkedin),
        }
      : {};

    // Determine founder badge eligibility
    const badges = getFounderSignupBadges();
    if (badges.includes('founder')) {
      logger.info('Founder badge awarded (new user registered within 6 months of launch)');
    }

    // Determine role using domain-admin logic
    // Owner email: always admin, always verified (skip verification email)
    // Admin domain: initial role as requested, upgrade to admin AFTER verification
    // Regular user: use requested role
    const isOwner = domainAdmin.isOwnerEmail(normalizedEmail);
    const roleDecision = domainAdmin.determineRole(normalizedEmail, roleFinal, false); // Not verified yet

    // Log admin domain detection
    if (roleDecision.willUpgradeOnVerification) {
      logger.info('Admin domain detected: user will be promoted to admin after verification');
    }

    if (isOwner) {
      logger.info('Owner account registration');
    }

    // Create user object first (needed for JWT token generation)
    const user = {
      id: uid('usr'),
      name: String(userFullName).slice(0, 81), // firstName(40) + ' ' + lastName(40) = 81 max
      firstName: userFirstName,
      lastName: userLastName,
      email: normalizedEmail,
      role: isOwner ? 'admin' : roleDecision.role, // Owner gets admin immediately
      passwordHash: await bcrypt.hash(password, 10),
      location: userLocation,
      postcode: trimString(postcode, 10) || undefined,
      company: userCompany || undefined,
      jobTitle: trimString(jobTitle, 100) || undefined,
      website: sanitizeOptionalUrl(website),
      socials: socialsParsed,
      badges,
      notify: true, // Deprecated, kept for backward compatibility
      notify_account: true, // Transactional emails enabled by default
      notify_marketing: !!(req.body && req.body.marketingOptIn), // Marketing emails opt-in
      marketingOptIn: !!(req.body && req.body.marketingOptIn), // Deprecated, kept for backward compatibility
      verified: isOwner, // Owner is pre-verified, others need verification
      isOwner: isOwner, // Special flag to protect owner account
      createdAt: new Date().toISOString(),
      ...(isOwner
        ? userProvenance.ownerProvenance(new Date().toISOString(), 'owner')
        : userProvenance.emailPasswordPendingProvenance()),
    };

    // Generate JWT verification token
    const verificationToken = tokenUtils.generateVerificationToken(user, {
      expiresInHours: 24,
    });

    // Store token info for legacy compatibility
    user.verificationToken = verificationToken;
    user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Send verification email via Postmark BEFORE saving user
    // This ensures we only create accounts when email can be sent
    // EXCEPT for owner email - skip verification email for owner
    if (!isOwner) {
      try {
        logger.info('Attempting to send verification email');
        const sendResult = await postmark.sendVerificationEmail(user, verificationToken);
        Object.assign(user, userProvenance.metadataFromSendResult(sendResult));
        logger.info('Verification email sent successfully', {
          emailLogId: user.lastVerificationEmailLogId,
        });
      } catch (emailError) {
        logger.error('Failed to send verification email:', emailError.message);

        // If email sending fails, don't create the user account
        // This prevents orphaned unverified accounts
        return res.status(500).json({
          error: 'Failed to send verification email. Please try again later.',
          details: process.env.NODE_ENV === 'development' ? emailError.message : undefined,
        });
      }
    } else {
      logger.info('Owner account - skipping verification email');
    }

    // Only save user after email is successfully sent
    const inserted = await dbUnified.insertOne('users', user);
    if (!inserted) {
      // insertOne returns null on error (e.g. a duplicate-key race between the
      // duplicate check above and this write). The verification email has already
      // been sent at this point — ops should investigate if this is seen frequently.
      // The user is told to retry; a fresh attempt will re-send a new verification
      // email and will succeed once the DB contention clears.
      logger.error('[REGISTER] insertOne returned null — account not saved (email already sent)', {
        email: normalizedEmail,
      });
      return res.status(500).json({
        error: 'Failed to create account. Please try again.',
      });
    }

    if (user.role === 'supplier' && req.partnerRegistrationRisk) {
      try {
        await partnerRegistrationRisk.completeRegistrationRisk(req, user.id);
      } catch (riskError) {
        logger.error('[REGISTER] supplier registration risk metadata failed; rolling back user', {
          userId: user.id,
          error: riskError.message,
        });
        await dbUnified.deleteOne('users', { id: user.id });
        return res.status(503).json({
          error: 'Registration could not be completed safely. Please try again.',
          code: 'REGISTRATION_RISK_UNAVAILABLE',
        });
      }
    }

    if (user.role === 'supplier') {
      try {
        await ensureSupplierProfileForUser(user, {
          claimSupplierId: trimString(claimSupplierId, 64) || undefined,
        });
      } catch (profileError) {
        logger.error('[REGISTER] failed to provision supplier profile; rolling back user', {
          userId: user.id,
          email: normalizedEmail,
          error: profileError.message,
        });

        const rolledBack = await dbUnified.deleteOne('users', { id: user.id });
        if (!rolledBack) {
          await dbUnified.updateOne(
            'users',
            { id: user.id },
            { $set: { supplierSetupStatus: 'profile_creation_failed' } }
          );
        }

        return res.status(500).json({
          error: 'Failed to create supplier profile. Please try again.',
          code: 'SUPPLIER_PROFILE_PROVISIONING_FAILED',
          message:
            'We could not finish setting up your supplier business profile. Please try again or contact support if the problem continues.',
        });
      }
    }

    // Record partner referral if a valid ref code was provided (non-blocking)
    if (refCode && user.role === 'supplier') {
      try {
        const partnerService = require('../services/partnerService');
        const partner = await partnerService.getPartnerByRefCode(String(refCode).trim());
        if (partner && partner.status === 'active') {
          await partnerService.recordReferral({
            partnerId: partner.id,
            supplierUserId: user.id,
            supplierCreatedAt: user.createdAt,
          });
          // Award sign-up bonus to the partner (non-blocking)
          partnerService.awardReferralSignupBonus(user.id).catch(bonusErr => {
            logger.warn('Partner referral signup bonus failed (non-blocking):', bonusErr.message);
          });
        }
      } catch (_refErr) {
        logger.warn('Partner referral recording failed (non-blocking):', _refErr.message);
      }
    }

    if (user.verified === true) {
      // Fire-and-forget — doesn't need to block cookie+redirect
      updateLastLogin(user.id).catch(err =>
        logger.warn('[GOOGLE-LOGIN] updateLastLogin failed', { error: err.message })
      );

      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
        expiresIn: '7d',
      });
      // Only verified accounts are signed in immediately. New email/password accounts must
      // complete verification before receiving an authenticated session.
      setAuthCookie(res, token, { remember: true });
    }

    // Prevent caching of registration responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    res.status(201).json({
      ok: true,
      requiresVerification: user.verified !== true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }
);

/**
 * POST /api/auth/login
 * Authenticate user and create session
 *
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login user
 *     description: Authenticate user with email and password, returns JWT token
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePassword123!
 *               remember:
 *                 type: boolean
 *                 description: Keep user logged in for 7 days
 *                 example: true
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: usr_abc123
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *                     role:
 *                       type: string
 *                       example: customer
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Email not verified
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/login', strictAuthLimiter, async (req, res) => {
  const { email, password, remember } = req.body || {};

  // Prevent caching of login responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  logger.info('[LOGIN] Attempt');

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    logger.warn('[LOGIN] Missing email or password');
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!isUsableEmail(normalizedEmail)) {
    logger.warn('[LOGIN] Invalid email format');
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Use a targeted findOne rather than loading every user into memory.
  // normalizedEmail is already lowercased (via normalizeEmail) and emails are
  // stored lowercase on registration, so the exact-match object filter is safe.
  // On MongoDB this lets the driver push the filter to the server and use an
  // index; on the local store it short-circuits at the first match — both are
  // far faster than the previous full collection scan.
  const user = await dbUnified.findOne('users', { email: normalizedEmail });

  // Always run bcrypt.compare, even for a nonexistent account or one with no
  // password hash set (e.g. Google-only sign-up) — comparing against a fixed
  // dummy hash keeps this branch's timing in line with a real wrong-password
  // attempt instead of returning near-instantly, which would let a caller
  // enumerate registered emails from response timing alone.
  let passwordMatches = false;
  try {
    passwordMatches = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    logger.debug('[LOGIN] Password check complete', { match: passwordMatches });
  } catch (error) {
    logger.error('[LOGIN] Password comparison error:', error.message);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!user) {
    logger.warn('[LOGIN] User not found');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  logger.debug('[LOGIN] User found', { verified: user.verified, hasHash: !!user.passwordHash });

  if (!user.passwordHash) {
    logger.error('[LOGIN] No password hash found');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (!passwordMatches) {
    logger.warn('[LOGIN] Invalid password attempt');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.verified === false) {
    logger.warn('[LOGIN] Email not verified');
    return res.status(403).json({ error: 'Please verify your email address before signing in.' });
  }

  // Check if 2FA is enabled
  if (user.twoFactorEnabled) {
    logger.info('[LOGIN] 2FA required');
    // Generate temporary token for 2FA step
    const tempToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, requires2FA: true },
      JWT_SECRET,
      { expiresIn: '2m' } // Short-lived token for 2FA verification
    );
    return res.json({
      ok: false,
      requires2FA: true,
      tempToken,
      message: 'Please enter your 2FA code',
    });
  }

  // Update last login timestamp — fire-and-forget so it doesn't delay the response
  logger.info('[LOGIN] Successful login');
  updateLastLogin(user.id).catch(err =>
    logger.warn('[LOGIN] updateLastLogin failed', { error: err.message })
  );

  // Align JWT expiry with remember-me: session-only (24h) vs persistent (7d)
  const tokenExpiry = remember ? '7d' : '24h';
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: tokenExpiry,
  });

  // Set cookie with remember option: if remember is true, persist for 7 days; otherwise session-only
  setAuthCookie(res, token, { remember: !!remember });

  res.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

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

function buildGoogleUser({
  googleProfile,
  roleFinal,
  location,
  postcode,
  company,
  jobTitle,
  nowIso,
}) {
  const email = String(googleProfile.email || '').toLowerCase();
  const googleSub = String(googleProfile.sub || '');
  const givenName = String(googleProfile.given_name || '')
    .trim()
    .slice(0, 40);
  const familyName = String(googleProfile.family_name || '')
    .trim()
    .slice(0, 40);
  const profileName = String(googleProfile.name || '').trim();
  const fallbackName = email.split('@')[0] || 'Google user';
  const fullName = (profileName || `${givenName} ${familyName}`.trim() || fallbackName).slice(
    0,
    80
  );
  const [derivedFirstName, ...derivedLastParts] = fullName.split(/\s+/);

  const badges = getFounderSignupBadges();

  const isOwner = domainAdmin.isOwnerEmail(email);
  const roleDecision = domainAdmin.determineRole(email, roleFinal, true);

  return {
    id: uid('usr'),
    name: fullName,
    firstName: givenName || derivedFirstName || 'Google',
    lastName: familyName || derivedLastParts.join(' ') || 'User',
    email,
    role: isOwner ? 'admin' : roleDecision.role,
    location: location ? String(location).trim().slice(0, 100) : 'Not specified',
    postcode: postcode ? String(postcode).trim().slice(0, 10) : undefined,
    company: company ? String(company).trim().slice(0, 100) : undefined,
    jobTitle: jobTitle ? String(jobTitle).trim().slice(0, 100) : undefined,
    badges,
    notify: true,
    notify_account: true,
    notify_marketing: false,
    marketingOptIn: false,
    verified: true,
    isOwner,
    ...userProvenance.googleSignupProvenance(nowIso),
    authProvider: 'google',
    authProviderIds: { google: googleSub },
    googleSub,
    googleLinkedAt: nowIso,
    avatarUrl: googleProfile.picture || undefined,
    createdAt: nowIso,
  };
}

/**
 * POST /api/auth/google
 * Sign in or create an account using a Google Identity Services ID token.
 */
router.post('/google', strictAuthLimiter, csrfProtection, async (req, res) => {
  const {
    credential,
    role,
    location,
    postcode,
    company,
    jobTitle,
    remember,
    ref: refCode,
  } = req.body || {};

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  try {
    const googleProfile = await googleAuthService.verifyGoogleCredential(credential);
    const email = String(googleProfile.email || '').toLowerCase();
    const googleSub = String(googleProfile.sub || '');
    const nowIso = new Date().toISOString();
    // Two targeted findOne calls instead of a full collection scan.
    // The $or object filter lets MongoDB use the sparse googleSub index.
    // The local store's matchesFilter also supports $or natively.
    let user = await dbUnified.findOne('users', {
      $or: [{ googleSub }, { 'authProviderIds.google': googleSub }],
    });
    const existingByEmail = await dbUnified.findOne('users', { email });

    if (user && user.email && (user.email || '').toLowerCase() !== email) {
      logger.warn('Google subject matched a user with a different email', { userId: user.id });
      return res.status(409).json({ error: 'Google account is linked to another user.' });
    }

    if (!user && existingByEmail) {
      if (!googleProfile.emailAuthoritative) {
        return res.status(409).json({
          error:
            'An account already exists for this email. Please log in with your password first, then contact support to link Google.',
        });
      }

      user = existingByEmail;
      await dbUnified.updateOne(
        'users',
        { id: user.id },
        {
          $set: {
            googleSub,
            ...userProvenance.googleLinkProvenance(user, nowIso),
            authProviderIds: { ...(user.authProviderIds || {}), google: googleSub },
            googleLinkedAt: user.googleLinkedAt || nowIso,
            avatarUrl: user.avatarUrl || googleProfile.picture || undefined,
          },
        }
      );
      user = {
        ...user,
        googleSub,
        ...userProvenance.googleLinkProvenance(user, nowIso),
        authProviderIds: { ...(user.authProviderIds || {}), google: googleSub },
        googleLinkedAt: user.googleLinkedAt || nowIso,
      };
    }

    if (!user) {
      const roleFinal = role === 'supplier' || role === 'customer' ? role : 'customer';
      const features = await getFeatureFlags();

      if (!features.registration) {
        return res.status(503).json({
          error: 'Feature temporarily unavailable',
          message: 'New account registrations are temporarily unavailable. Please try again later.',
          feature: 'registration',
        });
      }

      if (roleFinal === 'supplier') {
        if (!features.supplierApplications) {
          return res.status(503).json({
            error: 'Feature temporarily unavailable',
            message: 'Supplier applications are currently disabled. Please try again later.',
            feature: 'supplierApplications',
          });
        }
        if (!location) {
          return res.status(400).json({ error: 'Location is required for supplier sign up' });
        }
        if (!company) {
          return res.status(400).json({ error: 'Company name is required for suppliers' });
        }
      }

      if (roleFinal === 'supplier') {
        try {
          const googleRisk = await partnerRegistrationRisk.assessRegistration({
            req,
            email,
            role: 'supplier',
            refCode,
          });
          req.partnerRegistrationRisk = googleRisk;
          req.partnerRegistrationRiskFinalized = false;
          if (googleRisk.action === 'block') {
            req.partnerRegistrationRiskFinalized = true;
            await partnerRegistrationRisk.recordRegistrationEvent({
              assessment: googleRisk,
              outcome: 'blocked',
            });
            return res.status(403).json({
              error: 'We could not complete this registration automatically.',
              code: 'REGISTRATION_RISK_BLOCKED',
              appealPath: '/api/partner/abuse-appeals',
            });
          }
          await partnerRegistrationRisk.recordRegistrationEvent({
            assessment: googleRisk,
            outcome: 'attempt',
          });
        } catch (riskError) {
          logger.error('[GOOGLE-AUTH] registration risk assessment failed', {
            error: riskError.message,
          });
          if (process.env.PARTNER_ABUSE_FAIL_OPEN !== 'true') {
            return res.status(503).json({
              error: 'Registration is temporarily unavailable. Please try again shortly.',
              code: 'REGISTRATION_RISK_UNAVAILABLE',
            });
          }
        }
      }

      user = buildGoogleUser({
        googleProfile,
        roleFinal,
        location,
        postcode,
        company,
        jobTitle,
        nowIso,
      });

      const googleUserInserted = await dbUnified.insertOne('users', user);
      if (!googleUserInserted) {
        logger.error('[GOOGLE-AUTH] insertOne returned null — user account not saved', {
          email: user.email,
        });
        return res.status(500).json({ error: 'Failed to create account. Please try again.' });
      }

      if (roleFinal === 'supplier') {
        try {
          if (req.partnerRegistrationRisk) {
            await partnerRegistrationRisk.completeRegistrationRisk(req, user.id);
          }
        } catch (riskError) {
          logger.error('[GOOGLE-AUTH] risk metadata failed; rolling back new user', {
            userId: user.id,
            error: riskError.message,
          });
          await dbUnified.deleteOne('users', { id: user.id });
          return res.status(503).json({
            error: 'Registration could not be completed safely. Please try again.',
            code: 'REGISTRATION_RISK_UNAVAILABLE',
          });
        }

        try {
          await ensureSupplierProfileForUser(user);
        } catch (profileError) {
          logger.error('[GOOGLE-AUTH] failed to provision supplier profile; rolling back user', {
            userId: user.id,
            email: user.email,
            error: profileError.message,
          });
          const rolledBack = await dbUnified.deleteOne('users', { id: user.id });
          if (!rolledBack) {
            await dbUnified.updateOne(
              'users',
              { id: user.id },
              { $set: { supplierSetupStatus: 'profile_creation_failed' } }
            );
          }
          return res.status(500).json({
            error: 'Failed to create supplier profile. Please try again.',
            code: 'SUPPLIER_PROFILE_PROVISIONING_FAILED',
          });
        }

        await recordSupplierPartnerReferral(refCode, user);
      }
    }

    if (user.verified === false) {
      const googleVerifyUpdates = userProvenance.googleLinkProvenance(user, nowIso);
      await dbUnified.updateOne('users', { id: user.id }, { $set: googleVerifyUpdates });
      user = { ...user, ...googleVerifyUpdates };
    }

    if (user.twoFactorEnabled) {
      logger.info('[GOOGLE LOGIN] 2FA required');
      const tempToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, requires2FA: true },
        JWT_SECRET,
        { expiresIn: '2m' }
      );
      return res.json({
        ok: false,
        requires2FA: true,
        tempToken,
        message: 'Please enter your 2FA code',
      });
    }

    // Fire-and-forget — doesn't need to block the login response
    updateLastLogin(user.id).catch(err =>
      logger.warn('[GOOGLE-2FA] updateLastLogin failed', { error: err.message })
    );

    const tokenExpiry = remember ? '7d' : '24h';
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: tokenExpiry,
    });

    setAuthCookie(res, token, { remember: !!remember });
    return res.json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    logger.error('[GOOGLE LOGIN] Failed', { message: error.message });
    const status = error.statusCode || 500;
    const message = error.expose ? error.message : 'Google sign-in failed. Please try again.';
    return res.status(status).json({ error: message });
  }
});

/**
 * POST /api/auth/login-2fa
 * Complete login with 2FA token
 */
router.post('/login-2fa', strictAuthLimiter, async (req, res) => {
  const { tempToken, token: tfaToken, backupCode, remember } = req.body || {};

  logger.info('[LOGIN-2FA] 2FA verification attempt');

  if (!tempToken) {
    return res.status(400).json({ error: 'Temporary token is required' });
  }

  if (!tfaToken && !backupCode) {
    return res.status(400).json({ error: '2FA token or backup code is required' });
  }

  // Verify temporary token
  let decoded;
  try {
    decoded = jwt.verify(tempToken, JWT_SECRET);
    if (!decoded.requires2FA) {
      return res.status(400).json({ error: 'Invalid token' });
    }
  } catch (error) {
    logger.error('[LOGIN-2FA] Token verification error:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Get user — targeted lookup avoids full collection scan
  const user = await dbUnified.findOne('users', { id: decoded.id });

  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: '2FA is not enabled for this account' });
  }

  // Import encryption utilities
  const { decrypt, verifyHash } = require('../utils/encryption');
  const speakeasy = require('speakeasy');

  let verified = false;

  // Verify with 2FA token
  if (tfaToken) {
    try {
      const secret = decrypt(user.twoFactorSecret);
      verified = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token: tfaToken,
        window: 2,
      });
    } catch (error) {
      logger.error('[LOGIN-2FA] Token verification error:', error);
    }
  }

  // Verify with backup code
  if (!verified && backupCode && user.twoFactorBackupCodes) {
    for (const hashedCode of user.twoFactorBackupCodes) {
      if (verifyHash(backupCode.toUpperCase(), hashedCode)) {
        verified = true;
        // Remove used backup code
        const updatedCodes = user.twoFactorBackupCodes.filter(c => c !== hashedCode);
        await dbUnified.updateOne(
          'users',
          { id: user.id },
          {
            $set: { twoFactorBackupCodes: updatedCodes },
          }
        );
        logger.info('[LOGIN-2FA] Backup code used and removed');
        break;
      }
    }
  }

  if (!verified) {
    logger.warn('[LOGIN-2FA] Invalid 2FA token/code');
    return res.status(401).json({ error: 'Invalid 2FA token or backup code' });
  }

  // Update last login timestamp — fire-and-forget so it doesn't delay the response
  logger.info('[LOGIN-2FA] Successful 2FA login');
  updateLastLogin(user.id).catch(err =>
    logger.warn('[LOGIN-2FA] updateLastLogin failed', { error: err.message })
  );

  // Align JWT expiry with remember-me: session-only (24h) vs persistent (7d)
  const twoFaTokenExpiry = remember ? '7d' : '24h';
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: twoFaTokenExpiry,
  });

  setAuthCookie(res, token, { remember: !!remember });

  res.json({
    ok: true,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

/**
 * POST /api/auth/forgot
 * Request password reset token
 * Enhanced with logging for debugging
 */
router.post('/forgot', passwordResetLimiter, async (req, res) => {
  const { email } = req.body || {};

  logger.info('[PASSWORD RESET] Request received');

  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    logger.warn('[PASSWORD RESET] Missing email in request');
    return res.status(400).json({ error: 'Missing email' });
  }

  // Targeted lookup via indexed email field
  const user = await dbUnified.findOne('users', { email: normalizedEmail });

  if (!user) {
    logger.warn('[PASSWORD RESET] User not found');
    // Pad this branch to roughly match the found-user path's latency (token
    // generation + DB write + an awaited Postmark API call below) — otherwise
    // "no such account" returns near-instantly while a real one takes noticeably
    // longer, letting an attacker enumerate registered emails from timing alone.
    await sleep(300);
    // Always respond success so we don't leak which emails exist
    return res.json({
      ok: true,
      message: 'If an account exists with that email, you will receive a password reset link.',
    });
  }
  logger.debug('[PASSWORD RESET] Found user', { verified: user.verified });

  // Generate password reset token with JWT for better security
  try {
    const resetToken = tokenUtils.generatePasswordResetToken(user.email);
    logger.debug('[PASSWORD RESET] Token generated');

    // Save token with expiration (1 hour)
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: { resetToken: resetToken, resetTokenExpiresAt: expires },
      }
    );
    logger.debug('[PASSWORD RESET] Token saved', { expires });

    // Send password reset email
    logger.info('[PASSWORD RESET] Sending email');
    await postmark.sendPasswordResetEmail(user, resetToken);
    logger.info('[PASSWORD RESET] Email sent successfully');

    res.json({
      ok: true,
      message: 'Password reset email sent if account exists',
    });
  } catch (emailError) {
    logger.error('[PASSWORD RESET] Failed to send email:', emailError.message);

    // Still return success to prevent email enumeration
    res.json({
      ok: true,
      message: 'Password reset email sent if account exists',
    });
  }
});

/**
 * GET /api/auth/verify
 * Verify email address with token (supports both JWT and legacy tokens)
 * This endpoint maintains backward compatibility
 */
router.get('/verify', tokenLinkLimiter, async (req, res) => {
  const { token } = req.query || {};
  logger.debug('Verification request received', { hasToken: !!token });

  if (!token) {
    logger.error('Verification failed: Missing token');
    return res.status(400).json({ error: 'Missing token' });
  }

  // Check if it's a JWT token
  const isJWT = tokenUtils.isJWTToken(token);
  logger.debug('Verification token type', { type: isJWT ? 'JWT' : 'Legacy' });

  if (isJWT) {
    // Validate JWT token
    const validation = tokenUtils.validateVerificationToken(token, {
      allowGracePeriod: true,
      expectedType: tokenUtils.TOKEN_TYPES.EMAIL_VERIFICATION,
    });

    if (!validation.valid) {
      logger.error('JWT validation failed', { error: validation.error });
      return res.status(400).json({
        error: validation.message,
        code: validation.error,
        canResend: validation.canResend,
      });
    }

    // Find user by email from JWT — targeted lookup via indexed email field
    const user = await dbUnified.findOne('users', {
      email: String(validation.email).toLowerCase(),
    });

    if (!user) {
      logger.error('User not found during email verification');
      return res.status(400).json({ error: 'Invalid verification token - user not found' });
    }

    // Check if already verified
    if (user.verified === true) {
      logger.info('User already verified');
      return res.json({
        ok: true,
        message: 'Email already verified',
        alreadyVerified: true,
      });
    }

    const storedTokenStatus = getStoredTokenStatus(
      user,
      token,
      'verificationToken',
      'verificationTokenExpiresAt'
    );
    if (!storedTokenStatus.valid) {
      return res.status(400).json({
        error:
          storedTokenStatus.reason === 'expired'
            ? 'Verification token has expired. Please request a new one.'
            : 'Invalid or expired token',
        code: storedTokenStatus.reason === 'expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        canResend: true,
      });
    }

    // Mark user as verified and clear token
    const verifyUpdates = {
      ...userProvenance.eventflowEmailVerifiedProvenance(new Date().toISOString()),
    };

    // Check if this user should be auto-promoted to admin (domain-based)
    applyAdminVerificationUpgrade(user, verifyUpdates);

    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: verifyUpdates,
        $unset: { verificationToken: '', verificationTokenExpiresAt: '' },
      }
    );
    logger.info('User verified successfully via JWT');

    // Send welcome email (non-blocking)
    (async () => {
      try {
        logger.info('Sending welcome email to newly verified user');
        await postmark.sendWelcomeEmail(user);
        logger.info('Welcome email sent');
      } catch (emailError) {
        logger.error('Failed to send welcome email:', emailError.message);
      }
    })();

    return res.json({
      ok: true,
      message: 'Email verified successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  }

  // Handle legacy tokens (verificationToken field or emailVerificationToken field)
  // These are opaque strings with no index — findOne with a function filter is the
  // correct approach. This code path only runs for pre-JWT-migration tokens.
  logger.info('Processing legacy verification token');
  let tokenField = 'verificationToken';
  let expiresField = 'verificationTokenExpiresAt';
  let legacyUser = await dbUnified.findOne('users', u => u.verificationToken === token);

  if (!legacyUser) {
    // Also check the emailVerificationToken field used by emailVerification.js
    legacyUser = await dbUnified.findOne('users', u => u.emailVerificationToken === token);
    if (legacyUser) {
      tokenField = 'emailVerificationToken';
      expiresField = 'emailVerificationExpires';
      logger.info('Matched token via emailVerificationToken field');
    }
  }

  if (!legacyUser) {
    logger.error('Verification failed: Invalid token');
    return res.status(400).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
  logger.debug('Found user for legacy verification', { tokenField });

  // Check if already verified
  if (legacyUser.verified === true) {
    logger.info('User already verified (legacy path)');
    return res.json({
      ok: true,
      message: 'Email already verified',
      alreadyVerified: true,
    });
  }

  // Check whether the matched legacy token is still the active, unexpired token.
  const legacyTokenStatus = getStoredTokenStatus(legacyUser, token, tokenField, expiresField);
  if (!legacyTokenStatus.valid) {
    logger.error('Verification failed: Legacy token is not active or has expired', {
      reason: legacyTokenStatus.reason,
      tokenField,
    });
    return res.status(400).json({
      error:
        legacyTokenStatus.reason === 'expired'
          ? 'Verification token has expired. Please request a new one.'
          : 'Invalid or expired token',
      code: legacyTokenStatus.reason === 'expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      canResend: true,
    });
  }

  // Mark user as verified and clear all legacy token fields
  const legacyVerifyUpdates = {
    verified: true,
    verifiedAt: new Date().toISOString(),
  };

  // Check if this user should be auto-promoted to admin (domain-based)
  applyAdminVerificationUpgrade(legacyUser, legacyVerifyUpdates);

  await dbUnified.updateOne(
    'users',
    { id: legacyUser.id },
    {
      $set: legacyVerifyUpdates,
      $unset: {
        verificationToken: '',
        verificationTokenExpiresAt: '',
        emailVerificationToken: '',
        emailVerificationExpires: '',
      },
    }
  );
  logger.info('User verified successfully (legacy)', { tokenField });

  // Send welcome email after successful verification (non-blocking)
  (async () => {
    try {
      logger.info('Sending welcome email to newly verified user');
      await postmark.sendWelcomeEmail(legacyUser);
      logger.info('Welcome email sent');
    } catch (emailError) {
      // Don't fail verification if welcome email fails - just log it
      logger.error('Failed to send welcome email:', emailError.message);
    }
  })();

  res.json({
    ok: true,
    message: 'Email verified successfully',
    user: {
      id: legacyUser.id,
      email: legacyUser.email,
      name: legacyUser.name,
    },
  });
});

/**
 * POST /api/auth/verify-email
 * New unified verification endpoint with enhanced error handling
 * Supports both query params and body, with comprehensive logging
 */
router.post('/verify-email', authLimiter, validateToken({ required: true }), async (req, res) => {
  logger.debug('POST /api/auth/verify-email called');
  logger.debug('Token validation', { tokenValidation: req.tokenValidation });

  const validation = req.tokenValidation;

  // Handle JWT tokens
  if (validation.isJWT && validation.valid) {
    const user = await dbUnified.findOne('users', {
      email: String(validation.email).toLowerCase(),
    });

    if (!user) {
      logger.error('User not found during email verification');
      return res.status(400).json({
        ok: false,
        error: 'Invalid verification token - user not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Check if already verified
    if (user.verified === true) {
      logger.info('User already verified');
      return res.json({
        ok: true,
        message: 'Your email address is already verified',
        alreadyVerified: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    }

    const storedTokenStatus = getStoredTokenStatus(
      user,
      tokenUtils.extractToken(req),
      'verificationToken',
      'verificationTokenExpiresAt'
    );
    if (!storedTokenStatus.valid) {
      return res.status(400).json({
        ok: false,
        error:
          storedTokenStatus.reason === 'expired'
            ? 'Verification token has expired. Please request a new one.'
            : 'Invalid or expired verification token',
        code: storedTokenStatus.reason === 'expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        canResend: true,
      });
    }

    // Mark user as verified and apply the same domain-admin promotion rules as GET /verify.
    const verifyUpdates = applyAdminVerificationUpgrade(user, {
      ...userProvenance.eventflowEmailVerifiedProvenance(new Date().toISOString()),
    });

    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: verifyUpdates,
        $unset: { verificationToken: '', verificationTokenExpiresAt: '' },
      }
    );

    logger.info('User verified successfully via POST');

    // Send welcome email (non-blocking)
    (async () => {
      try {
        await postmark.sendWelcomeEmail(user);
        logger.info('Welcome email sent');
      } catch (emailError) {
        logger.error('Failed to send welcome email:', emailError.message);
      }
    })();

    return res.json({
      ok: true,
      message: 'Your email has been verified successfully! You can now log in.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: verifyUpdates.role || user.role,
      },
      withinGracePeriod: validation.withinGracePeriod,
    });
  }

  // Handle legacy tokens
  if (!validation.isJWT && validation.legacyToken) {
    logger.info('Processing legacy token via POST endpoint');

    let tokenField = 'verificationToken';
    let expiresField = 'verificationTokenExpiresAt';
    let user = await dbUnified.findOne(
      'users',
      u => u.verificationToken === validation.legacyToken
    );

    if (!user) {
      user = await dbUnified.findOne(
        'users',
        u => u.emailVerificationToken === validation.legacyToken
      );
      if (user) {
        tokenField = 'emailVerificationToken';
        expiresField = 'emailVerificationExpires';
      }
    }

    if (!user) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid or expired verification token',
        code: 'INVALID_TOKEN',
        canResend: true,
      });
    }

    // Check whether the matched legacy token is still active and unexpired.
    const legacyTokenStatus = getStoredTokenStatus(
      user,
      validation.legacyToken,
      tokenField,
      expiresField
    );
    if (!legacyTokenStatus.valid) {
      return res.status(400).json({
        ok: false,
        error:
          legacyTokenStatus.reason === 'expired'
            ? 'Verification token has expired. Please request a new one.'
            : 'Invalid or expired verification token',
        code: legacyTokenStatus.reason === 'expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        canResend: true,
      });
    }

    // Verify user and apply the same domain-admin promotion rules as GET /verify.
    const legacyVerifyUpdates = applyAdminVerificationUpgrade(user, {
      ...userProvenance.eventflowEmailVerifiedProvenance(new Date().toISOString()),
    });

    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: legacyVerifyUpdates,
        $unset: {
          verificationToken: '',
          verificationTokenExpiresAt: '',
          emailVerificationToken: '',
          emailVerificationExpires: '',
        },
      }
    );

    logger.info('User verified via legacy token', { tokenField });

    // Send welcome email (non-blocking)
    (async () => {
      try {
        await postmark.sendWelcomeEmail(user);
      } catch (err) {
        logger.error('Failed to send welcome email:', err.message);
      }
    })();

    return res.json({
      ok: true,
      message: 'Your email has been verified successfully! You can now log in.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: legacyVerifyUpdates.role || user.role,
      },
    });
  }

  // Should never reach here due to middleware
  return res.status(400).json({
    ok: false,
    error: 'Invalid token validation state',
    code: 'VALIDATION_ERROR',
  });
});

/**
 * POST /api/auth/validate-reset-token
 * Check whether a password-reset token is still valid without consuming it.
 * Used by reset-password.html to give early feedback before the user fills in the form.
 */
router.post('/validate-reset-token', passwordResetLimiter, async (req, res) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // Try JWT token first
    const jwtValidation = tokenUtils.validatePasswordResetToken(token);
    if (jwtValidation.valid) {
      const user = await dbUnified.findOne('users', {
        email: String(jwtValidation.email).toLowerCase(),
      });
      const status = getStoredTokenStatus(user, token, 'resetToken', 'resetTokenExpiresAt');
      if (!status.valid) {
        const message =
          status.reason === 'expired'
            ? 'Password reset link has expired. Please request a new one.'
            : 'Invalid or expired password reset link';
        return res.status(400).json({ error: message });
      }
      return res.json({ ok: true });
    }

    // Try legacy reset token (opaque string — no index, function scan)
    const user = await dbUnified.findOne('users', u => u.resetToken === token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired password reset link' });
    }
    const legacyStatus = getStoredTokenStatus(user, token, 'resetToken', 'resetTokenExpiresAt');
    if (!legacyStatus.valid) {
      const message =
        legacyStatus.reason === 'expired'
          ? 'Password reset link has expired. Please request a new one.'
          : 'Invalid or expired password reset link';
      return res.status(400).json({ error: message });
    }

    return res.json({ ok: true });
  } catch (err) {
    logger.error('[VALIDATE RESET TOKEN] Error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/reset-password
 * Verify reset token and update password
 * Enhanced with logging for debugging
 */
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  const { token, password } = req.body || {};

  logger.debug('[PASSWORD RESET VERIFY] Request received', { hasToken: !!token });

  if (!token || !password) {
    logger.warn('[PASSWORD RESET VERIFY] Missing token or password');
    return res.status(400).json({ error: 'Missing token or password' });
  }

  // Validate password strength
  if (!passwordOk(password)) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 8 characters with a letter and number' });
  }

  try {
    let user = null;

    // Try JWT token first
    logger.debug('[PASSWORD RESET VERIFY] Checking if JWT token');
    const validation = tokenUtils.validatePasswordResetToken(token);

    if (validation.valid) {
      logger.info('[PASSWORD RESET VERIFY] Valid JWT token found');
      user = await dbUnified.findOne('users', { email: String(validation.email).toLowerCase() });

      if (user) {
        const status = getStoredTokenStatus(user, token, 'resetToken', 'resetTokenExpiresAt');
        if (!status.valid) {
          logger.warn('[PASSWORD RESET VERIFY] JWT token is not the active stored reset token', {
            reason: status.reason,
          });
          return res.status(400).json({
            error:
              status.reason === 'expired'
                ? 'Password reset link has expired. Please request a new one.'
                : 'Invalid or expired password reset link',
          });
        }
      }
    } else {
      logger.debug('[PASSWORD RESET VERIFY] Not a valid JWT, trying legacy token');
      // Legacy opaque reset token — no index, function scan
      user = await dbUnified.findOne('users', u => u.resetToken === token);

      if (user) {
        logger.info('[PASSWORD RESET VERIFY] Found legacy token');
        const legacyStatus = getStoredTokenStatus(user, token, 'resetToken', 'resetTokenExpiresAt');
        if (!legacyStatus.valid) {
          if (legacyStatus.reason === 'expired') {
            logger.warn('[PASSWORD RESET VERIFY] Legacy token expired');
            return res.status(400).json({
              error: 'Password reset link has expired. Please request a new one.',
              canRequestNew: true,
            });
          }
          logger.warn('[PASSWORD RESET VERIFY] Legacy token is malformed or has been replaced');
          return res.status(400).json({ error: 'Invalid reset token format' });
        }
      }
    }

    if (!user) {
      logger.warn('[PASSWORD RESET VERIFY] Invalid or expired token');
      return res.status(400).json({
        error: 'Invalid or expired password reset link',
      });
    }
    logger.info('[PASSWORD RESET VERIFY] Resetting password');

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          passwordHash: hashedPassword,
          passwordResetRequired: false,
          passwordChangedAt: new Date().toISOString(),
        },
        $unset: { resetToken: '', resetTokenExpiresAt: '' },
      }
    );

    logger.info('[PASSWORD RESET VERIFY] Password updated successfully');

    // Send confirmation email
    try {
      await postmark.sendPasswordResetConfirmation(user);
      logger.info('[PASSWORD RESET VERIFY] Confirmation email sent');
    } catch (emailError) {
      logger.error('Failed to send confirmation email:', emailError.message);
      // Don't fail the reset if confirmation email fails
    }

    res.json({
      ok: true,
      message: 'Password updated successfully. You can now log in.',
      user: { id: user.id, email: user.email },
    });
  } catch (error) {
    logger.error('[PASSWORD RESET VERIFY] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /api/auth/logout
 * Log out current user
 */
router.post('/logout', authLimiter, csrfProtection, (_req, res) => {
  // Set cache control headers to prevent caching of logout response
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  clearAuthCookie(res);
  res.json({ ok: true });
});

/**
 * GET /api/auth/logout
 * Removed: use POST /api/auth/logout with CSRF token instead.
 * Returns 405 Method Not Allowed to inform any clients still using the old route.
 */
router.get('/logout', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Method Not Allowed. Use POST /api/auth/logout.' });
});

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
router.get('/me', async (req, res) => {
  // Set cache control headers to prevent caching of auth state
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie');

  const p = getUserFromCookie(req);
  if (!p) {
    return res.json({ user: null });
  }
  // Targeted lookup — avoids full collection scan on every page load
  const u = await dbUnified.findOne('users', { id: p.id });
  if (!u) {
    return res.json({ user: null });
  }

  // For supplier users, include approval status so the frontend can show pending-approval UX
  let supplierApproved = null;
  if (u.role === 'supplier') {
    try {
      const supplierProfile = await dbUnified.findOne('suppliers', { ownerUserId: u.id });
      supplierApproved = supplierProfile ? supplierProfile.approved === true : null;
    } catch (e) {
      logger.warn('Could not fetch supplier profile for GET /me', {
        userId: u.id,
        error: e.message,
      });
    }
  }

  res.json({
    user: {
      id: u.id,
      name: u.name,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      verified: u.verified === true,
      emailVerified: u.verified === true || u.emailVerified === true,
      supplierApproved,
      location: u.location,
      postcode: u.postcode,
      company: u.company,
      jobTitle: u.jobTitle,
      website: u.website,
      socials: u.socials || {},
      avatarUrl: u.avatarUrl,
      badges: u.badges || [],
      isPro: u.isPro || false,
      proExpiresAt: u.proExpiresAt || null,
      subscriptionTier: u.subscriptionTier || 'free',
      notify: u.notify !== false,
      notify_account: u.notify_account !== false,
      notify_marketing: u.notify_marketing === true,
    },
  });
});

/**
 * PUT /api/auth/preferences
 * Update user notification preferences
 */
router.put('/preferences', writeLimiter, authRequired, csrfProtection, async (req, res) => {
  const { notify_account, notify_marketing } = req.body || {};

  const prefUpdates = {};

  // Update preferences if provided
  if (typeof notify_account === 'boolean') {
    prefUpdates.notify_account = notify_account;
    prefUpdates.notify = notify_account; // Update deprecated field for backward compatibility
  }

  if (typeof notify_marketing === 'boolean') {
    prefUpdates.notify_marketing = notify_marketing;
    prefUpdates.marketingOptIn = notify_marketing; // Update deprecated field for backward compatibility
  }

  if (Object.keys(prefUpdates).length > 0) {
    const updated = await dbUnified.updateOne('users', { id: req.user.id }, { $set: prefUpdates });
    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }
  }

  // Read back current values — targeted lookup avoids full collection scan
  const user = (await dbUnified.findOne('users', { id: req.user.id })) || {};

  res.json({
    ok: true,
    preferences: {
      notify_account: user.notify_account !== false,
      notify_marketing: user.notify_marketing === true,
    },
  });
});

/**
 * Shared handler for GET and POST /api/auth/unsubscribe — the action itself
 * is identical either way (flip notify_marketing off, keyed by the same
 * token-verified email), only the trigger differs: a clicked link (GET) vs.
 * a mail client's RFC 8058 one-click List-Unsubscribe-Post request (POST).
 */
async function handleAccountUnsubscribe(req, res) {
  const { email, token } = req.query || {};

  if (!email || !token) {
    return res.status(400).json({ error: 'Missing email or token parameter' });
  }

  // Verify the token matches the email
  try {
    if (!postmark.verifyUnsubscribeToken(email, token)) {
      return res.status(400).json({ error: 'Invalid unsubscribe token' });
    }
  } catch (err) {
    // Handle token verification errors (e.g., token length mismatch)
    return res.status(400).json({ error: 'Invalid unsubscribe token' });
  }

  const normalizedEmail = normalizeEmail(email);
  // Targeted lookup — normalizedEmail is already lowercased, emails stored lowercase
  const user = await dbUnified.findOne('users', { email: normalizedEmail });

  if (!user) {
    // Don't reveal if email exists - return success anyway
    return res.json({
      ok: true,
      message: 'If this email is registered, marketing emails have been disabled.',
    });
  }

  // Disable marketing emails
  await dbUnified.updateOne(
    'users',
    { id: user.id },
    {
      $set: { notify_marketing: false, marketingOptIn: false },
    }
  );

  // Keep the newsletter subscription in sync — a separate newsletter signup
  // under the same email shouldn't keep receiving campaigns just because
  // the account holder unsubscribed via this link instead of the
  // newsletter's own unsubscribe flow.
  try {
    await dbUnified.updateOne(
      'newsletterSubscribers',
      { email: normalizedEmail },
      { $set: { status: 'unsubscribed', unsubscribedAt: new Date().toISOString() } }
    );
  } catch (syncError) {
    logger.warn(
      'Failed to sync account unsubscribe to newsletter subscription:',
      syncError.message
    );
  }

  res.json({
    ok: true,
    message:
      'You have been unsubscribed from marketing emails. You will still receive important account notifications.',
  });
}

/**
 * GET /api/auth/unsubscribe
 * Unsubscribe user from marketing emails
 * Requires email and secure token for verification
 */
router.get('/unsubscribe', tokenLinkLimiter, handleAccountUnsubscribe);

/**
 * POST /api/auth/unsubscribe
 * RFC 8058 one-click unsubscribe target for the List-Unsubscribe-Post
 * header set on marketing sends (utils/postmark.js's sendMarketingEmail) —
 * Gmail/Yahoo/etc. POST here directly with no user interaction beyond the
 * "Unsubscribe" button they render next to the message, so this must not
 * require a CSRF token (the mail client has none) or reveal any UI; the
 * unsubscribe token in the query string is this endpoint's only auth, same
 * as the GET link it mirrors.
 */
router.post('/unsubscribe', tokenLinkLimiter, handleAccountUnsubscribe);

/**
 * POST /api/auth/resend-verification
 * Resend verification email to user
 * Can be called by the user themselves or by an admin
 */
router.post('/resend-verification', resendEmailLimiter, csrfProtection, async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'Missing email address' });
  }

  if (!validator.isEmail(String(email))) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Look up user by email — targeted lookup avoids full collection scan
  const normalizedEmail = normalizeEmail(email);
  const user = await dbUnified.findOne('users', { email: normalizedEmail });

  if (!user) {
    // Don't reveal if email exists - return success anyway for security
    return res.json({
      ok: true,
      message:
        'If this email is registered and unverified, a new verification email has been sent.',
    });
  }

  // Check if user is already verified or does not require EventFlow email verification
  if (user.verified === true) {
    return res.json({
      ok: true,
      message: 'This email address is already verified.',
    });
  }

  if (!userProvenance.canResendVerification(user)) {
    return res.json({
      ok: true,
      message:
        'If this email is registered and unverified, a new verification email has been sent.',
    });
  }

  // Generate new JWT verification token
  const verificationToken = tokenUtils.generateVerificationToken(user, {
    expiresInHours: 24,
  });

  // Store token info
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Send verification email via Postmark BEFORE saving token
  let sendResult;
  try {
    logger.info('Resending verification email');
    sendResult = await postmark.sendVerificationEmail(user, verificationToken);
    logger.info('Verification email resent successfully');
  } catch (emailError) {
    logger.error('Failed to resend verification email:', emailError.message);

    // Return generic success to prevent email enumeration
    return res.json({
      ok: true,
      message:
        'If this email is registered and unverified, a new verification email has been sent.',
    });
  }

  // Only update token after email is successfully sent
  await dbUnified.updateOne(
    'users',
    { id: user.id },
    {
      $set: {
        verificationToken: verificationToken,
        verificationTokenExpiresAt: tokenExpiresAt,
        ...userProvenance.metadataFromSendResult(sendResult),
      },
    }
  );

  res.json({
    ok: true,
    message: 'A new verification email has been sent. Please check your inbox.',
  });
});

/**
 * PUT /api/auth/profile
 * Update current user's profile information
 */
router.put('/profile', authRequired, csrfProtection, async (req, res) => {
  const {
    name,
    firstName,
    lastName,
    email,
    phone,
    location,
    postcode,
    company,
    jobTitle,
    website,
  } = req.body;

  const user = await dbUnified.findOne('users', { id: req.user.id });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Check if email is being changed and if it's already taken
  const profileUpdates = {};
  const emailOriginal = user.email;

  if (email && email !== user.email) {
    const emailExists = await dbUnified.findOne('users', { email });
    if (emailExists && emailExists.id !== user.id) {
      return res.status(400).json({ error: 'Email address is already in use' });
    }

    // Email changed - mark as unverified and send new verification email
    profileUpdates.email = email;
    profileUpdates.verified = false;
    profileUpdates.verificationToken = tokenUtils.generateVerificationToken(
      { ...user, email },
      { expiresInHours: 24 }
    );
    profileUpdates.verificationTokenExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();

    // Send verification email asynchronously
    postmark
      .sendVerificationEmail({ ...user, email }, profileUpdates.verificationToken)
      .catch(err => {
        logger.error('Failed to send verification email:', err);
      });
  }

  // Update allowed fields
  if (name !== undefined) {
    profileUpdates.name = name;
  }
  if (firstName !== undefined) {
    profileUpdates.firstName = firstName;
  }
  if (lastName !== undefined) {
    profileUpdates.lastName = lastName;
  }
  if (phone !== undefined) {
    profileUpdates.phone = phone;
  }
  if (location !== undefined) {
    profileUpdates.location = location;
  }
  if (postcode !== undefined) {
    profileUpdates.postcode = postcode;
  }
  if (company !== undefined) {
    profileUpdates.company = company;
  }
  if (jobTitle !== undefined) {
    profileUpdates.jobTitle = jobTitle;
  }
  if (website !== undefined) {
    profileUpdates.website = website;
  }

  profileUpdates.updatedAt = new Date().toISOString();

  await dbUnified.updateOne('users', { id: req.user.id }, { $set: profileUpdates });

  // Build response from merged data
  const updatedUser = { ...user, ...profileUpdates };

  // Return updated user info
  res.json({
    ok: true,
    message:
      email && email !== emailOriginal
        ? 'Profile updated. Please check your new email address to verify it.'
        : 'Profile updated successfully',
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      location: updatedUser.location,
      postcode: updatedUser.postcode,
      company: updatedUser.company,
      jobTitle: updatedUser.jobTitle,
      website: updatedUser.website,
      avatarUrl: updatedUser.avatarUrl,
      verified: updatedUser.verified,
    },
  });
});

/**
 * POST /api/auth/change-password
 * Change the authenticated user's password (requires current password verification).
 */
router.post('/change-password', authRequired, csrfProtection, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (!passwordOk(newPassword)) {
    return res
      .status(400)
      .json({ error: 'New password must be at least 8 characters with a letter and number' });
  }

  try {
    // Targeted lookup — avoids full collection scan for every password change
    const user = await dbUnified.findOne('users', { id: req.user.id });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash || '');
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: {
          passwordHash: newHash,
          passwordChangedAt: new Date().toISOString(),
        },
      }
    );

    res.json({ ok: true, message: 'Password updated successfully' });
  } catch (err) {
    logger.error('change-password error:', err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

module.exports = router;
module.exports.setSendMailFunction = setSendMailFunction;
module.exports.initializeDependencies = initializeDependencies;
