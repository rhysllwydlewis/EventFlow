/**
 * Security Middleware
 * Configures Helmet CSP, CORS, and rate limiting
 */

'use strict';

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const PRODUCTION_APP_ORIGINS = ['https://event-flow.co.uk', 'https://www.event-flow.co.uk'];

// The supplier profile customisation page still contains two legacy inline scripts
// in the static HTML shell. Keep CSP strict by allowing only their exact hashes
// through script-src rather than weakening the policy with 'unsafe-inline'.
// script-src-elem intentionally falls back to script-src so Chrome can apply
// these hashes consistently for inline script elements.
const LEGACY_PROFILE_CUSTOMIZATION_INLINE_SCRIPT_HASHES = [
  "'sha256-I4IL+1RPLuuXd92FWbs4xjScLQmVhsgQF+cDe/pnxE='",
  "'sha256-N1M6EuZ08OtHzXxJT4SHQYVsxH0E0b52S1I4n3CE7A='",
];

function normalizeCorsOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch (_) {
    return raw.replace(/\/+$/, '');
  }
}

function addAllowedOrigin(allowedOrigins, origin) {
  const normalized = normalizeCorsOrigin(origin);
  if (normalized) {
    allowedOrigins.add(normalized);
  }
}

function addWwwVariant(allowedOrigins, origin) {
  const normalized = normalizeCorsOrigin(origin);
  if (!normalized || !normalized.includes('://')) {
    return;
  }

  const [protocol, domain] = normalized.split('://');
  if (domain.startsWith('www.')) {
    addAllowedOrigin(allowedOrigins, `${protocol}://${domain.slice(4)}`);
  } else {
    addAllowedOrigin(allowedOrigins, `${protocol}://www.${domain}`);
  }
}

/**
 * Configure Helmet with Content Security Policy
 *
 * @param {boolean} isProduction - Whether running in production
 * @returns {Function} Helmet middleware
 */
function configureHelmet(isProduction = false) {
  return helmet({
    // Google Identity Services can briefly use a popup at /gsi/transform even
    // for button flows. Helmet's default `same-origin` COOP severs the popup's
    // opener relationship and leaves that window blank, so allow same-origin
    // isolation while preserving popup communication for trusted sign-in flows.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...LEGACY_PROFILE_CUSTOMIZATION_INLINE_SCRIPT_HASHES,
          'https://cdn.jsdelivr.net',
          'https://cdn.socket.io',
          'https://cdn.tidycal.net',
          'https://estatic.com',
          'https://*.estatic.com',
          'https://accounts.google.com',
          'https://maps.googleapis.com',
          'https://*.googleapis.com',
          'https://maps.gstatic.com',
          'https://*.gstatic.com',
          'https://googletagmanager.com',
          'https://*.googletagmanager.com',
          // Google Ads conversion and remarketing scripts loaded by gtag.js after
          // the visitor grants marketing consent.
          'https://www.googleadservices.com',
          'https://pagead2.googlesyndication.com',
          'https://googleads.g.doubleclick.net',
          'https://www.google.com',
          'https://js.stripe.com',
          'https://static.cloudflareinsights.com',
          // PostHog's official browser snippet converts the ingestion host to
          // its region-specific assets host when analytics consent is granted.
          'https://eu-assets.i.posthog.com',
          'https://us-assets.i.posthog.com',
        ],
        scriptSrcAttr: ["'none'"], // Inline event handlers disallowed; use addEventListener in external JS
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'blob:',
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com',
          'https://accounts.google.com',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: [
          "'self'",
          'data:',
          // Kept broad (unlike connectSrc below) — supplier/marketplace listings hotlink
          // photos from arbitrary hosts suppliers choose, so a fixed allowlist would
          // routinely break real listing images. img-src also can't exfiltrate data the
          // way fetch/XHR/WebSocket can, so the tradeoff differs from connect-src.
          'https:',
          'blob:',
          // Explicitly list Pexels domains for documentation and clarity
          // even though 'https:' already allows them
          'https://images.pexels.com',
          'https://*.pexels.com',
        ],
        mediaSrc: [
          "'self'",
          // Same reasoning as imgSrc above — kept broad for supplier-hosted video/audio.
          'https:',
          'blob:',
          // Explicitly list Pexels video domain for clarity
          'https://videos.pexels.com',
          'https://*.pexels.com',
        ],
        connectSrc: [
          "'self'",
          'wss:',
          // Allow plaintext WebSocket only in development (hot-reload, local tools).
          // In production all WebSocket traffic must use TLS (wss:).
          ...(isProduction ? [] : ['ws:']),
          // No bare 'https:' here (unlike imgSrc/mediaSrc above): connect-src governs
          // fetch/XHR/WebSocket, the classic XSS-to-exfiltration vector, so it's kept to
          // an explicit allowlist of the third-party APIs the app actually calls.
          'https://googletagmanager.com',
          'https://*.googletagmanager.com',
          'https://*.google-analytics.com',
          'https://*.analytics.google.com',
          // Google Ads conversion and remarketing endpoints. Keep these explicit:
          // connect-src deliberately has no broad https: wildcard.
          'https://pagead2.googlesyndication.com',
          'https://www.googleadservices.com',
          'https://googleads.g.doubleclick.net',
          'https://ad.doubleclick.net',
          'https://www.google.com',
          'https://google.com',
          'https://*.tidycal.net',
          'https://api.stripe.com',
          'https://static.cloudflareinsights.com',
          'https://accounts.google.com',
          // PostHog event ingestion (behaviour-analytics.js / analytics-consent-upgrade.js);
          // POSTHOG_API_HOST defaults to eu.i.posthog.com but is env-configurable, so this
          // covers any regional ingestion host under the same PostHog domain.
          'https://*.i.posthog.com',
          // JadeAssist chat widget backend (jadeassist-init.v2.js / vendor/jade-widget.js,
          // loaded site-wide). Missed in the initial connect-src narrowing because its
          // fetch() call target is built from a runtime `this.baseUrl` variable, not a
          // literal 'https://...' string, so it didn't turn up in a source grep for
          // literal URLs — verified directly against jade-widget.js's fetch() call.
          'https://jadeassistbackend-production.up.railway.app',
        ],
        frameSrc: [
          "'self'",
          'https://www.googletagmanager.com',
          'https://accounts.google.com',
          'https://www.google.com',
          'https://maps.google.com',
          'https://tidycal.com',
          'https://*.tidycal.com',
          'https://js.stripe.com',
          'https://hooks.stripe.com',
        ],
        // Clickjacking protection: prefer frame-ancestors over X-Frame-Options
        frameAncestors: ["'none'"],
        workerSrc: ["'self'", 'blob:'],
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
 * Restricts browser features (geolocation, camera, microphone) by default.
 * Geolocation is permitted for the Marketplace page (used by "Use My Location").
 * @returns {Function} Express middleware
 */
function configurePermissionsPolicy() {
  return (req, res, next) => {
    // Allow geolocation only on the marketplace page (required for "Use My Location" feature)
    const isMarketplacePage = req.path === '/marketplace' || req.path === '/marketplace.html';
    const geolocationPolicy = isMarketplacePage ? 'geolocation=(self)' : 'geolocation=()';
    res.setHeader('Permissions-Policy', `${geolocationPolicy}, camera=(), microphone=()`);
    next();
  };
}

/**
 * Configure CORS with proper origin handling
 * Supports multiple origins via environment variables and Railway preview URLs
 * @param {boolean} isProduction - Whether running in production
 * @returns {Object} CORS options
 */
function isGoogleRedirectCallbackRequest(req) {
  if (!req) {
    return false;
  }

  const path = req.path || String(req.originalUrl || req.url || '').split('?')[0];
  return (
    req.method === 'POST' &&
    (path === '/api/auth/callback/google' || path === '/api/v1/auth/callback/google')
  );
}

function isOpaqueOrigin(origin) {
  return origin === 'null';
}

function isAllowedGoogleCallbackOrigin(origin, allowedOrigins) {
  const googleIdentityOrigins = new Set(['https://accounts.google.com']);
  if (googleIdentityOrigins.has(normalizeCorsOrigin(origin))) {
    return true;
  }

  return allowedOrigins.has(normalizeCorsOrigin(origin));
}

function configureCORS(isProduction = false, req = null) {
  return {
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        return callback(null, true);
      }

      const requestOrigin = normalizeCorsOrigin(origin);

      // Google Identity Services redirect mode can send credential callbacks from
      // accounts.google.com. Keep that origin globally trusted for existing GIS
      // integrations; the exact callback route below also lets opaque `null`
      // browser origins reach route-level CSRF and ID-token validation without
      // granting them CORS response headers.
      if (requestOrigin === 'https://accounts.google.com') {
        return callback(null, true);
      }

      // Get allowed origins from BASE_URL environment variable. Normalize every
      // configured value to URL.origin so a trailing slash or accidental path in
      // Railway/env config cannot make the real browser Origin header fail.
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const allowedOrigins = new Set();
      addAllowedOrigin(allowedOrigins, baseUrl);
      addWwwVariant(allowedOrigins, baseUrl);

      // The public production domain must remain valid even when deployment
      // configuration points BASE_URL at a preview/internal URL.
      if (isProduction) {
        PRODUCTION_APP_ORIGINS.forEach(appOrigin => addAllowedOrigin(allowedOrigins, appOrigin));
      }

      // Support additional origins via comma-separated ALLOWED_ORIGINS env var
      const additionalOrigins = process.env.ALLOWED_ORIGINS;
      if (additionalOrigins) {
        additionalOrigins.split(',').forEach(o => {
          addAllowedOrigin(allowedOrigins, o);
          addWwwVariant(allowedOrigins, o);
        });
      }

      // Google Identity Services redirect-mode callbacks are browser form
      // navigations rather than application XHR calls. Some browsers/privacy
      // contexts can send `Origin: null` for those navigations. For that exact
      // POST callback only, disable CORS header emission but do not reject the
      // request, so Google's double-submit CSRF and ID-token checks decide it.
      if (isGoogleRedirectCallbackRequest(req)) {
        if (isOpaqueOrigin(origin)) {
          return callback(null, false);
        }

        if (isAllowedGoogleCallbackOrigin(origin, allowedOrigins)) {
          return callback(null, true);
        }
      }

      // Support Railway preview URLs in non-production
      // Railway preview URLs follow pattern: https://projectname-pr-123.railway.app
      if (!isProduction && requestOrigin.endsWith('.railway.app')) {
        addAllowedOrigin(allowedOrigins, requestOrigin);
      }

      // For development, allow localhost on any port
      if (!isProduction) {
        addAllowedOrigin(allowedOrigins, 'http://localhost:3000');
        addAllowedOrigin(allowedOrigins, 'http://localhost:3001');
        addAllowedOrigin(allowedOrigins, 'http://127.0.0.1:3000');
        // Also allow any localhost port for flexibility in development
        if (
          requestOrigin.startsWith('http://localhost:') ||
          requestOrigin.startsWith('http://127.0.0.1:')
        ) {
          addAllowedOrigin(allowedOrigins, requestOrigin);
        }
      }

      if (allowedOrigins.has(requestOrigin)) {
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

function configureCORSMiddleware(isProduction = false) {
  return cors((req, callback) => {
    callback(null, configureCORS(isProduction, req));
  });
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
function resolveCanonicalProductionOrigin() {
  const configured =
    process.env.CANONICAL_BASE_URL || process.env.BASE_URL || 'https://event-flow.co.uk';

  try {
    const parsed = new URL(configured);
    const parsedOrigin = parsed.origin;
    if (parsed.protocol !== 'https:' || !PRODUCTION_APP_ORIGINS.includes(parsedOrigin)) {
      return null;
    }
    return parsedOrigin;
  } catch (_) {
    return null;
  }
}

/**
 * Configure HTTPS and canonical-host redirects for production.
 * Only known public hosts may be redirected; unknown Host values are never reflected.
 *
 * @param {boolean} isProduction - Whether running in production
 * @returns {Function} Express middleware
 */
function configureHTTPSRedirect(isProduction = false) {
  return (req, res, next) => {
    if (!isProduction) {
      return next();
    }

    // Railway probes these endpoints directly; do not redirect health traffic.
    if (req.path === '/api/health' || req.path === '/api/ready') {
      return next();
    }

    const canonicalOrigin = resolveCanonicalProductionOrigin();
    const canonicalHost = canonicalOrigin ? new URL(canonicalOrigin).host.toLowerCase() : '';
    const requestHost = String(req.headers.host || '').toLowerCase();
    const requestUrl = req.originalUrl || req.url || '/';
    const productionHosts = new Set(
      PRODUCTION_APP_ORIGINS.map(origin => new URL(origin).host.toLowerCase())
    );
    const isKnownPublicHost = productionHosts.has(requestHost);
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

    if (!isSecure) {
      if (!canonicalOrigin || !isKnownPublicHost) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(308, canonicalOrigin + requestUrl);
    }

    if (canonicalOrigin && isKnownPublicHost && requestHost !== canonicalHost) {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(308, canonicalOrigin + requestUrl);
    }

    return next();
  };
}

module.exports = {
  configureHelmet,
  configurePermissionsPolicy,
  configureCORS,
  configureCORSMiddleware,
  createRateLimiters,
  configureHTTPSRedirect,
};
