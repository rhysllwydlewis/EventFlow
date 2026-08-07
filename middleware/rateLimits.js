/**
 * Rate Limiting Middleware
 * Configures comprehensive rate limiters for different types of requests
 * to protect against abuse and ensure fair resource usage
 */

'use strict';

const rateLimit = require('express-rate-limit');

const PHOTO_ASSET_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PHOTO_ASSET_PATH_PATTERN = /^\/api\/(?:v1\/)?photos\/[^/?#]+$/;
const PUBLIC_CALENDAR_EVENTS_PATH_PATTERN =
  /^\/api\/(?:v1\/)?public-calendar\/events(?:\/[^/?#]+(?:\/ics)?)?\/?$/;
const parsedPhotoAssetLimit = Number.parseInt(process.env.PHOTO_ASSET_RATE_LIMIT_MAX || '3000', 10);
const PHOTO_ASSET_RATE_LIMIT_MAX = Number.isFinite(parsedPhotoAssetLimit)
  ? parsedPhotoAssetLimit
  : 3000;
const parsedPublicReadLimit = Number.parseInt(process.env.PUBLIC_READ_RATE_LIMIT_MAX || '3000', 10);
const PUBLIC_READ_RATE_LIMIT_MAX = Number.isFinite(parsedPublicReadLimit)
  ? Math.max(100, parsedPublicReadLimit)
  : 3000;

function getRequestPath(req) {
  try {
    return new URL(req.originalUrl || req.url || '', 'https://event-flow.local').pathname;
  } catch (_error) {
    return String(req.originalUrl || req.url || '').split('?')[0];
  }
}

function isPhotoAssetRequest(req) {
  return req.method === 'GET' && PHOTO_ASSET_PATH_PATTERN.test(getRequestPath(req));
}

function isPublicCalendarReadRequest(req) {
  if (req.method !== 'GET') {
    return false;
  }
  const requestPath = getRequestPath(req);
  if (!PUBLIC_CALENDAR_EVENTS_PATH_PATTERN.test(requestPath)) {
    return false;
  }
  return !/\/events\/saved\/?$/.test(requestPath);
}

function isBackendE2ERequest() {
  // The full backend browser server is a single isolated CI process that executes
  // many independent specs through one loopback address. Keeping normal per-IP
  // buckets enabled there makes unrelated tests exhaust each other's allowance.
  // Production, development and the ordinary Jest environment remain rate-limited.
  return process.env.NODE_ENV === 'test' && process.env.E2E_MODE === 'full';
}

/**
 * Strict rate limit for authentication endpoints
 * Protects against brute force attacks and credential stuffing
 * 10 requests per 15 minutes - balances security with user experience
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Stricter rate limit for sensitive login endpoints (login, 2FA)
 * 5 requests per 15 minutes to limit brute-force on credentials
 */
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for registration — tighter than authLimiter because each attempt triggers
 * a bcrypt hash (~177 ms CPU) and an outbound email (Postmark API call).
 * 5 registrations per hour per IP is generous for real users, too slow for abuse.
 */
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts. Please try again in an hour.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for password-reset flows (forgot, reset-password, validate-reset-token)
 * 5 requests per 15 minutes to prevent reset-link spam and enumeration attempts
 */
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many password reset requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for AI/OpenAI endpoints (expensive operations)
 * Prevents excessive usage of costly AI services
 * 50 requests per hour
 */
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Too many AI requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for file upload endpoints
 * Prevents storage abuse and resource exhaustion
 * 20 uploads per 15 minutes
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many upload requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for search/discovery endpoints
 * Prevents database overload from excessive searches
 * 30 searches per minute
 */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many search requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for notification endpoints
 * Prevents notification spam and API abuse
 * 50 requests per 5 minutes
 */
const notificationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 50,
  message: 'Too many notification requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for authenticated messenger read endpoints (conversation/message
 * listing, unread counts, contacts, search). These were previously open to
 * unlimited polling by any logged-in user, unlike every write route on the
 * same router. 120 requests/minute comfortably covers normal UI polling
 * while capping scripted abuse.
 */
const messengerReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Too many requests, please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limit for public photo asset delivery.
 *
 * Browser image loads must not share the strict general API limiter: one homepage
 * refresh can legitimately request many package, marketplace, and collage images.
 */
const photoAssetLimiter = rateLimit({
  windowMs: PHOTO_ASSET_LIMIT_WINDOW_MS,
  max: PHOTO_ASSET_RATE_LIMIT_MAX,
  message: {
    error: 'Too many photo asset requests, please try again shortly.',
    errorType: 'PhotoAssetRateLimit',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
  handler: (req, res, _next, options) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(Math.ceil(PHOTO_ASSET_LIMIT_WINDOW_MS / 1000)));
    return res.status(options.statusCode).json(options.message);
  },
});

/**
 * Higher-volume limiter for anonymous, read-only public catalogue data.
 * Search crawlers and shared networks must not exhaust the strict JSON API bucket
 * while rendering indexable event pages, but the endpoint remains abuse-limited.
 */
const publicReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PUBLIC_READ_RATE_LIMIT_MAX,
  message: 'Too many public catalogue requests, please try again shortly.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

const baseApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * General API rate limit.
 *
 * Public photo binaries and public calendar reads are routed through purpose-built
 * buckets instead of the strict JSON API allowance. This prevents image-heavy pages
 * and legitimate crawler rendering from intermittently receiving HTTP 429 responses.
 */
function apiLimiter(req, res, next) {
  if (isPhotoAssetRequest(req)) {
    return photoAssetLimiter(req, res, next);
  }
  if (isPublicCalendarReadRequest(req)) {
    return publicReadLimiter(req, res, next);
  }

  return baseApiLimiter(req, res, next);
}

/**
 * Rate limiter for write operations
 * Applies to POST/PUT/PATCH/DELETE operations
 * 80 requests per 10 minutes
 */
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

/**
 * Rate limiter for email resend operations
 * 3 requests per 15 minutes per email address
 */
const resendEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: 'Too many resend requests. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
  keyGenerator: req => req.body.email || req.ip,
});

/**
 * Rate limiter for API documentation and bot-probe paths
 * Applies to /api-docs*, /swagger*, /openapi* to throttle automated scanners
 * 20 requests per 15 minutes per IP
 */
const apiDocsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests to this endpoint, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBackendE2ERequest,
});

module.exports = {
  authLimiter,
  strictAuthLimiter,
  passwordResetLimiter,
  aiLimiter,
  uploadLimiter,
  searchLimiter,
  notificationLimiter,
  messengerReadLimiter,
  apiLimiter,
  publicReadLimiter,
  photoAssetLimiter,
  writeLimiter,
  resendEmailLimiter,
  registrationLimiter,
  apiDocsLimiter,
  _private: {
    getRequestPath,
    isPhotoAssetRequest,
    isPublicCalendarReadRequest,
    isBackendE2ERequest,
  },
};
