/**
 * Security Middleware
 * Configures Helmet CSP, CORS, and rate limiting
 */

'use strict';

const helmet = require('helmet');
// cors is used in server.js via require('cors')
// eslint-disable-next-line no-unused-vars
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Configure Helmet with Content Security Policy
 *
 * SECURITY NOTE: 'unsafe-inline' in scriptSrc
 * ============================================
 * Currently required for inline event handlers (onclick, onerror) in HTML.
 *
 * Files with inline handlers that need refactoring:
 * - public/index.html (onclick handlers)
 * - public/suppliers.html (onclick handlers)
 * - public/gallery.html (onclick, onerror handlers)
 * - Various other HTML files
 *
 * REMEDIATION PLAN (Future PR):
 * 1. Audit all HTML files for inline handlers
 * 2. Move handlers to external JS files with addEventListener
 * 3. Remove 'unsafe-inline' from scriptSrc
 * 4. Test thoroughly across all pages
 *
 * Risk Assessment: MEDIUM
 * - XSS attacks via inline script injection possible
 * - Mitigated by input sanitization and other CSP directives
 *
 * @param {boolean} isProduction - Whether running in production
 * @returns {Function} Helmet middleware
 */
function configureHelmet(isProduction = false) {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          // SECURITY: 'unsafe-inline' currently required - see detailed documentation above
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdn.socket.io',
          'https://cdn.tidycal.net',
          'https://estatic.com',
          'https://*.estatic.com',
          'https://maps.googleapis.com',
          'https://*.googleapis.com',
          'https://maps.gstatic.com',
          'https://*.gstatic.com',
          'https://googletagmanager.com',
          'https://*.googletagmanager.com',
          'https://js.stripe.com',
          'https://static.cloudflareinsights.com',
        ],
        // Explicitly define script-src-elem to avoid fallback ambiguity/noise in browser consoles.
        scriptSrcElem: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://cdn.socket.io',
          'https://cdn.tidycal.net',
          'https://estatic.com',
          'https://*.estatic.com',
          'https://maps.googleapis.com',
          'https://*.googleapis.com',
          'https://maps.gstatic.com',
          'https://*.gstatic.com',
          'https://googletagmanager.com',
          'https://*.googletagmanager.com',
          'https://js.stripe.com',
          'https://static.cloudflareinsights.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, onerror, etc.)
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'blob:',
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          'https:', // Allows all HTTPS images
          'blob:',
          // Explicitly list Pexels domains for documentation and clarity
          // even though 'https:' already allows them
          'https://images.pexels.com',
          'https://*.pexels.com',
        ],
        mediaSrc: [
          "'self'",
          'https:', // Allow all HTTPS video/audio sources
          'blob:',
          // Explicitly list Pexels video domain for clarity
          'https://videos.pexels.com',
          'https://*.pexels.com',
        ],
        connectSrc: [
          "'self'",
          'https:',
          'wss:',
          'ws:',
          'https://googletagmanager.com',
          'https://*.googletagmanager.com',
          'https://*.google-analytics.com',
          'https://*.analytics.google.com',
          'https://*.tidycal.net',
          'https://api.stripe.com',
          'https://static.cloudflareinsights.com',
        ],
        frameSrc: [
          "'self'",
          'https://www.google.com',
          'https://maps.google.com',
          'https://tidycal.com',
          'https://*.tidycal.com',
          'https://js.stripe.com',
          'https://hooks.stripe.com',
        ],
        // Clickjacking protection: prefer frame-ancestors over X-Frame-Options
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
        reportUri: '/api/csp-report',
      },
    },
    // HSTS only in production - do NOT set for localhost/dev/test
    hsts: isProduction
      ? {
          maxAge: 31536000, // 1 year
          includeSubDomains: true,
          preload: false, // Don't enable preload unless explicitly verified
        }
      : false,
    // Fallback clickjacking protection (CSP frame-ancestors is preferred)
    xFrameOptions: { action: 'deny' },
    // X-Content-Type-Options: nosniff (enabled by default, no options needed)
    // Helmet warns if you pass options to xContentTypeOptions - it only accepts true/false
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

/**
 * Configure Permissions-Policy header middleware
 * Restricts browser features (geolocation, camera, microphone) by default
 * @returns {Function} Express middleware
 */
function configurePermissionsPolicy() {
  return (req, res, next) => {
    // Disable geolocation, camera, and microphone by default
    // Only enable these permissions if truly needed for specific features
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    next();
  };
}

/**
 * Configure CORS with proper origin handling
 * Supports multiple origins via environment variables and Railway preview URLs
 * @param {boolean} isProduction - Whether running in production
 * @returns {Object} CORS options
 */
function configureCORS(isProduction = false) {
  return {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Get allowed origins from BASE_URL environment variable
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const allowedOrigins = [baseUrl];

      // Support additional origins via comma-separated ALLOWED_ORIGINS env var
      const additionalOrigins = process.env.ALLOWED_ORIGINS;
      if (additionalOrigins) {
        additionalOrigins.split(',').forEach(o => {
          const trimmed = o.trim();
          if (trimmed) {
            allowedOrigins.push(trimmed);
          }
        });
      }

      // If BASE_URL contains www, also allow non-www version and vice versa
      if (baseUrl.includes('www.')) {
        allowedOrigins.push(baseUrl.replace('www.', ''));
      } else if (baseUrl.includes('://')) {
        const [protocol, domain] = baseUrl.split('://');
        allowedOrigins.push(`${protocol}://www.${domain}`);
      }

      // Support Railway preview URLs in non-production
      // Railway preview URLs follow pattern: https://projectname-pr-123.railway.app
      if (!isProduction && origin.endsWith('.railway.app')) {
        allowedOrigins.push(origin);
      }

      // For development, allow localhost on any port
      if (!isProduction) {
        allowedOrigins.push('http://localhost:3000');
        allowedOrigins.push('http://localhost:3001');
        allowedOrigins.push('http://127.0.0.1:3000');
        // Also allow any localhost port for flexibility in development
        if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
          allowedOrigins.push(origin);
        }
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // In production, reject disallowed origins with detailed error
        if (isProduction) {
          // Log at debug level to avoid information leakage
          logger.debug(`CORS request rejected from non-configured origin`, {
            origin,
          });
          const error = new Error('Not allowed by CORS - origin not in allowed list');
          error.statusCode = 403;
          callback(error);
        } else {
          // In development, allow but warn
          callback(null, true);
          logger.warn(
            `CORS request from non-configured origin (allowed in development): ${origin}`
          );
        }
      }
    },
    credentials: true, // Allow cookies to be sent with requests
    optionsSuccessStatus: 200,
  };
}

/**
 * Create rate limiters for different types of requests
 * @returns {Object} Rate limiter instances
 */
function createRateLimiters() {
  return {
    // General auth limiter - 100 requests per 15 minutes
    authLimiter: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),

    // Strict auth limiter - 10 requests per 15 minutes
    strictAuthLimiter: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many requests. Please try again later.',
    }),

    // Password reset limiter - 5 requests per 15 minutes
    passwordResetLimiter: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many password reset attempts. Please try again later.',
    }),

    // Write operations limiter - 80 requests per 10 minutes
    writeLimiter: rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 80,
      standardHeaders: true,
      legacyHeaders: false,
    }),

    // Health check limiter - 60 requests per minute
    healthCheckLimiter: rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: 'Too many health check requests',
    }),
  };
}

/**
 * Configure HTTPS redirect for production
 * @param {boolean} isProduction - Whether running in production
 * @returns {Function} Express middleware
 */
function configureHTTPSRedirect(isProduction = false) {
  return (req, res, next) => {
    if (!isProduction) {
      return next();
    }

    // Skip HTTPS redirect for health check and readiness endpoints
    if (req.path === '/api/health' || req.path === '/api/ready') {
      return next();
    }

    // Check if request is not secure (HTTP)
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

    if (!isSecure) {
      // Redirect to HTTPS
      const httpsUrl = process.env.BASE_URL || `https://${req.headers.host}`;
      const redirectUrl = `${httpsUrl}${req.url}`;
      return res.redirect(301, redirectUrl);
    }

    // Check for non-www to www redirect (only if BASE_URL contains www)
    // Use the canonical host from BASE_URL instead of req.headers.host to
    // prevent Host header injection (open redirect).
    const configuredBaseUrl = process.env.BASE_URL || '';
    if (configuredBaseUrl.includes('www.')) {
      try {
        const canonicalHost = new URL(configuredBaseUrl).host; // e.g. "www.eventflow.app"
        const nonWwwHost = canonicalHost.replace(/^www\./, ''); // e.g. "eventflow.app"
        if (req.headers.host === nonWwwHost) {
          return res.redirect(301, `https://${canonicalHost}${req.url}`);
        }
      } catch {
        // Malformed BASE_URL — skip redirect rather than use raw host header
      }
    }

    next();
  };
}

module.exports = {
  configureHelmet,
  configurePermissionsPolicy,
  configureCORS,
  createRateLimiters,
  configureHTTPSRedirect,
};
