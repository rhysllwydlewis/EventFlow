/**
 * JWT Token Utilities for Email Verification
 * Provides secure token generation and validation with HMAC-SHA256 signing
 *
 * Features:
 * - Cryptographically signed JWT tokens
 * - Expiration validation with grace periods
 * - Token versioning for revocation
 * - Rate limiting support
 * - Comprehensive logging
 *
 * Environment Variables:
 * - JWT_SECRET: Secret key for signing tokens (required)
 * - TOKEN_EXPIRY_HOURS: Token expiration time in hours (default: 24)
 * - TOKEN_GRACE_PERIOD_MINUTES: Grace period for expired tokens (default: 5)
 */

'use strict';

const jwt = require('jsonwebtoken');
const logger = require('./logger');
const crypto = require('crypto');

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';
const TOKEN_EXPIRY_HOURS = parseInt(process.env.TOKEN_EXPIRY_HOURS || '24', 10);
const TOKEN_GRACE_PERIOD_MINUTES = parseInt(process.env.TOKEN_GRACE_PERIOD_MINUTES || '5', 10);
const TOKEN_VERSION = 1; // Increment this to invalidate all existing tokens
const PENDING_USER_ID = 'pending'; // Used for email verification tokens when user ID is not yet assigned

// Warn if using default secret in any environment — this is a dev-only placeholder.
if (JWT_SECRET === 'change_me_in_production') {
  if (process.env.NODE_ENV === 'production') {
    logger.error(
      '❌ CRITICAL: JWT_SECRET is not set! Using default secret is INSECURE in production!'
    );
  } else {
    logger.warn(
      '⚠️  JWT_SECRET is using the dev-only default. Set JWT_SECRET before deploying to production.'
    );
  }
}

/**
 * Token types
 */
const TOKEN_TYPES = {
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
};

/**
 * Generate a verification token for email verification
 * @param {Object} user - User object with id, email
 * @param {Object} options - Optional settings
 * @param {number} options.expiresInHours - Override default expiration (hours)
 * @param {string} options.type - Token type (default: email_verification)
 * @returns {string} JWT token
 */
function generateVerificationToken(user, options = {}) {
  if (!user || !user.id || !user.email) {
    throw new Error('User object must contain id and email');
  }

  const expiresInHours = options.expiresInHours || TOKEN_EXPIRY_HOURS;
  const type = options.type || TOKEN_TYPES.EMAIL_VERIFICATION;

  const payload = {
    sub: user.id, // Subject (user ID)
    email: user.email.toLowerCase(), // Email (normalized)
    type: type, // Token type
    ver: TOKEN_VERSION, // Token version for revocation
    iat: Math.floor(Date.now() / 1000), // Issued at
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: `${expiresInHours}h`,
    algorithm: 'HS256',
  });

  logger.info(`🔐 Generated ${type} token for ${maskEmail(user.email)}`);
  logger.info(`   User ID: ${user.id}`);
  logger.info(`   Expires: ${expiresInHours}h`);
  logger.info(`   Version: ${TOKEN_VERSION}`);

  return token;
}

/**
 * Validate a verification token
 * @param {string} token - JWT token to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowGracePeriod - Allow expired tokens within grace period
 * @param {string} options.expectedType - Expected token type
 * @returns {Object} Decoded token payload or validation error
 */
function validateVerificationToken(token, options = {}) {
  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      error: 'MISSING_TOKEN',
      message: 'Verification token is required',
    };
  }

  const allowGracePeriod = options.allowGracePeriod !== false;
  const expectedType = options.expectedType || TOKEN_TYPES.EMAIL_VERIFICATION;

  try {
    // First, decode without verification to check expiration
    const decoded = jwt.decode(token);

    if (!decoded) {
      logger.error('❌ Token validation failed: Invalid token format');
      return {
        valid: false,
        error: 'INVALID_FORMAT',
        message: 'Invalid token format',
      };
    }

    // Check token version
    if (decoded.ver !== TOKEN_VERSION) {
      logger.warn(`⚠️ Token version mismatch: got ${decoded.ver}, expected ${TOKEN_VERSION}`);
      return {
        valid: false,
        error: 'TOKEN_REVOKED',
        message: 'This verification link has been revoked. Please request a new one.',
      };
    }

    // Check token type
    if (decoded.type !== expectedType) {
      logger.error(`❌ Token type mismatch: got ${decoded.type}, expected ${expectedType}`);
      return {
        valid: false,
        error: 'WRONG_TOKEN_TYPE',
        message: 'Invalid token type',
      };
    }

    // Verify signature and expiration
    const verified = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    });

    logger.info(`✅ Token validated successfully for ${maskEmail(verified.email)}`);
    logger.info(`   User ID: ${verified.sub}`);
    logger.info(`   Issued: ${new Date(verified.iat * 1000).toISOString()}`);
    logger.info(`   Expires: ${new Date(verified.exp * 1000).toISOString()}`);

    return {
      valid: true,
      userId: verified.sub,
      email: verified.email,
      type: verified.type,
      issuedAt: new Date(verified.iat * 1000),
      expiresAt: new Date(verified.exp * 1000),
    };
  } catch (err) {
    // Handle specific JWT errors
    if (err.name === 'TokenExpiredError') {
      const decoded = jwt.decode(token);
      const expiredAt = new Date(err.expiredAt);
      const now = new Date();
      const minutesSinceExpiry = (now - expiredAt) / 1000 / 60;

      logger.warn(`⚠️ Token expired: ${maskEmail(decoded?.email || 'unknown')}`);
      logger.warn(`   Expired at: ${expiredAt.toISOString()}`);
      logger.warn(`   Minutes since expiry: ${minutesSinceExpiry.toFixed(1)}`);

      // Check if within grace period
      if (allowGracePeriod && minutesSinceExpiry <= TOKEN_GRACE_PERIOD_MINUTES) {
        logger.info(`✅ Token within grace period (${TOKEN_GRACE_PERIOD_MINUTES} minutes)`);
        return {
          valid: true,
          userId: decoded.sub,
          email: decoded.email,
          type: decoded.type,
          issuedAt: new Date(decoded.iat * 1000),
          expiresAt: new Date(decoded.exp * 1000),
          withinGracePeriod: true,
        };
      }

      return {
        valid: false,
        error: 'TOKEN_EXPIRED',
        message: `This verification link expired ${formatTimeAgo(expiredAt)}. Please request a new one.`,
        expiredAt: expiredAt,
        canResend: true,
      };
    }

    if (err.name === 'JsonWebTokenError') {
      logger.error(`❌ Token validation failed: ${err.message}`);
      return {
        valid: false,
        error: 'INVALID_SIGNATURE',
        message: 'Invalid or tampered token',
      };
    }

    if (err.name === 'NotBeforeError') {
      logger.error(`❌ Token not yet valid: ${err.message}`);
      return {
        valid: false,
        error: 'TOKEN_NOT_YET_VALID',
        message: 'Token is not yet valid',
      };
    }

    // Unknown error
    logger.error(`❌ Unexpected token validation error: ${err.message}`);
    return {
      valid: false,
      error: 'VALIDATION_ERROR',
      message: 'Token validation failed',
    };
  }
}

/**
 * Check if a token is a JWT token (vs legacy random token)
 * @param {string} token - Token to check
 * @returns {boolean} True if token appears to be a JWT
 */
function isJWTToken(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // JWT tokens have three parts separated by dots
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  // Check if first part decodes to valid JSON (header)
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    return header.alg === 'HS256' && (header.typ === 'JWT' || !header.typ);
  } catch (err) {
    return false;
  }
}

/**
 * Extract token from various sources (query, body, headers)
 * @param {Object} req - Express request object
 * @returns {string|null} Extracted token or null
 */
function extractToken(req) {
  // Try query parameter first (most common for email links)
  if (req.query && req.query.token) {
    return req.query.token;
  }

  // Try request body
  if (req.body && req.body.token) {
    return req.body.token;
  }

  // Try Authorization header (Bearer token)
  if (req.headers && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }
  }

  // Try custom X-Verification-Token header
  if (req.headers && req.headers['x-verification-token']) {
    return req.headers['x-verification-token'];
  }

  return null;
}

/**
 * Generate a secure random token (fallback for non-JWT systems)
 * @param {string} prefix - Prefix for the token (e.g., 'verify', 'reset')
 * @returns {string} Random token with prefix
 */
function generateRandomToken(prefix = 'token') {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `${prefix}_${randomBytes}`;
}

/**
 * Mask email address for logging
 * @param {string} email - Email to mask
 * @returns {string} Masked email
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') {
    return '***';
  }

  const [local, domain] = email.split('@');
  if (!domain) {
    return '***';
  }

  const maskedLocal =
    local.length > 2
      ? local[0] + '*'.repeat(Math.min(local.length - 1, 5))
      : '*'.repeat(local.length);

  return `${maskedLocal}@${domain}`;
}

/**
 * Format time ago string
 * @param {Date} date - Date to format
 * @returns {string} Human-readable time ago string
 */
function formatTimeAgo(date) {
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Debug token information (development only)
 * @param {string} token - Token to debug
 * @returns {Object} Token debug information
 */
function debugToken(token) {
  if (process.env.NODE_ENV === 'production') {
    return { error: 'Debug information disabled in production' };
  }

  if (!token) {
    return { error: 'No token provided' };
  }

  try {
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded) {
      return {
        isJWT: isJWTToken(token),
        format: 'Invalid or legacy token',
        token: `${token.substring(0, 20)}...`,
      };
    }

    return {
      isJWT: true,
      header: decoded.header,
      payload: {
        ...decoded.payload,
        email: maskEmail(decoded.payload.email),
      },
      issuedAt: new Date(decoded.payload.iat * 1000).toISOString(),
      expiresAt: new Date(decoded.payload.exp * 1000).toISOString(),
      isExpired: decoded.payload.exp < Date.now() / 1000,
      version: decoded.payload.ver,
      currentVersion: TOKEN_VERSION,
      versionValid: decoded.payload.ver === TOKEN_VERSION,
    };
  } catch (err) {
    return {
      error: err.message,
      isJWT: isJWTToken(token),
    };
  }
}

/**
 * Generate a password reset token
 * @param {string} email - User email address
 * @param {Object} options - Optional settings
 * @param {number} options.expiresInHours - Override default expiration (hours, default: 1)
 * @returns {string} JWT token
 */
function generatePasswordResetToken(email, options = {}) {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required for password reset token');
  }

  const expiresInHours = options.expiresInHours || 1; // Default 1 hour for password reset

  const payload = {
    email: email.toLowerCase(),
    type: TOKEN_TYPES.PASSWORD_RESET,
    ver: TOKEN_VERSION,
    iat: Math.floor(Date.now() / 1000),
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: `${expiresInHours}h`,
    algorithm: 'HS256',
  });

  logger.info(`🔐 Generated password reset token for ${maskEmail(email)}`);
  logger.info(`   Expires: ${expiresInHours}h`);
  logger.info(`   Version: ${TOKEN_VERSION}`);

  return token;
}

/**
 * Validate a password reset token
 * @param {string} token - JWT token to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowGracePeriod - Allow expired tokens within grace period (default: false for resets)
 * @returns {Object} Decoded token payload or validation error
 */
function validatePasswordResetToken(token, options = {}) {
  return validateVerificationToken(token, {
    allowGracePeriod: options.allowGracePeriod !== undefined ? options.allowGracePeriod : false,
    expectedType: TOKEN_TYPES.PASSWORD_RESET,
  });
}

/**
 * Generate email verification token (alias for backward compatibility)
 * @param {string} email - User email
 * @param {Object} options - Optional settings
 * @returns {string} JWT token
 */
function generateEmailVerificationToken(email, options = {}) {
  // For email verification tokens, we need the user object format
  // Create a minimal user object if just email is provided
  if (typeof email === 'string') {
    return generateVerificationToken(
      { email: email, id: PENDING_USER_ID },
      { ...options, type: TOKEN_TYPES.EMAIL_VERIFICATION }
    );
  }
  return generateVerificationToken(email, options);
}

module.exports = {
  // Core functions
  generateVerificationToken,
  validateVerificationToken,
  generatePasswordResetToken,
  validatePasswordResetToken,
  generateEmailVerificationToken,

  // Utility functions
  isJWTToken,
  extractToken,
  generateRandomToken,

  // Helper functions
  maskEmail,
  formatTimeAgo,
  debugToken,

  // Constants
  TOKEN_TYPES,
  TOKEN_VERSION,
  TOKEN_EXPIRY_HOURS,
  TOKEN_GRACE_PERIOD_MINUTES,
  PENDING_USER_ID,
};
