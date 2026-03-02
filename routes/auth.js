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
  authRequired,
  setAuthCookie,
  clearAuthCookie,
  getUserFromCookie,
} = require('../middleware/auth');
const { passwordOk } = require('../middleware/validation');
const { authLimiter, resendEmailLimiter } = require('../middleware/rateLimits');
const { csrfProtection } = require('../middleware/csrf');
const { featureRequired, getFeatureFlags } = require('../middleware/features');
const postmark = require('../utils/postmark');
const tokenUtils = require('../utils/token');
const { validateToken } = require('../middleware/token');
const domainAdmin = require('../middleware/domain-admin');

const router = express.Router();

const JWT_SECRET = String(process.env.JWT_SECRET || 'change_me');

// This will be set by the main server.js when mounting these routes (legacy compatibility)
// eslint-disable-next-line no-unused-vars
let _sendMailFn = null;
let _verifyHCaptcha = null;

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
  if (deps.verifyHCaptcha) {
    _verifyHCaptcha = deps.verifyHCaptcha;
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
    if (req.body.role === 'supplier') {
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
  authLimiter,
  async (req, res) => {
    const {
      firstName,
      lastName,
      name,
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
    } = req.body || {};

    // Verify hCaptcha token when the verifier is available
    if (_verifyHCaptcha) {
      const captchaResult = await _verifyHCaptcha(captchaToken);
      if (!captchaResult.success) {
        return res
          .status(400)
          .json({ error: captchaResult.error || 'CAPTCHA verification failed' });
      }
    }

    // Support both new (firstName/lastName) and legacy (name) formats
    const userFirstName = firstName || '';
    const userLastName = lastName || '';
    const userFullName =
      firstName && lastName ? `${firstName.trim()} ${lastName.trim()}`.trim() : (name || '').trim();

    // Required fields validation
    if (!userFullName || !email || !password) {
      return res.status(400).json({
        error: 'Missing required fields (name or firstName/lastName, email, and password required)',
      });
    }
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    if (!validator.isEmail(String(email))) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    if (!passwordOk(password)) {
      return res.status(400).json({ error: 'Weak password' });
    }

    const roleFinal = role === 'supplier' || role === 'customer' ? role : 'customer';

    // Role-specific required field validation
    if (!location) {
      return res.status(400).json({ error: 'Location is required' });
    }
    if (roleFinal === 'supplier' && !company) {
      return res.status(400).json({ error: 'Company name is required for suppliers' });
    }

    const users = await dbUnified.read('users');

    // Check if this is the owner email trying to register
    // Owner account should only be created through seed, not registration
    if (domainAdmin.isOwnerEmail(email)) {
      const ownerExists = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (ownerExists) {
        return res.status(409).json({
          error: 'Email already registered',
          message: 'This email is reserved for the system owner account.',
        });
      } else {
        // Owner doesn't exist yet - this shouldn't happen normally (seed creates it)
        // But we'll allow it and create them as owner
        logger.warn('Owner account being created through registration (should use seed)');
      }
    } else if (users.find(u => u.email.toLowerCase() === String(email).toLowerCase())) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Sanitize and validate optional URLs
    const sanitizeUrl = url => {
      if (!url) {
        return undefined;
      }
      const trimmed = String(url).trim();
      if (!trimmed) {
        return undefined;
      }
      // Basic URL validation
      if (!validator.isURL(trimmed, { require_protocol: false })) {
        return undefined;
      }
      return trimmed;
    };

    // Parse socials object
    const socialsParsed = socials
      ? {
          instagram: sanitizeUrl(socials.instagram),
          facebook: sanitizeUrl(socials.facebook),
          twitter: sanitizeUrl(socials.twitter),
          linkedin: sanitizeUrl(socials.linkedin),
        }
      : {};

    // Determine founder badge eligibility
    const founderLaunchTs = process.env.FOUNDER_LAUNCH_TS || '2026-01-01T00:00:00Z';
    const founderLaunchDate = new Date(founderLaunchTs);
    const founderEndDate = new Date(founderLaunchDate);
    founderEndDate.setMonth(founderEndDate.getMonth() + 6); // 6 months from launch

    const now = new Date();
    const badges = [];
    if (now <= founderEndDate) {
      badges.push('founder');
      logger.info('Founder badge awarded (new user registered within 6 months of launch)');
    }

    // Determine role using domain-admin logic
    // Owner email: always admin, always verified (skip verification email)
    // Admin domain: initial role as requested, upgrade to admin AFTER verification
    // Regular user: use requested role
    const isOwner = domainAdmin.isOwnerEmail(email);
    const roleDecision = domainAdmin.determineRole(email, roleFinal, false); // Not verified yet

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
      name: String(userFullName).slice(0, 80),
      firstName: String(userFirstName).trim().slice(0, 40),
      lastName: String(userLastName).trim().slice(0, 40),
      email: String(email).toLowerCase(),
      role: isOwner ? 'admin' : roleDecision.role, // Owner gets admin immediately
      passwordHash: await bcrypt.hash(password, 10),
      location: String(location).trim().slice(0, 100),
      postcode: postcode ? String(postcode).trim().slice(0, 10) : undefined,
      company: company ? String(company).trim().slice(0, 100) : undefined,
      jobTitle: jobTitle ? String(jobTitle).trim().slice(0, 100) : undefined,
      website: sanitizeUrl(website),
      socials: socialsParsed,
      badges,
      notify: true, // Deprecated, kept for backward compatibility
      notify_account: true, // Transactional emails enabled by default
      notify_marketing: !!(req.body && req.body.marketingOptIn), // Marketing emails opt-in
      marketingOptIn: !!(req.body && req.body.marketingOptIn), // Deprecated, kept for backward compatibility
      verified: isOwner, // Owner is pre-verified, others need verification
      isOwner: isOwner, // Special flag to protect owner account
      createdAt: new Date().toISOString(),
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
        await postmark.sendVerificationEmail(user, verificationToken);
        logger.info('Verification email sent successfully');
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
    await dbUnified.insertOne('users', user);

    // Update last login timestamp (non-blocking)
    await updateLastLogin(user.id);

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });
    // Default to remember=true for registration to provide better UX
    setAuthCookie(res, token, { remember: true });

    // Prevent caching of registration responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    res.status(201).json({
      ok: true,
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
router.post('/login', authLimiter, async (req, res) => {
  const { email, password, remember } = req.body || {};

  // Prevent caching of login responses
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  logger.info('[LOGIN] Attempt');

  if (!email || !password) {
    logger.warn('[LOGIN] Missing email or password');
    return res.status(400).json({ error: 'Missing fields' });
  }

  const users = await dbUnified.read('users');
  const user = users.find(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

  if (!user) {
    logger.warn('[LOGIN] User not found');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  logger.debug('[LOGIN] User found', { verified: user.verified, hasHash: !!user.passwordHash });

  // Check password hash exists and is valid
  if (!user.passwordHash) {
    logger.error('[LOGIN] No password hash found');
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Try to compare password
  let passwordMatches = false;
  try {
    passwordMatches = await bcrypt.compare(password, user.passwordHash);
    logger.debug('[LOGIN] Password check complete', { match: passwordMatches });
  } catch (error) {
    logger.error('[LOGIN] Password comparison error:', error.message);
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

  // Update last login timestamp
  logger.info('[LOGIN] Successful login');
  await updateLastLogin(user.id);

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

/**
 * POST /api/auth/login-2fa
 * Complete login with 2FA token
 */
router.post('/login-2fa', authLimiter, async (req, res) => {
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

  // Get user
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === decoded.id);

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

  // Update last login timestamp
  logger.info('[LOGIN-2FA] Successful 2FA login');
  await updateLastLogin(user.id);

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
router.post('/forgot', authLimiter, async (req, res) => {
  const { email } = req.body || {};

  logger.info('[PASSWORD RESET] Request received');

  if (!email) {
    logger.warn('[PASSWORD RESET] Missing email in request');
    return res.status(400).json({ error: 'Missing email' });
  }

  // Look up user by email (case-insensitive)
  const users = await dbUnified.read('users');
  const idx = users.findIndex(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

  if (idx === -1) {
    logger.warn('[PASSWORD RESET] User not found');
    // Always respond success so we don't leak which emails exist
    return res.json({
      ok: true,
      message: 'If an account exists with that email, you will receive a password reset link.',
    });
  }

  const user = users[idx];
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
router.get('/verify', async (req, res) => {
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

    // Find user by email from JWT
    const users = await dbUnified.read('users');
    const idx = users.findIndex(u => u.email.toLowerCase() === validation.email.toLowerCase());

    if (idx === -1) {
      logger.error('User not found during email verification');
      return res.status(400).json({ error: 'Invalid verification token - user not found' });
    }

    const user = users[idx];

    // Check if already verified
    if (user.verified === true) {
      logger.info('User already verified');
      return res.json({
        ok: true,
        message: 'Email already verified',
        alreadyVerified: true,
      });
    }

    // Mark user as verified and clear token
    const verifyUpdates = {
      verified: true,
      verifiedAt: new Date().toISOString(),
    };

    // Check if this user should be auto-promoted to admin (domain-based)
    if (domainAdmin.shouldUpgradeToAdminOnVerification(user.email)) {
      const previousRole = user.role;
      verifyUpdates.role = 'admin';
      logger.info('User auto-promoted to admin (admin domain verified)', { previousRole });
    }

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

  // Handle legacy tokens
  logger.info('Processing legacy verification token');
  const legacyUsers = await dbUnified.read('users');
  const legacyIdx = legacyUsers.findIndex(u => u.verificationToken === token);

  if (legacyIdx === -1) {
    logger.error('Verification failed: Invalid token');
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  const legacyUser = legacyUsers[legacyIdx];
  logger.debug('Found user for legacy verification');

  // Check if token has expired
  if (legacyUser.verificationTokenExpiresAt) {
    const expiresAt = new Date(legacyUser.verificationTokenExpiresAt);
    if (expiresAt < new Date()) {
      logger.error('Verification failed: Token expired');
      return res
        .status(400)
        .json({ error: 'Verification token has expired. Please request a new one.' });
    }
  }

  // Mark user as verified and clear token
  const legacyVerifyUpdates = {
    verified: true,
    verifiedAt: new Date().toISOString(),
  };

  // Check if this user should be auto-promoted to admin (domain-based)
  if (domainAdmin.shouldUpgradeToAdminOnVerification(legacyUser.email)) {
    const previousRole = legacyUser.role;
    legacyVerifyUpdates.role = 'admin';
    logger.info('User auto-promoted to admin (admin domain verified)', { previousRole });
  }

  await dbUnified.updateOne(
    'users',
    { id: legacyUser.id },
    {
      $set: legacyVerifyUpdates,
      $unset: { verificationToken: '', verificationTokenExpiresAt: '' },
    }
  );
  logger.info('User verified successfully (legacy)');

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

  res.json({ ok: true, message: 'Email verified successfully' });
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
    const users = await dbUnified.read('users');
    const idx = users.findIndex(u => u.email.toLowerCase() === validation.email.toLowerCase());

    if (idx === -1) {
      logger.error('User not found during email verification');
      return res.status(400).json({
        ok: false,
        error: 'Invalid verification token - user not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const user = users[idx];

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

    // Mark user as verified
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: { verified: true, verifiedAt: new Date().toISOString() },
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
        role: user.role,
      },
      withinGracePeriod: validation.withinGracePeriod,
    });
  }

  // Handle legacy tokens
  if (!validation.isJWT && validation.legacyToken) {
    logger.info('Processing legacy token via POST endpoint');

    const users = await dbUnified.read('users');
    const idx = users.findIndex(u => u.verificationToken === validation.legacyToken);

    if (idx === -1) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid or expired verification token',
        code: 'INVALID_TOKEN',
        canResend: true,
      });
    }

    const user = users[idx];

    // Check expiration
    if (user.verificationTokenExpiresAt) {
      const expiresAt = new Date(user.verificationTokenExpiresAt);
      if (expiresAt < new Date()) {
        return res.status(400).json({
          ok: false,
          error: 'Verification token has expired. Please request a new one.',
          code: 'TOKEN_EXPIRED',
          canResend: true,
        });
      }
    }

    // Verify user
    await dbUnified.updateOne(
      'users',
      { id: user.id },
      {
        $set: { verified: true, verifiedAt: new Date().toISOString() },
        $unset: { verificationToken: '', verificationTokenExpiresAt: '' },
      }
    );

    logger.info('User verified via legacy token');

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
        role: user.role,
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
router.post('/validate-reset-token', authLimiter, async (req, res) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    const users = await dbUnified.read('users');

    // Try JWT token first
    const jwtValidation = tokenUtils.validatePasswordResetToken(token);
    if (jwtValidation.valid) {
      const userExists = users.some(
        u => (u.email || '').toLowerCase() === String(jwtValidation.email).toLowerCase()
      );
      if (!userExists) {
        return res.status(400).json({ error: 'Invalid or expired password reset link' });
      }
      return res.json({ ok: true });
    }

    // Try legacy reset token
    const user = users.find(u => u.resetToken === token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired password reset link' });
    }
    if (user.resetTokenExpiresAt && new Date(user.resetTokenExpiresAt) < new Date()) {
      return res
        .status(400)
        .json({ error: 'Password reset link has expired. Please request a new one.' });
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
router.post('/reset-password', authLimiter, async (req, res) => {
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
    const users = await dbUnified.read('users');
    let user = null;
    let userIdx = -1;

    // Try JWT token first
    logger.debug('[PASSWORD RESET VERIFY] Checking if JWT token');
    const validation = tokenUtils.validatePasswordResetToken(token);

    if (validation.valid) {
      logger.info('[PASSWORD RESET VERIFY] Valid JWT token found');
      userIdx = users.findIndex(
        u => (u.email || '').toLowerCase() === String(validation.email).toLowerCase()
      );
    } else {
      logger.debug('[PASSWORD RESET VERIFY] Not a valid JWT, trying legacy token');
      // Try legacy reset token
      userIdx = users.findIndex(u => u.resetToken === token);

      if (userIdx !== -1) {
        user = users[userIdx];
        logger.info('[PASSWORD RESET VERIFY] Found legacy token');

        // Check if expired
        if (user.resetTokenExpiresAt) {
          const expiresAt = new Date(user.resetTokenExpiresAt);
          if (expiresAt < new Date()) {
            logger.warn('[PASSWORD RESET VERIFY] Legacy token expired');
            return res.status(400).json({
              error: 'Password reset link has expired. Please request a new one.',
              canRequestNew: true,
            });
          }
        } else {
          // If no expiry set, reject for security
          logger.warn('[PASSWORD RESET VERIFY] Legacy token without expiry');
          return res.status(400).json({ error: 'Invalid reset token format' });
        }
      }
    }

    if (userIdx === -1) {
      logger.warn('[PASSWORD RESET VERIFY] Invalid or expired token');
      return res.status(400).json({
        error: 'Invalid or expired password reset link',
      });
    }

    user = users[userIdx];
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
 * Log out current user and redirect to home page
 */
router.get('/logout', authLimiter, (_req, res) => {
  // Set cache control headers to prevent caching of logout response
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  clearAuthCookie(res);
  res.redirect('/');
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
  const users = await dbUnified.read('users');
  const u = users.find(x => x.id === p.id);
  res.json({
    user: u
      ? {
          id: u.id,
          name: u.name,
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          role: u.role,
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
        }
      : null,
  });
});

/**
 * PUT /api/auth/preferences
 * Update user notification preferences
 */
router.put('/preferences', authRequired, csrfProtection, async (req, res) => {
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

  // Read back to get the current values for the response
  const users = await dbUnified.read('users');
  const user = users.find(u => u.id === req.user.id) || {};

  res.json({
    ok: true,
    preferences: {
      notify_account: user.notify_account !== false,
      notify_marketing: user.notify_marketing === true,
    },
  });
});

/**
 * GET /api/auth/unsubscribe
 * Unsubscribe user from marketing emails
 * Requires email and secure token for verification
 */
router.get('/unsubscribe', async (req, res) => {
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

  const users = await dbUnified.read('users');
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase());

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

  res.json({
    ok: true,
    message:
      'You have been unsubscribed from marketing emails. You will still receive important account notifications.',
  });
});

/**
 * POST /api/auth/resend-verification
 * Resend verification email to user
 * Can be called by the user themselves or by an admin
 */
router.post('/resend-verification', resendEmailLimiter, async (req, res) => {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'Missing email address' });
  }

  if (!validator.isEmail(String(email))) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Look up user by email (case-insensitive)
  const users = await dbUnified.read('users');
  const idx = users.findIndex(u => (u.email || '').toLowerCase() === String(email).toLowerCase());

  if (idx === -1) {
    // Don't reveal if email exists - return success anyway for security
    return res.json({
      ok: true,
      message:
        'If this email is registered and unverified, a new verification email has been sent.',
    });
  }

  const user = users[idx];

  // Check if user is already verified
  if (user.verified === true) {
    return res.json({
      ok: true,
      message: 'This email address is already verified.',
    });
  }

  // Generate new JWT verification token
  const verificationToken = tokenUtils.generateVerificationToken(user, {
    expiresInHours: 24,
  });

  // Store token info
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  // Send verification email via Postmark BEFORE saving token
  try {
    logger.info('Resending verification email');
    await postmark.sendVerificationEmail(user, verificationToken);
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

  const users = await dbUnified.read('users');
  const idx = users.findIndex(u => u.id === req.user.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = users[idx];

  // Check if email is being changed and if it's already taken
  const profileUpdates = {};
  const emailOriginal = user.email;

  if (email && email !== user.email) {
    const emailExists = users.some(u => u.email === email && u.id !== user.id);
    if (emailExists) {
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

module.exports = router;
module.exports.setSendMailFunction = setSendMailFunction;
module.exports.initializeDependencies = initializeDependencies;
