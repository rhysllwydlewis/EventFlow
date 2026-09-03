/**
 * Sentry Error Tracking and Performance Monitoring
 * Provides error tracking for both backend and frontend
 */

'use strict';

const logger = require('./logger');

let Sentry = null;
let sentryEnabled = false;

/**
 * Initialize Sentry for Node.js backend
 * @param {Object} _app - Express app instance (unused since v8's expressIntegration
 *   no longer needs an app reference at init time; kept for call-site compatibility)
 * @returns {boolean} Whether Sentry was initialized
 */
function initSentry(_app) {
  const sentryDsn = process.env.SENTRY_DSN;
  const environment = process.env.NODE_ENV || 'development';

  if (!sentryDsn) {
    logger.info('ℹ️  Sentry DSN not configured, error tracking disabled');
    return false;
  }

  try {
    // eslint-disable-next-line global-require, node/no-missing-require
    Sentry = require('@sentry/node');

    // Note: the class-based `Sentry.Integrations.*` API and `Sentry.Handlers.*`
    // middleware this file used to call were removed in the @sentry/node v8 SDK
    // (this project has been pinned to ^8.0.0 since before this rewrite) — every
    // call below silently threw on init, was swallowed by this try/catch, and
    // left Sentry permanently disabled regardless of SENTRY_DSN. Rewritten to the
    // current function-style integrations API; httpIntegration/expressIntegration
    // are already included in Sentry's default integrations, so only the
    // non-default Mongo/Redis instrumentation needs to be listed explicitly.
    // Note: Sentry's OpenTelemetry-based auto-instrumentation for Express route
    // performance tracing only attaches if Sentry.init() runs before express is
    // first required anywhere in the process; this app requires express near
    // the top of server.js, ahead of initSentry(), so route-level tracing spans
    // won't appear even though this DOES still initialize correctly and error
    // capture (captureException/setupExpressErrorHandler) works regardless.
    Sentry.init({
      dsn: sentryDsn,
      environment,
      release: process.env.npm_package_version
        ? `eventflow@${process.env.npm_package_version}`
        : undefined,
      // Performance monitoring
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      // Set sampling rate for profiling
      profilesSampleRate: environment === 'production' ? 0.1 : 1.0,
      integrations: [
        Sentry.mongoIntegration({ useMongoose: false }),
        ...(Sentry.redisIntegration ? [Sentry.redisIntegration()] : []),
      ],
      // BeforeSend hook for filtering/modifying events
      beforeSend(event) {
        // Don't send events in test environment
        if (environment === 'test') {
          return null;
        }

        // Filter out sensitive data
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
        }

        return event;
      },
    });

    // v8+ registers request/tracing instrumentation automatically via the
    // integrations above — there is no separate requestHandler/tracingHandler
    // middleware to mount (getRequestHandler/getTracingHandler below are now
    // no-ops, kept only so existing app.use(...) call sites stay valid).
    // The error handler, however, must still be wired in explicitly, and must
    // be attached after routes are registered — see setupExpressErrorHandler().

    sentryEnabled = true;
    logger.info('✅ Sentry error tracking initialized');
    return true;
  } catch (error) {
    logger.error('Failed to initialize Sentry:', error.message);
    return false;
  }
}

/**
 * Attach Sentry's Express error handler to the app. Must be called after all
 * routes/middleware are registered and before any other error-handling
 * middleware (mirrors the old getErrorHandler() call site in server.js).
 * @param {Object} app - Express app instance
 */
function setupExpressErrorHandler(app) {
  if (sentryEnabled && Sentry) {
    Sentry.setupExpressErrorHandler(app);
  }
}

/**
 * @deprecated No-op since the @sentry/node v8 SDK. Request tracking is now
 * automatic via the httpIntegration/expressIntegration registered in
 * initSentry() — there is no separate requestHandler middleware to mount.
 * Kept so existing app.use(sentry.getRequestHandler()) call sites stay valid.
 * @returns {Function} Pass-through Express middleware
 */
function getRequestHandler() {
  return (req, res, next) => next();
}

/**
 * @deprecated No-op since the @sentry/node v8 SDK, for the same reason as
 * getRequestHandler() above.
 * @returns {Function} Pass-through Express middleware
 */
function getTracingHandler() {
  return (req, res, next) => next();
}

/**
 * @deprecated Use setupExpressErrorHandler(app) instead. The @sentry/node v8
 * SDK replaced the errorHandler() middleware factory with a function that
 * attaches itself directly to the app, so it can no longer be returned here
 * for app.use() — this is now a pass-through no-op.
 * @returns {Function} Pass-through Express error middleware
 */
function getErrorHandler() {
  return (err, req, res, next) => next(err);
}

/**
 * Capture exception manually
 * @param {Error} error - Error to capture
 * @param {Object} context - Additional context
 */
function captureException(error, context = {}) {
  if (sentryEnabled && Sentry) {
    Sentry.captureException(error, {
      tags: context.tags || {},
      extra: context.extra || {},
      user: context.user || {},
      level: context.level || 'error',
    });
  } else {
    logger.error('Error:', error, 'Context:', context);
  }
}

/**
 * Capture message manually
 * @param {string} message - Message to capture
 * @param {string} level - Severity level (info, warning, error)
 * @param {Object} context - Additional context
 */
function captureMessage(message, level = 'info', context = {}) {
  if (sentryEnabled && Sentry) {
    Sentry.captureMessage(message, {
      level,
      tags: context.tags || {},
      extra: context.extra || {},
      user: context.user || {},
    });
  } else {
    logger.log(level, message, context);
  }
}

/**
 * Set user context for error tracking
 * @param {Object} user - User information
 */
function setUser(user) {
  if (sentryEnabled && Sentry) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    });
  }
}

/**
 * Clear user context
 */
function clearUser() {
  if (sentryEnabled && Sentry) {
    Sentry.setUser(null);
  }
}

/**
 * Add breadcrumb for tracking user actions
 * @param {Object} breadcrumb - Breadcrumb data
 */
function addBreadcrumb(breadcrumb) {
  if (sentryEnabled && Sentry) {
    Sentry.addBreadcrumb({
      message: breadcrumb.message,
      category: breadcrumb.category || 'custom',
      level: breadcrumb.level || 'info',
      data: breadcrumb.data || {},
    });
  }
}

/**
 * Create transaction for performance monitoring
 * @param {string} name - Transaction name
 * @param {string} op - Operation type
 * @returns {Object} Transaction object
 */
function startTransaction(name, op = 'http') {
  if (sentryEnabled && Sentry) {
    return Sentry.startTransaction({
      name,
      op,
    });
  }
  // Return mock transaction if Sentry is not enabled
  return {
    finish: () => {},
    setTag: () => {},
    setData: () => {},
  };
}

/**
 * Flush pending events (useful before shutdown)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} Whether flush was successful
 */
async function flush(timeout = 2000) {
  if (sentryEnabled && Sentry) {
    try {
      await Sentry.flush(timeout);
      return true;
    } catch (error) {
      logger.error('Sentry flush error:', error);
      return false;
    }
  }
  return true;
}

/**
 * Close Sentry client
 * @returns {Promise<boolean>} Whether close was successful
 */
async function close() {
  if (sentryEnabled && Sentry) {
    try {
      await Sentry.close(2000);
      return true;
    } catch (error) {
      logger.error('Sentry close error:', error);
      return false;
    }
  }
  return true;
}

/**
 * Check if Sentry is enabled
 * @returns {boolean} Whether Sentry is enabled
 */
function isEnabled() {
  return sentryEnabled;
}

module.exports = {
  initSentry,
  setupExpressErrorHandler,
  getRequestHandler,
  getTracingHandler,
  getErrorHandler,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  startTransaction,
  flush,
  close,
  isEnabled,
};
