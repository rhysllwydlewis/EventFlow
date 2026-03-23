/**
 * Rate Limiting Middleware
 * Configures comprehensive rate limiters for different types of requests
 * to protect against abuse and ensure fair resource usage
 */

'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Strict rate limit for authentication endpoints
 * Protects against brute force attacks and credential stuffing
 * 10 requests per 15 minutes - balances security with user experience
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limit for AI/OpenAI endpoints (expensive operations)
 * Prevents excessive usage of costly AI services
 * 50 requests per hour
 */
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 requests per hour
  message: 'Too many AI requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limit for file upload endpoints
 * Prevents storage abuse and resource exhaustion
 * 20 uploads per 15 minutes
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per window
  message: 'Too many upload requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limit for search/discovery endpoints
 * Prevents database overload from excessive searches
 * 30 searches per minute
 */
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 searches per minute
  message: 'Too many search requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limit for notification endpoints
 * Prevents notification spam and API abuse
 * 50 requests per 5 minutes
 */
const notificationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per window
  message: 'Too many notification requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limit
 * Default rate limiting for all API endpoints
 * 100 requests per 15 minutes
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

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
  keyGenerator: req => {
    // Rate limit by email address to prevent abuse of a single account
    return req.body.email || req.ip;
  },
});

/**
 * Rate limiter for API documentation and bot-probe paths
 * Applies to /api-docs*, /swagger*, /openapi* to throttle automated scanners
 * 20 requests per 15 minutes per IP
 */
const apiDocsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: 'Too many requests to this endpoint, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authLimiter,
  aiLimiter,
  uploadLimiter,
  searchLimiter,
  notificationLimiter,
  apiLimiter,
  writeLimiter,
  resendEmailLimiter,
  apiDocsLimiter,
};
