/**
 * Authentication and Authorization Middleware
 * Handles JWT verification, role-based access control, and auth helpers
 */

'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = String(process.env.JWT_SECRET || 'change_me');

// Validate JWT secret at module load time
if (
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET.trim() === '' ||
  process.env.JWT_SECRET === 'change_me'
) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: JWT_SECRET is missing, blank, or set to default value in production. ' +
        'Please set a strong JWT_SECRET environment variable.'
    );
  } else {
    // Warn developers so they remember to set this before deploying.
    const logger = require('../utils/logger');
    logger.warn(
      '⚠️  JWT_SECRET is using the dev-only default ("change_me"). Set JWT_SECRET before deploying to production.'
    );
  }
}

/**
 * Set authentication cookie with JWT token
 * @param {Object} res - Express response object
 * @param {string} token - JWT token to set in cookie
 * @param {Object} options - Cookie options
 * @param {boolean} options.remember - If true, persists for 7 days; if false, session-only
 */
function setAuthCookie(res, token, options = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    // Use 'lax' for better compatibility while still providing CSRF protection
    // 'strict' can prevent cookies from being sent during same-site navigation in some browsers
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  };

  // If remember is true, set maxAge for 7 days; otherwise, no maxAge (session-only)
  if (options.remember) {
    cookieOptions.maxAge = 1000 * 60 * 60 * 24 * 7; // 7 days
  }
  // If remember is false or not set, cookie expires when browser closes (session-only)

  res.cookie('token', token, cookieOptions);
}

/**
 * Clear authentication cookie
 * Clears cookie with multiple domain configurations to ensure cleanup across www/apex variants
 * @param {Object} res - Express response object
 */
function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === 'production';

  // Clear cookie with same options used when setting it
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
  });

  // Also clear without path option for legacy compatibility
  res.clearCookie('token');

  // In production, also try clearing with explicit COOKIE_DOMAIN variants when configured.
  // Only do this when COOKIE_DOMAIN is explicitly set — no hardcoded fallback domain.
  if (isProd && process.env.COOKIE_DOMAIN) {
    const productionDomain = process.env.COOKIE_DOMAIN;
    const domains = [productionDomain];

    // Also try without leading dot if provided with dot
    if (productionDomain.startsWith('.')) {
      domains.push(productionDomain.substring(1));
    }

    domains.forEach(domain => {
      res.clearCookie('token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        domain: domain,
      });
    });
  }
}

/**
 * Extract and verify user from JWT cookie
 * @param {Object} req - Express request object
 * @returns {Object|null} User object or null if not authenticated
 */
function getUserFromCookie(req) {
  const t = req.cookies && req.cookies.token;
  if (!t) {
    return null;
  }
  try {
    return jwt.verify(t, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Middleware to require authentication
 * Verifies JWT token and attaches user to request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function authRequired(req, res, next) {
  const u = getUserFromCookie(req);
  if (!u) {
    logger.warn('Authentication required but no valid user found', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.status(401).json({
      error: 'Unauthenticated',
      message: 'Please log in to access this resource.',
    });
  }

  // Verify user still exists in database - prevents stale JWT issues
  // Uses indexed query for O(1) performance instead of loading all users
  //
  // Note: Redis caching could be added if auth request volume exceeds 1000 req/sec
  // For most use cases, the indexed MongoDB query provides sufficient performance
  try {
    const dbUnified = require('../db-unified');
    const dbUser = await dbUnified.findOne('users', { id: u.id });

    if (!dbUser) {
      return res.status(401).json({
        error: 'Unauthenticated',
        message: 'User account not found. Please log in again.',
      });
    }

    // Attach only minimal user object to prevent stale data
    req.user = {
      id: u.id,
      email: u.email,
      role: u.role,
      name: dbUser.name || null,
      firstName: dbUser.firstName || null,
      displayName: dbUser.displayName || null,
      businessName: dbUser.businessName || dbUser.company || null,
    };
    // Also expose userId for routes that rely on it
    req.userId = u.id;
    next();
  } catch (error) {
    logger.error('Error verifying user in authRequired:', error);
    // If database is unavailable, return service unavailable instead of bypassing security
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      message: 'Unable to verify authentication. Please try again.',
    });
  }
}

/**
 * Middleware factory to require specific role(s)
 * @param {string|string[]} role - Required role(s) (admin, supplier, customer)
 * @returns {Function} Express middleware function
 */
function roleRequired(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthenticated',
        message: 'Please log in to access this resource.',
      });
    }

    // Handle array of roles
    if (Array.isArray(role)) {
      if (!role.includes(req.user.role)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `This action requires one of the following roles: ${role.join(', ')}. Your current role is ${req.user.role}.`,
        });
      }
    } else {
      // Handle single role (backward compatible)
      if (req.user.role !== role) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `This action requires ${role} role. Your current role is ${req.user.role}.`,
        });
      }
    }
    next();
  };
}

/**
 * Middleware to extract user from JWT cookie
 * Sets req.user and req.userId if valid token exists
 * Non-blocking - continues even if no valid token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function userExtractionMiddleware(req, res, next) {
  const u = getUserFromCookie(req);
  if (u) {
    req.user = u;
    req.userId = u.id;
  }
  next();
}

/**
 * Middleware to check if user owns a plan
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function planOwnerOnly(req, res, next) {
  const { read } = require('../store');
  const plans = read('plans');
  const p = plans.find(x => x.userId === req.userId);
  if (!p) {
    return res.status(404).json({ error: 'No plan found' });
  }
  req.plan = p;
  next();
}

module.exports = {
  JWT_SECRET,
  setAuthCookie,
  clearAuthCookie,
  getUserFromCookie,
  userExtractionMiddleware,
  authRequired,
  roleRequired,
  planOwnerOnly,
};
